> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 06: Mergulho Fundo no Sistema de Ferramentas

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Descrever todos os cinco estágios do ciclo de vida de uma ferramenta e nomear o método ou subsistema responsável por cada estágio
* Ler a interface `Tool<Input, Output>` em `src/Tool.ts` e explicar o que cada método faz e quando é chamado
* Explicar o que `buildTool()` faz, por que existe e quais sete chaves ele fornece padrões seguros
* Articular a distinção entre `ToolDef` (o que autores de ferramentas escrevem) e `Tool` (o que o runtime opera)
* Traçar uma invocação de `FileReadTool` por validação, verificação de permissão, despacho por extensão, dedup e serialização para API
* Explicar como `getAllBaseTools()` em `src/tools.ts` age como única fonte de verdade para o registro de ferramentas
* Percorrer `runTools()` em `src/services/tools/toolOrchestration.ts` e explicar como `partitionToolCalls` decide quais ferramentas rodam concorrentemente e quais serialmente
* Implementar uma ferramenta customizada mínima mas completa do zero usando `buildTool()` e registrá-la no registro de ferramentas

---

## 6.1 O Ciclo de Vida da Ferramenta

Antes de mergulhar em estruturas de dados e código, é útil ter um mapa mental dos estágios que cada chamada de ferramenta passa. Há cinco estágios, em ordem estrita.

**Registro** acontece uma vez na inicialização do processo. `getAllBaseTools()` retorna um array plano de objetos `Tool`; o loop lê esse array e constrói um registro em runtime usado para cada turno subsequente.

**Seleção pelo modelo** não é controlada pelo código da aplicação — o modelo decide qual ferramenta chamar e quais argumentos passar com base no contexto da conversa e nas strings `prompt()` que cada ferramenta expõe. O modelo emite um bloco `tool_use` no seu stream de resposta; o loop extrai o `name` e faz o parse do JSON de `input`.

**Validação e verificação de permissão** acontecem antes de qualquer I/O. `validateInput()` faz lógica pura e síncrona — verificando formatos de caminho, extensões bloqueadas e regras de negação — sem tocar o sistema de arquivos. `checkPermissions()` consulta o sistema de permissão e pode solicitar aprovação explícita do usuário.

**Execução** é o método `call()`. Aqui ocorrem todos os efeitos colaterais reais: leitura de arquivos, execução de comandos shell, requisições de rede.

**Serialização do resultado** converte o valor `Output` tipado para o formato `ToolResultBlockParam` que a API Anthropic Messages entende.

**Renderização na UI** acontece em paralelo com a serialização. A UI React chama `renderToolUseMessage()` enquanto a ferramenta está rodando e `renderToolResultMessage()` quando o resultado está disponível.

---

## 6.2 A Interface `Tool<Input, Output>`

A interface `Tool<Input, Output, P>` em `src/Tool.ts` é o contrato que toda ferramenta deve satisfazer. Parametrizada por três tipos: `Input` é um tipo de schema Zod, `Output` é o tipo de resultado, e `P extends ToolProgressData` é o tipo de eventos de progresso em streaming.

### 6.2.1 Métodos de Execução Central

O método mais importante é `call()`:

```typescript
call(
  args: z.infer<Input>,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  parentMessage: AssistantMessage,
  onProgress?: ToolCallProgress<P>,
): Promise<ToolResult<o>>
```

`args` é o input parseado e validado — Zod já coerceu o JSON bruto para a forma tipada. `context` é o `ToolUseContext` de escopo de sessão. `canUseTool` permite que a ferramenta invoque ferramentas aninhadas (o `AgentTool` usa isso para spawnar subagentes). `onProgress` é um callback opcional para transmitir resultados intermediários à UI antes de `call()` completar.

O tipo de retorno `ToolResult<o>`:

```typescript
export type ToolResult<T> = {
  data: T
  newMessages?: (UserMessage | AssistantMessage | AttachmentMessage | SystemMessage)[]
  contextModifier?: (context: ToolUseContext) => ToolUseContext
  mcpMeta?: { _meta?: ...; structuredContent?: ... }
}
```

`newMessages` permite injetar mensagens adicionais na conversa sem fazer chamada adicional de API. `contextModifier` transforma o `ToolUseContext` atual — o caminho serial aplica modificadores imediatamente e em ordem; o caminho concorrente os adia até o batch inteiro completar, depois os aplica em ordem de `tool_use_id`.

Dois outros métodos centrais governam como a ferramenta se descreve:

```typescript
description(input: z.infer<Input>, options: DescriptionOptions): Promise<string>
prompt(options: PromptOptions): Promise<string>
```

`description()` retorna um resumo legível do que esta invocação específica fará — mostrado na UI antes de o usuário aprovar uma operação sensível. `prompt()` retorna a descrição visível ao modelo que aparece no system prompt.

### 6.2.2 Classificação e Concorrência

```typescript
isConcurrencySafe(input: z.infer<Input>): boolean
isEnabled(): boolean
isReadOnly(input: z.infer<Input>): boolean
isDestructive?(input: z.infer<Input>): boolean
```

`isConcurrencySafe()` é o mais importante. Quando o modelo chama múltiplas ferramentas em uma única resposta, a camada de orquestração agrupa invocações consecutivas em batches. Se toda ferramenta em um grupo retorna `true`, essas invocações rodam em um batch concorrente — todas iniciadas ao mesmo tempo, com cap em `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (padrão 10). Quando uma ferramenta retorna `false`, o batch concorrente é quebrado e um batch serial começa.

`isEnabled()` deixa uma ferramenta se desabilitar em runtime — uma ferramenta que requer um binário específico retorna `false` quando o binário está ausente, e o loop a omite da requisição de API.

`isReadOnly()` é usado pelo sistema de permissão e pela UI. Ferramentas read-only tipicamente recebem aprovação automática em modos não-interativos.

`isDestructive()` é um refinamento opcional de `isReadOnly()` — distinção entre escrever em arquivo temporário (não destrutivo) e sobrescrever arquivo existente (destrutivo).

### 6.2.3 Métodos de Validação e Permissão

```typescript
validateInput?(input: z.infer<Input>, context: ToolUseContext): Promise<ValidationResult>
checkPermissions(input: z.infer<Input>, context: ToolUseContext): Promise<PermissionResult>
```

`validateInput()` é opcional e roda primeiro. Destinado a verificações de lógica pura sem I/O: validação de formato de caminho, filtragem de extensão, correspondência de regras de negação. Erros de `validateInput()` são apresentados ao modelo como falhas de validação no nível da ferramenta; negações de `checkPermissions()` são apresentadas como recusas de permissão — o modelo os trata diferentemente.

```typescript
getPath?(input: z.infer<Input>): string
preparePermissionMatcher?(input: z.infer<Input>): Promise<(pattern: string) => boolean>
backfillObservableInput?(input: z.infer<Input>): void
```

`backfillObservableInput()` é chamado antes que hooks ou matchers de permissão vejam o input — é o lugar correto para expandir `~` e caminhos relativos para suas formas absolutas.

### 6.2.4 Métodos de Renderização na UI

```typescript
renderToolUseMessage(input: z.infer<Input>, options: RenderOptions): React.ReactNode
renderToolResultMessage?(content: Output, progressMessages: P[], options: RenderOptions): React.ReactNode
renderToolUseErrorMessage?(result: ToolResult<o>, options: RenderOptions): React.ReactNode
```

`renderToolUseMessage()` é chamado enquanto a ferramenta está executando — mostra o estado "requisitando". `renderToolResultMessage()` é chamado quando o resultado está disponível. `renderToolUseErrorMessage()` dá à ferramenta controle sobre como erros são apresentados.

### 6.2.5 Serialização para API

```typescript
mapToolResultToToolResultBlockParam(
  content: Output,
  toolUseID: string,
): ToolResultBlockParam
```

Converte o valor `Output` tipado para a estrutura JSON exata que a API Anthropic Messages espera. O `toolUseID` deve ser ecoado de volta para que a API correlacione requisição e resultado.

```typescript
readonly maxResultSizeChars: number
```

Quando um resultado de ferramenta excede esse tamanho, o runtime salva o conteúdo completo em arquivo temporário e envia ao modelo uma prévia truncada com o caminho. O padrão em `TOOL_DEFAULTS` é um número finito; `FileReadTool` o sobrescreve para `Infinity` porque gerencia seu próprio orçamento de tokens internamente.

---

## 6.3 `buildTool()`: A Factory Function

Autores de ferramentas não implementam `Tool<Input, Output>` diretamente. Implementam `ToolDef<Input, Output>` e passam para `buildTool()`.

### 6.3.1 ToolDef vs Tool

```typescript
export type ToolDef<Input, Output, P> =
  Omit<Tool<Input, Output, P>, DefaultableToolKeys> &
  Partial<Pick<Tool<Input, Output, P>, DefaultableToolKeys>>
```

`ToolDef` torna sete chaves opcionais. O restante da interface `Tool` é obrigatório. As sete chaves opcionais — `DefaultableToolKeys` — são:

```typescript
type DefaultableToolKeys =
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'toAutoClassifierInput'
  | 'userFacingName'
```

Cada uma tem um padrão seguro e conservador: `isEnabled` → `() => true`, `isConcurrencySafe` → `false` (assume execução serial), `isReadOnly` → `false` (assume escritas possíveis), `isDestructive` → `false`, `checkPermissions` → sempre permite, `toAutoClassifierInput` → `() => ''`, `userFacingName` → `() => def.name`.

Os padrões conservadores significam que uma nova ferramenta sem personalização de concorrência ou permissões se comportará de forma segura — rodará serialmente e não será auto-aprovada.

### 6.3.2 A Implementação de buildTool()

```typescript
export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,   // def substitui os padrões
  } as BuiltTool<D>
}
```

A ordem do spread importa: `TOOL_DEFAULTS` primeiro, depois `userFacingName` (que fecha sobre `def.name`), depois `def` por último para que qualquer método fornecido pelo autor substitua o padrão.

---

## 6.4 Anatomia do FileReadTool

`FileReadTool` em `src/tools/FileReadTool/FileReadTool.ts` é a ferramenta mais engenheirada do codebase. Com 1.184 linhas, lida com sete tipos de arquivo diferentes, implementa cache de dedup, impõe orçamento de tokens, acrescenta um lembrete de segurança e serializa resultados em cinco formatos de API diferentes.

### 6.4.1 Input Schema: lazySchema para Inicialização Diferida

```typescript
const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to read'),
    offset: semanticNumber(z.number().int().nonnegative().optional())
      .describe('The line number to start reading from...'),
    limit: semanticNumber(z.number().int().positive().optional())
      .describe('The number of lines to read...'),
    pages: z.string().optional()
      .describe('Page range for PDF files (e.g., "1-5", "3", "10-20")...'),
  }),
)
```

`lazySchema()` adia a chamada a `z.strictObject()` até o schema ser acessado pela primeira vez. A construção de schema Zod tem overhead não trivial — com `lazySchema`, o custo é pago uma vez, no primeiro uso, e o resultado é cacheado.

`z.strictObject()` (não `z.object()`) significa que qualquer chave não declarada causará falha de parse em vez de ser silenciosamente ignorada. Correto para inputs de ferramentas porque o modelo às vezes alucina campos extras.

`semanticNumber()` é uma transformação Zod que aceita número ou string numérica (ex: `"10"`) e coerce para número — lida com comportamento comum do modelo onde argumentos numéricos chegam como valores JSON codificados como string.

### 6.4.2 Output Schema: Union Discriminada de Seis Variantes

```typescript
const outputSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'),           file: z.object({ filePath, content, numLines, startLine, totalLines }) }),
    z.object({ type: z.literal('image'),          file: z.object({ base64, type, originalSize, dimensions }) }),
    z.object({ type: z.literal('notebook'),       file: z.object({ filePath, cells }) }),
    z.object({ type: z.literal('pdf'),            file: z.object({ filePath, base64, originalSize }) }),
    z.object({ type: z.literal('parts'),          file: z.object({ filePath, originalSize, count, outputDir }) }),
    z.object({ type: z.literal('file_unchanged'), file: z.object({ filePath }) }),
  ])
)
```

O discriminante `type` conduz tanto `mapToolResultToToolResultBlockParam()` quanto os métodos de renderização na UI.

`'file_unchanged'` é a saída de dedup. Quando `FileReadTool` determina que um arquivo não mudou desde a última leitura na sessão, retorna essa variante em vez de reler o arquivo. Em dados de produção, ~18% de todas as chamadas de `FileReadTool` são colisões no mesmo arquivo que se beneficiam desse dedup.

`'parts'` é usado quando um arquivo é tão grande que mesmo a leitura com limite de orçamento de tokens transbordaria o contexto disponível — o arquivo é dividido em partes escritas em diretório temporário e o modelo recebe `outputDir` para ler cada parte em sequência.

### 6.4.3 O Método `call()`: Despacho por Extensão

O método `call()` segue uma sequência de cinco etapas:

**Etapa 1 — Verificação de dedup.** Antes de qualquer I/O, `call()` busca o caminho em `readFileState`, um `Map<string, { mtime, range }>` de escopo de sessão. Se a entrada existe e o `mtime` atual do arquivo corresponde ao valor cacheado e o intervalo solicitado é o mesmo, o método retorna imediatamente com a variante `file_unchanged`.

**Etapa 2 — Descoberta de skill.** Inspeciona o caminho do arquivo para descobrir e ativar módulos de comportamento condicional relevantes para esse tipo de arquivo.

**Etapa 3 — Despacho por extensão via `callInner()`:**

```typescript
if (extension === '.ipynb')                → readNotebook(file_path)
else if (imageExtensions.has(extension))   → readImageWithTokenBudget(file_path)
else if (extension === '.pdf' && pages)    → extractPDFPages(file_path, pages)
else if (extension === '.pdf')             → readPDF(file_path)
else                                       → readFileInRange(file_path, offset, limit)
```

Para SVG lê o texto bruto em vez de codificar como base64 porque SVG é um formato XML que o modelo pode entender diretamente.

**Etapa 4 — Imposição do orçamento de tokens.** `validateContentTokens()` conta o custo estimado em tokens da saída e lança `MaxFileReadTokenExceededError` se o resultado transbordaria o orçamento da janela de contexto. Quando esse erro é lançado, `call()` o captura, divide o arquivo em partes e retorna a variante `'parts'`.

**Etapa 5 — Atualização de estado e listeners.** Após leitura bem-sucedida, `readFileState` é atualizado com o novo mtime e intervalo. Os `fileReadListeners` — callbacks registrados — são notificados, conduzindo serviços downstream como o servidor de linguagem.

### 6.4.4 Validação e Permissões

`validateInput()` tem cinco cláusulas de guarda:

1. Verificação de formato de `pages` — validação pura de string
2. Verificação de regra de negação (`matchingRuleForInput`) — correspondência de padrão de caminho, sem acesso ao sistema de arquivos
3. Verificação de caminho UNC (Windows `\\servidor\compartilhamento\...`) — sai cedo com pass-through
4. Rejeição de extensão binária (`.exe`, `.dylib`, `.so`) — produziriam saída lixo se lidas como texto
5. Verificação de caminho de dispositivo — bloqueia `/dev/zero`, `/dev/random`, `/dev/urandom`, `/dev/stdin`

Para permissões, `FileReadTool` delega ao helper compartilhado `checkReadPermissionForTool()`.

### 6.4.5 Serializando para a API

```typescript
mapToolResultToToolResultBlockParam(data, toolUseID) {
  switch (data.type) {
    case 'image':
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: [{ type: 'image', source: { type: 'base64', media_type: data.file.type, data: data.file.base64 } }],
      }
    case 'notebook':
      return mapNotebookCellsToToolResult(data.file.cells, toolUseID)
    case 'text':
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: formatFileLines(data.file) + CYBER_RISK_MITIGATION_REMINDER,
      }
    case 'file_unchanged':
      return { type: 'tool_result', tool_use_id: toolUseID, content: FILE_UNCHANGED_STUB }
    // ... casos pdf e parts
  }
}
```

`FILE_UNCHANGED_STUB` é uma string constante curta que o modelo reconhece como "já tenho esse arquivo no contexto, nenhuma ação necessária."

### 6.4.6 O Mecanismo de Dedup: readFileState e mtime

O sistema de dedup troca correção por eficiência de forma fundamentada. Assume que se o `mtime` de um arquivo não mudou e o intervalo de bytes solicitado é idêntico, o conteúdo é idêntico. O mapa `readFileState` é escopado ao `ToolUseContext` — vive pela duração de uma única invocação de `query()` e é resetado no início de cada novo turno.

### 6.4.7 O CYBER\_RISK\_MITIGATION\_REMINDER

Todo resultado de arquivo de texto tem um lembrete do sistema acrescentado antes de ser enviado ao modelo. O lembrete instrui o modelo a analisar malware ou conteúdo suspeito se solicitado, mas não melhorá-lo, otimizá-lo ou reproduzi-lo. Medida de defesa em profundidade para o cenário onde um usuário pede ao Claude Code para ler um arquivo que contém conteúdo adversarial projetado para sequestrar o comportamento do modelo.

`backfillObservableInput()` lida com normalização de caminho antes que qualquer coisa disso rode:

```typescript
backfillObservableInput(input) {
  if (typeof input.file_path === 'string') input.file_path = expandPath(input.file_path)
}
```

`expandPath()` resolve `~` para o diretório home e converte caminhos relativos para absolutos. Garante que `~/project/foo.ts` e `/home/user/project/foo.ts` sejam tratados como o mesmo caminho pelas regras de negação, padrões de permissão e cache de dedup.

---

## 6.5 O Registro de Ferramentas: `getAllBaseTools()`

Toda ferramenta que o runtime conhece é retornada por `getAllBaseTools()` em `src/tools.ts`. Esta função é a única fonte de verdade para quais ferramentas existem — não há arquivo de configuração, diretório de plugins ou mecanismo de descoberta dinâmica além do que essa função retorna.

```typescript
export function getAllBaseTools(): Tools {
  return [
    AgentTool, TaskOutputTool, BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool, FileReadTool, FileEditTool, FileWriteTool,
    NotebookEditTool, WebFetchTool, TodoWriteTool, WebSearchTool,
    TaskStopTool, AskUserQuestionTool, SkillTool, EnterPlanModeTool,
    ...(process.env.USER_TYPE === 'ant' ? [ConfigTool] : []),
    ...(SleepTool ? [SleepTool] : []),
    ...(cronTools),
    ...(MonitorTool ? [MonitorTool] : []),
    ...(REPLTool ? [REPLTool] : []),
    TestingPermissionTool, LSPTool, ToolSearchTool,
  ].filter(Boolean)
}
```

`hasEmbeddedSearchTools()` exclui condicionalmente `GlobTool` e `GrepTool` quando o binário inclui sua própria implementação nativa rápida de busca. `process.env.USER_TYPE === 'ant'` controla ferramentas internas para funcionários da Anthropic. As expressões condicionais com arrays (`SleepTool ? [SleepTool] : []`) lidam com módulos que podem exportar `null` quando feature flags estão desabilitados. O `.filter(Boolean)` ao final remove quaisquer valores nullish.

O comentário no código-fonte observa que essa lista deve permanecer em sincronia com a configuração de cache do sistema Statsig. A chave do cache de prompt inclui um hash da lista de ferramentas — se a lista mudar mas a config de cache não, usuários diferentes podem ter hits de cache incompatíveis.

---

## 6.6 Orquestração de Ferramentas: `runTools()`

Quando a resposta do modelo contém blocos `tool_use`, o loop chama `runTools()` de `src/services/tools/toolOrchestration.ts`. Esta função é um async generator que gera eventos `MessageUpdate` conforme resultados de ferramentas chegam.

### 6.6.1 `partitionToolCalls`: Agrupando a Lista de Chamadas

```typescript
export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const { isConcurrencySafe, blocks } of partitionToolCalls(toolUseMessages, currentContext)) {
    if (isConcurrencySafe) {
      for await (const update of runToolsConcurrently(blocks, ...)) {
        yield { message: update.message, newContext: currentContext }
      }
    } else {
      for await (const update of runToolsSerially(blocks, ...)) {
        if (update.newContext) currentContext = update.newContext
        yield { message: update.message, newContext: currentContext }
      }
    }
  }
}
```

`partitionToolCalls()` percorre o array `toolUseMessages` e agrupa chamadas consecutivas no maior batch possível. A regra de agrupamento: um batch é concorrente se e somente se toda ferramenta no batch reporta `isConcurrencySafe() === true`.

Exemplo com quatro chamadas `[FileRead, FileRead, BashTool, FileRead]`: resultado seria três batches: `[FileRead, FileRead]` (concorrente), `[BashTool]` (serial), `[FileRead]` (concorrente).

O ordenamento das chamadas de ferramentas pelo modelo controla tanto o que roda quanto como roda. Se o modelo emite todas as leituras antes de todas as escritas, as leituras podem ser paralelizadas.

### 6.6.2 Batches Concorrentes

`runToolsConcurrently()` despacha todas as ferramentas no batch simultaneamente usando `Promise.all()`. O cap de concorrência:

```typescript
function getMaxToolUseConcurrency(): number {
  return parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
}
```

Detalhe crítico: quando múltiplas ferramentas cada uma retorna um `contextModifier`, o executor concorrente adia todos os modificadores até toda ferramenta no batch ter terminado, depois os aplica em ordem de `tool_use_id` — garantindo determinismo independentemente de qual chamada de rede completou primeiro.

### 6.6.3 Batches Seriais

`runToolsSerially()` roda cada ferramenta uma por vez e aplica seu `contextModifier` imediatamente após completar, antes da próxima ferramenta começar. Comportamento correto para ferramentas de escrita porque a próxima ferramenta pode precisar observar as mudanças de contexto feitas pela anterior.

### 6.6.4 StreamingToolExecutor: Execução Paralela Durante Streaming

`StreamingToolExecutor` é um caminho separado de `runTools` que opera durante a fase de streaming ativa — enquanto o modelo ainda está gerando tokens. Pode iniciar uma chamada de ferramenta assim que o modelo fecha o JSON de input do bloco `tool_use`.

Condições mais estritas para execução de ferramenta em streaming: a ferramenta deve ser `isConcurrencySafe()`, deve ser `isReadOnly()`, e o modelo deve ter terminado de serializar o JSON de input completo para esse bloco.

Esta otimização é mais impactante para invocações de `FileReadTool` e `GlobTool` onde o modelo lê vários arquivos em sequência — a segunda e terceira leituras podem ser despachadas enquanto o modelo ainda está gerando a chamada de ferramenta para a quarta.

---

## 6.7 Guia Prático: Construindo uma Nova Ferramenta do Zero

Esta seção percorre a criação de `WordCountTool` — uma ferramenta que conta linhas, palavras e caracteres em um arquivo de texto.

### Etapa 1: Definir os Tipos de Input e Output

```typescript
// src/tools/WordCountTool/WordCountTool.ts

import { z } from 'zod'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe('The absolute path to the text file to analyze'),
  }),
)

type WordCountOutput = {
  file_path: string
  lines: number
  words: number
  chars: number
}
```

### Etapa 2: Implementar a Ferramenta com buildTool()

```typescript
export const WordCountTool = buildTool({
  name: 'WordCount',
  searchHint: 'count lines words characters in a text file',
  inputSchema,
  maxResultSizeChars: 4096,

  async description({ file_path }) {
    return `Count lines, words, and characters in ${file_path}`
  },

  async prompt() {
    return [
      'Count the number of lines, words, and characters in a text file.',
      'Use this tool when you need statistics about file size or content volume.',
      '',
      'Input: file_path — the absolute path to a text file.',
      'Output: an object with fields lines, words, and chars.',
    ].join('\n')
  },

  isConcurrencySafe() { return true },
  isReadOnly() { return true },

  async validateInput({ file_path }) {
    if (!file_path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(file_path)) {
      return {
        result: false,
        message: `file_path must be an absolute path; received: ${file_path}`,
      }
    }
    return { result: true }
  },

  async checkPermissions(input, context) {
    return checkReadPermissionForTool(WordCountTool, input, appState.toolPermissionContext)
  },

  backfillObservableInput(input) {
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },

  async call({ file_path }) {
    const content = await fs.readFile(file_path, 'utf-8')
    const lines = content.split('\n').length
    const words = content.trim() === '' ? 0 : content.trim().split(/\s+/).length
    const chars = content.length
    return { data: { file_path, lines, words, chars } }
  },

  mapToolResultToToolResultBlockParam({ file_path, lines, words, chars }, toolUseID) {
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: `${file_path}: ${lines} lines, ${words} words, ${chars} characters`,
    }
  },

  renderToolUseMessage({ file_path }) {
    return `Counting words in ${file_path}…`
  },

  toAutoClassifierInput({ file_path }) {
    return file_path
  },
})
```

Decisões importantes: `isConcurrencySafe()` retorna `true` porque a ferramenta apenas lê. `validateInput()` retorna cedo com `{ result: false, message: ... }` para caminhos não-absolutos — verificação pura de string. `backfillObservableInput()` expande `~` antes de matchers de permissão e regras de negação processarem o input. `call()` retorna `{ data: { ... } }` — `newMessages`, `contextModifier` e `mcpMeta` são omitidos porque são opcionais.

### Etapa 3: Registrar a Ferramenta

```typescript
// src/tools.ts — adicionar import
import { WordCountTool } from './tools/WordCountTool/WordCountTool.js'

// Dentro de getAllBaseTools(), adicionar ao array:
export function getAllBaseTools(): Tools {
  return [
    AgentTool, TaskOutputTool, BashTool,
    // ... ferramentas existentes ...
    WordCountTool,   // <-- adicionar aqui
  ].filter(Boolean)
}
```

Nenhum outro registro é necessário. Na próxima inicialização, o system prompt do modelo incluirá o texto `prompt()` do `WordCountTool` e seu schema JSON, tornando-o disponível para seleção em toda conversa subsequente.

### Etapa 4: Verificar a Ferramenta

Um teste mínimo deve verificar três coisas: que o schema rejeita chaves desconhecidas (devido a `z.strictObject`), que `call()` retorna as contagens corretas para um arquivo conhecido, e que `mapToolResultToToolResultBlockParam()` produz uma string que o modelo pode entender.

---

## Principais Conclusões

O sistema de ferramentas é construído em um pequeno número de ideias composáveis consistentes em todas as 30+ ferramentas do codebase.

Toda ferramenta é um objeto JavaScript simples satisfazendo `Tool<Input, Output>`. Sem classes, sem herança, sem decoradores. `buildTool()` preenche padrões conservadores seguros para as sete chaves que a maioria das ferramentas não precisa customizar.

A divisão `ToolDef` / `Tool` codifica a distinção entre o que autores de ferramentas precisam pensar (os métodos obrigatórios) e o que o runtime precisa para operar corretamente (a interface completa). TypeScript impõe essa divisão em tempo de compilação.

Validação e verificação de permissão são separadas em dois métodos com contratos diferentes. `validateInput()` é lógica pura sem I/O. `checkPermissions()` consulta o contexto de permissão da sessão e pode envolver interação do usuário.

A camada de orquestração em `toolOrchestration.ts` usa `isConcurrencySafe()` para paralelizar automaticamente grupos de chamadas de ferramentas read-only enquanto garante que operações de escrita rodem em sequência estrita.

`FileReadTool` é a implementação de referência que demonstra cada feature avançada: `lazySchema`, saídas de union discriminada, `backfillObservableInput`, `validateInput` com múltiplas cláusulas de guarda, dedup via `readFileState`, imposição de orçamento de tokens e serialização de API específica por formato.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 07 examina o modelo de permissão e segurança — como o Claude Code decide o que pode e o que não pode fazer, e como os usuários podem configurar essas regras.*
