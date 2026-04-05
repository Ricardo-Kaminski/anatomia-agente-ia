const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 03: O Sistema de Tipos Central

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Explicar os três parâmetros de tipo de \`Tool<Input, Output, P>\` e o papel de cada um tanto em tempo de compilação quanto em runtime
* Navegar pelos 40+ campos do \`ToolUseContext\` e entender por que o padrão de injeção de dependências foi escolhido em vez de estado global
* Distinguir a factory function \`buildTool()\` da interface \`Tool\` bruta, e explicar o que a maquinaria \`ToolDef\` / \`BuiltTool\` realiza
* Identificar as três variantes da union discriminada \`Command\` e saber quando cada uma é usada
* Mapear as 7 variantes de \`TaskType\` e os 5 estados de \`TaskStatus\`, e usar \`isTerminalTaskStatus()\` corretamente
* Descrever o sistema de tipos de permissão: modos, variantes de decisão e a union \`PermissionDecisionReason\`
* Explicar como \`DeepImmutable<T>\` impõe imutabilidade sem copiar dados
* Explicar a garantia de segurança em tempo de compilação fornecida por tipos branded como \`SessionId\` e \`AgentId\`
* Entender o papel do Zod v4 em conectar validação em runtime e inferência TypeScript

---

## Por que o Sistema de Tipos Importa

A arquitetura do Claude Code é um loop de chamadas de ferramentas. O modelo solicita ações, o sistema as executa e os resultados retornam. Cada componente nesse loop é expresso em um pequeno conjunto de tipos cuidadosamente projetados. Esses tipos são os contratos de API que tornam possível que mais de 60 implementações de ferramentas compartilhem um único motor de execução, que a lógica de permissão seja testada em isolamento, e que a UI React permaneça em sincronia com a execução de ferramentas sem fiação explícita.

---

## A Interface \`Tool<Input, Output, P>\`

**Fonte:** \`src/Tool.ts:362-466\`

\`\`\`typescript
export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = { ... }
\`\`\`

\`\`\`typescript
export type AnyObject = z.ZodType<{ [key: string]: unknown }>
\`\`\`

\`Input\` é um schema Zod que serve a dois mestres: em runtime valida inputs malformados da API; em tempo de compilação \`z.infer<Input>\` extrai o objeto de parâmetros fortemente tipado.

\`Output\` padrão é \`unknown\`, representa os dados retornados pela ferramenta.

\`P\` estende \`ToolProgressData\` — os payloads de progresso em streaming emitidos enquanto a ferramenta roda.

### O método \`call\` — o núcleo obrigatório

\`\`\`typescript
call(
  args: z.infer<Input>,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  parentMessage: AssistantMessage,
  onProgress?: ToolCallProgress<P>,
): Promise<ToolResult<o>>
\`\`\`

\`args\` é \`z.infer<Input>\` — já validado pelo executor antes de \`call\` ser invocado. \`onProgress\` é opcional: ferramentas que transmitem saída incremental chamam esse callback conforme produzem dados, por isso a saída do terminal aparece caractere por caractere.

### Métodos comportamentais principais

\`\`\`typescript
isConcurrencySafe(input: z.infer<Input>): boolean
isEnabled(): boolean
isReadOnly(input: z.infer<Input>): boolean
isDestructive?(input: z.infer<Input>): boolean
interruptBehavior?(): 'cancel' | 'block'
\`\`\`

\`isConcurrencySafe\`: leituras de arquivo retornam \`true\`; comandos Bash retornam \`false\`. \`isDestructive\`: quando \`true\` e o modo de permissão requer confirmação, a UI apresenta aviso mais proeminente. \`interruptBehavior\`: \`'cancel'\` aborta imediatamente; \`'block'\` continua e enfileira a nova mensagem.

### Carregamento diferido: \`shouldDefer\` e \`alwaysLoad\`

\`\`\`typescript
readonly shouldDefer?: boolean
readonly alwaysLoad?: boolean
\`\`\`

Ferramentas com \`shouldDefer: true\` são excluídas da lista inicial de ferramentas da API. O modelo pode buscá-las via ToolSearch. Ferramentas com \`alwaysLoad: true\` nunca são diferidas. Mecanismo que permite mais de 60 ferramentas coexistir sem preencher o system prompt inicial.

### \`maxResultSizeChars\` — o orçamento de overflow

\`\`\`typescript
maxResultSizeChars: number
\`\`\`

Quando o resultado excede esse limite, o executor escreve o resultado completo em arquivo temporário e retorna prévia truncada com o caminho. \`FileReadTool\` define isso como \`Infinity\` para evitar loops circulares de leitura.

---

## \`ToolResult<T>\` — Efeitos Colaterais ao Lado dos Dados

\`\`\`typescript
export type ToolResult<T> = {
  data: T
  newMessages?: (UserMessage | AssistantMessage | AttachmentMessage | SystemMessage)[]
  contextModifier?: (context: ToolUseContext) => ToolUseContext
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
}
\`\`\`

\`data\`: valor primário, serializado como bloco \`tool_result\`. \`newMessages\`: permite injetar mensagens adicionais (usado por sub-agentes para injetar transcrição completa). \`contextModifier\`: transforma \`ToolUseContext\` após a ferramenta completar — só respeitado para ferramentas não concurrency-safe.

---

## \`buildTool()\` — A Factory Builder

**Fonte:** \`src/Tool.ts:721-792\`

\`\`\`typescript
export type ToolDef<...> = Omit<Tool<...>, DefaultableToolKeys> &
  Partial<Pick<Tool<...>, DefaultableToolKeys>>
\`\`\`

\`\`\`typescript
type BuiltTool<D> = Omit<D, DefaultableToolKeys> & {
  [K in DefaultableToolKeys]-?: K extends keyof D
    ? undefined extends D[K] ? ToolDefaults[K] : D[K]
    : ToolDefaults[K]
}
\`\`\`

\`\`\`typescript
export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>
}
\`\`\`

Os padrões são fail-closed: \`isConcurrencySafe\` → \`false\`, \`isReadOnly\` → \`false\`, \`isDestructive\` → \`false\`, \`checkPermissions\` → \`{ behavior: 'allow' }\`.

Exemplo típico:
\`\`\`typescript
export const FileReadTool = buildTool({
  name: 'Read',
  inputSchema: z.object({ file_path: z.string() }),
  maxResultSizeChars: Infinity,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(args, context, canUseTool) { ... },
})
\`\`\`

---

## \`ToolUseContext\` — A Espinha Dorsal de Injeção de Dependências

**Fonte:** \`src/Tool.ts:158-300\`

Ferramentas são funções puras de seus \`args\` e \`context\`. Isso as torna testáveis em isolamento.

### O sub-objeto \`options\`

\`\`\`typescript
options: {
  commands: Command[]
  debug: boolean
  mainLoopModel: string
  tools: Tools
  verbose: boolean
  thinkingConfig: ThinkingConfig
  mcpClients: MCPServerConnection[]
  mcpResources: Record<string, ServerResource[]>
  isNonInteractiveSession: boolean
  agentDefinitions: AgentDefinitionsResult
  maxBudgetUsd?: number
  customSystemPrompt?: string
  refreshTools?: () => Tools
}
\`\`\`

\`isNonInteractiveSession\` é particularmente importante: ferramentas verificam esse flag antes de tentar renderizar elementos de UI.

### Acessores de estado: a fronteira React

\`\`\`typescript
getAppState(): AppState
setAppState(f: (prev: AppState) => AppState): void
setAppStateForTasks?: (f: (prev: AppState) => AppState) => void
\`\`\`

\`setAppStateForTasks\` bypassa o no-op de sub-agentes e sempre escreve na store raiz — necessário para tarefas em background que precisam se registrar globalmente.

### Callbacks de UI: fiação opcional

\`\`\`typescript
setToolJSX?: SetToolJSXFn
addNotification?: (notif: Notification) => void
appendSystemMessage?: (msg: Exclude<SystemMessage, SystemLocalCommandMessage>) => void
sendOSNotification?: (opts: { message: string; notificationType: string }) => void
setStreamMode?: (mode: SpinnerMode) => void
\`\`\`

Todos opcionais (\`?\`) — uma ferramenta que usa \`sendOSNotification?.()\` não lançará erro no modo headless.

### Campos de rastreamento e orçamento

\`\`\`typescript
toolDecisions?: Map<string, { source: string; decision: 'accept' | 'reject'; timestamp: number }>
localDenialTracking?: DenialTrackingState
contentReplacementState?: ContentReplacementState
renderedSystemPrompt?: SystemPrompt
\`\`\`

\`renderedSystemPrompt\` carrega o system prompt congelado da sessão pai no momento do fork. Sub-agentes compartilham a chave de cache de prompt do pai para evitar divergências por transições cold-to-warm do GrowthBook.

---

## A Union Discriminada \`Command\`

**Fonte:** \`src/types/command.ts:205-206\`

\`\`\`typescript
export type Command = CommandBase &
  (PromptCommand | LocalCommand | LocalJSXCommand)
\`\`\`

**\`PromptCommand\` (\`type: 'prompt'\`)**: backed por template Markdown; expandido em \`ContentBlockParam[]\` e enviado ao modelo. Skills de \`.claude/skills/\` são prompt commands.

**\`LocalCommand\` (\`type: 'local'\`)**: função TypeScript; retorna \`LocalCommandResult\` sem fazer chamada de API. \`/clear\`, \`/reset\`, \`/cost\` são local commands.

**\`LocalJSXCommand\` (\`type: 'local-jsx'\`)**: renderiza componente React no terminal até o callback \`onDone\` ser chamado. A função \`load\` é um import dinâmico — o componente pesado só é carregado quando o comando é invocado.

---

## O Sistema \`Task\` e \`TaskType\`

**Fonte:** \`src/Task.ts\`

### \`TaskType\` — 7 variantes

\`\`\`typescript
export type TaskType =
  | 'local_bash'      // b — comando shell em terminal em background
  | 'local_agent'     // a — sub-agente assíncrono
  | 'remote_agent'    // r — agente em processo Claude Code separado
  | 'in_process_teammate' // t — agente no mesmo processo, compartilha memória
  | 'local_workflow'  // w — sequência de chamadas de ferramentas
  | 'monitor_mcp'     // m — observação de servidor MCP de longa duração
  | 'dream'           // d — tipo especulativo controlado por feature flag
\`\`\`

### \`TaskStatus\` — 5 estados

\`\`\`typescript
export type TaskStatus =
  | 'pending'    // → running
  | 'running'    // → completed | failed | killed
  | 'completed'  // terminal
  | 'failed'     // terminal
  | 'killed'     // terminal

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}
\`\`\`

### \`TaskStateBase\` — o registro comum

\`\`\`typescript
export type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  totalPausedMs?: number
  outputFile: string      // arquivo onde a tarefa escreve saída em streaming
  outputOffset: number    // bytes já consumidos pela UI
  notified: boolean       // flag unidirecional — nunca redefinido
}
\`\`\`

### A interface \`Task\` — kill polimórfico

\`\`\`typescript
export type Task = {
  name: string
  type: TaskType
  kill(taskId: string, setAppState: SetAppState): Promise<void>
}
\`\`\`

Refatoração removeu os caminhos polimórficos de spawn e render, deixando apenas \`kill\` — a única operação que deve funcionar uniformemente em todos os seis tipos concretos.

---

## O Sistema de Tipos de Permissão

**Fonte:** \`src/types/permissions.ts\`

### \`PermissionMode\` — 7 variantes

\`\`\`typescript
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',        // auto-aprova edições de arquivo
  'bypassPermissions',  // remove todas as verificações
  'default',            // solicita confirmação para escritas
  'dontAsk',            // auto-aprova tudo
  'plan',               // desativa toda execução de ferramentas
] as const

export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
\`\`\`

\`auto\` (feature flag \`TRANSCRIPT_CLASSIFIER\`): roteia decisões para modelo classificador. \`bubble\`: usado por workers do coordinator que delegam decisões para o pai.

### \`PermissionResult\` — a union de decisão

Quatro variantes:

- **\`allow\`**: ferramenta pode prosseguir. \`updatedInput\` pode conter input reescrito por hook.
- **\`ask\`**: usuário deve aprovar interativamente. \`suggestions\` oferece opções de um clique.
- **\`deny\`**: rejeitado. Sempre carrega \`decisionReason\`.
- **\`passthrough\`**: defer para o próximo handler na cadeia de regras.

### \`PermissionDecisionReason\` — a trilha de auditoria

\`\`\`typescript
export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'subcommandResults'; reasons: Map<string, PermissionResult> }
  | { type: 'permissionPromptTool'; ... }
  | { type: 'hook'; hookName: string; hookSource?: string; reason?: string }
  | { type: 'asyncAgent'; reason: string }
  | { type: 'sandboxOverride'; reason: 'excludedCommand' | 'dangerouslyDisableSandbox' }
  | { type: 'classifier'; classifier: string; reason: string }
  | { type: 'workingDir'; reason: string }
  | { type: 'safetyCheck'; reason: string; classifierApprovable: boolean }
  | { type: 'other'; reason: string }
\`\`\`

11 variantes cobrem cada caminho de decisão — permite que a UI mostre explicação precisa e atribuída à fonte de por que uma ação foi bloqueada.

---

## \`AppState\` — A Store de Sessão Imutável com 150+ Campos

**Fonte:** \`src/state/AppStateStore.ts:89-216\`

\`\`\`typescript
export type AppState = DeepImmutable<{
  settings: SettingsJson
  verbose: boolean
  mainLoopModel: ModelSetting
  toolPermissionContext: ToolPermissionContext
  remoteConnectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  replBridgeEnabled: boolean
  // ... 150+ campos
}> & {
  // Excluídos de DeepImmutable — TaskState contém tipos função
  tasks: { [taskId: string]: TaskState }
  agentNameRegistry: Map<string, AgentId>
  mcp: { clients: MCPServerConnection[]; tools: Tool[]; ... }
  plugins: { enabled: LoadedPlugin[]; ... }
}
\`\`\`

### \`DeepImmutable<T>\` — o utilitário readonly recursivo

\`\`\`typescript
export type DeepImmutable<T> = T extends (...args: unknown[]) => unknown
  ? T  // Funções: passar sem alteração
  : { readonly [K in keyof T]: DeepImmutable<T[K]> }
\`\`\`

Recursa por todo nível aninhado adicionando \`readonly\`. Tipos função são passados sem recursão — tornar parâmetros de função \`readonly\` causaria erros de tipo falsos. O efeito prático: qualquer mutação direta de \`AppState\` não compila. Mudanças devem ir por \`setAppState(prev => ({ ...prev, campo: novoValor }))\`.

---

## Tipos Branded: \`SessionId\` e \`AgentId\`

**Fonte:** \`src/types/ids.ts\`

\`\`\`typescript
export type SessionId = string & { readonly __brand: 'SessionId' }
export type AgentId   = string & { readonly __brand: 'AgentId' }
\`\`\`

A propriedade \`__brand\` existe apenas no nível de tipo — nunca presente em runtime. Custo zero de bytes e overhead zero.

\`\`\`typescript
// Escape hatch para fontes confiáveis
export function asSessionId(id: string): SessionId {
  return id as SessionId
}

// Construtor seguro com validação de formato
const AGENT_ID_PATTERN = /^a(?:.+-)?[0-9a-f]{16}$/
export function toAgentId(s: string): AgentId | null {
  return AGENT_ID_PATTERN.test(s) ? (s as AgentId) : null
}
\`\`\`

Garantia em tempo de compilação: passar um \`SessionId\` onde um \`AgentId\` é esperado não compila. O typo que causaria roteamento errado entre processos é rejeitado pelo compilador.

---

## Zod v4: Validação em Runtime Encontra Inferência TypeScript

\`\`\`typescript
import type { z } from 'zod/v4'
\`\`\`

O subpath \`'zod/v4'\` é significativo — diferente do \`'zod'\` do Zod v3.

**Três propósitos simultâneos:**

1. **Validação em runtime**: \`tool.inputSchema.parse(rawJson)\` rejeita inputs malformados antes de \`call()\` ser invocado
2. **Inferência TypeScript**: \`z.infer<Input>\` extrai o tipo em tempo de compilação — schema e tipo derivados da mesma fonte de verdade
3. **Geração de JSON Schema**: conversor Zod-para-JSON-Schema produz o \`tools\` parameter para a API

---

## Principais Conclusões

\`Tool<Input, Output, P>\` torna toda ação intercambiável do ponto de vista do executor. Os três parâmetros de tipo garantem que o schema de validação e o tipo TypeScript estejam sempre em sincronia.

\`buildTool()\` é o padrão Builder implementado inteiramente no sistema de tipos TypeScript. Defaults são fail-closed — impossível obter \`undefined\` em métodos defaultáveis.

Os 40+ campos de \`ToolUseContext\` são injeção de dependências em vez de estado global. Sub-agentes recebem contexto clonado com estado isolado.

\`DeepImmutable<T>\` impõe imutabilidade em cada nível de \`AppState\` sem anotações \`readonly\` explícitas em cada campo.

Tipos branded como \`SessionId\` e \`AgentId\` previnem bugs de roteamento em tempo de compilação, sem custo em runtime.

\`PermissionDecisionReason\` com 11 variantes cria trilha de auditoria completa para cada decisão de permissão.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 04 examina o sistema de gerenciamento de estado — como \`AppState\`, \`bootstrap/state.ts\` e os mecanismos de store interagem para manter consistência ao longo de toda a sessão.*
`;export{e as default};
