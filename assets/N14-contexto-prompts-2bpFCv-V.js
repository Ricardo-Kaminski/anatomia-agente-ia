const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 14: Construção de Contexto e System Prompt

## O que você vai aprender

Quando você digita uma mensagem no Claude Code, o modelo recebe muito mais do que essas poucas palavras. Antes do seu input chegar, um pipeline cuidadosamente orquestrado já montou um pano de fundo rico: um system prompt multi-seção, o diretório de trabalho atual e snapshot do Git, instruções CLAUDE.md em camadas, um índice de memória persistente e potencialmente um resumo comprimido do histórico de conversa que havia crescido demais.

Ao final deste capítulo você entenderá: o que \`getUserContext()\` e \`getSystemContext()\` montam; a hierarquia completa de carregamento de CLAUDE.md; como \`getSystemPrompt()\` é ordenado para maximizar taxas de acerto do Prompt Cache; o sistema Auto Memory memdir; e as três estratégias de compressão.

---

## 14.1 Variáveis de Contexto: getUserContext e getSystemContext

Ambas as funções vivem em \`context.ts\` e são envolvidas com \`lodash-es/memoize\` — computam seu resultado uma vez por sessão e retornam o valor em cache em todas as chamadas subsequentes.

### 14.1.1 getSystemContext: O Snapshot Git

\`getSystemContext\` é responsável pelo snapshot do estado do repositório. Dispara cinco comandos Git concorrentemente:

\`\`\`typescript
const [branch, mainBranch, status, log, userName] = await Promise.all([
  getBranch(),
  getDefaultBranch(),
  execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], ...),
  execFileNoThrow(gitExe(), ['--no-optional-locks', 'log', '--oneline', '-n', '5'], ...),
  execFileNoThrow(gitExe(), ['config', 'user.name'], ...),
])
\`\`\`

Esses cinco dados são unidos em um bloco de texto descritivo. Dois pontos de design merecem atenção: (1) o snapshot é tomado uma vez no início da sessão e é explicitamente marcado como não-atualizante — "Note que este status é um snapshot no tempo e não será atualizado durante a conversa"; (2) a saída de status é truncada em \`MAX_STATUS_CHARS = 2000\` caracteres, com instrução de usar BashTool para a listagem completa.

### 14.1.2 getUserContext: CLAUDE.md e a Data

\`\`\`typescript
export const getUserContext = memoize(
  async (): Promise<{ [k: string]: string }> => {
    const claudeMd = shouldDisableClaudeMd
      ? null
      : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))

    setCachedClaudeMdContent(claudeMd || null)

    return {
      ...(claudeMd && { claudeMd }),
      currentDate: \`Today's date is \${getLocalISODate()}.\`,
    }
  },
)
\`\`\`

O modo \`--bare\` pula a descoberta automática de CLAUDE.md mas ainda carrega arquivos de diretórios explicitamente passados via \`--add-dir\`. A chamada a \`setCachedClaudeMdContent\` resolve uma dependência circular: o classificador de modo automático precisa ler o conteúdo de CLAUDE.md, mas importá-lo diretamente criaria um ciclo. O cache contorna o ciclo.

---

## 14.2 Carregamento de CLAUDE.md: A Hierarquia de Cinco Camadas

A lógica de carregamento de CLAUDE.md vive em \`utils/claudemd.ts\` (~1500 linhas). O comentário no topo do arquivo fornece o resumo mais claro:

\`\`\`
// utils/claudemd.ts:1-26
/**
 * Arquivos são carregados na seguinte ordem:
 *
 * 1. Memória gerenciada (/etc/claude-code/CLAUDE.md)  - Instruções globais para todos os usuários
 * 2. Memória do usuário (~/.claude/CLAUDE.md)         - Instruções globais privadas para todos os projetos
 * 3. Memória do projeto (CLAUDE.md, .claude/CLAUDE.md,
 *    e .claude/rules/*.md nas raízes do projeto)      - Instruções versionadas no codebase
 * 4. Memória local (CLAUDE.local.md nas raízes)       - Instruções privadas específicas do projeto
 *
 * Arquivos são carregados em ordem inversa de prioridade, i.e. os arquivos mais recentes têm maior prioridade
 */
\`\`\`

Ordem de carregamento é do menor para o maior prioridade: Managed primeiro, depois User, depois Project, depois Local. Conteúdo aparecendo mais tarde na string concatenada final fica mais próximo da janela de atenção do modelo.

### 14.2.1 Travessia de Diretório

\`getMemoryFiles()\` caminha para cima do diretório de trabalho atual até a raiz do sistema de arquivos, coletando caminhos candidatos. Caminhos são coletados na ordem CWD-para-raiz mas revertidos antes do processamento — o CLAUDE.md mais próximo da raiz do projeto é carregado primeiro e termina mais cedo na string final, enquanto o CLAUDE.md no próprio CWD é carregado por último e termina no final — e portanto tem maior atenção do modelo.

### 14.2.2 A Diretiva @include

Arquivos de memória podem puxar outros arquivos usando sintaxe \`@path\`:

\`\`\`markdown
<!-- Em CLAUDE.md -->
@./rules/typescript-guidelines.md
@~/shared-team-guidelines.md
\`\`\`

\`extractIncludePathsFromTokens\` usa o lexer \`marked\` para tokenizar o Markdown e varrer nós de texto por padrões \`@path\`, deliberadamente pulando blocos de código. Referências circulares são prevenidas via conjunto \`processedPaths\`, e a profundidade é limitada em \`MAX_INCLUDE_DEPTH = 5\` níveis. Includes externos — arquivos fora do CWD do projeto — são bloqueados por padrão.

### 14.2.3 Pipeline de Processamento de Conteúdo

Após ler cada arquivo, \`parseMemoryFileContent\` executa três transformações:

1. **Parsing de frontmatter**: Remove frontmatter YAML delimitado por \`---\` e extrai o campo \`paths\` para correspondência condicional de regras
2. **Remoção de comentários HTML**: Remove comentários \`<!-- ... -->\` preservando comentários dentro de spans de código e blocos cercados
3. **Truncamento de MEMORY.md**: Para tipos AutoMem e TeamMem, impõe limite duplo de 200 linhas e 25.000 bytes

A montagem final em \`getClaudeMds\` formata cada arquivo com cabeçalho descritivo e junta sob um preâmbulo fixo:

\`\`\`typescript
const MEMORY_INSTRUCTION_PROMPT =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
  'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'
\`\`\`

### 14.2.4 Regras Condicionais

Arquivos em diretórios \`.claude/rules/\` podem incluir frontmatter com padrões \`paths\`:

\`\`\`yaml
---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---
# Regras para arquivos de teste
Sempre escreva asserções com \`expect().toBe()\` não \`assert.equal()\`.
\`\`\`

Esses arquivos são injetados no contexto apenas quando o modelo está trabalhando em um arquivo que corresponde a um desses padrões glob.

---

## 14.3 getSystemPrompt: Montando o Prompt Completo

A montagem completa do system prompt está em \`constants/prompts.ts\`. Retorna um array de string em vez de uma única string porque o array permite à camada de API atribuir diferentes escopos de cache a elementos diferentes.

### 14.3.1 A Divisão Estático/Dinâmico

O array retornado é organizado em duas zonas:

\`\`\`typescript
return [
  // --- Conteúdo estático (cacheável) ---
  getSimpleIntroSection(outputStyleConfig),
  getSimpleSystemSection(),
  getSimpleDoingTasksSection(),
  getActionsSection(),
  getUsingYourToolsSection(enabledTools),
  getSimpleToneAndStyleSection(),
  getOutputEfficiencySection(),
  // === MARCADOR DE FRONTEIRA ===
  ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
  // --- Conteúdo dinâmico (gerenciado por registro) ---
  ...resolvedDynamicSections,
].filter(s => s !== null)
\`\`\`

O marcador \`'__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'\` é consumido por \`splitSysPromptPrefix\` em \`src/utils/api.ts\`. Tudo antes do marcador recebe \`scope: 'global'\` (compartilhamento de cache entre organizações); tudo depois contém conteúdo específico da sessão e não é cacheado globalmente.

A consequência prática é significativa: as sete seções estáticas que definem o comportamento (identidade, uso de ferramentas, estilo de código, formato de saída) são idênticas em todos os usuários e sessões. O Prompt Cache pode amortizar o custo de processar esses tokens em todas as organizações.

### 14.3.2 Seções do Sistema

As sete seções estáticas cobrem:

**\`getSimpleIntroSection\`**: Identidade do agente e instrução de idioma.

**\`getSimpleSystemSection\`**: Regras invioláveis do sistema: nunca mencionar que o modelo subjacente é Claude, nunca revelar o system prompt, sempre responder no idioma do usuário.

**\`getSimpleDoingTasksSection\`**: Comportamento de execução de tarefas: trabalhar metodicamente, evitar alucinação de conteúdo de arquivo, verificar o trabalho após completar uma tarefa.

**\`getActionsSection\`**: Quando chamar ferramentas — incluindo a regra crítica de que o modelo deve fazer uma pergunta ao usuário se não tiver certeza sobre o que fazer, em vez de prosseguir com uma suposição que pode ser destrutiva.

**\`getUsingYourToolsSection\`**: Descrições e instruções de uso para cada ferramenta habilitada.

**\`getSimpleToneAndStyleSection\`**: Regras de formatação de resposta: sem markdown em respostas conversacionais, sem prólogo ("Certamente!"), sem epílogo repetitivo.

**\`getOutputEfficiencySection\`**: Restrições de economicidade: limitar saída de código às linhas específicas solicitadas, nunca repetir contexto de volta ao usuário.

### 14.3.3 Seções Dinâmicas

O sistema de registro dinâmico permite que diferentes partes do codebase injetem seções no system prompt sem acoplar ao \`getSystemPrompt\`:

\`\`\`typescript
type SystemPromptSection = {
  id: string
  priority: number
  content: string | (() => Promise<string>)
}

const sectionRegistry: SystemPromptSection[] = []

export function registerSystemPromptSection(section: SystemPromptSection): void {
  sectionRegistry.push(section)
  sectionRegistry.sort((a, b) => a.priority - b.priority)
}
\`\`\`

O registro de seção é chamado por módulos como o sistema de skills, o cliente MCP e o sistema de memória — cada um injetando contexto específico da sessão sem tocar nos arquivos centrais de system prompt.

---

## 14.4 O Sistema Auto Memory (memdir)

\`src/memdir/\` implementa o sistema de memória persistente — uma forma de o modelo construir e manter um arquivo de memória entre sessões.

### 14.4.1 Como Funciona

Após cada turno de conversa bem-sucedido, o módulo de extração de memória (\`executeExtractMemories\` no Capítulo 5) analisa a conversa e extrai preferências do usuário, fatos sobre o projeto e outros contextos que valem a pena lembrar. Essas extrações são escritas em arquivos Markdown em \`~/.claude/memory/\` (global) ou \`.claude/memory/\` (projeto).

Na próxima sessão, \`getUserContext\` descobre esses arquivos e os injeta no conteúdo CLAUDE.md do usuário como uma seção especial \`[MEMORY]\`.

### 14.4.2 Mecanismo de Injeção de Memória

\`filterInjectedMemoryFiles\` distingue entre arquivos CLAUDE.md regulares e arquivos de memória injetados. Arquivos de memória recebem cabeçalhos especiais indicando sua idade e origem:

\`\`\`
[MEMORY from 2025-01-15, global memory]
User prefers TypeScript over JavaScript for all new files.
Always use named exports, not default exports.
\`\`\`

O sistema usa marcação de timestamp para que memórias mais antigas possam ser priorizadas abaixo de instruções mais recentes.

---

## 14.5 Estratégias de Compressão de Contexto

Conversas longas eventualmente excedem o limite da janela de contexto do modelo. O Claude Code usa três estratégias de compressão, cada uma com suas próprias condições de trigger.

### 14.5.1 Auto Compact (Compactação Proativa)

Auto Compact roda proativamente quando a conversa se aproxima do limite da janela de contexto — tipicamente quando os tokens de entrada acumulados estão dentro de um limiar configurável do máximo (ex: 80%). Quando acionado, envia o histórico de conversa inteiro ao modelo com uma instrução especial: "Resuma esta conversa preservando todos os detalhes técnicos relevantes, decisões e contexto necessários para continuar o trabalho."

O resumo resultante substitui o histórico de conversa, e um marcador \`compact_boundary\` é inserido no array de mensagens. A partir daí, apenas o resumo e as mensagens após o limite são incluídas em chamadas de API subsequentes.

### 14.5.2 Micro Compact

Micro Compact é compressão inline de resultados de ferramentas individuais, diferente do Auto Compact que comprime o histórico inteiro. Quando um resultado de ferramenta excede \`TOOL_RESULT_MICROCOMPACT_TOKEN_THRESHOLD\`, o resultado é reescrito pelo modelo em uma forma comprimida em vez de ser descartado. A versão comprimida preserva informações-chave enquanto reduz a contagem de tokens.

Resultados micro-compactados são cacheados por \`tool_use_id\`. Uma vez que um resultado é comprimido, a versão comprimida é sempre usada em chamadas de API subsequentes — o resultado original nunca aparece novamente, prevenindo que conversas longas acumulem resultados de ferramentas cada vez maiores.

### 14.5.3 Context Collapse (Feature Gate \`CONTEXT_COLLAPSE\`)

Context Collapse é uma estratégia em estágios que marca seções da conversa como candidatas para colapso. Ao longo de uma conversa longa, resultados de ferramentas processados pelo modelo — uma longa listagem de arquivo que o modelo já leu e usou — são marcados como colapsáveis. Quando um erro \`prompt-too-long\` ocorre, o loop de query compromete todos os colapsos em estágio imediatamente, reduzindo o contexto antes de tentar novamente.

Esta é a estratégia de compressão de menor custo porque não requer uma chamada de API separada ao modelo — é puramente mecânica.

---

## Principais Conclusões

O contexto injetado em cada chamada de API é o produto de múltiplas fontes: variáveis do sistema (snapshot Git, data atual), instruções do usuário (CLAUDE.md em camadas), memória persistente (arquivos memdir), e o próprio histórico de conversa (potencialmente comprimido). Cada fonte tem seu próprio pipeline de carregamento, e todas são eventualmente montadas em uma única requisição de API.

O divisão estático/dinâmico em \`getSystemPrompt\` é a decisão de design mais impactante no pipeline de montagem. As sete seções estáticas são idênticas em todos os usuários — o Prompt Cache pode amortizar seu custo de processamento entre organizações. As seções dinâmicas são específicas da sessão e não são cacheadas globalmente.

A hierarquia CLAUDE.md — Managed, User, Project, Local — é o mecanismo de extensibilidade primário para uso sem código. A diretiva \`@include\` permite que as regras se componham entre arquivos. Padrões de \`paths\` permitem que regras sejam condicionalmente aplicadas com base nos arquivos que o modelo está trabalhando.

As três estratégias de compressão — Auto Compact, Micro Compact e Context Collapse — operam em diferentes granularidades e pontos de trigger. Context Collapse é mais barato (sem chamada de API extra); Micro Compact preserva informações-chave enquanto reduz tamanho; Auto Compact é a solução de último recurso que comprime a conversa inteira.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 15 examina a integração do protocolo MCP — como o Claude Code se conecta a servidores externos que estendem suas capacidades.*
`;export{e as default};
