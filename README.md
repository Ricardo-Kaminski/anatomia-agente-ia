# Anatomia de um Agente de IA
## Engenharia Reversa do Claude Code

> **O maior leak acidental da história dos LLMs — analisado em português.**

Em março de 2025, o código-fonte completo do Claude Code (512K linhas de TypeScript, sourcemap de 59.8MB) foi exposto acidentalmente via npm. Em 30 minutos estava no Hacker News. Em dias, o fork `claw-code` tinha 100K stars.

Este projeto é a **primeira análise sistemática em português** desse artefato histórico: engenharia reversa técnica combinada com análise de governança, regulação e accountability de IA.

[![Licença: CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
[![PT-BR](https://img.shields.io/badge/idioma-PT--BR-green)](nucleo/)
[![Status](https://img.shields.io/badge/status-MVP%20publicado-blue)](ROADMAP.md)

---

## Por que este livro é diferente

| | Outros materiais | Este projeto |
|---|---|---|
| **Idioma** | Inglês, chinês | **Português (ES planejado)** |
| **Foco** | Como o código funciona | **Por que essas decisões foram tomadas** |
| **Camada analítica** | Técnica apenas | **Técnica + governança + regulação** |
| **Frameworks** | Nenhum | **Q-FENG, VSM, EU AI Act, PL 2338/2023** |
| **Produção** | Análise estática | **Feito com Claude Code para analisar Claude Code** |

---

## O que está publicado

### Núcleo Técnico — 20 capítulos

| # | Capítulo | Conteúdo |
|---|----------|----------|
| N01 | [Projeto e Arquitetura](nucleo/N01-projeto-e-arquitetura.md) | Visão geral, stack, mapa de módulos |
| N02 | [Inicialização e Bootstrap](nucleo/N02-inicializacao-bootstrap.md) | Do npm install ao primeiro prompt |
| N03 | [Sistema de Tipos](nucleo/N03-sistema-de-tipos.md) | Core types: Message, Tool, Permission, Session |
| N04 | [Gerenciamento de Estado](nucleo/N04-gerenciamento-estado.md) | Estado mutável/imutável, Zustand patterns |
| N05 | [Loop Agente](nucleo/N05-loop-agente.md) | O ciclo receber→pensar→agir→observar |
| N06 | [Sistema de Ferramentas](nucleo/N06-sistema-ferramentas.md) | 40+ tools: Bash, File, LSP, Web, Sub-agent |
| N07 | [Permissões e Segurança](nucleo/N07-permissoes-seguranca.md) | Three-gate architecture, sandboxing |
| N08 | [Sistema de Comandos](nucleo/N08-sistema-comandos.md) | Slash commands, hooks, extensibilidade |
| N09 | [Query Engine e SDK](nucleo/N09-query-engine-sdk.md) | QueryEngine.ts: 46K linhas de inferência |
| N10 | [Terminal UI (Ink)](nucleo/N10-terminal-ui-ink.md) | React no terminal: a escolha arquitetural |
| N11 | [REPL e Sessão](nucleo/N11-repl-sessao.md) | Gerenciamento de sessão interativa |
| N12 | [Componentes e Design System](nucleo/N12-componentes-design.md) | Diff view, componentes, design tokens |
| N13 | [Hooks e Lógica](nucleo/N13-hooks-logica.md) | React hooks customizados, lógica de UI |
| N14 | [Contexto e Prompts](nucleo/N14-contexto-prompts.md) | Como o system prompt é montado dinamicamente |
| N15 | [MCP Protocol](nucleo/N15-mcp-protocolo.md) | Model Context Protocol: conexão ao mundo externo |
| N16 | [Multi-Agent e Coordinator](nucleo/N16-multi-agent.md) | De agente solo a orquestrador de workers |
| N17 | [Skills e Plugins](nucleo/N17-skills-plugins.md) | SKILL.md como contrato, marketplace de capacidades |
| N18 | [Serviços, API e LSP](nucleo/N18-servicos-api-lsp.md) | OAuth, telemetria, LSP integration |
| N19 | [Configuração e Hooks](nucleo/N19-configuracao-hooks.md) | Settings, feature flags, hooks de automação |
| N20 | [Periféricos e Utilitários](nucleo/N20-perifericos-utilitarios.md) | Buddy System, utilitários, easter eggs |

### Ferramentas

- **[Cartografia C0](cartografia/c0-visao-geral.jsx)** — grafo interativo dos módulos (React artifact)
- **[Dados extraídos](dados/)** — modulos.json, tools.json (base para as cartografias)

---

## O que vem a seguir

Ver [ROADMAP.md](ROADMAP.md) para o plano completo. Em desenvolvimento:

- **Camada Analítica** — governança (Q-FENG), regulação comparada, VSM, segurança
- **Camada Prática** — workflows para devs, gestores, setor público, saúde
- **Edições Setoriais** — Gov, Health, Legal, Dev, CISO editions
- **Cartografias interativas** — C1–C7 (fluxo, permissões, memória, multi-agent, governança)
- **Versão ES** — tradução para espanhol latinoamericano

---

## Como usar — por perfil

| Perfil | Por onde começar |
|--------|-----------------|
| **Desenvolvedor** | N01 → N05 → N06 → N07 (leia tudo) |
| **Arquiteto de IA** | N01 → N07 → N14 → N16 → N17 |
| **Gestor público** | N01 → N02 → N07 → N16 (visão geral de cada) |
| **Pesquisador** | N01 → N05 → N09 → N16 → aguardar camada analítica |
| **Jurista / CISO** | N01 → N07 → N14 → N16 → aguardar A1/A2/A5 |

---

## Sobre o projeto

**Autor:** Ricardo Kaminski  
**Versão analisada:** Claude Code v2.1.88 (snapshot histórico de março de 2025)  
**Produção:** Este livro foi produzido usando Claude Code para analisar o próprio Claude Code — uma recursividade metodológica documentada no processo.

**Licença:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — livre para usar, adaptar e redistribuir com atribuição.

---

*Contribuições bem-vindas. Ver [CONTRIBUTING.md](CONTRIBUTING.md).*
