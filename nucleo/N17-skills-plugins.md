> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 17: Sistema de Skills e Plugins

## O que você vai aprender

1. O que é uma Skill: como um arquivo Markdown com frontmatter YAML se torna um slash command invocável
2. Como `loadSkillsDir.ts` descobre e parseia arquivos de skill — o pipeline completo do scan de diretório ao objeto `Command`
3. Como Bundled Skills diferem arquiteturalmente de Skills baseadas em arquivo
4. Como `SkillTool` invoca uma Skill em runtime — modos de execução inline vs. fork
5. Arquitetura de plugin: o que um Plugin pode carregar, como é instalado e gerenciado, como se mescla ao registro de comandos
6. Um exemplo completo: construindo uma Skill customizada do zero com cada campo de frontmatter explicado
7. Filosofia de design: por que Markdown alimenta Skills enquanto código estruturado alimenta Plugins

---

## 17.1 O que é uma Skill

Uma Skill é um "intent" empacotado — diz ao Claude o que fazer em uma situação específica. O carrier é um arquivo Markdown simples. O topo do arquivo contém frontmatter YAML (metadados) e o restante é o texto de instrução que será injetado no contexto do Claude.

Quando um usuário digita `/commit` ou `/review-pr 123`, o Claude Code procura uma Skill chamada `commit` ou `review-pr`, expande seu conteúdo Markdown na conversa e deixa o modelo executar as instruções incorporadas.

Um arquivo Skill mínimo:

```markdown
---
description: "Commit staged changes with a conventional commit message"
allowed-tools:
  - Bash(git:*)
when_to_use: "Use when the user wants to commit. Examples: 'commit', 'git commit', 'save my changes'"
---

# Commit

Review the staged diff with `git diff --staged`, write a conventional commit message, and run `git commit`.
```

Este arquivo vive em `.claude/skills/commit/SKILL.md`. O nome do diretório `commit` torna-se o nome do comando.

---

## 17.2 Descoberta e Carregamento de Arquivo

### 17.2.1 Convenção de Layout de Diretório

Skills são carregadas de três níveis, em prioridade decrescente:

- **Managed** (controlado por política): caminhos determinados por `getManagedFilePath()`; não podem ser substituídos por usuários
- **User**: `~/.claude/skills/` — aplica-se a todos os projetos
- **Project**: `.claude/skills/` — aplica-se apenas ao projeto atual

Cada Skill deve ser um diretório contendo um arquivo chamado `SKILL.md`. Um único arquivo `.md` colocado diretamente dentro do diretório `/skills/` não é reconhecido:

```
.claude/
└── skills/
    ├── commit/
    │   └── SKILL.md        # correto: diretório + SKILL.md
    ├── review-pr/
    │   └── SKILL.md
    └── my-helper.md        # errado: arquivos .md simples são ignorados
```

A convenção de diretório é intencional: um diretório de Skill pode conter arquivos companheiros (scripts, arquivos de dados, schemas) que o prompt da Skill pode referenciar através da variável `${CLAUDE_SKILL_DIR}`.

### 17.2.2 Carregamento Paralelo e Deduplicação

`getSkillDirCommands` é envolvido com `lodash.memoize` para que I/O real aconteça apenas uma vez por valor de `cwd`. Todas as leituras de diretório acontecem concorrentemente. Após os resultados chegarem, são mesclados e deduplicados por **realpath** — o caminho canônico com symlinks resolvidos:

```typescript
const seenFileIds = new Map<string, ...>()
// Primeiro a chegar vence: precedência managed > user > project é preservada pela ordem de iteração
for (let i = 0; i < allSkillsWithPaths.length; i++) {
  const fileId = fileIds[i]
  if (seenFileIds.has(fileId)) { continue }   // pular duplicata
  seenFileIds.set(fileId, skill.source)
  deduplicatedSkills.push(skill)
}
```

### 17.2.3 Parsing de Frontmatter

Após ler cada `SKILL.md`, `parseFrontmatter` divide em objeto de frontmatter e string de corpo. Referência completa de frontmatter:

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `name` | string | Nome de exibição; padrão é o nome do diretório |
| `description` | string | Descrição de uma linha mostrada na listagem de skills |
| `when_to_use` | string | Descrição detalhada de quando auto-invocar, com exemplos de frases trigger |
| `allowed-tools` | string[] | Whitelist de ferramentas que esta Skill tem permissão de usar |
| `argument-hint` | string | Hint de argumento mostrado no autocomplete |
| `arguments` | string[] | Lista de argumentos nomeados para substituição `$arg_name` no corpo |
| `model` | string | Substituir o modelo, ex: `claude-opus-4-5`, ou `inherit` para manter o pai |
| `effort` | string/int | Esforço de thinking: `low`/`medium`/`high` ou orçamento inteiro |
| `context` | string | Contexto de execução: `fork` roda como sub-agente isolado |
| `paths` | string[] | Padrões de caminho estilo gitignore; Skill ativa apenas quando arquivos correspondentes são tocados |
| `hooks` | object | Configuração de hooks escopada à skill |
| `user-invocable` | boolean | Se a Skill aparece na listagem visível ao usuário (padrão: true) |
| `disable-model-invocation` | boolean | Desabilita invocação via SkillTool; apenas slash commands digitados pelo usuário funcionam |

### 17.2.4 Ativação Condicional: o Campo `paths`

O campo `paths` habilita despertar sob demanda: em vez de ser imediatamente ativa, uma Skill com `paths` é colocada em um mapa `conditionalSkills`. É promovida para a lista de skills ativas apenas quando uma operação de arquivo toca um caminho correspondente:

```typescript
export function activateConditionalSkillsForPaths(filePaths: string[], cwd: string): string[] {
  for (const [name, skill] of conditionalSkills) {
    const skillIgnore = ignore().add(skill.paths)  // correspondência estilo gitignore
    for (const filePath of filePaths) {
      const relativePath = relative(cwd, filePath)
      if (skillIgnore.ignores(relativePath)) {
        dynamicSkills.set(name, skill)     // agora ativa
        conditionalSkills.delete(name)
        break
      }
    }
  }
}
```

---

## 17.3 Bundled Skills

Bundled Skills são pré-compiladas no binário do Claude Code — não descobertas do sistema de arquivos em runtime. A vantagem é eliminar latência de I/O na inicialização: essas skills estão sempre disponíveis sem varredura de disco.

Uma Bundled Skill ainda usa a mesma interface `PromptCommand`, mas seu campo `source` é `'bundled'` em vez de `'userSettings'` ou `'projectSettings'`. O `getPromptForCommand()` de uma Bundled Skill retorna um array estático de blocos de conteúdo em vez de ler de um arquivo.

As Bundled Skills são onde a Anthropic empacota melhores práticas destiladas — fluxos de trabalho de commit, procedimentos de revisão de PR, estratégias de depuração — que os usuários obtêm automaticamente sem precisar instalar nada.

---

## 17.4 Invocação de Skill em Runtime: SkillTool

`SkillTool` é a ferramenta que permite ao modelo invocar Skills programaticamente durante operação agêntica. Quando o modelo quer usar uma Skill como ferramenta, ele emite uma chamada de ferramenta `Skill` com o nome da skill e quaisquer argumentos.

### 17.4.1 Inline vs. Fork

O parâmetro `context: 'fork'` no frontmatter de uma Skill determina o modo de execução:

**Inline (padrão)**: A Skill expande seu conteúdo no contexto do agente atual. O agente continua com o histórico de conversa existente mais as instruções da skill injetadas. Apropriado para skills que precisam de contexto existente.

**Fork**: Um sub-agente separado (via `AgentTool`) é spawned com apenas o conteúdo da skill como contexto inicial. O sub-agente opera isoladamente e retorna um resultado. Apropriado para skills que fazem mudanças extensas que não devem poluir o contexto do pai.

### 17.4.2 Substituição de Argumentos

Dentro do corpo de uma Skill, argumentos são referenciados com `$arg_name`. Antes de injetar o conteúdo da skill no contexto, `expandSkillArguments` substitui essas referências pelos valores passados pelo modelo:

```typescript
function expandSkillArguments(content: string, args: Record<string, string>): string {
  return content.replace(/\$(\w+)/g, (match, name) => {
    return args[name] !== undefined ? args[name] : match
  })
}
```

---

## 17.5 Arquitetura de Plugin

Plugins estendem o Claude Code com capacidades mais ricas do que Skills simples permitem — eles podem incluir ferramentas compiladas, servidores MCP, agents customizados e múltiplas Skills como um bundle.

### 17.5.1 Estrutura de Plugin

Um Plugin é um pacote npm com um campo `claude-code` em seu `package.json`:

```json
{
  "name": "@company/claude-code-plugin",
  "version": "1.0.0",
  "claude-code": {
    "version": 1,
    "skills": ["./skills/deploy.md", "./skills/rollback.md"],
    "mcpServers": {
      "company-api": {
        "type": "stdio",
        "command": "node",
        "args": ["./mcp-server.js"]
      }
    },
    "agents": ["./agents/deployment-coordinator.yaml"]
  }
}
```

### 17.5.2 Instalação e Gerenciamento

Plugins são instalados via `claude plugins install <package-name>` ou adicionados manualmente ao arquivo de configuração `~/.claude.json`. O ciclo de vida de instalação:

1. `npm install` (ou equivalente do gerenciador de pacotes) o pacote no diretório de plugins global
2. Ler o manifesto do plugin do `package.json`
3. Registrar Skills declaradas como `PromptCommand`s com `source: 'plugin'`
4. Inicializar servidores MCP declarados como conexões de cliente MCP
5. Carregar definições de agente declaradas no registro de agentes

`getPluginCommands` em `src/commands.ts` (coberto no Capítulo 8) faz o loading de skills de plugin. É chamado em paralelo com o loading de skills de diretório durante `loadAllCommands`.

### 17.5.3 Precedência de Plugin vs. Skill vs. Builtin

Na lista de registro de comandos, a precedência é: bundled skills → built-in plugin skills → skill-dir commands → workflow commands → plugin commands → plugin skills → built-in commands. Skills de usuário e projeto podem efetivamente substituir comandos built-in para aquele contexto.

---

## 17.6 Exemplo Completo: Construindo uma Skill Customizada

Construindo uma Skill de revisão de PR com todas as features avançadas:

**Estrutura de arquivos:**
```
.claude/skills/review-pr/
├── SKILL.md         # o arquivo de skill principal
└── checklist.md     # arquivo companheiro referenciado pela skill
```

**SKILL.md:**
```markdown
---
name: "Review Pull Request"
description: "Review a GitHub pull request against our team standards"
when_to_use: "Use when asked to review a PR, pull request, or code review"
allowed-tools:
  - Bash(gh:*)
  - WebFetch
  - FileRead
argument-hint: "<pr-number>"
arguments:
  - pr_number
model: inherit
effort: high
context: fork
paths:
  - "**/*.py"
  - "**/*.ts"
---

# Pull Request Review

Review PR #$pr_number against our team standards.

## Steps

1. Fetch the PR details:
   ```bash
   gh pr view $pr_number --json title,body,files,reviews
   ```

2. Read the diff:
   ```bash
   gh pr diff $pr_number
   ```

3. Check against our checklist in ${CLAUDE_SKILL_DIR}/checklist.md

4. Provide structured feedback covering:
   - Code quality issues
   - Missing tests
   - Documentation gaps
   - Security concerns
```

**checklist.md:**
```markdown
# Review Checklist
- [ ] Tests cover the happy path
- [ ] Error cases are handled
- [ ] No hardcoded credentials
- [ ] TypeScript strict mode compliance
```

A variável `${CLAUDE_SKILL_DIR}` é resolvida para o diretório de skill em runtime, permitindo que o arquivo companheiro seja referenciado de forma confiável independentemente de onde a skill está instalada.

---

## 17.7 Filosofia de Design: Markdown vs. Código

A distinção arquitetural central é clara:

**Skills usam Markdown porque:** são primariamente sobre instrução, não execução. Uma Skill diz ao Claude o que fazer — o Claude executa. O Markdown é legível por humanos sem treinamento em codificação. Skills podem ser criadas e editadas por membros da equipe não técnicos. O sistema de frontmatter YAML fornece configuração sem exigir que os autores escrevam TypeScript.

**Plugins usam código estruturado porque:** precisam registrar novas ferramentas, inicializar servidores de processo, e se integrar com sistemas externos. Essas operações requerem lógica de programa. Plugins têm efeitos colaterais de processo que precisam de gerenciamento de ciclo de vida. A segurança de tipos TypeScript é necessária para código de integração de produção.

A divisão significa que há uma rampa clara de entrada: um usuário pode criar uma skill em minutos editando um arquivo Markdown, escalar para plugins quando precisam de capacidades que o Markdown não pode expressar.

---

## Principais Conclusões

Skills são arquivos Markdown com frontmatter YAML que se tornam slash commands invocáveis. O pipeline de carregamento varre múltiplos diretórios concorrentemente, deduplica por realpath e registra cada skill como um `PromptCommand`.

O campo `paths` é o mecanismo de extensibilidade mais poderoso do sistema de skills — ele permite que skills permaneçam dormentes até que o modelo toque um arquivo relevante, garantindo que a lista de comandos permaneça focada e não sobrecarregada.

Bundled Skills são Skills pré-compiladas que chegam sem latência de I/O. Elas representam fluxos de trabalho destilados que os usuários obtêm automaticamente.

`SkillTool` é a interface de ferramenta que permite ao modelo invocar Skills programaticamente. O campo `context: 'fork'` nos metadados da skill determina se a skill roda inline ou como sub-agente isolado.

Plugins estendem além de Skills para incluir ferramentas compiladas, servidores MCP, e agents customizados. São instalados como pacotes npm com um campo `claude-code` em seu `package.json` descrevendo suas contribuições.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 18 examina a camada de serviços, API analytics e LSP — os serviços de background que potencializam a inteligência contextual do Claude Code.*
