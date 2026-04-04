> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 05: O Loop Agêntico

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Explicar por que um loop iterativo — em vez de uma única chamada de função — é o primitivo correto para um agente de IA que usa ferramentas
* Traçar um prompt completo do usuário desde o ponto de entrada até o valor de retorno terminal, nomeando cada decisão importante ao longo do caminho
* Ler o struct `State` e explicar o que cada um de seus dez campos rastreia e por quê
* Descrever as quatro etapas de preparação pré-iteração (snip, microcompact, context collapse, autocompact) e a ordem em que rodam
* Explicar `deps.callModel()` e o que o loop de streaming coleta de cada evento
* Percorrer todos os sete caminhos `continue` em `queryLoop()` e dar um cenário real concreto onde cada um dispara
* Entender o que `handleStopHooks()` faz após cada turno que termina sem chamadas de ferramentas
* Distinguir entre `runTools` e `StreamingToolExecutor` e explicar quando cada um está ativo
* Explicar o papel de `QueryConfig` e `QueryDeps` em tornar o loop independentemente testável
* Ler `checkTokenBudget()` e explicar as duas condições de parada que ele impõe

---

## 5.1 Por que um Loop? O Insight Fundamental de Design

Quando você interage com um modelo de linguagem em sua forma mais simples, a troca é uma única ida e volta. Você envia um prompt, recebe uma completação de texto, a interação acaba. Esse modelo é poderoso, mas não pode agir sobre o mundo. Pode descrever um comando shell; não pode executá-lo. Pode esboçar um plano para ler um arquivo; não pode abrir o arquivo e reportar o que encontrou.

O insight arquitetural central do Claude Code é que um agente não é uma única chamada de API, mas um processo que alterna entre dois modos: raciocínio e ação. O modelo raciocina produzindo texto. Age solicitando execuções de ferramentas — leia este arquivo, execute este comando, pesquise este codebase. Cada conjunto de resultados de ferramentas é alimentado de volta ao modelo como novo contexto, possibilitando a próxima rodada de raciocínio. Essa alternância continua até o modelo produzir uma resposta final sem chamadas de ferramentas, momento em que o turno está completo.

Essa alternância é o loop agêntico. Não é uma função recursiva (embora versões anteriores deste codebase usassem recursão). É um motor `while (true)` com um único struct `State` mutável, sete caminhos distintos que chamam `continue` para reiniciar o motor, e um pequeno conjunto de condições que fazem `return` de um valor terminal para encerrá-lo permanentemente.

O loop vive em `src/query.ts`, que com 1.730 linhas é o maior e mais importante arquivo do codebase. Todo o resto — a UI React, as implementações de ferramentas, o sistema de permissões, os subsistemas de compactação — existe para servir ou estender este loop.

---

## 5.2 `query()`: O Wrapper Externo Fino

O ponto de entrada público do loop é `query()` em `src/query.ts:219`:

```typescript
// src/query.ts:219-239
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
>
{
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  // Só alcançado se queryLoop retornou normalmente. Pulado em throw e .return()
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

`query()` é uma função async generator. O operador `yield*` delega para `queryLoop`, encaminhando cada evento gerado para o chamador e recebendo o valor de retorno terminal quando `queryLoop` termina. Isso significa que `query()` não é apenas um wrapper — participa do protocolo generator como um conduto transparente.

A única lógica que `query()` adiciona é a notificação de ciclo de vida de comandos. Quando um usuário digita um slash command que é enfileirado e posteriormente consumido como anexo no meio de um turno, o UUID desse comando é rastreado em `consumedCommandUuids`. Quando `queryLoop` completa normalmente, `query()` percorre esses UUIDs e dispara `notifyCommandLifecycle(uuid, 'completed')`. O comentário explica a assimetria: se `queryLoop` lança, esse código nunca roda, produzindo o sinal "iniciado mas não completado" que a UI usa para detectar processamento de comando interrompido.

### O tipo QueryParams

```typescript
export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  taskBudget?: { total: number }
  deps?: QueryDeps
}
```

`messages` é o histórico de conversa até este ponto. `systemPrompt` é o system prompt estruturado, não uma string simples — carrega anotações de cache. `userContext` e `systemContext` são mapas chave-valor injetados no nível da API: valores de `userContext` são prefixados ao primeiro turno humano; valores de `systemContext` são acrescentados ao system prompt. `canUseTool` é chamado antes de cada execução de ferramenta, não no momento da configuração — permissões podem mudar no meio de um turno. `querySource` identifica qual caminho de código iniciou a query: `'repl_main_thread'`, `'sdk'`, uma variante `'agent:...'`, etc.

---

## 5.3 O Esqueleto do Loop: State e while(true)

`queryLoop()` começa construindo o valor `State` inicial:

```typescript
// src/query.ts:268-279
let state: State = {
  messages: params.messages,
  toolUseContext: params.toolUseContext,
  maxOutputTokensOverride: params.maxOutputTokensOverride,
  autoCompactTracking: undefined,
  stopHookActive: undefined,
  maxOutputTokensRecoveryCount: 0,
  hasAttemptedReactiveCompact: false,
  turnCount: 1,
  pendingToolUseSummary: undefined,
  transition: undefined,
}
```

O tipo `State` completo:

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined  // por que a iteração anterior continuou
}
```

**Papel de cada campo:**

- `messages`: histórico acumulado que cresce entre turnos — começa como `params.messages` e a cada `next_turn` torna-se `[...messagesForQuery, ...assistantMessages, ...toolResults]`
- `toolUseContext`: pode ser atualizado por execução de ferramentas; quando um AgentTool spawna um subagente, as definições de agente disponíveis no contexto devem ser visíveis na próxima chamada de API
- `autoCompactTracking`: registra se o autocompact proativo disparou e quantos turnos se passaram desde então
- `maxOutputTokensRecoveryCount`: conta tentativas consecutivas de recuperação após o modelo atingir o limite de tokens de saída — permitidas até três
- `hasAttemptedReactiveCompact`: guard booleano que previne a compactação reativa de rodar mais de uma vez por query
- `maxOutputTokensOverride`: controla uma escalada one-shot — quando o modelo atinge o cap padrão de 8.192 tokens e um feature gate permite, o loop tenta novamente com 64.000
- `pendingToolUseSummary`: `Promise` que resolve para um resumo legível das chamadas de ferramentas que acabaram de completar, gerado em paralelo pela próxima chamada de API
- `stopHookActive`: flag que informa `handleStopHooks` se um stop hook já rodou em iteração anterior
- `turnCount`: começa em 1 e incrementa a cada continuação `next_turn`, comparado contra `maxTurns`
- `transition`: registra *por que* a iteração anterior continuou — testes podem inspecionar isso sem precisar parsear conteúdo de mensagens

O loop abre em `src/query.ts:307`:

```typescript
// eslint-disable-next-line no-constant-condition
while (true) {
  let { toolUseContext } = state
  const { messages, autoCompactTracking, ... } = state
  // ... corpo da iteração ...
}
```

A desestruturação no topo de cada iteração serve a um propósito importante. Os campos de `state` são lidos uma vez em constantes locais. Em cada site de `continue`, o código escreve `state = { ... }` como uma única construção atômica de objeto — não há atribuições espalhadas de `state.field = value`. Isso torna trivialmente verificável se alguma mutação de estado foi perdida.

---

## 5.4 Preparação Pré-Iteração: Quatro Camadas

Antes de fazer a chamada de API, cada iteração do loop roda até quatro etapas de preparação que trimam ou transformam o histórico de mensagens.

**Etapa 1: Extração de limite de compactação.** `getMessagesAfterCompactBoundary(messages)` retorna a fatia da conversa desde o último evento de auto-compactação. Tudo antes do limite foi substituído por um resumo.

**Etapa 2: Orçamento de resultados de ferramentas.** `applyToolResultBudget()` impõe um orçamento de tamanho por mensagem no conteúdo de resultados de ferramentas. Se uma ferramenta produziu saída maior que seu máximo configurado, o conteúdo é substituído por um aviso de truncamento e a substituição é persistida em disco.

**Etapa 3: Snip (feature gate `HISTORY_SNIP`).** Quando habilitado, o módulo snip remove turnos antigos que excedem um orçamento de tokens. Diferente da compactação, que resume conteúdo, o snipping simplesmente descarta mensagens antigas da janela de contexto preservando as recentes.

**Etapa 4: Microcompact.** `deps.microcompact()` realiza compressão inline de resultados recentes de ferramentas, tipicamente substituindo saída verbose do bash por uma versão condensada. Os resultados comprimidos são cacheados por `tool_use_id` para que uma vez comprimido nunca seja recomprimido.

**Etapa 5: Projeção de context collapse (feature gate `CONTEXT_COLLAPSE`).** Mecanismo em estágios que marca seções da conversa como comprimíveis. Antes da chamada de API, a etapa de projeção decide quais colapsos aplicar, substituindo seções expandidas por espaços reservados compactos.

**Etapa 6: Autocompact.** `deps.autocompact()` verifica se o token count acumulado cruzou o limiar configurado. Se sim, aciona uma sumarização completa: o histórico é comprimido em uma mensagem de resumo, um limite de compact é registrado, e a próxima chamada de API vê apenas o resumo mais os turnos recentes.

---

## 5.5 A Chamada de API com Streaming

Após a preparação, o loop faz a chamada de API via `deps.callModel()`. A chamada em si é um loop `for await` sobre um async generator — a resposta da API chega em stream como uma sequência de eventos de mensagem tipados.

Decisões de design que merecem atenção:

**`prependUserContext`** envolve `messagesForQuery` com os pares chave-valor dinâmicos de `userContext`. São prefixados ao primeiro turno humano para que o modelo sempre veja valores atuais sem exigir que o chamador mute o array de mensagens.

**O sinal de abort** é encadeado diretamente em `callModel`. Se o usuário pressiona Ctrl+C, o abort controller dispara, a requisição HTTP é cancelada e o loop `for await` termina imediatamente.

**Retenção de erros recuperáveis.** Quando a API retorna `prompt-too-long` (HTTP 413), um erro de tamanho de mídia ou stop reason `max_tokens`, o loop *não* gera esse erro imediatamente para o chamador. Define `withheld = true`, pula o yield, mas ainda empurra a mensagem em `assistantMessages`. Após o loop de streaming terminar, a lógica de recuperação inspeciona o último elemento de `assistantMessages` para decidir se deve compactar e tentar novamente. Se a recuperação tiver sucesso, o usuário nunca vê o erro.

**`needsFollowUp`** é o booleano que determina qual branch a lógica pós-stream entra. Se qualquer mensagem `assistant` no stream continha pelo menos um bloco `tool_use`, `needsFollowUp` é `true` e o loop executará essas ferramentas e continuará.

**Integração do `StreamingToolExecutor`.** Quando habilitado, ferramentas são iniciadas enquanto o modelo ainda está fazendo streaming. À medida que cada bloco `tool_use` chega na mensagem assistant, `streamingToolExecutor.addTool(toolBlock, message)` é chamado imediatamente. Quando o stream termina, algumas ferramentas podem já ter completado, reduzindo a latência total.

**Fallback de modelo.** Se `deps.callModel` lança `FallbackTriggeredError` e um `fallbackModel` foi fornecido, toda a tentativa de streaming é descartada e tentada novamente com o modelo de fallback. Mensagens assistant previamente geradas recebem eventos tombstone para que a UI as remova do display.

---

## 5.6 Os Sete Caminhos Continue

O loop agêntico tem sete caminhos distintos que chamam `continue` — construindo um novo `State` e reiniciando o corpo `while (true)`.

### Caminho 1: Retry de Drenagem de Context Collapse

**Razão de transição:** `collapse_drain_retry`

**Trigger:** O modelo retornou erro `prompt-too-long` e o subsistema de context collapse tem colapsos em estágio disponíveis ainda não commitados.

Context collapse é um mecanismo progressivo. Ao longo de uma conversa longa, seções do histórico de mensagens são marcadas como candidatas a colapso. Normalmente são commitadas lazily, uma por iteração. Mas quando um erro `prompt-too-long` ocorre, o loop invoca `contextCollapse.recoverFromOverflow()`, que commita todos os colapsos em estágio imediatamente.

A verificação da transição anterior garante que este caminho dispare no máximo uma vez: se um drain-retry ainda produziu 413, o loop cai para o caminho mais agressivo de compact reativo na próxima iteração.

**Cenário concreto:** Um usuário pede ao Claude para analisar um repositório e o modelo passou dez turnos lendo arquivos grandes. Os resultados acumulados de ferramentas preenchem a janela de contexto. No décimo primeiro turno a API retorna 413. Context collapse tem resumos em estágio para sete desses resultados de leitura de arquivo. O loop os commita todos imediatamente, o contexto cai abaixo do limite e a chamada de API tem sucesso na tentativa sem o usuário ver nenhuma mensagem de erro.

### Caminho 2: Retry de Compact Reativo

**Razão de transição:** `reactive_compact_retry`

**Trigger:** Erro `prompt-too-long` ou erro de tamanho de mídia (imagem ou PDF oversized), e a drenagem de context collapse falhou ou já foi tentada.

A compactação reativa invoca uma sumarização completa do histórico de conversas e substitui as mensagens acumuladas por esse resumo mais os turnos recentes. `hasAttemptedReactiveCompact` previne o loop de acionar a compactação reativa uma segunda vez.

**Cenário concreto:** Um usuário colou várias capturas de tela de alta resolução na conversa. O path de compact reativo remove as imagens das mensagens históricas e produz um resumo em texto do que havia nelas.

### Caminho 3: Escalada de max\_output\_tokens

**Razão de transição:** `max_output_tokens_escalate`

**Trigger:** O modelo atingiu seu limite de tokens de saída, é a primeira vez nesta query, o feature gate de escalada está habilitado e `maxOutputTokensOverride` ainda não foi definido.

O cap padrão de saída é 8.192 tokens. Quando o modelo atinge esse limite e o gate Statsig `tengu_otk_slot_v1` está habilitado, o loop tenta novamente a mesma requisição com `maxOutputTokensOverride` definido como `ESCALATED_MAX_TOKENS` (64.000). O array de mensagens não muda — é exatamente a mesma requisição com um cap mais alto.

**Cenário concreto:** Um usuário pede ao Claude para escrever um conjunto completo de testes para um módulo grande. O modelo começa a gerar os testes e atinge 8.192 tokens no meio do suite. Em vez de entregar um arquivo incompleto, o loop tenta novamente silenciosamente com 64.000 tokens e o suite completo é entregue como uma única resposta.

### Caminho 4: Recuperação Multi-Turno de max\_output\_tokens

**Razão de transição:** `max_output_tokens_recovery`

**Trigger:** O modelo atingiu seu limite de tokens de saída, a escalada já disparou (ou não está habilitada) e o contador de recuperação está abaixo do limite de três.

Se a escalada falhou ou não está disponível, o loop injeta um prompt de recuperação como mensagem de usuário oculta: `"Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."` O flag `isMeta: true` oculta esta mensagem da UI.

`maxOutputTokensRecoveryCount` permite até três injeções de recuperação. Após três tentativas, o erro retido é gerado e o loop sai normalmente.

**Cenário concreto:** Um modelo pedido para produzir um longo script de migração atinge o limite de saída no meio da geração. O loop injeta o prompt de recuperação. O modelo retoma exatamente onde parou — no meio de uma linha, se necessário — e continua. Isso pode acontecer até três vezes antes de desistir.

### Caminho 5: Erro de Bloqueio de Stop Hook

**Razão de transição:** `stop_hook_blocking`

**Trigger:** O modelo completou seu turno sem chamadas de ferramentas, `handleStopHooks()` rodou e pelo menos um stop hook retornou um erro de bloqueio.

Stop hooks são scripts shell configuráveis pelo usuário que rodam após cada turno do modelo. Um hook pode retornar um "erro de bloqueio" — saída que deve ser mostrada de volta ao modelo para que ele possa responder ou incorporar o feedback. Quando `handleStopHooks()` retorna `blockingErrors` com pelo menos uma entrada, o loop acrescenta esses erros ao histórico de mensagens e continua.

`maxOutputTokensRecoveryCount` é resetado para 0 neste caminho, mas `hasAttemptedReactiveCompact` é preservado. O comentário no código-fonte explica: resetar `hasAttemptedReactiveCompact` causou um loop infinito em um bug real — compact rodou, o contexto compactado ainda era muito longo, o erro da API acionou um retry de bloqueio de stop hook e o guard de compact resetado permitiu que compact rodasse novamente, produzindo o mesmo resultado indefinidamente.

**Cenário concreto:** Um usuário configurou um stop hook que roda seu suite de testes após cada turno. O Claude escreve um arquivo e o hook reporta que três testes estão falhando. O loop injeta a saída de falha de testes como uma mensagem de usuário oculta e continua, dando ao Claude a oportunidade de ver as falhas e corrigi-las.

### Caminho 6: Continuação de Orçamento de Tokens

**Razão de transição:** `token_budget_continuation`

**Trigger:** A feature `TOKEN_BUDGET` está habilitada, o modelo completou seu turno sem chamadas de ferramentas e `checkTokenBudget()` retornou `action: 'continue'`.

Quando o token count de saída do modelo está abaixo do limiar de orçamento configurado (90%), o loop injeta uma mensagem de "nudge" encorajando o modelo a continuar trabalhando.

**Cenário concreto:** Um usuário está rodando um agente de sumarização em background com orçamento de token de 500.000. Após processar cinquenta arquivos, o modelo retorna uma atualização de status. O verificador de orçamento vê que apenas 40% do orçamento foi usado, injeta um nudge de continuação e o modelo continua processando mais arquivos até o orçamento ser esgotado ou retornos decrescentes serem detectados.

### Caminho 7: Próximo Turno Normal

**Razão de transição:** `next_turn`

**Trigger:** A resposta do modelo continha chamadas de ferramentas (`needsFollowUp === true`), todas as ferramentas foram executadas com sucesso e nem o sinal de abort nem um flag hook-stop impediram a continuação.

Este é o caminho de continuação "feliz" — o ciclo ordinário do loop agêntico. Após as ferramentas completarem, o loop constrói o próximo estado mesclando as mensagens de query processadas, as respostas assistant e os resultados das ferramentas em um array de mensagens unificado.

```typescript
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  toolUseContext: toolUseContextWithQueryTracking,
  autoCompactTracking: tracking,
  turnCount: nextTurnCount,
  maxOutputTokensRecoveryCount: 0,    // reset
  hasAttemptedReactiveCompact: false,  // reset
  pendingToolUseSummary: nextPendingToolUseSummary,
  maxOutputTokensOverride: undefined,
  stopHookActive,
  transition: { reason: 'next_turn' },
}
state = next
```

`maxOutputTokensRecoveryCount` e `hasAttemptedReactiveCompact` são ambos resetados neste caminho — uma execução limpa de ferramentas implica que o modelo produziu uma resposta válida.

---

## 5.7 Stop Hooks: Contabilidade de Fim de Turno

`handleStopHooks()` é chamado ao fim de cada turno que termina sem chamadas de ferramentas e sem erro de API. Sua responsabilidade é muito mais ampla que seu nome sugere: é o hub de contabilidade pós-turno que roda uma gama de efeitos colaterais em background.

A função é um async generator em `src/query/stopHooks.ts`. Retorna um `StopHookResult`:

```typescript
type StopHookResult = {
  blockingErrors: Message[]
  preventContinuation: boolean
}
```

**Sequência de operações:**

1. **Salvar params cache-safe.** Para `repl_main_thread` e `sdk`, o estado atual da conversa é serializado e salvo em variável de nível de módulo. Lido pelo comando `/btw` e pelo `side_question` do SDK.

2. **Classificação de job (feature gate `TEMPLATES`).** Quando rodando como job despachado, o histórico completo do turno é classificado e um arquivo `state.json` é escrito.

3. **Sugestão de prompt.** `executePromptSuggestion()` é disparado como fire-and-forget para sugerir prompts de follow-up para a UI.

4. **Extração de memória (feature gate `EXTRACT_MEMORIES`).** `executeExtractMemories()` é disparado como fire-and-forget no modo interativo. Pulado para subagentes.

5. **Auto-dream.** Consolidação em background do histórico de conversa para sessões longas. Pulado para subagentes.

6. **Limpeza de computer use (feature gate `CHICAGO_MCP`).** Libera o lock de processo de computer use e desoculta o desktop após cada turno.

7. **Execução de stop hooks.** `executeStopHooks()` roda os scripts de stop hook configurados pelo usuário em paralelo. Cada hook recebe o histórico completo do turno e pode retornar saída (mostrada na UI) ou um erro de bloqueio (alimentado de volta ao modelo).

8. **Hooks de teammate (apenas `isTeammate()`).** Em modo de orquestração de equipe, `executeTaskCompletedHooks()` e `executeTeammateIdleHooks()` sinalizam o estado do agente.

---

## 5.8 Execução de Ferramentas: runTools e StreamingToolExecutor

A execução de ferramentas é controlada pelo flag `config.gates.streamingToolExecution`.

```typescript
const toolUpdates = streamingToolExecutor
  ? streamingToolExecutor.getRemainingResults()
  : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)
```

**`runTools` (caminho sequencial).** Quando a execução de ferramentas em streaming está desabilitada, `runTools` em `src/services/tools/toolOrchestration.ts` recebe a lista completa de `toolUseBlocks` e os executa após o loop de streaming terminar. É um async generator que gera eventos de atualização tipados conforme cada ferramenta completa.

**`StreamingToolExecutor` (caminho concorrente).** Quando habilitado, um `StreamingToolExecutor` é criado antes do loop de streaming da API começar. À medida que cada bloco `tool_use` chega no stream, `streamingToolExecutor.addTool(toolBlock, message)` é chamado imediatamente. O executor começa a rodar a ferramenta em background enquanto o modelo continua a fazer streaming.

Essa sobreposição importa para latência. Um modelo que chama cinco ferramentas sequencialmente em sua resposta terá a primeira ferramenta completando antes de o modelo terminar de gerar os parâmetros da quinta chamada. Sem execução em streaming, todas as cinco ferramentas esperam até o stream inteiro terminar.

Se a tentativa de streaming falha no meio e cai para um modelo diferente, `streamingToolExecutor.discard()` é chamado para abandonar execuções de ferramentas em andamento, e um novo executor é criado para a tentativa. Isso previne resultados de ferramentas órfãos (com IDs da tentativa que falhou) de serem acrescentados ao array de mensagens da tentativa.

---

## 5.9 QueryConfig e QueryDeps: Dependências Testáveis

### QueryConfig: Snapshot Imutável

```typescript
export type QueryConfig = {
  sessionId: SessionId
  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}
```

`QueryConfig` é snapshotado uma vez na entrada de `queryLoop()` e nunca mutado. O comentário no código-fonte explica o intento de design: separar o snapshot de config de `State` e `ToolUseContext` torna uma arquitetura futura de "reducer puro" viável — uma função que recebe `(state, event, config)` onde config é dados simples, sem efeitos colaterais.

Os gates `feature()` são explicitamente mantidos fora de `QueryConfig`. A função `feature()` é uma fronteira de tree-shaking em tempo de compilação — as chamadas a `feature('...')` devem aparecer inline nos blocos guardados, não ser extraídas para um objeto de config. Movê-las quebraria o build externo que strip features enterprise-only.

O sufixo `CACHED_MAY_BE_STALE` em `checkStatsigFeatureGate_CACHED_MAY_BE_STALE` reconhece que valores Statsig podem estar uma ciclo de busca desatualizados. Snapshotá-los uma vez por chamada `query()` fica dentro do contrato de desatualização existente.

### QueryDeps: Injeção de Dependência de I/O

```typescript
export type QueryDeps = {
  callModel: typeof queryModelWithStreaming
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded
  uuid: () => string
}

export function productionDeps(): QueryDeps {
  return {
    callModel: queryModelWithStreaming,
    microcompact: microcompactMessages,
    autocompact: autoCompactIfNeeded,
    uuid: randomUUID,
  }
}
```

`QueryDeps` captura as quatro dependências de I/O que testes mais comumente precisam fazer stub: a chamada de API do modelo, as duas funções de compactação e geração de UUID. Com `QueryDeps`, um teste pode passar um override `deps` diretamente em `QueryParams` e fornecer implementações falsas sem tocar no sistema de módulos.

O padrão `typeof fn` é deliberado. Se a assinatura da função real mudar, o tipo `QueryDeps` muda automaticamente porque é derivado do tipo de implementação real. O escopo é "intencionalmente estreito (4 deps)" como prova do padrão.

---

## 5.10 O Módulo de Orçamento de Tokens

A feature de orçamento de tokens (feature gate `TOKEN_BUDGET`) permite que chamadores especifiquem um máximo de tokens de saída e instrui o loop a continuar gerando saída até que esse orçamento seja esgotado ou retornos decrescentes sejam detectados.

```typescript
// Constantes-chave
const COMPLETION_THRESHOLD = 0.9    // continuar se abaixo de 90% do orçamento
const DIMINISHING_THRESHOLD = 500   // parar se ganho marginal < 500 tokens
```

```typescript
export type BudgetTracker = {
  continuationCount: number    // quantas vezes o caminho de orçamento disparou
  lastDeltaTokens: number      // delta de tokens na continuação mais recente
  lastGlobalTurnTokens: number // total de tokens no último check
  startedAt: number            // tempo wall-clock para rastreamento de duração
}
```

`checkTokenBudget()` toma a decisão de continuar/parar:

```typescript
export function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  globalTurnTokens: number,
): TokenBudgetDecision {
  // Subagentes contornam a continuação de orçamento
  if (agentId || budget === null || budget <= 0) {
    return { action: 'stop', completionEvent: null }
  }

  const pct = Math.round((turnTokens / budget) * 100)
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens

  // Retornos decrescentes: >= 3 continuações E ambos os últimos deltas abaixo de 500 tokens
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD

  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount++
    return { action: 'continue', nudgeMessage: ..., pct, turnTokens, budget }
  }

  return { action: 'stop', completionEvent: { ... } }
}
```

**Duas condições independentes param a continuação de orçamento:**

1. **Limiar de completude:** quando o token count acumulado de saída atinge 90% do orçamento total, o loop para de continuar independentemente de retornos decrescentes. Garante que o agente não gaste além do orçamento.

2. **Verificação de retornos decrescentes:** após pelo menos três continuações, se tanto o delta mais recente quanto o delta atual estão abaixo de 500 tokens, o agente está produzindo saída adicional negligenciável. O loop para cedo.

Subagentes são explicitamente excluídos — têm seus próprios limites de turno via `maxTurns`; dar a eles continuação independente de orçamento de tokens criaria gasto descontrolado sem teto.

---

## Principais Conclusões

O loop agêntico em `src/query.ts` é o motor central do Claude Code. Tudo o mais no codebase existe para servi-lo ou estendê-lo.

**Iteração sobre recursão.** O loop é um `while (true)` com um struct `State` mutável em vez de uma função recursiva. Profundidade da call stack constante independentemente de quantos turnos de uso de ferramenta ocorrem.

**State como valor atômico.** Cada site de `continue` constrói um valor `State` completo novo em uma única expressão. Sem mutações de campo espalhadas — trivialmente verificável se algum estado foi acidentalmente carregado ou esquecido.

**`transition` como intenção observável.** Registrar *por que* cada iteração continuou em `state.transition.reason` torna o comportamento do loop testável sem inspecionar conteúdo de mensagens.

**Retenção antes de surfacing.** Erros recuperáveis são retidos do chamador durante streaming para que a recuperação possa acontecer silenciosamente. Apenas quando todos os caminhos de recuperação se esgotam é que o erro é gerado.

**Injeção de dependência na costura.** `QueryDeps` captura as quatro operações que tocam I/O que testes mais comumente precisam fazer stub. O padrão `typeof fn` mantém tipos sincronizados com implementações automaticamente.

**Protocolo generator como mecanismo de entrega.** O loop é um async generator. Gera eventos intermediários (mensagens de progresso, resultados de ferramentas, mensagens de sistema) conforme chegam, em vez de bufferizar tudo e retornar ao final.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 06 mergulha fundo no sistema de ferramentas — como BashTool, FileEditTool, AgentTool e as outras 20+ ferramentas são implementadas, orquestradas e integradas ao loop agêntico.*
