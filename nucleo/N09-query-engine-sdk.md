> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 09: QueryEngine e Interface SDK

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Explicar por que `QueryEngine` existe como classe sobre a função stateless `query()` e qual problema resolve
* Ler `QueryEngineConfig` e descrever o propósito de cada campo, incluindo os três controles de orçamento, o hook de saída estruturada e o callback de elicitação
* Traçar uma chamada completa a `submitMessage()` por seus dez estágios lógicos, do reset por turno ao `SDKResultMessage` final
* Distinguir o caminho de curto-circuito de slash-command do caminho completo do loop `query()` e explicar quando cada um dispara
* Identificar cada variante de `SDKMessage` por tipo e subtipo, e saber quando é emitida e quais campos-chave contém
* Escrever um programa TypeScript autossuficiente que conduz `QueryEngine` programaticamente e coleta resultados estruturados
* Descrever a superfície de tipos públicos exportada de `agentSdkTypes.ts` e explicar a divisão em três submódulos
* Explicar o que `isNonInteractiveSession: true` muda em comparação ao modo interativo e por que a distinção importa

---

## 9.1 O Papel do QueryEngine

O loop agêntico em `src/query.ts` é deliberadamente stateless. Toda chamada a `query()` recebe um snapshot completo de mensagens, system prompt, ferramentas e configuração, roda seu iterador até a conclusão e retorna um valor terminal. Não lembra o que aconteceu entre chamadas, não possui um histórico de conversa e não sabe se está rodando dentro de uma UI de terminal ou em um processo de automação em background.

Essa statelessness é uma virtude para testes e composição, mas cria um problema prático imediato: a maioria dos usos reais do Claude Code não é de único disparo. Um usuário digita várias mensagens em sequência. Um pipeline automatizado submete prompts de follow-up. Um job de CI retoma uma sessão após falha parcial. Todos esses requerem que o estado persista entre turnos — especificamente a lista crescente de objetos `Message` que forma o histórico de conversa.

`QueryEngine` é a classe que possui esse estado. É definida em `src/QueryEngine.ts` e pode ser resumida em uma frase: é um gerenciador de sessão para o modo headless (não-interativo) que mantém a lista mutável de mensagens da conversa, envolve `query()` com contabilidade por turno e emite um stream tipado de eventos `SDKMessage` para cada prompt submetido.

---

## 9.2 QueryEngineConfig: Cada Campo Explicado

O construtor aceita um único objeto `QueryEngineConfig`:

```typescript
export type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: Command[]
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  initialMessages?: Message[]
  readFileCache: FileStateCache
  customSystemPrompt?: string
  appendSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  jsonSchema?: Record<string, unknown>
  verbose?: boolean
  replayUserMessages?: boolean
  handleElicitation?: ToolUseContext['handleElicitation']
  includePartialMessages?: boolean
  setSDKStatus?: (status: SDKStatus) => void
  abortController?: AbortController
  orphanedPermission?: OrphanedPermission
  snipReplay?: (yieldedSystemMsg: Message, store: Message[]) => { messages: Message[]; executed: boolean } | undefined
}
```

**Identidade e diretório de trabalho.** `cwd` define o diretório de trabalho para a sessão. É passado para `setCwd()` no início de toda chamada `submitMessage()`.

**Registros de ferramentas e comandos.** `tools` é o conjunto completo de definições de ferramentas que o modelo pode chamar. `commands` é o registro de slash-commands. `mcpClients` fornece conexões de servidores MCP. `agents` é uma lista de definições de sub-agentes.

**Gate de permissão.** `canUseTool` é uma função que o motor chama antes de executar qualquer ferramenta. `QueryEngine` envolve essa função internamente para registrar cada negação em uma lista que é anexada à mensagem de resultado final.

**Acessores de estado da aplicação.** `getAppState` e `setAppState` dão ao motor acesso de leitura e escrita à store de estado mais ampla da aplicação.

**Semeadura de conversa.** `initialMessages` permite que chamadores pré-populem o histórico de conversa antes da primeira chamada `submitMessage()`. Usado para retomada de sessão.

**Cache de dedup de arquivo.** `readFileCache` é uma instância de `FileStateCache` que rastreia quais versões de arquivo já foram lidas durante a sessão. Previne que o contexto se encha de conteúdos de arquivo redundantes durante sessões longas.

**Personalização de system prompt.** `customSystemPrompt` substitui o system prompt padrão inteiramente. `appendSystemPrompt` adiciona conteúdo após o prompt padrão sem substituí-lo.

**Seleção de modelo.** `userSpecifiedModel` é o identificador primário do modelo. `fallbackModel` é tentado se o modelo primário estiver indisponível. `thinkingConfig` controla o orçamento de thinking estendido.

**Limites de turno e orçamento.** Três controles independentes limitam quanto trabalho o motor pode fazer: `maxTurns` (teto de iterações inteiro), `maxBudgetUsd` (limite em dólares), `taskBudget` (unidades de tokens, passado diretamente para `query()`).

**Saída estruturada.** `jsonSchema` é um objeto JSON Schema. Quando fornecido, o motor instrui o modelo a produzir uma chamada de ferramenta final cujo output conforma a esse schema. O resultado da ferramenta é então extraído e retornado como campo `result` do `SDKResultMessage` final.

**Diagnóstico e replay.** `verbose` habilita logging detalhado. `replayUserMessages` faz o motor re-gerar mensagens do usuário como eventos `SDKUserMessageReplay`.

**Callback de elicitação.** `handleElicitation` é uma função que o modelo pode chamar quando precisa fazer uma pergunta estruturada ao usuário no meio de uma tarefa.

**Inclusão de mensagens parciais.** `includePartialMessages` controla se eventos de streaming em andamento são encaminhados ao stream SDK durante execução de ferramentas.

**Relatório de status.** `setSDKStatus` é um callback que o motor chama com transições de status (`running`, `awaiting_input`, `completed`, etc.).

**Abort e permissão órfã.** `abortController` permite que o chamador cancele um `submitMessage()` em andamento. `orphanedPermission` carrega uma requisição de permissão pendente de uma sessão anterior interrompida.

---

## 9.3 Estrutura da Classe e Estado Privado

```typescript
export class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]         // histórico de conversa, persistido entre turnos
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage
  private hasHandledOrphanedPermission = false
  private readFileState: FileStateCache
  private discoveredSkillNames = new Set<string>()
  private loadedNestedMemoryPaths = new Set<string>()

  constructor(config: QueryEngineConfig) {
    this.mutableMessages = config.initialMessages ?? []
    this.abortController = config.abortController ?? createAbortController()
    this.permissionDenials = []
    this.readFileState = config.readFileCache
    this.totalUsage = EMPTY_USAGE
  }
}
```

`mutableMessages` é o coração da classe — um array simples de objetos `Message` que cresce a cada turno. Todo o array é passado para `query()` em cada chamada para que o modelo tenha histórico completo de conversa.

`permissionDenials` acumula ao longo de toda a sessão. Cada vez que `canUseTool` retorna um resultado não-allow, a negação é acrescentada aqui. No final de toda chamada `submitMessage()`, a lista completa é embutida no `SDKResultMessage`.

`totalUsage` é um contador corrente de consumo de tokens, atualizado após cada turno.

`discoveredSkillNames` e `loadedNestedMemoryPaths` são caches por turno limpos no início de cada chamada `submitMessage()`.

`hasHandledOrphanedPermission` é um flag one-shot. A permissão órfã da sessão anterior é apresentada exatamente uma vez, durante a primeira chamada `submitMessage()`.

---

## 9.4 submitMessage(): O Fluxo Completo

`submitMessage()` é um método async generator com tipo de retorno `AsyncGenerator<SDKMessage, void, unknown>`.

### 9.4.1 Reset Por Turno e Envolvimento de canUseTool

A primeira coisa que `submitMessage()` faz é limpar `discoveredSkillNames` e chamar `setCwd(cwd)`. Imediatamente após o reset, cria `wrappedCanUseTool`:

```typescript
const wrappedCanUseTool: CanUseToolFn = async (tool_name, tool_use_id, tool_input, context) => {
  const result = await canUseTool(tool_name, tool_use_id, tool_input, context)
  if (result.behavior !== 'allow') {
    this.permissionDenials.push({ tool_name, tool_use_id, tool_input })
  }
  return result
}
```

O wrapper não modifica o resultado; apenas intercepta negações. A política vive em `canUseTool`; a trilha de auditoria vive em `QueryEngine`.

### 9.4.2 Montagem do System Prompt

`submitMessage()` chama `fetchSystemPromptParts()` com a lista de ferramentas, o nome do modelo resolvido e as conexões de clientes MCP. Retorna três componentes: `defaultSystemPrompt`, `userContext` e `systemContext`.

```typescript
const systemPrompt = asSystemPrompt([
  ...(customPrompt ? [customPrompt] : defaultSystemPrompt),
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
])
```

Se `customSystemPrompt` foi fornecido na config, substitui `defaultSystemPrompt` inteiramente. O prompt de memória é injetado apenas quando a variável de ambiente `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` está definida. `appendSystemPrompt` é sempre acrescentado por último.

### 9.4.3 Processamento de Input do Usuário e Persistência de Transcrição

`submitMessage()` chama `processUserInput()` com `isNonInteractiveSession: true`. Este único flag muda múltiplos comportamentos downstream: o caminho de renderização da UI é pulado, diálogos de confirmação interativos são suprimidos, e certas ferramentas que requerem um terminal ativo são desabilitadas.

Após acrescentar as mensagens ao `this.mutableMessages`, o motor escreve o histórico atualizado na transcrição de sessão antes de enviar qualquer coisa à API. Se o processo for morto entre enviar a requisição e receber a resposta, a mensagem do usuário já está persistida.

### 9.4.4 O Caminho de Curto-Circuito de Slash Command

Quando o prompt do usuário é um slash command que pode ser tratado localmente, `processUserInput()` define `shouldQuery = false`. O motor não chama o modelo de forma alguma. O caminho de curto-circuito:

1. Gerar `SDKSystemInitMessage` como de costume.
2. Se `replayUserMessages` está definido, gerar a mensagem do usuário como evento `SDKUserMessageReplay`.
3. Empacotar `resultText` em um `SDKAssistantMessage` e gerá-lo.
4. Gerar um `SDKResultMessage` terminal com `subtype: 'success'`.

O `SDKResultMessage` sempre chega, independentemente do caminho tomado.

### 9.4.5 O Loop query() e Mapeamento de SDKMessage

Quando `shouldQuery` é `true`, o motor abre um loop `for await ... of` sobre o generator `query()`:

```typescript
for await (const message of query({
  messages,
  systemPrompt, userContext, systemContext,
  canUseTool: wrappedCanUseTool,
  toolUseContext: processUserInputContext,
  querySource: 'sdk',
  maxTurns, taskBudget,
})) {
  // traduz tipos internos Message para tipos SDKMessage
}
```

Mapeamentos principais:
- Mensagem de papel `assistant` com resposta do modelo → `SDKAssistantMessage`
- Mensagem de papel `user` com resultados de ferramentas → `SDKUserMessage`
- Mensagem `compact_boundary` → `SDKCompactBoundaryMessage`
- Mensagem `tombstone` → removida de `mutableMessages`, não gerada
- Eventos de progresso/streaming → gerados apenas quando `includePartialMessages: true`

### 9.4.6 O SDKResultMessage Final

Quando o generator `query()` completa, `submitMessage()` gera um único `SDKResultMessage`:

```typescript
yield {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: Date.now() - startTime,
  duration_api_ms: getTotalAPIDuration(),
  num_turns: ...,
  result: structuredOutputFromTool ?? resultText ?? '',
  stop_reason: lastStopReason,
  session_id: getSessionId(),
  total_cost_usd: getTotalCost(),
  usage: this.totalUsage,
  modelUsage: getModelUsage(),
  permission_denials: this.permissionDenials,
}
```

O campo `result` contém a saída de texto final. Quando `jsonSchema` foi fornecido na config, `structuredOutputFromTool` contém o objeto JSON analisado extraído da chamada de ferramenta de saída estruturada, e tem prioridade sobre `resultText`.

`stop_reason` transmite por que o modelo parou: `end_turn`, `max_turns`, `tool_use` ou outros valores definidos pela API.

`permission_denials` é a lista completa de ferramentas bloqueadas durante este turno, com nome da ferramenta, ID de tool-use e input tentado.

---

## 9.5 Variantes de SDKMessage

| `type` | `subtype` | Quando emitida | Campos-chave |
| --- | --- | --- | --- |
| `system` | `init` | Primeira mensagem de toda chamada `submitMessage()` | `session_id`, `model`, `tools`, `mcp_servers`, `permissionMode`, `apiKeySource` |
| `assistant` | — | Cada vez que o modelo produz resposta | `message.content` (array de texto, tool_use, blocos de thinking) |
| `user` | — | Cada vez que resultados de ferramentas são alimentados de volta ao modelo | `message.content` (array de blocos tool_result) |
| `user` | `replay` | Quando `replayUserMessages: true` | `message.content` |
| `system` | `compact_boundary` | Quando compactação de contexto ocorre | `summary` (o texto de contexto comprimido) |
| `result` | `success` | Turno completou normalmente | `result`, `usage`, `total_cost_usd`, `duration_ms`, `stop_reason`, `permission_denials` |
| `result` | `error_during_execution` | Exceção não tratada ocorreu | `is_error: true`, `result` (texto de mensagem de erro) |
| `result` | `error_max_turns` | `maxTurns` foi atingido | `is_error: true`, `num_turns` |

A mensagem `system/init` é sempre a primeira no stream e a única que carrega metadados de sessão. A mensagem `result` é sempre a última — pode ser usada como sentinela para saber que o generator terminou.

---

## 9.6 Exemplo de Uso Programático

```typescript
import { QueryEngine } from './src/QueryEngine.js'

async function runHeadlessQuery(prompt: string): Promise<string> {
  const engine = new QueryEngine({
    cwd: process.cwd(),
    tools: await getTools(),
    commands: await getCommands(),
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: 'allow' }),
    getAppState: () => useAppStateStore.getState(),
    setAppState: f => useAppStateStore.setState(f(useAppStateStore.getState())),
    readFileCache: createFileStateCache(),
    maxTurns: 10,
    verbose: false,
  })

  let finalResult = ''

  for await (const message of engine.submitMessage(prompt)) {
    if (message.type === 'result') {
      if (message.is_error) {
        throw new Error(`QueryEngine error: ${message.subtype} — ${message.result}`)
      }
      finalResult = message.result
      console.log(`Cost: $${message.total_cost_usd.toFixed(6)}`)
      console.log(`Turns: ${message.num_turns}`)
      if (message.permission_denials.length > 0) {
        console.warn('Blocked tools:', message.permission_denials.map(d => d.tool_name))
      }
    } else if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') process.stdout.write(block.text)
      }
    }
  }

  return finalResult
}

// Exemplo multi-turno: reutilizar a mesma instância do motor entre turnos
async function runMultiTurnSession() {
  const engine = new QueryEngine({ /* ... mesma config ... */ })

  // Primeiro turno
  for await (const msg of engine.submitMessage('List the files in the src directory.')) {
    if (msg.type === 'result') console.log('Turn 1 done:', msg.result)
  }

  // Segundo turno: o motor retém o histórico de conversa
  for await (const msg of engine.submitMessage('Which of those files is the largest?')) {
    if (msg.type === 'result') console.log('Turn 2 done:', msg.result)
  }
}
```

O ponto crítico no exemplo multi-turno é que a instância do motor é reutilizada. `this.mutableMessages` acumula as trocas de ambos os turnos. Criar uma nova instância de `QueryEngine` para cada turno perderia o histórico.

Para saída JSON estruturada:

```typescript
const engine = new QueryEngine({
  // ... outros campos ...
  jsonSchema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' } },
      count: { type: 'integer' },
    },
    required: ['files', 'count'],
  },
})

for await (const msg of engine.submitMessage('List all TypeScript files in src/')) {
  if (msg.type === 'result' && !msg.is_error) {
    const data = JSON.parse(msg.result) as { files: string[]; count: number }
    console.log(`Found ${data.count} TypeScript files`)
  }
}
```

---

## 9.7 A Superfície de Tipos Públicos SDK: agentSdkTypes.ts

`src/entrypoints/agentSdkTypes.ts` é o arquivo único do qual consumidores externos devem importar. Re-exporta de três submódulos:

**`src/entrypoints/sdk/coreTypes.ts`** contém os tipos serializáveis: a union `SDKMessage` e todas as suas variantes, o array constante `HOOK_EVENTS` listando cada nome de evento de ciclo de vida:

```typescript
export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
  'PermissionRequest', 'PermissionDenied', 'Setup',
  'TeammateIdle', 'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult', 'ConfigChange',
  'WorktreeCreate', 'WorktreeRemove', 'InstructionsLoaded',
  'CwdChanged', 'FileChanged',
] as const
```

**`src/entrypoints/sdk/runtimeTypes.ts`** contém os tipos não-serializáveis: o objeto `Options` aceito pela função `query()` de nível superior e a interface `Query` que `query()` retorna. Incluem referências a funções e interfaces `AsyncIterable`.

**`src/entrypoints/sdk/toolTypes.ts`** exporta os tipos de definição de ferramentas e helpers. O export mais importante é a factory function `tool()`:

```typescript
export function tool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (input: unknown) => Promise<unknown>,
  extras?: ToolExtras,
): SdkMcpToolDefinition

export function createSdkMcpServer(options: SdkMcpServerOptions): McpSdkServerConfigWithInstance

export class AbortError extends Error {}

export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query
```

O `query()` de nível superior exportado de `agentSdkTypes.ts` é uma função de conveniência de nível mais alto distinta do `query()` interno em `src/query.ts`. Aceita um prompt de string simples ou um async iterable de objetos `SDKUserMessage` para input em streaming, e retorna uma interface `Query` que é um async iterable de objetos `SDKMessage`.

`AbortError` é uma subclasse de erro tipada lançada quando o `AbortController` do chamador dispara.

---

## 9.8 Modo Headless vs Interativo

A distinção não é um único flag — é uma constelação de diferenças comportamentais que fluem do setting `isNonInteractiveSession: true` colocado em `processUserInputContext`.

**Renderização.** No modo interativo, mensagens assistant são renderizadas via Ink. No modo headless, nada disso acontece — o output é puro: objetos `SDKMessage` gerados de um generator.

**Requisições de permissão.** No modo interativo, o motor pausa e apresenta um prompt de confirmação. No modo headless, a função `canUseTool` passada na config toma a decisão programaticamente. Sem pausa, sem humano no loop.

**Elicitação.** No modo interativo, o motor renderiza um formulário no terminal e aguarda. No modo headless, o callback `handleElicitation` da config é chamado. Se nenhum callback foi fornecido, a elicitação resolve com uma resposta null.

**Disponibilidade de ferramentas.** Algumas ferramentas não estão disponíveis em sessões não-interativas. Qualquer ferramenta que verifica `isNonInteractiveSession` antes de rodar vai curto-circuitar quando chamada do `QueryEngine`.

**Handling de slash commands.** No modo interativo, local slash commands podem renderizar JSX arbitrário. No modo headless, o caminho de renderização JSX é pulado, e apenas o output de texto do comando é capturado.

**Stream de mensagens vs eventos de UI.** No modo interativo, a árvore de componentes assina a store de mensagens via estado React. No modo headless, o chamador recebe eventos `SDKMessage` diretamente.

---

## Principais Conclusões

`QueryEngine` é uma casca stateful fina sobre a função stateless `query()`. Seu único estado durável é o array crescente `mutableMessages` e o contador cumulativo `totalUsage`.

`QueryEngineConfig` é a especificação completa de uma sessão headless. Os três controles de orçamento — `maxTurns`, `maxBudgetUsd` e `taskBudget` — operam em diferentes níveis de abstração: contagem de iteração, gasto em dólares e contagem de tokens.

`submitMessage()` sempre gera exatamente um `SDKSystemInitMessage` como seu primeiro evento e exatamente um `SDKResultMessage` como seu último evento.

O campo `permission_denials` em `SDKResultMessage` é a trilha de auditoria da sessão. Em ambientes automatizados onde `canUseTool` impõe uma política programaticamente, essa lista diz exatamente o que foi bloqueado e com quais inputs.

A divisão entre `coreTypes.ts` (serializável), `runtimeTypes.ts` (não-serializável) e `toolTypes.ts` (helpers de ferramentas) no ponto de entrada do SDK é um design deliberado que permite aos consumidores importar apenas o que precisam.

O flag `isNonInteractiveSession: true` não é um switch único mas um sinal propagante — flui por `ProcessUserInputContext` para cada subsistema que o verifica e transforma cada um de uma interface voltada a humanos para uma programática.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 10 examina o framework customizado de UI de terminal — como o fork do Ink do Claude Code renderiza árvores React como sequências de escape ANSI e gerencia o layout com Yoga.*
