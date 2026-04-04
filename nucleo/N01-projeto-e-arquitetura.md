> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 01: Visão Geral do Projeto e Arquitetura

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Descrever a arquitetura geral do Claude Code em uma frase, com precisão suficiente para ser útil ao ler o código-fonte
* Navegar pelos 35 módulos em `src/` e localizar qualquer um deles pela sua função
* Traçar o fluxo completo de dados desde o toque de uma tecla pelo usuário até a saída renderizada na tela
* Explicar como os feature flags eliminam código tanto em tempo de compilação quanto em tempo de execução, e por que isso importa para a leitura do codebase

---

## O que é o Claude Code?

Claude Code é um agente de programação baseado em CLI — um programa de linha de comando que incorpora um loop conversacional completo com a API Claude da Anthropic, um motor de execução de ferramentas com controle de permissões, e uma UI React para terminal, tudo empacotado em um único binário que roda na sua máquina local.

O usuário o inicia em um diretório de projeto, digita requisições em linguagem natural, e o Claude Code lê arquivos autonomamente, os edita, executa comandos shell, faz buscas na web, spawna sub-agentes e reporta os resultados — tudo isso solicitando permissão em qualquer etapa que modifique o ambiente.

O design é deliberadamente monolítico: a UI, o loop agêntico, o sistema de ferramentas e a camada de configuração vivem todos em um único repositório e em um único binário. Isso não é acidental. Um único processo significa estado compartilhado, zero saltos de rede entre componentes, e a capacidade de renderizar prompts de permissão interativos no mesmo terminal onde o código está sendo escrito.

---

## Stack Tecnológica

Entender a stack antes de ler o código previne várias surpresas comuns.

**Runtime: Bun, não Node.js.** O Claude Code é construído e executado com Bun. Essa escolha oferece inicialização rápida, um bundler nativo e um recurso usado de forma generalizada neste codebase: a eliminação de código morto (DCE) em tempo de compilação via `bun:bundle`. A chamada `feature()` que você verá em todo lugar não é uma função de runtime — é uma macro de tempo de build que o Bun avalia e remove os branches inalcançáveis do bundle final.

**Linguagem: TypeScript 5.x em modo strict.** Todos os 1.884 arquivos fonte são `.ts` ou `.tsx`. O sistema de tipos é usado de forma agressiva: inputs de ferramentas são validados com schemas Zod, o barramento de mensagens é uma union discriminada, e o objeto de injeção de dependência carrega mais de 40 campos tipados.

**Framework de UI: um fork customizado do Ink.** O diretório `src/ink/` contém um reconciliador React completo para saída no terminal, e não o pacote npm `ink`. Ele renderiza árvores de componentes React como sequências de escape ANSI, usando Yoga (compilado para WebAssembly) para layout CSS Flexbox. O restante da UI é escrito em React 19 — incluindo uma passagem do React Compiler em alguns componentes (procure chamadas `_c()` de cache-slot em arquivos `.tsx` compilados).

**Validação de schema: Zod v4.** Os schemas de input das ferramentas são definições `z.object(...)` que servem a três propósitos simultaneamente: validação em runtime do JSON fornecido pelo modelo, inferência de tipos TypeScript via `z.infer<>`, e geração de JSON Schema para o parâmetro `tools` da API.

**Parsing de argumentos CLI: Commander.js** (`@commander-js/extra-typings`). A função god-function `src/main.tsx` registra dezenas de subcomandos e opções via Commander.

**Feature flags: sistema de duas camadas.** Tempo de compilação: chamadas `feature('FLAG_NAME')` em `src/tools.ts`, `src/query.ts` e outros lugares são avaliadas pelo Bun no momento do bundle; branches falsos viram código morto e são removidos. Runtime: o GrowthBook fornece overrides remotos e alocação de experimentos A/B, acessados via `src/services/analytics/`.

| Tecnologia | Função |
| --- | --- |
| Bun | Runtime, bundler, DCE em tempo de compilação |
| TypeScript 5.x | Linguagem, modo strict em todo o projeto |
| React 19 + React Compiler | Árvore de componentes da UI no terminal |
| Fork customizado do Ink (`src/ink/`) | Reconciliador React para terminais ANSI |
| Yoga WASM | Layout CSS Flexbox para o terminal |
| `@anthropic-ai/sdk` | Cliente streaming da API Claude |
| `@modelcontextprotocol/sdk` | Protocolo servidor/cliente MCP |
| Zod v4 | Validação em runtime + inferência de tipos |
| Commander.js | Parsing de argumentos CLI |
| GrowthBook | Feature flags em runtime e testes A/B |
| OpenTelemetry | Rastreamento distribuído e métricas |
| lodash-es | Funções utilitárias (memoize, mergeWith, etc.) |

---

## Estrutura de Diretórios

O diretório `src/` contém 35 subdiretórios e cerca de 18 arquivos no nível raiz.

### Módulos Core

| Módulo | Arquivos | Função |
| --- | --- | --- |
| `src/Tool.ts` | 1 (793 linhas) | O contrato de interface `Tool<Input,Output>` e o objeto de injeção de dependência `ToolUseContext` |
| `src/query.ts` + `src/query/` | 5 | O loop agêntico interno: chamadas de API, streaming, despacho de ferramentas, compactação de contexto |
| `src/QueryEngine.ts` | 1 (1.296 linhas) | Motor de conversação headless usado pelo SDK e modos não-interativos |
| `src/bootstrap/` | 1 (1.759 linhas) | Estado singleton global: ID de sessão, rastreamento de custo, configuração de modelo, telemetria, OAuth |
| `src/tools/` | 184 | Toda implementação de ferramenta: BashTool, AgentTool, FileEditTool, FileReadTool, GrepTool, e mais de 20 outras |
| `src/commands/` + `src/commands.ts` | 208 | Mais de 70 implementações de slash-commands e o registro de comandos |
| `src/screens/` | 3 | A tela REPL de sessão interativa (`REPL.tsx`, ~3.000 linhas) |
| `src/ink/` | 96 | Reconciliador React customizado para renderização no terminal, layout Yoga, saída ANSI |
| `src/components/` | 389 | Todos os componentes de UI: exibição de mensagens, diálogos de permissão, input de prompt, design system |
| `src/hooks/` | 104 | Hooks React conectando eventos de UI à lógica de negócio: permissões, comandos, typeahead |
| `src/state/` | 6 | `AppState` (150+ campos), store pub/sub mínimo, provider de contexto React |
| `src/services/` | 130 | Cliente de API, conexões MCP, compactação de contexto, analytics, LSP, OAuth |
| `src/utils/` | 564 | Maior módulo: segurança bash, permissões, settings, seleção de modelo, telemetria, e mais |
| `src/entrypoints/` | 8 | Bootstrap `cli.tsx`, inicialização `init.ts`, modo servidor `mcp.ts`, exports de tipos do SDK |

### Módulos Supporting

| Módulo | Arquivos | Função |
| --- | --- | --- |
| `src/tasks/` | 12 | Executores de tarefas em background: shell, agent, teammate, workflow |
| `src/skills/` | 20 | Sistema de skills baseado em Markdown carregado de `.claude/skills/` |
| `src/bridge/` | 31 | Bridge de controle remoto: clientes mobile e web conectando-se a uma sessão CLI local |
| `src/cli/` | 19 | Saída estruturada, transportes SSE e WebSocket para a bridge |
| `src/memdir/` | 8 | Gerenciamento de arquivos `.claude/memory/` para memória persistente de sessão |
| `src/keybindings/` | 14 | Definições e handlers de atalhos de teclado customizáveis |
| `src/constants/` | 21 | Rate limits de API, headers de features beta, strings de produto, templates de system prompt |
| `src/context/` | 9 | Contextos React para notificações, estado modal, mailbox, voz |

### Módulos Peripheral

| Módulo | Arquivos | Função |
| --- | --- | --- |
| `src/coordinator/` | 1 | Modo coordinator para gerenciar redes de agentes worker |
| `src/schemas/` | 1 | Schema Zod para o formato de configuração de hooks |
| `src/migrations/` | 11 | Migrações únicas para o formato do arquivo de settings |
| `src/vim/` | 5 | Modo de atalhos Vim para o campo de input do prompt |
| `src/remote/` | 4 | Gerenciamento de sessão remota para o modo `--remote` |
| `src/server/` | 3 | Servidor de socket de domínio Unix para Direct Connect |
| `src/plugins/` | 2 | Registro de plugins built-in |
| `src/buddy/` | 6 | Feature de mascote companion (controlada por feature flag) |
| `src/voice/` | 1 | Verificação de feature flag do modo voz |
| `src/native-ts/` | 4 | Ports TypeScript de bibliotecas nativas (yoga-layout, color-diff) |
| `src/upstreamproxy/` | 2 | Suporte a proxy HTTP para configurações de firewall corporativo |

### Arquivos Importantes no Nível Raiz

| Arquivo | Função |
| --- | --- |
| `src/main.tsx` | Faz o parsing de todos os argumentos CLI, monta o `ToolUseContext`, inicia o REPL ou modo headless |
| `src/tools.ts` | Registro de ferramentas: importa todas as ferramentas, aplica carregamento condicional por feature flag |
| `src/replLauncher.tsx` | Conecta `main.tsx` à raiz de renderização React |
| `src/context.ts` | Descoberta de arquivos CLAUDE.md e injeção de contexto no sistema |
| `src/history.ts` | Leitura e escrita do histórico de sessão |
| `src/cost-tracker.ts` | Rastreamento de custo de API por sessão |

---

## Arquitetura: Pipeline AsyncGenerator Orientado a Eventos

O Claude Code não é uma aplicação MVC. A arquitetura é um **pipeline AsyncGenerator orientado a eventos** — uma cadeia de funções `AsyncGenerator` que produzem stream events e consomem resultados de ferramentas em um loop até que o modelo sinalize que concluiu.

A ideia central é que `query()` em `src/query.ts` é um `AsyncGenerator<StreamEvent>`. Ele não retorna uma resposta final. Ele gera um fluxo de eventos tipados — `text_delta`, `tool_use`, `tool_result`, `request_start`, `compact_start`, e assim por diante. A tela REPL assina esse generator e renderiza cada evento de forma incremental.

---

## Fluxo de Dados: Do Input do Usuário à Saída Renderizada

### Etapa 1: Entrada pelo CLI e despacho por fast-path

`src/entrypoints/cli.tsx` é o ponto de entrada do binário. Minimiza o tempo de inicialização evitando o carregamento de qualquer módulo para fast-paths comuns.

### Etapa 2: Inicialização e parsing de argumentos

`src/entrypoints/init.ts` executa a sequência de inicialização em duas fases. `src/main.tsx` registra todos os subcomandos e opções do Commander.js.

### Etapa 3: O ToolUseContext

`ToolUseContext` é o único objeto que flui por todas as chamadas de ferramenta no sistema. É um objeto TypeScript simples contendo tudo o que uma ferramenta pode precisar acessar.

### Etapa 4: Renderização do REPL e submissão de mensagens

`launchRepl()` em `src/replLauncher.tsx` importa dinamicamente `App` e `REPL`. O componente `REPL` (`src/screens/REPL.tsx`) é o dono da sessão interativa.

### Etapa 5: O loop de query

`src/query.ts` contém o loop agêntico interno. Faz a chamada de API com streaming, itera sobre valores `StreamEvent`, despacha blocos `tool_use` e faz o loop até `stop_reason === 'end_turn'`.

### Etapa 6: Execução de ferramentas

`src/services/tools/` contém o `StreamingToolExecutor`. Busca a ferramenta, verifica permissões, executa e serializa o resultado.

### Etapa 7: Recursão por sub-agente

`src/tools/AgentTool/runAgent.ts` implementa o caminho recursivo de sub-agente com contexto clonado e isolado.

### Etapa 8: Injeção de contexto — CLAUDE.md

`src/context.ts` varre do diretório atual até o home, lendo cada `CLAUDE.md` encontrado e injetando no system prompt.

---

## Configuração Principal

### CLAUDE.md

Arquivos CLAUDE.md são documentos de instrução específicos do projeto injetados no system prompt de cada chamada de API.

### settings.json

Settings carregadas em ordem de prioridade: usuário → projeto → MDM enterprise → flags CLI → settings remotas.

### Feature Flags

- **Tempo de compilação** (`feature('FLAG')`): macro bun:bundle, branch sofre DCE em builds de produção
- **Runtime** (GrowthBook): avaliado durante a sessão contra instância remota

### O Singleton Bootstrap

`src/bootstrap/state.ts` é o container de estado global do processo, com 1.759 linhas e ~80 funções getter/setter.

---

## Principais Conclusões

O Claude Code é um **CLI monolítico de binário único** combinando loop agêntico de IA, UI de terminal completa e motor de execução de ferramentas em TypeScript/Bun.

A **abstração central** é a interface `Tool<Input, Output>`. O **loop de query** em `src/query.ts` é um `AsyncGenerator`. **Feature flags** são macros de tempo de compilação. **A configuração tem três camadas**: CLAUDE.md, settings.json e feature flags.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 02 traça a sequência completa de inicialização de `cli.tsx` passando por `init.ts` até o primeiro prompt REPL renderizado.*
