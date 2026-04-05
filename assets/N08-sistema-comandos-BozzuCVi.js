const o=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 08: O Sistema de Comandos

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Distinguir as três variantes de comando — \`PromptCommand\`, \`LocalCommand\` e \`LocalJSXCommand\` — e explicar quando cada uma é usada
* Ler \`CommandBase\` e explicar cada campo: gates de disponibilidade, resolução de alias, flags de sensibilidade e o modo de execução \`immediate\`
* Navegar \`src/commands.ts\` e explicar por que os 70+ comandos built-in estão envolvidos em uma chamada \`memoize()\` em vez de exportados como um array simples
* Traçar o pipeline completo de descoberta de comandos: do \`loadAllCommands()\` memoizado pelo \`getCommands()\` até a lista filtrada que chega ao REPL
* Explicar como skills e plugins se fundem à lista de comandos e qual ordem de prioridade governa quando dois comandos compartilham um nome
* Seguir o pipeline \`processUserInput()\` desde o toque de tecla bruto até o comando roteado ou prompt do modelo
* Adicionar um novo slash command ao codebase, conectando corretamente tipo, metadados, lazy-load e registro

---

## Por que um Sistema de Comandos Dedicado

O sistema de comandos do Claude Code deve servir a dois públicos muito diferentes simultaneamente.

O primeiro público é o usuário humano no terminal. Ele digita \`/clear\`, \`/compact\` ou uma skill customizada. Espera comportamento imediato e previsível — \`clear\` deve limpar a conversa; \`compact\` deve resumi-la.

O segundo público é o próprio modelo de linguagem. O modelo pode invocar slash commands como ferramentas durante operação agêntica. Precisa conhecer a descrição de cada comando, quando usá-lo, quais ferramentas permite, e se pode ser chamado em contextos não-interativos.

Esses dois públicos compartilham o mesmo registro de comandos mas o consomem de formas completamente diferentes.

---

## 8.1 Três Tipos de Comando

### 8.1.1 PromptCommand: Expandindo no Contexto do Modelo

**Fonte:** \`src/types/command.ts:25-57\`

Um \`PromptCommand\` não executa lógica TypeScript. Em vez disso, expande em uma sequência de blocos de conteúdo que são inseridos no contexto do modelo como se o usuário os tivesse digitado. Pense nele como uma macro.

\`\`\`typescript
export type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  contentLength: number        // usado para estimativa de orçamento de tokens
  argNames?: string[]
  allowedTools?: string[]
  model?: string
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
  pluginInfo?: { pluginManifest: PluginManifest; repository: string }
  disableNonInteractive?: boolean
  hooks?: HooksSettings
  skillRoot?: string
  context?: 'inline' | 'fork'  // roda inline ou como sub-agente
  agent?: string
  effort?: EffortValue
  paths?: string[]             // padrões glob; comando só visível após o modelo tocar arquivos correspondentes
  getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]>
}
\`\`\`

\`contentLength\` é uma estimativa pré-computada usada para decidir se há espaço para este comando na janela de contexto atual antes de chamar o \`getPromptForCommand()\` relativamente caro.

\`source\` codifica proveniência. \`'builtin'\` significa que o comando vem com o código-fonte do Claude Code. \`'plugin'\` significa que chegou via plugin instalado. A distinção importa em \`formatDescriptionWithSource()\`.

\`context: 'inline' | 'fork'\` controla o escopo de execução. Um comando inline roda dentro do contexto do agente atual. Um comando fork spawna um sub-agente com seu próprio contexto isolado.

\`paths\` implementa visibilidade condicionada: um comando só aparece no registro após o modelo ter tocado pelo menos um arquivo correspondendo a um dos padrões. Previne que comandos relevantes apenas em projeto Rust poluam o menu de comandos de um projeto Python.

### 8.1.2 LocalCommand: Execução TypeScript Local

**Fonte:** \`src/types/command.ts:74-78\`

Um \`LocalCommand\` executa um módulo TypeScript diretamente, sem envolver o modelo. Retorna \`Promise<{ resultText?: string }>\` e opcionalmente define \`shouldQuery: false\` para dizer ao REPL para não enviar nada à API.

\`\`\`typescript
type LocalCommand = {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<LocalCommandModule>  // carregado lazy
}
\`\`\`

O campo \`load\` é um thunk de import dinâmico. O módulo não é carregado na inicialização; é buscado no primeiro uso. Mantém o bundle de inicialização pequeno.

\`supportsNonInteractive\` indica se este comando pode ser usado quando o Claude Code é invocado com a flag \`-p\` (print) no modo não-interativo.

O comando \`clear\` é o exemplo mínimo canônico de \`LocalCommand\`:

\`\`\`typescript
const clear = {
  type: 'local',
  name: 'clear',
  description: 'Clear conversation history and free up context',
  aliases: ['reset', 'new'],
  supportsNonInteractive: false,
  load: () => import('./clear.js'),
} satisfies Command
\`\`\`

\`satisfies Command\` em vez de anotação de tipo explícita permite ao TypeScript verificar que o objeto literal satisfaz a union \`Command\` completa sem alargar o tipo, preservando o literal \`type: 'local'\` no tipo inferido do objeto.

### 8.1.3 LocalJSXCommand: Renderizando UI Ink

**Fonte:** \`src/types/command.ts:144-152\`

Um \`LocalJSXCommand\` é idêntico em conceito a um \`LocalCommand\`, exceto que o módulo que carrega retorna um componente React em vez de uma função simples. O Claude Code usa Ink para renderizar árvores React no terminal, então um \`LocalJSXCommand\` pode exibir elementos de UI interativos — listas de seleção, inputs de texto, barras de progresso.

\`\`\`typescript
type LocalJSXCommand = {
  type: 'local-jsx'
  load: () => Promise<LocalJSXCommandModule>
}
\`\`\`

A interface é intencionalmente mínima. Todos os botões comportamentais são carregados por \`CommandBase\`.

---

## 8.2 CommandBase: A Fundação Compartilhada

**Fonte:** \`src/types/command.ts:175-203\`

Todas as três variantes de comando são intersectadas com \`CommandBase\`:

\`\`\`typescript
export type CommandBase = {
  availability?: CommandAvailability[]
  description: string
  hasUserSpecifiedDescription?: boolean
  isEnabled?: () => boolean
  isHidden?: boolean
  name: string
  aliases?: string[]
  isMcp?: boolean
  argumentHint?: string
  whenToUse?: string
  version?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  loadedFrom?: 'commands_DEPRECATED' | 'skills' | 'plugin' | 'managed' | 'bundled' | 'mcp'
  kind?: 'workflow'
  immediate?: boolean
  isSensitive?: boolean
  userFacingName?: () => string
}

export type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)
\`\`\`

Os campos em \`CommandBase\` se dividem em três responsabilidades:

**Identidade e descoberta.** \`name\` é o identificador canônico usado no registro. \`aliases\` é um array de nomes alternativos — \`clear\` declara aliases \`['reset', 'new']\`. \`userFacingName\` é uma função (não uma string) porque pode ser computada dinamicamente.

**Disponibilidade e habilitação.** \`availability\` é um array de valores \`CommandAvailability\` — atualmente \`'claude-ai'\` (assinatura Claude.ai necessária) ou \`'console'\` (console interno Anthropic). \`isEnabled\` é uma função de zero argumentos chamada no momento de listagem de comandos. \`isHidden\` exclui o comando do \`/help\` enquanto o mantém funcional.

**Metadados de execução.** \`immediate\` marca comandos que devem executar sem esperar o modelo chegar a um ponto de parada natural. \`isSensitive\` causa redação dos argumentos do comando do histórico de conversa armazenado. \`disableModelInvocation\` previne o modelo de invocar este comando como ferramenta.

Duas funções utilitárias exportadas do mesmo arquivo tornam os campos opcionais seguros para chamar sem verificações null:

\`\`\`typescript
export function getCommandName(cmd: CommandBase): string {
  return cmd.userFacingName?.() ?? cmd.name
}

export function isCommandEnabled(cmd: CommandBase): boolean {
  return cmd.isEnabled?.() ?? true
}
\`\`\`

---

## 8.3 O Registro de Comandos: \`commands.ts\`

**Fonte:** \`src/commands.ts:258-346\`

A lista de comandos built-in é definida dentro de uma chamada \`memoize()\`, não como um array de nível superior:

\`\`\`typescript
const COMMANDS = memoize((): Command[] => [
  addDir, advisor, agents, branch, clear, compact, config,
  // ... 70+ comandos built-in
  ...(proactive ? [proactive] : []),
  ...(voiceCommand ? [voiceCommand] : []),
  ...(process.env.USER_TYPE === 'ant' && !process.env.IS_DEMO
    ? INTERNAL_ONLY_COMMANDS
    : []),
])
\`\`\`

A razão para memoização é sutil mas importante. Vários comandos chamam funções de leitura de configuração no momento da construção. Se \`COMMANDS\` fosse uma constante de nível de módulo, toda essa avaliação aconteceria no momento em que o módulo fosse importado — muito cedo na sequência de inicialização antes do sistema de config estar totalmente inicializado. Envolver em \`memoize()\` adia toda inicialização para a primeira chamada de \`COMMANDS()\`.

Os spreads condicionais ao final do array demonstram inclusão controlada por feature flag. \`proactive\` é uma referência ao módulo de comando de features proativas; se o módulo é \`null\` o spread não adiciona nada. O bloco \`USER_TYPE === 'ant'\` controla um conjunto de comandos internos por verificação de funcionário combinada com exclusão de modo demo.

Os comandos internos são exportados separadamente para que possam ser inspecionados e testados:

\`\`\`typescript
export const INTERNAL_ONLY_COMMANDS = [
  backfillSessions, breakCache, bughunter, commit, commitPushPr,
].filter(Boolean)
\`\`\`

\`.filter(Boolean)\` remove entradas \`null\` ou \`undefined\` que surgem quando um módulo de comando é condicionalmente compilado, sem exigir que cada entrada seja guardada por ternário.

\`formatDescriptionWithSource()\` aplica rótulos específicos de fonte a cada string de descrição de comando para exibição:

\`\`\`typescript
export function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.type !== 'prompt') return cmd.description
  if (cmd.kind === 'workflow') return \`\${cmd.description} (workflow)\`
  if (cmd.source === 'plugin') { /* inclui nome do plugin */ }
  if (cmd.source === 'bundled') return \`\${cmd.description} (bundled)\`
  return \`\${cmd.description} (\${getSettingSourceName(cmd.source)})\`
}
\`\`\`

---

## 8.4 Descoberta de Comandos: Do Lista Bruta aos Comandos Disponíveis

### O carregamento completo memoizado

**Fonte:** \`src/commands.ts:449-469\`

A primeira camada é \`loadAllCommands\`, memoizada por diretório de trabalho:

\`\`\`typescript
const loadAllCommands = memoize(async (cwd: string): Promise<Command[]> => {
  const [
    { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
    pluginCommands,
    workflowCommands,
  ] = await Promise.all([
    getSkills(cwd),
    getPluginCommands(),
    getWorkflowCommands ? getWorkflowCommands(cwd) : Promise.resolve([]),
  ])
  return [
    ...bundledSkills,        // skills pré-empacotadas enviadas com o binário
    ...builtinPluginSkills,  // skills fornecidas por plugins built-in
    ...skillDirCommands,     // ~/.claude/skills/ e .claude/skills/ do usuário
    ...workflowCommands,     // scripts de workflow
    ...pluginCommands,       // comandos de plugins instalados
    ...pluginSkills,         // skills de plugins instalados
    ...COMMANDS(),           // comandos built-in (menor prioridade)
  ]
})
\`\`\`

A ordenação do array resultante é a ordem de prioridade para conflitos de nome: se uma skill do usuário e um comando built-in compartilham o mesmo nome, a skill do usuário vence porque aparece mais cedo no array. \`findCommand()\` usa \`Array.find()\`, que retorna o primeiro match.

Memoização por \`cwd\` significa que o Claude Code paga o custo de varrer diretórios de skills e carregar manifestos de plugins exatamente uma vez por diretório de trabalho por tempo de vida do processo.

### O filtro por chamada

**Fonte:** \`src/commands.ts:476-516\`

A segunda camada é \`getCommands\`, chamada em cada prompt do REPL:

\`\`\`typescript
export async function getCommands(cwd: string): Promise<Command[]> {
  const allCommands = await loadAllCommands(cwd)
  const dynamicSkills = getDynamicSkills()  // descobertas durante operações de arquivo
  const baseCommands = allCommands.filter(
    _ => meetsAvailabilityRequirement(_) && isCommandEnabled(_),
  )
  // Insere dynamic skills antes de comandos built-in, deduplicated
}
\`\`\`

\`getDynamicSkills()\` retorna skills descobertas em runtime. Estas não estão presentes no resultado estático de \`loadAllCommands\`, então são inseridas na posição correta de prioridade durante a passagem de filtro por chamada.

**\`meetsAvailabilityRequirement\`** verifica se a sessão atual satisfaz as restrições de \`availability\` do comando:

\`\`\`typescript
export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability) return true  // sem restrição = visível a todos
  for (const a of cmd.availability) {
    switch (a) {
      case 'claude-ai':
        if (isClaudeAISubscriber()) return true; break
      case 'console':
        if (!isClaudeAISubscriber() && !isUsing3PServices() && isFirstPartyAnthropicBaseUrl())
          return true; break
    }
  }
  return false
}
\`\`\`

**\`isCommandEnabled\`** chama a função opcional \`isEnabled()\` do comando. Comandos controlados por feature flag fornecem uma função que lê o estado da flag atual cada vez que é chamada, então uma mudança de flag em runtime tem efeito no próximo prompt do REPL.

---

## 8.5 Busca de Comando: \`findCommand()\`

**Fonte:** \`src/commands.ts:688-698\`

\`\`\`typescript
export function findCommand(commandName: string, commands: Command[]): Command | undefined {
  return commands.find(
    _ => _.name === commandName
      || getCommandName(_) === commandName
      || _.aliases?.includes(commandName),
  )
}
\`\`\`

As três condições lidam com as três formas como um comando pode ser referenciado: pelo nome interno do registro, pelo nome de exibição via \`userFacingName()\`, e pelos aliases. A função retorna \`undefined\` se nenhum comando corresponder — os chamadores em \`processUserInput\` tratam isso como uma condição de "pass-through" e roteiam o input para o modelo como texto simples.

---

## 8.6 Skills e Plugins: Extensão Dinâmica

Três mecanismos de extensão adicionam comandos em runtime:

**Skills do usuário** são arquivos Markdown ou script colocados em \`~/.claude/skills/\` (global) ou \`.claude/skills/\` (local do projeto). \`getSkills(cwd)\` varre ambos os diretórios e converte cada arquivo de skill em um \`PromptCommand\`. O nome do arquivo da skill torna-se o nome do comando; seu front-matter YAML fornece a descrição e outros metadados.

**Plugins** são pacotes npm declarados na configuração do Claude Code. \`getPluginCommands()\` carrega o manifesto de cada plugin, lê suas exportações de comandos declaradas e as envolve como objetos \`Command\` com \`source: 'plugin'\`.

**Dynamic skills** são as mais incomuns. Certas definições de \`PromptCommand\` declaram um array \`paths\` de padrões glob. Quando o modelo lê ou modifica um arquivo que corresponde a um desses padrões, a skill é promovida de inativa para ativa via \`getDynamicSkills()\`. Isso implementa comandos cientes de contexto: uma skill de refatoração Rust com \`paths: ['**/*.rs']\` só aparece no menu de comandos após o modelo ter tocado um arquivo fonte Rust.

A ordem de prioridade em \`loadAllCommands\` — skills empacotadas, skills de plugins built-in, comandos de diretório de skill, comandos de workflow, comandos de plugins, skills de plugins, comandos built-in — garante que a extensão mais específica sempre vença sobre o built-in mais geral.

---

## 8.7 O Pipeline de Input do Usuário: \`processUserInput()\`

**Fonte:** \`src/utils/processUserInput/processUserInput.ts\`

Cada caractere que o usuário digita no REPL passa por \`processUserInput\`. Sua função é classificar o input e roteá-lo para o handler correto.

\`\`\`typescript
export async function processUserInput({
  input,
  mode,
  setToolJSX,
  context,
  pastedContents,
  skipSlashCommands,  // true: trata /xxx como texto simples (usado pela bridge)
  bridgeOrigin,
  ...
}): Promise<ProcessUserInputBaseResult>
\`\`\`

O tipo de retorno carrega tudo que o REPL precisa para dar o próximo passo:

\`\`\`typescript
export type ProcessUserInputBaseResult = {
  messages: (UserMessage | AssistantMessage | AttachmentMessage | SystemMessage | ProgressMessage)[]
  shouldQuery: boolean      // false = tratado localmente, não chamar o modelo
  allowedTools?: string[]
  model?: string
  effort?: EffortValue
  resultText?: string       // saída de texto para modo -p (não-interativo)
  nextInput?: string        // pré-preenche o próximo input após o comando completar
  submitNextInput?: boolean
}
\`\`\`

\`shouldQuery: false\` é o sinal chave. Quando um \`LocalCommand\` trata o input completamente — \`/clear\` limpa a conversa e retorna — não há nada para enviar ao modelo.

O caminho da bridge (\`skipSlashCommands + bridgeOrigin\`) merece menção especial. Quando input chega do app mobile ou interface web, definir \`skipSlashCommands: true\` contorna todo o branch \`processSlashCommand\`, garantindo que o texto chegue ao modelo inalterado.

---

## 8.8 Guia Prático: Adicionando um Novo Slash Command

Percorrendo a adição de um comando hipotético \`/summarize\` que chama uma função TypeScript local para imprimir um resumo de contagem de palavras da conversa atual.

**Etapa 1: Criar o diretório do comando.**

Por convenção cada comando vive em seu próprio diretório em \`src/commands/\`. Criar \`src/commands/summarize/\`.

**Etapa 2: Escrever o módulo de implementação.**

\`\`\`typescript
// src/commands/summarize/summarize.ts
import type { LocalCommandModule } from '../../types/command.js'
import type { ToolUseContext } from '../../context/ToolUseContext.js'

const summarizeModule: LocalCommandModule = {
  async call(args: string, context: ToolUseContext) {
    const messages = context.getAppState().messages ?? []
    const wordCount = messages
      .flatMap(m => (typeof m.content === 'string' ? [m.content] : []))
      .join(' ')
      .split(/\\s+/)
      .filter(Boolean).length

    return {
      resultText: \`Conversation word count: \${wordCount}\`,
      shouldQuery: false,
    }
  },
}

export default summarizeModule
\`\`\`

**Etapa 3: Escrever o módulo de metadados do comando.**

\`\`\`typescript
// src/commands/summarize/index.ts
import type { Command } from '../../types/command.js'

const summarize = {
  type: 'local',
  name: 'summarize',
  description: 'Print a word count summary of the current conversation',
  supportsNonInteractive: true,
  load: () => import('./summarize.js'),
} satisfies Command

export default summarize
\`\`\`

**Etapa 4: Registrar o comando em \`commands.ts\`.**

\`\`\`typescript
// src/commands.ts — seção de imports
import summarize from './commands/summarize/index.js'

// src/commands.ts — dentro da chamada memoize()
const COMMANDS = memoize((): Command[] => [
  addDir, advisor, agents, branch, clear, compact, config,
  summarize,    // adicionar aqui
  // ... resto da lista
])
\`\`\`

**Etapa 5: Verificar se o comando aparece na lista.**

Rodar o servidor de desenvolvimento e digitar \`/summarize\` no prompt do REPL.

**Etapa 6: Adicionar um teste unitário.**

\`\`\`typescript
// src/commands/summarize/__tests__/summarize.test.ts
import summarizeModule from '../summarize.js'
import { makeTestContext } from '../../../test-utils/makeTestContext.js'

test('returns word count of conversation messages', async () => {
  const ctx = makeTestContext({
    messages: [{ role: 'user', content: 'hello world' }],
  })
  const result = await summarizeModule.call('', ctx)
  expect(result.shouldQuery).toBe(false)
  expect(result.resultText).toContain('2')
})
\`\`\`

O fluxo completo do toque de tecla ao resultado: usuário digita \`/summarize\` → \`processUserInput\` detecta o \`/\` inicial → \`processSlashCommand\` chama \`findCommand('summarize', commands)\` → o objeto de metadados é retornado → \`load()\` é invocado pela primeira vez → o módulo de implementação é importado e seu método \`call\` é executado → \`ProcessUserInputBaseResult\` é retornado com \`shouldQuery: false\` → o REPL imprime \`resultText\` e não faz chamada de API.

---

## Principais Conclusões

O design do sistema de comandos reflete um conjunto consistente de escolhas em toda a arquitetura do Claude Code: adiar inicialização cara, separar metadados da implementação, usar o sistema de tipos como a garantia primária de correção, e tornar a extensão fácil sem tornar o núcleo complexo.

Os três tipos de comando formam uma cobertura completa de destinos de saída. \`PromptCommand\` alimenta o contexto do modelo; \`LocalCommand\` produz texto; \`LocalJSXCommand\` renderiza UI de terminal interativa.

\`CommandBase\` coleta todos os botões comportamentais que são independentes do destino de saída em um contrato compartilhado.

O pipeline de carregamento em camadas — \`loadAllCommands\` memoizado por \`cwd\`, depois \`getCommands\` filtrando por chamada — separa o I/O caro (varredura de diretórios de skills, leitura de manifestos de plugins) da avaliação barata (verificação de estados de flags).

\`findCommand\` é intencionalmente simples: um único \`Array.find\` sobre uma lista plana que verifica três condições de correspondência.

Adicionar um comando é genuinamente uma operação de três arquivos: módulo de implementação, módulo de metadados, e uma linha no array de registro.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 09 examina o QueryEngine e a interface SDK — como o Claude Code expõe sua funcionalidade para uso programático e integração com ferramentas externas.*
`;export{o as default};
