> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 13: Camada de Hooks — Bridge de Lógica de Negócio

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Explicar o propósito arquitetural de `src/hooks/` e por que existe como camada distinta entre REPL.tsx e os sistemas de motor subjacentes
* Ler `useCanUseTool.tsx` com consciência de que é output do React Compiler, entender seu dispatch de três estratégias e traçar uma decisão de permissão do início ao `PermissionDecisionReason` resolvido
* Descrever como `useLogMessages.ts` resolve o problema de eventos de alta frequência via batching
* Seguir um slash command por `useCommandQueue.ts` do input do usuário à execução completa
* Entender que estado `useTextInput.ts` possui e como modela movimento de cursor multi-linha
* Descrever os dois modos de completion de `useTypeahead.tsx` e como compartilham um shape de retorno comum
* Explicar o que `useReplBridge.tsx` sincroniza, em qual direção e para qual categoria de consumidor

---

## 13.1 A Arquitetura da Camada de Hooks

O diretório `src/hooks/` contém aproximadamente 100 arquivos. Cada arquivo existe para resolver um de três problemas que REPL.tsx enfrentaria se tentasse tratar tudo inline.

**O primeiro problema é isolamento.** REPL.tsx seria ilegível se contivesse diretamente a lógica de assinatura de eventos do QueryEngine, as leituras de sistema de arquivos debounced para completion de arquivo, o proxy IPC para delegação de permissão de swarm e a aritmética de posição de cursor para edição multi-linha. Extrair cada preocupação em um hook dá a ela um limite claro e um nome.

**O segundo problema é bridging.** Os sistemas abaixo do REPL.tsx — QueryEngine, registro de comandos, sistema de permissão — não são construtos React. São classes e funções TypeScript puras sem consciência do modelo de renderização do React. Um hook é o mecanismo React padrão para envolver um sistema não-React de modo que participe no fluxo de dados reativo.

**O terceiro problema é reutilização.** Um hook que encapsula gerenciamento de estado de input pode ser usado pelo REPL principal e por um harness de teste headless sem que nenhum consumidor saiba da existência do outro.

**Modelo mental:** REPL.tsx é a camada de aplicação (o que declarar que precisa). Os hooks são a camada de transporte (como os dados chegam de fontes não-React). Os sistemas subjacentes — QueryEngine, registro de comandos, motor de permissão — são a camada de rede (fazem o trabalho real e são indiferentes à existência do React).

---

## 13.2 `useCanUseTool.tsx` — O Hub de Decisão de Permissão

`src/hooks/useCanUseTool.tsx`

Este hook é a face reativa de todo o sistema de permissão descrito no Capítulo 7.

**Nota importante:** `useCanUseTool.tsx` é output do React Compiler, não código-fonte escrito à mão. O compilador insere memoização automaticamente. Quando você abre o arquivo e vê `const $ = _c(14)` e `if ($[0] !== someValue) { $[0] = someValue; $[1] = result; }`, você está vendo infraestrutura de cache — leia além dela para encontrar a lógica real de permissão.

O valor de retorno do hook é uma função do tipo `CanUseToolFn`:

```typescript
type CanUseToolFn = (
  tool: Tool,
  input: unknown,
  context: ToolUseContext
) => Promise<PermissionDecision>
```

### 13.2.1 Dispatch de Três Estratégias

O design central de `useCanUseTool` é uma seleção de estratégia que acontece no topo do `CanUseToolFn` que produz:

```typescript
async function canUseTool(tool, input, context): Promise<PermissionDecision> {
  if (isCoordinatorContext(context)) {
    // Estratégia 1: Este é o agente coordinator — fazer proxy para o líder humano
    return coordinatorPermissions.request(tool, input, context)
  }
  if (isSwarmWorker(context)) {
    // Estratégia 2: Este é um worker swarm — fazer proxy via IPC para o coordinator
    return swarmPermissions.request(tool, input, context)
  }
  // Estratégia 3: REPL interativo normal — perguntar ao usuário
  return interactivePermissions.request(tool, input, context)
}
```

### 13.2.2 Fluxo de Decisão Interativo

A estratégia interativa coordena três caminhos de resolução independentes em corrida:

```typescript
const decision = await Promise.race([
  // Caminho A: Classificador especulativo (auto-aprova comandos de baixo risco)
  speculativeClassifier(tool, input, { timeoutMs: 2000 }),
  // Caminho B: Aguardar o usuário interagir com o diálogo
  waitForUserDialog(tool, input),
  // Caminho C: Sinal de abort da sessão
  waitForAbort(context.abortSignal),
])
```

**Caminho A** é o classificador especulativo. Para comandos estatisticamente de baixo risco, um classificador leve avalia a chamada e pode retornar `allow` automaticamente dentro de 2000ms. Se o classificador disparar dentro do timeout, o usuário nunca vê um diálogo.

**Caminho B** é o diálogo interativo. Um objeto de requisição de permissão é empurrado para uma fila de estado React que `PermissionDialog` renderiza. `allow-always` e `deny-always` escrevem de volta em `settings.json` como nova regra.

**Caminho C** é o caminho de abort — se a query é interrompida enquanto o diálogo está aberto.

### 13.2.3 PermissionDecisionReason no Caminho Interativo

O caminho interativo produz um subconjunto das onze variantes de `PermissionDecisionReason`: `settings-allow/deny` (regra explícita correspondeu), `speculative-allow` (classificador aprovado), `interactive-allow-once/always/deny` (escolha explícita do usuário), `worker-proxy` (decisão tunelada via IPC), `coordinator-allow/deny` (coordinator encaminhou ao líder humano).

Essas razões são escritas no log de auditoria de permissão da sessão e disponíveis para chamadores via `SDKResultMessage.permissionDenials`.

---

## 13.3 `useLogMessages.ts` — A Bridge do Stream de Mensagens

`src/hooks/useLogMessages.ts`

O QueryEngine comunica seu progresso através de um stream de objetos `StreamEvent`. `useLogMessages` é a bridge que subscreve a esse emitter e converte seus eventos no array `LogMessage[]` que REPL.tsx passa ao `MessageList`.

### 13.3.1 Assinatura e Ciclo de Vida

```typescript
useEffect(() => {
  const controller = new AbortController()
  const handler = (event: StreamEvent) => {
    if (controller.signal.aborted) return
    receiveEvent(event)
  }
  queryEngine.addEventListener('streamEvent', handler)
  return () => {
    controller.abort()
    queryEngine.removeEventListener('streamEvent', handler)
  }
}, [queryEngine])
```

O duplo guard — tanto o AbortController quanto o `removeEventListener` — lida com a condição de corrida onde um evento dispara após o início do cleanup do efeito. No modo concorrente do React essa corrida é possível.

### 13.3.2 O Problema de Batching

Eventos `text_delta` podem chegar a 50 ou mais por segundo. Uma implementação ingênua chamaria `setState` para cada evento, agendando 50 re-renders por segundo. A solução é batching de eventos:

```typescript
const pendingText = useRef<string>('')
const batchHandle = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)

function flushPendingText() {
  const accumulated = pendingText.current
  pendingText.current = ''
  batchHandle.current = null
  setMessages(prev => appendToLastAssistantMessage(prev, accumulated))
}

function receiveTextDelta(delta: string) {
  pendingText.current += delta
  if (batchHandle.current === null) {
    batchHandle.current = requestAnimationFrame(flushPendingText)
  }
}
```

Uma explosão de 30 tokens dentro de um único frame de 16ms colapsa em uma chamada `setState` e um re-render. Eventos não-texto (`tool_use_start`, `tool_result`, erros) contornam a fila de batch e liberam imediatamente — representam limites semânticos que o usuário quer ver sem esperar pelo próximo frame.

### 13.3.3 Normalização de Mensagens em `applyStreamEvent`

A função `applyStreamEvent` implementa uma máquina de estados sobre o array `messages`: `message_start` empurra nova `AssistantMessage`; `text_delta` encontra a última e acrescenta; `tool_use_start` empurra nova `ToolUseMessage`; `tool_result` empurra nova `ToolResultMessage`; `error` empurra `SystemMessage` com detalhes do erro.

O array `messages` está sempre em estado estruturalmente consistente, mesmo mid-stream — cada estado intermediário é exibível.

---

## 13.4 `useCommandQueue.ts` — Despacho de Slash Command

`src/hooks/useCommandQueue.ts`

### 13.4.1 A Justificativa do Enfileiramento

Sem uma fila, comandos simultâneos podem interagir de formas indefinidas. A fila garante execução serial — o próximo comando na fila não começa até a promise do comando atual resolver.

### 13.4.2 Pipeline de Execução

```typescript
async function executeNext() {
  const cmd = queue.current.shift()
  if (!cmd) { isExecuting.current = false; return }
  isExecuting.current = true
  try {
    const result = await cmd.command.run(cmd.args, cmd.context)
    if (isJSXElement(result)) {
      injectMessageElement(cmd.uuid, result)
    }
    notifyCommandLifecycle(cmd.uuid, 'completed')
  } catch (err) {
    notifyCommandLifecycle(cmd.uuid, 'error')
  } finally {
    executeNext()  // processar próximo na fila
  }
}
```

O bloco `finally` garante que a fila sempre avance, mesmo se um comando lança. Comandos `LocalJSXCommand` — que renderizam UI interativa em vez de executar imperativamente — retornam um elemento React que é injetado na lista de mensagens na posição correta.

---

## 13.5 `useTextInput.ts` — Máquina de Estados do Input Box

`src/hooks/useTextInput.ts`

Possui todo o estado mutável para o componente PromptInput, separando "o que o input contém" de "como é renderizado."

### 13.5.1 Estado Possuído

```typescript
type TextInputState = {
  value: string          // conteúdo de texto atual
  cursorOffset: number   // posição do cursor (baseado em 0)
  history: string[]      // entradas de histórico persistidas
  historyIndex: number   // -1 = na entrada ao vivo
  savedLive: string      // entrada ao vivo salva antes da navegação de histórico
}
```

### 13.5.2 Movimento Multi-Linha do Cursor

Em um campo de texto de linha única, o cursor move-se via offsets de caractere diretos. Em modo multi-linha, a seta para cima move-se para a linha anterior tentando preservar a posição de coluna. O hook calcula isso com divisão de string:

```typescript
function moveCursorUp(state: TextInputState): TextInputState {
  const lines = state.value.split('\n')
  let charsUntilCursor = 0
  let lineIndex = 0
  let colInLine = 0

  // Encontrar em qual linha o cursor está e a posição de coluna
  for (let i = 0; i < lines.length; i++) {
    if (charsUntilCursor + lines[i].length >= state.cursorOffset) {
      lineIndex = i
      colInLine = state.cursorOffset - charsUntilCursor
      break
    }
    charsUntilCursor += lines[i].length + 1 // +1 para \n
  }

  if (lineIndex === 0) return state // já na primeira linha

  const prevLine = lines[lineIndex - 1]
  const newColInLine = Math.min(colInLine, prevLine.length)
  const newCursorOffset = lines.slice(0, lineIndex - 1).reduce((acc, l) => acc + l.length + 1, 0) + newColInLine
  return { ...state, cursorOffset: newCursorOffset }
}
```

### 13.5.3 Tratamento de Composição IME

IME (Input Method Editor) é o mecanismo usado para inserir caracteres CJK e outros scripts complexos. Durante a composição, o usuário digita uma sequência de teclas que são temporariamente exibidas em uma "string de composição" antes de serem confirmadas como caracteres reais. O hook usa eventos `compositionstart` e `compositionend` do termio para rastrear se a composição está ativa e suprime o processamento de teclado normal durante esse período.

---

## 13.6 `useTypeahead.tsx` — Completion de Comando e Arquivo

`src/hooks/useTypeahead.tsx`

O typeahead ativa-se em dois modos baseados no trigger:

**Modo de completion de comando** — o input começa com `/`:
```typescript
function buildCommandCompletions(
  input: string,
  commands: Command[]
): TypeaheadItem[] {
  const query = input.slice(1)  // remove '/'
  const filtered = commands.filter(cmd => !cmd.isHidden)
  if (query.length === 0) return filtered.map(commandToItem)
  return fuzzyFilter(filtered, query, cmd => cmd.name)
    .map(({ item, matches }) => commandToItem(item, matches))
}
```

**Modo de completion de arquivo** — a palavra atual começa com `@`:
```typescript
async function buildFileCompletions(
  prefix: string,
  cwd: string
): Promise<TypeaheadItem[]> {
  const dirPath = path.dirname(prefix) || '.'
  const filePrefix = path.basename(prefix)
  const entries = await fs.readdir(path.join(cwd, dirPath))
  return entries
    .filter(e => e.startsWith(filePrefix))
    .map(e => ({
      label: path.join(dirPath, e),
      isDirectory: isDirectory(path.join(cwd, dirPath, e)),
    }))
}
```

Ambos os modos retornam `TypeaheadItem[]` — o mesmo tipo — para que o componente `FuzzyPicker` os renderize sem saber qual modo está ativo.

O hook monitora `cursorOffset` e `value` do input e recalcula os completions após cada keystroke que afeta a palavra atual. Completions de arquivo são assíncronos (envolvem I/O do sistema de arquivos); o hook armazena a promise de busca atual e cancela chamadas em andamento quando uma nova busca começa.

---

## 13.7 `useReplBridge.tsx` — Ponte de Sessão Remota

`src/hooks/useReplBridge.tsx`

O REPL bridge conecta a sessão CLI local a consumidores remotos: o app móvel do Claude, a extensão de navegador e o cliente web. Esses consumidores querem observar o estado da sessão e opcionalmente enviar input de usuário sem estarem presentes no terminal local.

### 13.7.1 O que É Sincronizado

O bridge sincroniza em três categorias:

**Estado de sessão (local → remoto):** O estado visível da sessão — mensagens, estado de ferramenta ativo, modo de permissão, contador de tokens — é serializado e enviado via WebSocket para consumidores remotos conectados. Essa sincronização acontece sempre que o `AppState` muda.

**Input do usuário (remoto → local):** Quando um consumidor remoto envia input — uma mensagem digitada no app móvel — o bridge recebe isso e o injeta na fila de input do REPL exatamente como se o usuário tivesse digitado no terminal local.

**Decisões de permissão (bidirecional):** Quando uma ferramenta requer aprovação de permissão, a requisição é serializada e enviada para consumidores remotos. Um usuário no app móvel pode aprovar ou negar a requisição; a decisão volta ao bridge e é injetada no sistema de permissão como se tivesse vindo do terminal local.

### 13.7.2 Garantias de Protocolo

O bridge WebSocket usa um protocolo de enfileiramento de mensagens que garante entrega em ordem. Mensagens enviadas enquanto o consumidor remoto está desconectado são enfileiradas e entregues quando a conexão é reestabelecida. O bridge rastreia o `lastSeenMessageId` reportado por cada consumidor remoto e reenvia qualquer histórico de mensagem não confirmado.

---

## 13.8 Diretório `toolPermission/` — Estratégias de Permissão

`src/hooks/toolPermission/` contém quatro arquivos correspondentes às estratégias descritas na Seção 13.2.1.

**`interactivePermissions.ts`** implementa a Estratégia 3 — a corrida de três caminhos descrita na Seção 13.2.2. É o arquivo mais longo e complexo do diretório.

**`coordinatorPermissions.ts`** implementa a Estratégia 1. Quando o agente atual é o coordinator, ele encaminha a questão de permissão para a sessão líder usando o mecanismo de IPC do bridge. O coordinator não toma decisões de permissão autonomamente — é apenas um relé.

**`swarmPermissions.ts`** implementa a Estratégia 2. Um worker swarm que precisa de uma decisão de permissão escreve a requisição em seu mailbox IPC. O coordinator monitora esse mailbox, lê a requisição, aplica suas próprias regras de permissão, e escreve a decisão de volta. O worker então lê a decisão e a retorna à chamada de ferramenta aguardando.

**`speculativePermissions.ts`** implementa o mecanismo de classifier de 2 segundos do Caminho A da estratégia interativa. Contém o código que inicia a chamada do classifier, implementa o timeout de corrida e interpreta o resultado.

---

## Principais Conclusões

A camada de hooks é uma bridge arquitetural distinta, não apenas uma coleção de código auxiliar de componente. Cada hook resolve uma das três preocupações: isolamento de lógica complexa de REPL.tsx, bridging de sistemas não-React para estado React, ou reutilização entre contextos.

`useCanUseTool` é o coração do sistema de permissão do ponto de vista do React. Seu dispatch de três estratégias garante que o comportamento de permissão correto seja aplicado independentemente de a sessão ser interativa, coordinator, ou worker swarm. A corrida de três caminhos dentro da estratégia interativa — classifier especulativo vs. diálogo do usuário vs. abort — é a concretização do design de permissão ergonômico.

`useLogMessages` resolve o problema de alta frequência de streaming de tokens com batching de animation frame. O invariante — que eventos não-texto nunca são batched — garante que limites semânticos sejam sempre imediatamente visíveis para o usuário.

`useCommandQueue` garante serialidade na execução de comando via encadeamento de promise. O bloco `finally` garante que a fila sempre avance mesmo quando comandos falham.

`useTextInput` possui o estado completo do input box, incluindo aritmética de cursor multi-linha e tratamento de composição IME. A separação entre estado de input e renderização de input é o que torna `PromptInput.tsx` relativamente simples.

`useTypeahead` e `useReplBridge` estendem o REPL em direções distintas — o primeiro para ergonomia de teclado, o segundo para acesso remoto — ambos sem modificar o contrato do componente central do REPL.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 14 examina a construção de contexto e o system prompt — como o Claude Code monta as instruções que governam o comportamento do modelo em cada chamada de API.*
