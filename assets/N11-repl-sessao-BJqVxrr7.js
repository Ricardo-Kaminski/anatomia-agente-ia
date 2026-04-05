const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 11: REPL e Sessão Interativa

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Ler \`src/screens/REPL.tsx\` com confiança, entendendo como suas ~3000 linhas se decompõem em um punhado de sub-componentes cooperantes
* Traçar uma mensagem desde o momento em que o QueryEngine emite um \`StreamEvent\` através de batching, normalização e renderização de lista virtual até os caracteres que realmente aparecem na tela
* Explicar como \`PromptInput\` gerencia edição multi-linha, navegação de histórico, expansão de referências \`@\` e o guard de paste com brackets
* Descrever o pipeline de typeahead completion, o sistema de diálogos de permissão, o Task Panel e as Teammate Views
* Entender como a busca de transcrição funciona

---

## 11.1 REPL.tsx em Contexto

\`src/screens/REPL.tsx\` é onde a aplicação vive — um componente React de aproximadamente 3000 linhas que monta a sessão interativa do Claude Code. Todo token que o modelo transmite, toda chamada de ferramenta, toda requisição de permissão e todo slash command do usuário passa por ou ao redor deste arquivo.

A árvore de componentes de nível superior:

\`\`\`tsx
export function REPL(props: REPLProps) {
  return (
    <Box flexDirection="column" height={terminalHeight}>
      <TaskPanel tasks={backgroundTasks} />
      <MessageList
        messages={logMessages}
        scrollOffset={scrollOffset}
        onScroll={handleScroll}
      />
      <PermissionDialog
        request={pendingPermissionRequest}
        onDecision={handlePermissionDecision}
      />
      <PromptInput
        value={inputValue}
        onSubmit={handleSubmit}
        completions={typeaheadCompletions}
        isDisabled={isWaitingForPermission}
      />
      <StatusBar model={currentModel} tokenCount={tokenCount} agentCount={activeAgentCount} />
    </Box>
  )
}
\`\`\`

O layout é vertical: monitoramento de tarefas no topo, histórico de mensagens no meio, diálogo de permissão sobreposto quando ativo, input na parte inferior e barra de status de uma linha no fim.

Os cinco sub-componentes mapeiam claramente para as cinco coisas com que o usuário interage. \`TaskPanel\` responde "o que está rodando em background?" \`MessageList\` responde "o que foi dito até agora?" \`PermissionDialog\` responde "esta ferramenta deve ter permissão?" \`PromptInput\` responde "o que o usuário quer dizer a seguir?" \`StatusBar\` responde "qual é o estado atual do sistema?"

---

## 11.2 O Pipeline de Exibição de Mensagens

O pipeline tem quatro estágios distintos.

### 11.2.1 Estágio Um: Assinatura de Eventos via \`useLogMessages\`

\`useLogMessages\` subscreve ao emitter de \`StreamEvent\` que o QueryEngine expõe e mantém um array de estado React de objetos \`LogMessage\`. A função \`applyStreamEvent\` implementa a máquina de estados: um \`text_delta\` encontra a última \`AssistantMessage\` e acrescenta ao texto; um \`tool_use_start\` empurra uma nova \`ToolUseMessage\`; um \`tool_result\` empurra uma nova \`ToolResultMessage\`.

### 11.2.2 Estágio Dois: Batching de Eventos

O streaming de tokens é rápido — um modelo Claude pode emitir dezenas de deltas por segundo. O hook \`useLogMessages\` faz batching de eventos antes de commitá-los ao estado. A regra é simples: enquanto eventos do mesmo tipo chegam em rápida sucessão, eles são mesclados em uma única atualização acumulada e a atualização de estado é diferida por um animation frame.

\`\`\`typescript
// 30 text_delta events em um único frame tornam-se uma atualização de estado
const pendingDeltas = useRef<string[]>([])
const frameHandle = useRef<number | null>(null)

function flushDeltas() {
  const combined = pendingDeltas.current.join('')
  pendingDeltas.current = []
  frameHandle.current = null
  setMessages(prev => appendToLastAssistantMessage(prev, combined))
}

// Para eventos text_delta:
pendingDeltas.current.push(event.delta)
if (frameHandle.current === null) {
  frameHandle.current = requestAnimationFrame(flushDeltas)
}
\`\`\`

Eventos não-texto (chamadas de ferramentas, resultados, mensagens de sistema) não são batched — são liberados imediatamente porque representam limites semânticos.

### 11.2.3 Estágio Três: Normalização de Mensagens

Uma etapa de normalização converte \`LogMessage[]\` para \`DisplayMessage[]\` com hints de renderização. As seis variantes de \`DisplayMessage\` correspondem às seis coisas que podem aparecer em uma conversa:

**\`AssistantMessage\`**: resposta de texto do modelo com suporte a markdown (títulos, negrito, código inline, blocos de código).

**\`ToolUseMessage\`**: mostra nome da ferramenta e argumentos. A formatação por ferramenta é definida no método \`renderToolUseMessage\` de cada ferramenta.

**\`ToolResultMessage\`**: saída da execução da ferramenta. Saídas longas são truncadas. Saídas JSON são formatadas; saídas que parecem diffs são realçadas com sintaxe; saídas de imagem são renderizadas com suporte sixel/block-character.

**\`HumanMessage\`**: ecoa o que o usuário digitou, com referências \`@\` expandidas para mostrar o nome do arquivo.

**\`SystemMessage\`**: comunica eventos que não fazem parte da conversa mas são significativos: \`/compact\` foi executado, o modelo foi mudado, uma sessão foi retomada.

**\`TombstoneMessage\`**: o fantasma das mensagens compactadas — inserido onde o histórico foi removido, mostrando o timestamp de compactação e tokens recuperados.

### 11.2.4 Estágio Quatro: Renderização de Lista Virtual

Uma sessão longa pode acumular centenas de mensagens. \`MessageList\` resolve isso com scrolling virtual — renderizando apenas as mensagens visíveis na viewport atual, mais um pequeño buffer de overscan:

\`\`\`tsx
function MessageList({ messages, scrollOffset, terminalHeight }: Props) {
  const heights = useMemo(() => messages.map(measureMessageHeight), [messages])
  const { startIndex, endIndex, topPadding, bottomPadding } =
    computeVisibleRange(heights, scrollOffset, terminalHeight)

  return (
    <Box flexDirection="column">
      <Box height={topPadding} />
      {messages.slice(startIndex, endIndex + 1).map(msg => (
        <MessageItem key={msg.id} message={msg} />
      ))}
      <Box height={bottomPadding} />
    </Box>
  )
}
\`\`\`

Por padrão o offset de scroll rastreia o fundo da lista. Quando o usuário rola para cima, o offset muda e a janela visível se move. Quando uma nova mensagem chega enquanto o usuário está rolado para cima, o REPL não pula automaticamente de volta — preserva a posição e mostra um indicador ("N novas mensagens abaixo").

---

## 11.3 PromptInput: A Interface do Usuário

### 11.3.1 Edição Multi-Linha e Comportamento de Submit

Enter sozinho submete o input atual ao agente. Shift+Enter inserta um caractere de nova linha literal, permitindo prompts multi-parágrafo.

\`\`\`typescript
useInput((input, key) => {
  if (key.return && !key.shift) {
    onSubmit(currentValue)
    clearInput()
    return
  }
  if (key.return && key.shift) {
    insertAtCursor('\\n')
    return
  }
})
\`\`\`

Cada nova linha no input aumenta a altura da área de input em uma linha, o que diminui a altura disponível para \`MessageList\`. O REPL.tsx gerencia isso lendo a altura da área de input após cada render e subtraindo-a da altura do terminal ao computar a viewport do \`MessageList\`.

### 11.3.2 Navegação de Histórico

O Claude Code mantém um histórico persistente de comandos. A seta para cima navega para o comando anterior. Quando a navegação no histórico começa, a entrada "atual" é salva em um slot temporário e restaurada quando o usuário pressiona para baixo além da entrada de histórico mais recente. Isso previne perder um prompt parcialmente digitado ao pressionar acidentalmente para cima.

### 11.3.3 Referências \`@\` a Arquivos

Ao confirmar uma referência de arquivo via typeahead, em vez de inserir o conteúdo bruto do arquivo (que poderia ser enorme), o Claude Code insere uma referência tipada — visualmente algo como \`@src/tools/BashTool.ts\` — que é expandida para conteúdo completo quando o prompt é submetido:

\`\`\`
<file path="src/tools/BashTool.ts">
// ... conteúdo completo do arquivo ...
</file>
\`\`\`

O usuário vê uma referência compacta; o modelo recebe o conteúdo completo. A sintaxe \`@\` também suporta intervalos de linha: \`@src/main.ts:10-50\` expande apenas as linhas 10 a 50.

### 11.3.4 Tratamento de Paste

O modo de paste com brackets (descrito no Cap. 10) é tratado no nível do \`PromptInput\`. Quando a camada termio detecta a sequência de início de paste com brackets, define um flag indicando que o input subsequente é colado. O \`PromptInput\` usa esse flag para suprimir o requisito de Shift+Enter: novas linhas coladas são sempre tratadas como novas linhas suaves.

### 11.3.5 Contador de Caracteres e Aviso de Token

O canto inferior direito da área de input mostra uma contagem de caracteres. Quando o input se aproxima do limite prático da janela de contexto, o contador muda de cor para um âmbar de aviso. A estimativa de contagem de tokens usa uma aproximação rápida (aproximadamente quatro caracteres por token) em vez de chamar o tokenizador real, que introduziria latência em cada toque de tecla.

---

## 11.4 Typeahead Completion

O typeahead completion ativa quando a palavra atual corresponde a uma das duas condições trigger: \`/\` inicial para completion de comandos, ou \`@\` inicial para completion de caminho de arquivo.

### 11.4.1 Completion de Comandos

Quando o input começa com \`/\`, \`useTypeahead\` chama \`getCommandCompletions(inputValue)\` para consultar o registro de comandos. O componente \`FuzzyPicker\` recebe a lista de candidatos e a string de consulta e realiza correspondência fuzzy, recompensando correspondências de caracteres consecutivos:

\`\`\`typescript
function fuzzyScore(query: string, candidate: string): number {
  let queryIndex = 0, score = 0, consecutiveBonus = 0
  for (let i = 0; i < candidate.length && queryIndex < query.length; i++) {
    if (candidate[i].toLowerCase() === query[queryIndex].toLowerCase()) {
      score += 1 + consecutiveBonus
      consecutiveBonus += 2
      queryIndex++
    } else {
      consecutiveBonus = 0
    }
  }
  return queryIndex === query.length ? score : -1
}
\`\`\`

O overlay de completion renderiza acima da área de input. Tab ou Enter aceita a seleção atual.

### 11.4.2 Completion de Caminho de Arquivo

Quando o input contém uma palavra começando com \`@\`, o hook muda para modo de completion de arquivo. Entradas de diretório são exibidas com \`/\` no final e são selecionáveis — selecionar um diretório estende o prefixo para esse diretório, permitindo navegação incremental pela árvore de arquivos.

---

## 11.5 O Sistema de Diálogos de Permissão

### 11.5.1 Da Ferramenta ao Diálogo

Quando \`checkPermissions\` retorna \`needs_user_confirmation\`, a invocação da ferramenta é pausada e uma requisição de permissão é colocada em uma fila. O hook \`useCanUseTool\` atualiza o estado \`pendingPermissionRequest\` passado ao \`PermissionDialog\`. Simultaneamente, o flag \`isWaitingForPermission\` é definido como \`true\`, fazendo o \`PromptInput\` parar de aceitar input.

O mecanismo de pausa-e-retomada funciona porque \`checkPermissions\` é uma função async. O sistema de permissão usa uma promise diferida: cria uma \`Promise\` cuja função resolve é armazenada em um mapa indexado por ID de requisição. Quando o usuário toma uma decisão, \`useCanUseTool\` chama essa função resolve armazenada.

### 11.5.2 Variantes do Diálogo

**Permitir uma vez** (\`interactive_temporary\`): permite esta invocação específica mas não registra preferência.

**Sempre permitir** (\`interactive_permanent\`): permite a invocação e registra uma regra permanente de permissão em \`settings.json\` sob a chave \`toolPermissions\`.

**Negar** (\`deny\`): cancela a invocação da ferramenta.

\`\`\`tsx
function PermissionDialog({ request, onDecision }: Props) {
  const [selected, setSelected] = useState<0 | 1 | 2>(0)

  useInput((input, key) => {
    if (key.upArrow) setSelected(prev => Math.max(0, prev - 1) as 0 | 1 | 2)
    if (key.downArrow) setSelected(prev => Math.min(2, prev + 1) as 0 | 1 | 2)
    if (key.return) onDecision(OPTIONS[selected].decision)
    if (input === 'y') onDecision('interactive_temporary')
    if (input === 'a') onDecision('interactive_permanent')
    if (input === 'n') onDecision('deny')
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow">
      <Text bold>{request.toolName}</Text>
      {request.renderedArgs}
      {OPTIONS.map((opt, i) => (
        <Box key={opt.label}>
          <Text color={selected === i ? 'cyan' : undefined}>
            {selected === i ? '>' : ' '} {opt.label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
\`\`\`

Os atalhos de teclado \`y\`, \`a\` e \`n\` permitem que usuários experientes respondam a requisições de permissão sem olhar para o estado de seleção — minimizando a fricção que os diálogos de permissão introduzem no fluxo.

### 11.5.3 Proxy de Permissão Multi-Agente

Em modo swarm, quando um sub-agente precisa de uma decisão de permissão, a requisição é proxied para o \`useCanUseTool\` do REPL pai. O \`PermissionDialog\` nesse caso mostra uma linha de cabeçalho adicional identificando qual sub-agente está solicitando a permissão, permitindo ao usuário ser mais cauteloso com comandos emitidos por sub-agentes automatizados.

---

## 11.6 O Task Panel

O \`TaskPanel\` renderiza no topo do REPL. Em seu estado colapsado (padrão), mostra uma única linha de resumo. O usuário pressiona um atalho de teclado configurável (padrão \`Ctrl+T\`) para alternar para o estado expandido.

O \`TaskPanel\` reserva uma altura fixa quando expandido — novos tasks adicionados após a abertura do painel são silenciosamente acrescentados a uma fila. Atualizações de tempo decorrido são tratadas com reescritas de caractere in-place usando o renderer diferencial — apenas os dígitos de tempo mudam.

---

## 11.7 Teammate Views em Modo Multi-Agente

### 11.7.1 Modelo de Processo vs. Modelo In-Process

Sub-agentes podem ser spawned em dois modos. No modo padrão para tarefas longas, cada sub-agente é um processo OS separado com seu próprio terminal. No segundo modo, sub-agentes rodam no mesmo processo que o orchestrador — cada sub-agente obtém uma subárvore React independente renderizada em um buffer de terminal virtual separado, e o componente de layout de nível superior empilha esses buffers lado a lado antes de escrever no terminal físico:

\`\`\`
┌─────────────────────┬────────────────────┐
│  Agente Principal   │  research_agent    │
│  Working on: coord  │  Working on: docs  │
│  > |                │  Fetching https... │
└─────────────────────┴────────────────────┘
\`\`\`

### 11.7.2 Bridge de Permissão do Líder

Apenas o REPL do agente principal tem a atenção do teclado do usuário. Quando um sub-agente precisa de uma decisão de permissão, a bridge de permissão do líder roteia a requisição para a fila de permissão do orchestrador, que exibe o diálogo com a atribuição do sub-agente mostrada. Todas as requisições de permissão aparecem em um lugar independentemente de quantos agentes estão rodando.

---

## 11.8 Busca de Transcrição

### 11.8.1 Ativando o Modo de Busca

Pressionar Ctrl+R ativa o modo de busca — espelhando o atalho de busca de histórico usado em bash e zsh. Quando ativo, o \`PromptInput\` é substituído por um input de busca com prefixo \`(search):\`.

### 11.8.2 Filtragem Fuzzy em Tempo Real

Conforme o usuário digita no input de busca, \`useTypeahead\` roda correspondência fuzzy contra o conteúdo de texto normalizado de todas as mensagens no histórico de conversa. Os resultados controlam a posição de scroll do \`MessageList\` — a mensagem com melhor correspondência é rolada para a visibilidade e seu fundo é realçado.

### 11.8.3 Realce de Correspondências e Navegação

Dentro da mensagem visível, a substring correspondente é realçada. As pressionamentos subsequentes de cima/baixo em modo de busca ciclem pelas outras correspondências. Pressionar Escape ou Enter sai do modo de busca — pressionar Enter com uma correspondência ativa retorna o foco ao input principal enquanto mantém a lista de mensagens rolada para a mensagem correspondente.

### 11.8.4 Retenção Completa de Histórico

O Claude Code não poda a lista de mensagens em memória durante uma sessão. O sistema de scroll virtual significa que não há razão de performance para descartar mensagens antigas do estado React — consomem memória mas não tempo de renderização. Dentro de uma única sessão, a busca de transcrição cobre confiavelmente tudo que foi dito.

---

## 11.9 A Máquina de Estados do REPL

O REPL está sempre em exatamente um de um pequeno número de estados mutuamente exclusivos:

- **Idle**: o usuário pode digitar livremente, navegar no histórico, acionar completions e submeter
- **Querying**: o agente está rodando — o modelo gera tokens, ferramentas podem estar executando, e o \`PromptInput\` mostra um indicador "stop" que permite interrupção com Escape
- **WaitingForPermission**: input está suspenso e o \`PermissionDialog\` tem foco
- **Searching**: modo de busca de transcrição
- **Expanding**: task panel em seu estado expandido

A tecla Escape em estado \`Querying\` envia um sinal de interrupção para o QueryEngine via abort controller, que aciona cancelamento gracioso: a ferramenta atual recebe uma breve janela para limpeza, o stream do modelo é fechado e o REPL transita de volta para \`Idle\` com uma \`SystemMessage\` notando a interrupção.

---

## Principais Conclusões

\`src/screens/REPL.tsx\` é a camada de aplicação que monta tudo dos capítulos anteriores em uma experiência interativa coerente.

O pipeline de exibição de mensagens — assinatura de eventos, batching, normalização e renderização virtual — é um sistema de quatro estágios projetado em torno de um insight: o output de token em streaming é extremamente rápido, e toda decisão arquitetural existe para garantir que essa velocidade se traduza em renderização suave.

O \`PromptInput\` é mais complexo do que parece. Edição multi-linha, navegação de histórico, expansão de referências \`@\` e o guard de paste com brackets existem porque a alternativa — um input simples de linha única — seria inadequada para os prompts que usuários de uma ferramenta de codificação de IA realmente escrevem.

O sistema de diálogos de permissão é arquiteturalmente significativo porque representa uma decisão humana síncrona no meio de um processo computacional assíncrono. O mecanismo de promise diferida é a forma correta de modelar isso.

O Task Panel e as Teammate Views estendem o design do REPL de agente único para o caso multi-agente sem mudar fundamentalmente a arquitetura. A bridge de permissão do líder garante que a supervisão humana permaneça centralizada independentemente de quantos agentes estão rodando.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 12 examina a biblioteca de componentes e o design system — os blocos de construção reutilizáveis que compõem a UI do Claude Code.*
`;export{e as default};
