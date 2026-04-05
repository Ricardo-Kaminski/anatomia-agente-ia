const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 16: Sub-Agente e Coordenação Multi-Agente

## O que você vai aprender

Este capítulo examina a capacidade mais poderosa e arquiteturalmente sofisticada do Claude Code: colaboração multi-agente. Quando uma tarefa excede o que um único agente pode lidar eficientemente, o Claude Code pode dinamicamente spawnar sub-agentes, decompor o trabalho e rodá-lo em paralelo.

Ao final do capítulo você entenderá: como \`AgentTool\` age como ponto de entrada para sub-agentes; o mecanismo de fork de contexto; a diferença entre modo Coordinator e modo REPL regular; os três backends de execução swarm; os sete tipos de tarefa; e como workers in-process escalam requisições de permissão para o terminal do líder.

---

## 16.1 De Agente Único para Multi-Agente: Por que a Colaboração Importa

O núcleo do Claude Code é o loop \`query()\` descrito no Capítulo 5. Esse modelo funciona bem para a maioria dos casos, mas atinge limites estruturais ao enfrentar:

**Gargalo de paralelismo**: Um único agente é estritamente sequencial. Se as subtarefas de uma tarefa são independentes, forçá-las a enfileirar é ineficiente.

**Pressão na janela de contexto**: Investigar uma codebase grande pode exigir a leitura de dezenas de arquivos, acumulando dezenas de milhares de tokens.

**Redução do escopo de permissão**: Algumas subtarefas (como investigação read-only de código) não precisam do acesso de escrita que a tarefa pai pode ter. Sub-agentes fornecem uma forma natural de estreitar a superfície de permissão.

**Isolamento de trabalho**: Quando modificações paralelas de arquivo são necessárias, sub-agentes podem operar em git worktrees separados sem interferir entre si.

---

## 16.2 AgentTool e runAgent: O Ciclo de Vida Completo do Sub-Agente

### 16.2.1 O Papel do AgentTool

\`tools/AgentTool/AgentTool.tsx\` é o ponto de entrada que o modelo Claude pode invocar. Quando o modelo decide spawnar um sub-agente, passa a descrição da tarefa, \`subagent_type\` (que determina qual \`AgentDefinition\` usar) e um prompt inicial. \`AgentTool\` é uma camada fina: parseia argumentos, determina se executar sincronamente (foreground) ou assincronamente (background), e delega para \`runAgent.ts\`.

### 16.2.2 O Fluxo Central de runAgent.ts

\`runAgent.ts\` é o coração da execução de sub-agentes — aproximadamente 900 linhas com estrutura lógica clara:

**Etapa 1: Inicializar Identidade do Agente**

\`\`\`typescript
const agentId = override?.agentId ? override.agentId : createAgentId()
\`\`\`

Cada sub-agente obtém um \`agentId\` único (ex: \`agent-a1b2c3d4\`). Em cenários de retomada, \`override.agentId\` carrega o ID histórico.

**Etapa 2: Fork de Mensagens de Contexto**

\`\`\`typescript
const contextMessages: Message[] = forkContextMessages
  ? filterIncompleteToolCalls(forkContextMessages)
  : []
const initialMessages: Message[] = [...contextMessages, ...promptMessages]
\`\`\`

Quando \`forkContextMessages\` está presente, o sub-agente herda o histórico de conversa do pai. \`filterIncompleteToolCalls\` remove chamadas de ferramentas sem entradas \`tool_result\` correspondentes, prevenindo erros de API.

**Etapa 3: Resolvendo o Modelo e o Modo de Permissão**

\`\`\`typescript
const resolvedAgentModel = getAgentModel(
  agentDefinition.model,
  toolUseContext.options.mainLoopModel,
  model,
  permissionMode,
)
\`\`\`

O campo \`model\` em uma definição de agente pode ser \`"inherit"\` (usar o modelo do agente pai) ou um alias de modelo específico. Se o pai está no modo \`bypassPermissions\` ou \`acceptEdits\`, esses modos são herdados pelo sub-agente — um sub-agente não pode ter permissões mais amplas que seu pai.

**Etapa 4: Fork do ToolUseContext**

\`\`\`typescript
const subAgentContext: ToolUseContext = {
  ...toolUseContext,
  agentId,
  messages: [],
  setAppState: (f) => {
    // No-op: sub-agents don't directly update parent's React state
  },
}
\`\`\`

O contexto do sub-agente é bifurcado do pai. O campo \`setAppState\` é substituído por um no-op — sub-agentes não atualizam diretamente o estado React do pai (isso foi explicado no Capítulo 4). Em vez disso, eles comunicam progresso através do sistema de yield de mensagens.

**Etapa 5: Executar o Loop de Query**

\`\`\`typescript
for await (const event of query({
  messages: initialMessages,
  systemPrompt: subAgentSystemPrompt,
  canUseTool: subAgentCanUseTool,
  toolUseContext: subAgentContext,
  querySource: \`agent:\${agentId}\`,
  maxTurns: resolvedMaxTurns,
})) {
  yield event
}
\`\`\`

O sub-agente executa seu próprio loop \`query()\` independente. Eventos são gerados de volta para o pai através de \`yield\`, permitindo que o pai observe progresso e mensagens em tempo real.

---

## 16.3 Fork de Contexto: O que é Clonado vs. Compartilhado

A decisão de fork de contexto é uma das mais críticas no design multi-agente:

**Clonado (isolado por sub-agente):**
- \`messages\`: cada sub-agente tem seu próprio histórico de conversa
- \`agentId\`: identificador único para roteamento de permissão
- \`setAppState\`: substituído por no-op para prevenir mutação de estado pai
- \`abortController\`: cada sub-agente tem seu próprio sinal de cancelamento
- \`localDenialTracking\`: rastreamento de negação de permissão local
- \`contentReplacementState\`: estado de substituição de resultado de ferramenta

**Compartilhado (mesmo objeto):**
- \`readFileState\`: o cache de dedup de arquivo é compartilhado — se o pai leu \`foo.ts\`, o sub-agente não precisa relê-lo
- \`options.tools\`: a lista de ferramentas disponíveis (possivelmente filtrada para o sub-agente)
- \`options.mcpClients\`: as conexões de servidor MCP ativas
- Sistema de arquivos subjacente

A lógica por trás: recursos de I/O são compartilhados para eficiência; estado de conversa e UI são isolados para corretude.

---

## 16.4 Modo Coordinator

O modo coordinator é o caso quando o agente principal não conversa diretamente com o usuário — em vez disso, ele orquestra uma equipe de workers, cada um responsável por um subconjunto da tarefa geral.

### 16.4.1 Definições de Agente

Cada worker type é definido por um \`AgentDefinition\`:

\`\`\`typescript
type AgentDefinition = {
  name: string
  description: string
  model: string | 'inherit'
  tools: string[]            // nomes de ferramentas permitidas
  permissionMode: PermissionMode
  systemPrompt?: string
  maxTurns?: number
}
\`\`\`

As definições de agente são carregadas de \`~/.claude/agents/\` (usuário-global) ou \`.claude/agents/\` (local do projeto) como arquivos YAML. Isso permite que as equipes definam suas topologias multi-agente customizadas sem modificação de código.

### 16.4.2 O Worker Pool

O coordinator mantém um pool de workers, cada um rodando em um dos três backends:

**In-process workers**: Rodam na mesma instância do processo JavaScript que o coordinator, compartilhando memória e acesso ao sistema de arquivos. Mais rápidos, menor overhead, mas competem por CPU no mesmo thread.

**tmux workers**: Cada worker roda como um subprocesso Claude Code separado em seu próprio painel tmux. Verdadeiro paralelismo, visíveis no terminal para o usuário.

**iTerm2 workers**: Similar a tmux mas usando os painéis nativos do iTerm2 no macOS. A auto-detecção verifica \`$TERM_PROGRAM === 'iTerm.app'\`.

A lógica de auto-seleção prioriza tmux quando disponível (detectado verificando se \`tmux\` está no PATH e se a variável de ambiente \`$TMUX\` está definida), depois iTerm2 em macOS, e volta para in-process como padrão.

---

## 16.5 Os Sete Tipos de Tarefa

O tipo de tarefa determina como um worker é executado e gerenciado:

| TaskType | Prefixo ID | Descrição |
| --- | --- | --- |
| \`local_bash\` | \`b\` | Comando shell rodando em terminal em background |
| \`local_agent\` | \`a\` | Sub-agente assíncrono (roda até conclusão fora do turno atual) |
| \`remote_agent\` | \`r\` | Agente em processo Claude Code separado, conectado via bridge |
| \`in_process_teammate\` | \`t\` | Agente no mesmo processo, compartilhando memória e árvore React |
| \`local_workflow\` | \`w\` | Sequência de chamadas de ferramentas definida por especificação de workflow |
| \`monitor_mcp\` | \`m\` | Processo de observação de servidor MCP de longa duração |
| \`dream\` | \`d\` | Tipo especulativo de agente controlado por feature flag |

A interface \`Task\` expõe apenas \`kill\` polimorficamente — \`spawn\` e \`render\` foram removidos de tipos anteriores porque cada tipo de tarefa tem seu próprio mecanismo de spawn especializado.

---

## 16.6 Bridge de Permissão

Workers in-process (teammates) rodam dentro do processo do coordinator mas não têm acesso direto ao terminal do coordinator. Quando um worker precisa de aprovação de permissão, a bridge de permissão (descrita no Capítulo 13 como \`swarmPermissions\`) faz proxy da requisição para cima.

O protocolo da bridge:

1. Worker detecta que \`checkPermissions\` retornou \`ask\`
2. Worker escreve a requisição de permissão serializada no mailbox IPC do coordinator
3. Coordinator lê do mailbox, processa a requisição através de seu próprio \`useCanUseTool\`
4. Se aprovado pelo usuário, o coordinator escreve a decisão de volta no mailbox
5. Worker lê a decisão e retorna para a chamada de ferramenta aguardando

O mailbox IPC é um simples arquivo de socket de domínio Unix (no Unix) ou pipe nomeado (no Windows). O arquivo está localizado em um diretório temporário criado na inicialização do coordinator e é comunicado aos workers via variável de ambiente.

---

## 16.7 Isolamento de Worktree

Para tarefas que fazem modificações extensas de arquivo, sub-agentes podem ser isolados em git worktrees separados:

\`\`\`typescript
// AgentTool spawna o sub-agente com um worktreePath
const worktreeResult = await spawnWorktree(agentDefinition, task)
const subAgentResult = await runAgent({
  ...params,
  worktreePath: worktreeResult.path,
})
\`\`\`

O isolamento de worktree garante que mudanças feitas pelo sub-agente não sejam visíveis para o pai até serem explicitamente mescladas. Isso previne condições de corrida quando múltiplos sub-agentes estão fazendo modificações em paralelo e permite que o coordinator inspecione e escolha quais mudanças do sub-agente aceitar.

---

## Principais Conclusões

O sistema multi-agente do Claude Code é construído sobre uma abstração cuidadosa: cada sub-agente é um loop \`query()\` independente com seu próprio histórico de conversa, modelo e escopo de permissão, mas compartilha estado de I/O como o cache de arquivo dedup e conexões de servidor MCP.

O mecanismo de fork de contexto é a decisão de design central. Clonar o que precisa ser isolado (histórico de mensagens, agentId, setAppState) enquanto compartilha o que pode ser compartilhado com segurança (cache de arquivo, lista de ferramentas, conexões MCP) equilibra corretude e eficiência.

O modo coordinator escala esse modelo além do spawn único-turno. O coordinator orquestra um pool de workers, cada um executando em um dos três backends (in-process, tmux, iTerm2) selecionados por auto-detecção das capacidades do ambiente.

A bridge de permissão é a peça crítica que garante que supervisão humana permaneça centralizada mesmo em cenários multi-agente complexos. Workers que precisam de aprovação de permissão escalam via mailbox IPC para o terminal do coordinator, onde o usuário tem visibilidade completa de todas as ações requerendo aprovação.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 17 examina o sistema de skills e plugins — como o Claude Code é estendido com capacidades customizadas via Markdown e módulos npm.*
`;export{e as default};
