> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 04: Gerenciamento de Estado

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Explicar a arquitetura de estado em duas camadas e articular o limite preciso de responsabilidade entre `src/bootstrap/state.ts` e a store `AppState`
* Ler `src/state/store.ts` e explicar cada escolha de design em suas 35 linhas: por que `Object.is` é a verificação de igualdade, por que `onChange` dispara antes dos listeners, e para que serve a função de cancelamento de inscrição retornada
* Entender como `AppStateProvider` em `src/state/AppState.tsx` conecta a store customizada ao reconciliador React de modo concorrente via `useSyncExternalStore`
* Explicar por que os campos `tasks`, `agentNameRegistry` e o sub-objeto `mcp` são excluídos de `DeepImmutable<>` em `AppStateStore.ts`
* Escrever um novo campo `AppState`, atualizá-lo de uma ferramenta e lê-lo em um componente React — seguindo os padrões corretos em cada etapa
* Explicar o que é `onChangeAppState` em `src/state/onChangeAppState.ts`, por que existe e qual bug corrigiu
* Usar `src/state/selectors.ts` para derivar estado computado sem introduzir efeitos colaterais

---

## O Problema: Dois Tipos de Estado

O Claude Code roda como um processo de terminal interativo. A qualquer momento ele mantém estado que pertence a lifetimes e audiências fundamentalmente diferentes.

Algum estado existe pelo tempo de vida do processo do SO: o ID de sessão carimbado na inicialização, o custo acumulado em USD em todas as chamadas de API, os handles do medidor OpenTelemetry, o caminho para a raiz do projeto. Nenhum desses valores muda em resposta a ações do usuário. Nada na UI precisa re-renderizar quando eles mudam. São infraestrutura de nível de processo.

Outro estado existe especificamente para conduzir a UI React: se a visualização expandida de tarefas está aberta, em qual modo de permissão a sessão está, a lista de conexões MCP ativas, a notificação atual a exibir. Esses valores mudam constantemente, cada mudança deve acionar uma re-renderização React, e se tornam sem sentido depois que a árvore React é desmontada.

Misturar ambos os tipos de estado em uma única store exigiria que toda a árvore React assinasse mutações de infraestrutura que nunca afetam o display. Por outro lado, colocar estado de UI em um objeto simples de nível de módulo exigiria notificar manualmente cada componente em cada mudança.

O Claude Code resolve isso mantendo duas camadas de estado completamente separadas.

---

## A Arquitetura de Duas Camadas

O lado esquerdo nunca notifica ninguém. O lado direito notifica o React em toda mutação.

---

## `src/state/store.ts`: Trinta e Cinco Linhas que Conduzem o React

Toda a implementação da store tem 35 linhas. Vale ler cada uma delas com cuidado.

```typescript
// src/state/store.ts:1-8
type Listener = () => void
type OnChange<T> = (args: { newState: T; oldState: T }) => void

export type Store<T> = {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}
```

A interface pública é mínima. `getState` retorna o snapshot atual. `setState` recebe uma função updater — uma função pura do estado anterior que retorna o próximo estado. `subscribe` registra um listener e retorna uma função de cancelamento de inscrição.

O padrão de função updater para `setState` é uma escolha deliberada. Elimina condições de corrida onde dois chamadores lêm o estado atual, derivam um novo estado independentemente, e a segunda escrita sobrescreve a primeira. Um updater sempre vê o estado mais recente, então chamadas concorrentes produzem resultados determinísticos.

```typescript
// src/state/store.ts:10-34
export function createStore<T>(
  initialState: T,
  onChange?: OnChange<T>,
): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  return {
    getState: () => state,

    setState: (updater: (prev: T) => T) => {
      const prev = state
      const next = updater(prev)
      if (Object.is(next, prev)) return    // Pular se referência igual
      state = next
      onChange?.({ newState: next, oldState: prev })
      for (const listener of listeners) listener()
    },

    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)   // Função de cancelamento de inscrição
    },
  }
}
```

Várias escolhas de implementação merecem atenção explícita.

**`Object.is` para igualdade.** O método `setState` sai imediatamente se `Object.is(next, prev)` é verdadeiro. Isso é igualdade de referência: se a função updater retorna exatamente o mesmo objeto que recebeu, nenhuma notificação dispara. Retornar `prev` inalterado (como em `prev => prev`) é sempre barato e sempre seguro — é o idioma correto para uma atualização no-op.

**`onChange` dispara antes dos listeners.** O callback de efeito colateral `onChange?.({ newState: next, oldState: prev })` é invocado antes do loop de listeners. Isso significa que quando o React re-renderiza em resposta a uma chamada de `Listener`, quaisquer efeitos colaterais que `onChange` iniciou (como persistir um valor em disco ou notificar um SDK externo) já foram despachados. A ordenação previne uma classe de bugs onde a UI renderiza novo estado que o mundo externo ainda não foi informado.

**`Set<Listener>` em vez de um array.** Usar `Set` significa que a mesma função listener só pode ser registrada uma vez. Chamadas duplicadas de `subscribe` de re-renderizações de componentes não acumulam listeners fantasmas. Quando `subscribe` retorna sua função de limpeza `() => listeners.delete(listener)`, a limpeza do `useEffect` do React removerá exatamente o listener que foi registrado.

**A função de cancelamento de inscrição retornada.** `subscribe` retorna `() => listeners.delete(listener)`. Este é o contrato de limpeza de inscrição esperado por `useSyncExternalStore`.

---

## `src/state/AppStateStore.ts`: A Árvore de Estado com 150+ Campos

`AppState` é o tipo que parametriza a store.

### A divisão DeepImmutable

```typescript
// src/state/AppStateStore.ts:89-95
export type AppState = DeepImmutable<{
  settings: SettingsJson
  verbose: boolean
  mainLoopModel: ModelSetting
  mainLoopModelForSession: ModelSetting
  statusLineText: string | undefined
  expandedView: 'none' | 'tasks' | 'teammates'
  // ... muitos mais campos
}> & {
  // Esses campos são excluídos de DeepImmutable:
  tasks: { [taskId: string]: TaskState }
  agentNameRegistry: Map<string, AgentId>
  foregroundedTaskId?: string
  viewingAgentTaskId?: string
  mcp: { clients: MCPServerConnection[]; tools: Tool[]; commands: Command[]; ... }
  plugins: { enabled: LoadedPlugin[]; disabled: LoadedPlugin[]; ... }
}
```

O tipo é uma interseção TypeScript de duas partes. A primeira parte envolve a maioria dos campos em `DeepImmutable<{...}>`. A segunda parte, acrescentada via `&`, contém campos explicitamente excluídos de `DeepImmutable`.

`DeepImmutable<T>` é definido em `src/types/utils.ts` como um tipo mapeado recursivo:

```typescript
export type DeepImmutable<T> = T extends (...args: unknown[]) => unknown
  ? T   // Funções passam sem alteração
  : { readonly [K in keyof T]: DeepImmutable<T[K]> }
```

A consequência prática: TypeScript recusará compilar qualquer mutação direta de um campo `DeepImmutable`. A única forma de mudar `AppState` é por `setState(prev => ({ ...prev, campoMudado: novoValor }))`.

### Por que `tasks` é excluído

O comentário no código-fonte é explícito: `TaskState` contém tipos função. Especificamente, cada registro de estado de tarefa inclui o callback `kill` — uma função armazenada no objeto de estado para que o gerenciador de tarefas possa chamá-la polimorficamente. Se `tasks` estivesse dentro de `DeepImmutable<{...}>`, o sistema de tipos recursiria no tipo função e marcaria seus parâmetros como `readonly`. Isso não tem sentido em runtime, produz erros de compilador confusos e não adiciona nenhuma segurança real.

O mesmo raciocínio se aplica a `agentNameRegistry` (um `Map`, cujos métodos JavaScript não são compatíveis com imutabilidade profunda), e aos sub-objetos `mcp` e `plugins` que contêm handles de conexões ativas e referências a módulos carregados.

### Campos representativos

```typescript
settings: SettingsJson                    // Settings mescladas de todas as fontes
verbose: boolean                          // Flag --verbose para esta sessão
mainLoopModel: ModelSetting              // Modelo atualmente selecionado
statusLineText: string | undefined       // Texto de override da barra de status
expandedView: 'none' | 'tasks' | 'teammates'  // Qual painel está expandido
toolPermissionContext: ToolPermissionContext  // Modo de permissão atual + regras
kairosEnabled: boolean                   // Feature flag para modo Kairos
remoteConnectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
replBridgeEnabled: boolean
thinkingEnabled: boolean | undefined
notifications: { current: Notification | null; queue: Notification[] }
todos: { [agentId: string]: TodoList }
```

---

## `src/state/AppState.tsx`: Integração com React

`AppState.tsx` é a camada de integração React. Conecta a store customizada à árvore de componentes React usando `useSyncExternalStore` e expõe um conjunto de hooks para leitura e escrita de estado.

### AppStateProvider

```typescript
export const AppStoreContext = React.createContext<AppStateStore | null>(null)
const HasAppStateContext = React.createContext<boolean>(false)

export function AppStateProvider({ children, initialState, onChangeAppState }: Props) {
  // Previne aninhamento acidental
  const hasAppStateContext = useContext(HasAppStateContext)
  if (hasAppStateContext) {
    throw new Error("AppStateProvider can not be nested within another AppStateProvider")
  }

  // Store criada uma vez e nunca muda — valor de contexto estável significa
  // que o provider nunca aciona re-renderizações
  const [store] = useState(
    () => createStore(initialState ?? getDefaultAppState(), onChangeAppState)
  )

  return (
    <HasAppStateContext.Provider value={true}>
      <AppStoreContext.Provider value={store}>
        <MailboxProvider>
          <VoiceProvider>{children}</VoiceProvider>
        </MailboxProvider>
      </AppStoreContext.Provider>
    </HasAppStateContext.Provider>
  )
}
```

**A store é criada uma vez dentro de `useState`.** A factory function `() => createStore(...)` é passada para `useState`, garantindo que rode exatamente uma vez — na primeira renderização. Como a referência da store nunca muda, `AppStoreContext.Provider` sempre recebe o mesmo prop `value`. Nenhum componente filho re-renderiza por mudança do valor de contexto. O mecanismo `subscribe`/`getState` da store lida com todo agendamento de re-renderização independentemente do sistema de contexto.

**`HasAppStateContext` previne aninhamento.** Um segundo `AppStateProvider` dentro do primeiro criaria uma nova store isolada. O throw explícito torna esse erro imediatamente visível.

**O efeito de montagem lida com uma condição de corrida.** O `useEffect` na montagem verifica se `bypassPermissionsMode` deve ser desabilitado. Necessário porque settings remotas podem carregar antes do React montar. Se a busca de settings remotas completar antes de `AppStateProvider` montar, a notificação de mudança seria perdida. O efeito de montagem re-lê a política atual e corrige a store se necessário.

### useSyncExternalStore: a ponte para o React concorrente

```typescript
// src/state/AppState.tsx:142-163
export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useAppStore()

  const get = () => {
    const state = store.getState()
    const selected = selector(state)
    return selected
  }

  return useSyncExternalStore(store.subscribe, get, get)
}
```

`useSyncExternalStore` é a API oficial do React 18 para conectar stores externas (não-React) ao reconciliador de modo concorrente. O hook re-renderiza o componente quando `subscribe` dispara uma notificação E o valor do snapshot mudou (comparado via `Object.is`).

Um componente que chama `useAppState(s => s.verbose)` re-renderiza apenas quando `verbose` muda. Um componente que chama `useAppState(s => s.mainLoopModel)` re-renderiza apenas quando `mainLoopModel` muda. Os dois componentes são completamente independentes mesmo compartilhando a mesma store subjacente.

**Aviso crítico de uso:** não retorne novos objetos do selector — `Object.is` sempre os verá como mudados. Em vez disso, selecione uma referência de sub-objeto existente:

```typescript
// Correto — seleciona referência de sub-objeto existente
const { text, promptId } = useAppState(s => s.promptSuggestion)

// Errado — novo objeto literal a cada chamada, re-renderiza em toda notificação
const data = useAppState(s => ({ a: s.a, b: s.b }))
```

### Os hooks restantes

```typescript
export function useSetAppState() {
  return useAppStore().setState
}

export function useAppStateStore() {
  return useAppStore()
}
```

`useSetAppState` retorna `store.setState` diretamente. Como `store` é criada uma vez e nunca substituída, `store.setState` é uma referência de função estável. Um componente que só chama `useSetAppState()` — e nunca chama `useAppState()` — nunca re-renderizará por mudanças de estado. É o padrão correto para componentes somente-ação (botões, handlers de input) que escrevem estado mas nunca o exibem.

---

## `src/state/selectors.ts`: Derivações Puras de Estado

Seletores vivem em seu próprio arquivo e têm uma regra: sem efeitos colaterais.

```typescript
// src/state/selectors.ts:18-40
export function getViewedTeammateTask(
  appState: Pick<AppState, 'viewingAgentTaskId' | 'tasks'>,
): InProcessTeammateTaskState | undefined {
  const { viewingAgentTaskId, tasks } = appState

  if (!viewingAgentTaskId) return undefined
  const task = tasks[viewingAgentTaskId]
  if (!task) return undefined
  if (!isInProcessTeammateTask(task)) return undefined
  return task
}
```

`getViewedTeammateTask` aceita um `Pick<AppState, ...>` em vez do `AppState` completo. É um sinal de precisão: a função declara exatamente quais campos precisa. O compilador TypeScript impõe isso nos call sites — não é possível passar acidentalmente uma cópia stale de apenas dois campos e a função usar campos que estão faltando. Também torna a função trivialmente testável.

```typescript
export type ActiveAgentForInput =
  | { type: 'leader' }
  | { type: 'viewed'; task: InProcessTeammateTaskState }
  | { type: 'named_agent'; task: LocalAgentTaskState }

export function getActiveAgentForInput(appState: AppState): ActiveAgentForInput {
  const viewedTask = getViewedTeammateTask(appState)
  if (viewedTask) return { type: 'viewed', task: viewedTask }

  const { viewingAgentTaskId, tasks } = appState
  if (viewingAgentTaskId) {
    const task = tasks[viewingAgentTaskId]
    if (task?.type === 'local_agent') return { type: 'named_agent', task }
  }

  return { type: 'leader' }
}
```

`getActiveAgentForInput` computa uma union discriminada que determina para onde a próxima mensagem do usuário deve ser roteada. O seletor encapsula essa lógica de roteamento em uma única função testável em vez de espalhá-la pelo handler de input do REPL.

O comentário de nível de módulo `Keep selectors pure and simple - just data extraction, no side effects` é uma restrição arquitetural. Seletores que realizam I/O, mutam estado ou chamam APIs externas quebrariam a garantia fundamental de que podem ser chamados a qualquer momento — incluindo de dentro da função `getSnapshot` do `useSyncExternalStore`, que o React pode chamar durante a renderização.

---

## `src/state/onChangeAppState.ts`: O Hub de Efeitos Colaterais

O callback `onChange` de `createStore` aceita uma função que dispara sempre que o estado muda. No caminho interativo do Claude Code, isso é `onChangeAppState` de `src/state/onChangeAppState.ts`.

Este arquivo existe para resolver um bug histórico específico. O comentário no código-fonte o descreve diretamente:

```typescript
// src/state/onChangeAppState.ts:50-64
// toolPermissionContext.mode — único ponto de estrangulamento para sync CCR/SDK.
//
// Antes deste bloco, mudanças de modo eram repassadas ao CCR por apenas 2 de 8+
// caminhos de mutação: um wrapper setAppState específico em print.ts (apenas
// modo headless/SDK) e uma notificação manual no handler set_permission_mode.
// Todo outro caminho — ciclagem Shift+Tab, opções do diálogo ExitPlanMode,
// o slash command /plan, rewind, o onSetPermissionMode da bridge REPL —
// mutava AppState sem informar o CCR, deixando external_metadata.permission_mode
// stale e a UI web fora de sincronia com o modo real do CLI.
//
// Fazer o hook do diff aqui significa que QUALQUER chamada setAppState que
// muda o modo notifica o CCR e o stream de status do SDK. Os call sites
// espalhados acima não precisam de zero mudanças.
```

Antes de `onChangeAppState` existir, havia pelo menos 8 caminhos de código diferentes que podiam mudar o modo de permissão. Apenas dois deles lembravam de notificar o runtime de controle externo (CCR) e o stream de status do SDK. O resultado era um bug de estado stale.

A correção foi arquitetural. Em vez de auditar cada call site e adicionar a notificação manualmente, `onChangeAppState` observa o diff before/after de estado centralmente:

```typescript
// src/state/onChangeAppState.ts:65-92
const prevMode = oldState.toolPermissionContext.mode
const newMode = newState.toolPermissionContext.mode
if (prevMode !== newMode) {
  const prevExternal = toExternalPermissionMode(prevMode)
  const newExternal = toExternalPermissionMode(newMode)
  if (prevExternal !== newExternal) {
    notifySessionMetadataChanged({
      permission_mode: newExternal,
      is_ultraplan_mode: isUltraplan,
    })
  }
  notifyPermissionModeChanged(newMode)
}
```

A etapa de externalização `toExternalPermissionMode(prevMode)` é importante. Modos internos como `bubble` e `auto` externalizam para seus equivalentes públicos. A notificação do CCR dispara apenas quando a representação externa mudou — uma transição de `default` para `bubble` de volta para `default` são duas mudanças internas mas zero mudanças externas do ponto de vista do CCR.

O restante de `onChangeAppState` lida com outras preocupações de sincronização de estado:

```typescript
// Persistir modelo quando mainLoopModel muda
if (newState.mainLoopModel !== oldState.mainLoopModel) {
  updateSettingsForSource('userSettings', { model: newState.mainLoopModel ?? undefined })
  setMainLoopModelOverride(newState.mainLoopModel)
}

// Persistir expandedView para compatibilidade retroativa
if (newState.expandedView !== oldState.expandedView) {
  saveGlobalConfig(current => ({
    ...current,
    showExpandedTodos: newState.expandedView === 'tasks',
    showSpinnerTree: newState.expandedView === 'teammates',
  }))
}

// Persistir verbose para config global
if (newState.verbose !== oldState.verbose) {
  saveGlobalConfig(current => ({ ...current, verbose: newState.verbose }))
}

// Limpar caches de auth quando settings mudam
if (newState.settings !== oldState.settings) {
  clearApiKeyHelperCache()
  clearAwsCredentialsCache()
  clearGcpCredentialsCache()
  if (newState.settings.env !== oldState.settings.env) {
    applyConfigEnvironmentVariables()
  }
}
```

Cada bloco trata de uma preocupação transversal que de outra forma exigiria que cada call site que muda um dado campo lembrasse de realizar o efeito colateral correspondente.

---

## `src/bootstrap/state.ts`: O Singleton de Nível de Processo

```typescript
// src/bootstrap/state.ts:31
// NÃO ADICIONE MAIS ESTADO AQUI - SEJA CRITERIOSO COM ESTADO GLOBAL
```

Este é uma restrição arquitetural genuína, não comentário decorativo. Adicionar estado a este módulo afeta todos os caminhos de execução — interativo, headless, SDK, sub-agente — porque o módulo é carregado uma vez por processo e seu objeto persiste pelo tempo de vida completo do processo.

Não há reatividade. Sem notificações. Os chamadores lêm o valor e obtêm o que está atualmente lá. Se um sub-agente e a sessão principal estão ambos adicionando custo, ambos chamam `addTotalCostUSD` e os incrementos acumulam no objeto compartilhado. Essa acumulação compartilhada é intencional — o custo exibido na barra de status reflete o custo total da sessão incluindo todos os sub-agentes.

**Categorias de estado:**
- **Identidade de sessão**: `sessionId`, `parentSessionId`, `originalCwd`, `projectRoot` — definidos na inicialização, nunca alterados
- **Acumuladores**: `totalCostUSD`, `totalAPIDuration`, `totalToolDuration`, `totalLinesAdded`, `modelUsage` — acumulam ao longo da sessão, lidos no shutdown
- **Configuração de modelo**: `mainLoopModelOverride`, `initialMainLoopModel` — o override é escrito por `onChangeAppState` quando o usuário muda modelos em `AppState`
- **Handles de telemetria**: `meter`, `sessionCounter`, `loggerProvider`, `meterProvider`, `tracerProvider` — objetos OpenTelemetry criados uma vez, persistem para sempre
- **Flags de sessão**: `isInteractive`, `sessionBypassPermissionsMode`, `sessionTrustAccepted`
- **Caches de infraestrutura**: `agentColorMap`, `lastAPIRequest`, `registeredHooks`, `invokedSkills`

---

## Limite de Responsabilidade: Tabela de Decisão

| Dimensão | `bootstrap/state.ts` | `AppState` (store + `AppStateStore.ts`) |
| --- | --- | --- |
| Lifetime | Tempo de processo | Tempo de sessão (árvore React) |
| Padrão de acesso | Funções síncronas `getXxx()` / `setXxx()` | `store.getState()` ou hooks React |
| Reatividade | Nenhuma | Aciona re-renderizações React via `useSyncExternalStore` |
| Imutabilidade | Nenhuma | `DeepImmutable<>` na maioria dos campos |
| Conteúdo típico | `sessionId`, custo, telemetria, credenciais | Estado de UI, modo de permissão, MCP, tarefas |
| Herança de sub-agente | Compartilhado | Não compartilhado — cada sub-agente tem sua própria store |
| Despacho de efeito colateral | Nenhum | `onChangeAppState` dispara em toda mudança de estado |

**Heurística simples:** se mudar o valor deve atualizar o display do terminal imediatamente → `AppState`. Se é infraestrutura de escopo de processo ou valor que deve ser legível de código de inicialização de módulo sem objeto de contexto → `bootstrap/state.ts`.

---

## Adicionando um Novo Campo ao AppState: O Padrão Completo

Para tornar os critérios de aceitação concretos, aqui está a sequência completa para adicionar um campo hipotético `isCompacting: boolean` ao `AppState`.

**Etapa 1: Adicionar o campo ao tipo em `AppStateStore.ts`.**
```typescript
// Dentro de DeepImmutable<{...}>
isCompacting: boolean
```

**Etapa 2: Adicionar valor padrão em `getDefaultAppState()`.**
```typescript
isCompacting: false,
```

**Etapa 3: Atualizar o campo de uma ferramenta.**
```typescript
context.setAppState(prev => ({ ...prev, isCompacting: true }))
// ... realizar compactação ...
context.setAppState(prev => ({ ...prev, isCompacting: false }))
```

**Etapa 4: Ler o campo em um componente React.**
```typescript
const isCompacting = useAppState(s => s.isCompacting)
```
Este componente re-renderizará exatamente quando `isCompacting` mudar e em nenhum outro momento.

**Etapa 5: Adicionar efeito colateral em `onChangeAppState.ts` se necessário.**
```typescript
if (newState.isCompacting !== oldState.isCompacting) {
  notifyCompactionStatusChanged(newState.isCompacting)
}
```

Nenhum outro arquivo precisa ser tocado. O sistema de tipos impõe o contrato de imutabilidade em cada etapa.

---

## Principais Conclusões

A arquitetura de estado em duas camadas não é um acidente de crescimento. É uma separação deliberada de duas preocupações fundamentalmente incompatíveis: infraestrutura de tempo de processo sem reatividade, e estado de UI de tempo de sessão com reatividade de granularidade fina.

`src/state/store.ts` com 35 linhas implementa o subconjunto essencial de uma store estilo Zustand: snapshots imutáveis, bail-out de igualdade de referência, notificação ordenada (efeitos colaterais antes dos listeners), e limpeza estável de cancelamento de inscrição.

`DeepImmutable<T>` impõe o contrato de imutabilidade em 150+ campos sem exigir anotações `readonly` em cada campo individual. A interseção `& { tasks: ...; mcp: ...; }` é uma exclusão cirúrgica precisa para campos que contêm tipos função ou handles de conexões ativas.

`useSyncExternalStore` é a conexão load-bearing entre a store customizada e o reconciliador React de modo concorrente. O padrão de seletor em `useAppState(selector)` garante que componentes re-renderizem apenas quando a fatia específica de estado de que se importam muda.

`onChangeAppState` centraliza todos os efeitos colaterais transversais de mudanças de estado. Sua existência corrigiu uma classe de bugs de estado stale onde caminhos de mutação espalhados cada um tinha que lembrar de notificar consumidores externos.

`src/bootstrap/state.ts` é a válvula de pressão explícita para estado que verdadeiramente não pode viver no nível reativo: valores que devem sobreviver a resets da árvore React, valores que devem ser acessíveis de código de inicialização de módulo sem injeção de dependência, e valores que devem ser compartilhados por todos os sub-agentes porque acumulam ao longo do tempo de vida completo do processo.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 05 traça o loop agêntico interno em `src/query.ts` — o pipeline AsyncGenerator que conduz chamadas de API com streaming, despacho de ferramentas e compactação de contexto.*
