# PLANO MESTRE DE EXECUÇÃO
## Anatomia de um Agente de IA — Da Engenharia Reversa à Monetização

---

## 1. Realidade Operacional

**Budget atual:** ~$100/mês (plano Claude Pro)
**Budget futuro:** Ampliável a partir de receita do projeto de planilhas + primeiras vendas
**Tempo disponível:** Trabalho paralelo ao CGDID
**Ferramentas:** Claude Pro (claude.ai + Claude Code VSCode), GitHub, LinkedIn
**Idioma primário:** PT-BR (publicação diária), ES (tradução posterior)

**Princípio operacional:** Cada dia produz uma peça publicável. Nada fica no gaveta. O processo de construção É o conteúdo.

---

## 2. A Dor Comercial: Otimização de Custos e Limites em IA

### O que o código-fonte revela sobre custos
O leak expõe módulos que controlam:
- **Token counting** — como o Claude Code conta e gerencia tokens
- **Model cost** (utils/modelCost.ts) — tabela de preços interna
- **Context window management** — como decide o que manter/descartar
- **Compactação de contexto** — estratégias de summarization
- **Model routing** — quando usa Sonnet vs Opus vs Haiku
- **Feature flags de custo** — o que é gated por subscription tier

### Produtos derivados dessa análise

| Produto | Dor que resolve | Preço | Esforço |
|---------|----------------|-------|---------|
| **"Guia de Otimização Claude Code"** | "Estou gastando demais com tokens" | R$47 | 1 semana |
| **"Token Budget Calculator"** (artifact/tool) | "Não sei quanto vou gastar" | Gratuito (lead magnet) | 2 dias |
| **"CLAUDE.md Templates Otimizados"** | "Meu CLAUDE.md desperdiça contexto" | R$27 (pack) | 3 dias |
| **"Skills que Economizam Tokens"** | "Como fazer mais com menos" | R$37 (pack) | 1 semana |
| **"Context Window Masterclass"** | "Perco contexto em conversas longas" | R$97 (mini-curso) | 2 semanas |
| **"Arquitetura de Squads com Budget Limitado"** | "Como orquestrar agents sem falir" | R$67 | 1 semana |

### Sequência de monetização
```
Semana 1-2: Conteúdo gratuito (LinkedIn posts) → builds audiência
Semana 3:   Lead magnet gratuito (Token Calculator) → captura emails
Semana 4:   Primeiro produto pago (Guia Otimização, R$47)
Semana 5+:  Produtos adicionais baseados em feedback
```

---

## 3. Estrutura de Repositórios

```
GitHub: ricardo-kaminski/  (ou nome que preferir)

├── anatomia-agente-ia/              ← REPO PRINCIPAL (público)
│   ├── README.md                    # Manifesto do projeto
│   ├── LICENSE                      # CC BY-SA 4.0
│   │
│   ├── nucleo/                      # Módulos N1-N12 (engenharia reversa)
│   │   ├── N01-o-leak.md
│   │   ├── N02-o-que-e-agente.md
│   │   └── ...
│   │
│   ├── analise/                     # Módulos A1-A7 (camadas analíticas)
│   │   ├── A1-governanca.md
│   │   └── ...
│   │
│   ├── cartografias/                # Código das cartografias interativas
│   │   ├── c0-visao-orbital/
│   │   │   ├── data.json            # Dados extraídos do código
│   │   │   └── CartografiaMestra.jsx
│   │   ├── c1-anatomia/
│   │   ├── c2-fluxo/
│   │   └── ...
│   │
│   ├── dados/                       # Datasets extraídos
│   │   ├── modulos.json
│   │   ├── tools.json
│   │   ├── permissoes.json
│   │   ├── feature-flags.json
│   │   └── system-prompts.json
│   │
│   ├── docs/                        # Meta-documentação
│   │   ├── metodo.md                # Cap 3: Joler + Foucault + Beer
│   │   ├── progresso.md
│   │   └── referencias.md
│   │
│   ├── diario/                      # ← PUBLICAÇÃO DIÁRIA
│   │   ├── 2026-04-04.md            # "Hoje analisei o QueryEngine..."
│   │   ├── 2026-04-05.md
│   │   └── ...
│   │
│   └── site/                        # VitePress (futuro)
│       └── .vitepress/
│
├── claude-code-otimizacao/          ← REPO DE PRODUTOS (público/freemium)
│   ├── README.md
│   ├── guias/
│   │   ├── otimizacao-tokens.md     # Gratuito (preview)
│   │   └── context-window.md
│   ├── tools/
│   │   ├── token-calculator/        # React artifact
│   │   └── cost-estimator/
│   ├── templates/
│   │   ├── claude-md/               # CLAUDE.md otimizados
│   │   └── skills/                  # Skills que economizam
│   └── squads/
│       └── budget-limitado.md
│
└── cartografias-ia/                 ← REPO DAS CARTOGRAFIAS (público)
    ├── README.md
    ├── src/
    │   ├── C0-orbital.jsx
    │   ├── C1-anatomia.jsx
    │   ├── C2-fluxo.jsx
    │   ├── C3-permissoes.jsx
    │   ├── C4-ontologia-org.jsx
    │   ├── C5-memoria.jsx
    │   ├── C6-multi-agent.jsx
    │   └── C7-governanca-overlay.jsx
    ├── data/
    │   └── claude-code-v2.1.88.json
    └── docs/
        └── metodo-cartografia-critica.md
```

**Lógica dos 3 repos:**
- **anatomia-agente-ia**: O livro/conteúdo analítico. Atrai pesquisadores, gestores, academia.
- **claude-code-otimizacao**: Os produtos práticos. Atrai devs, gera receita.
- **cartografias-ia**: As visualizações interativas. Atrai todo mundo, viraliza.

Os três se referenciam mutuamente. O diário do repo principal é a fonte do conteúdo LinkedIn.

---

## 4. Calendário de Execução — 30 Dias

### Semana 1 (04-07 abr): FUNDAÇÃO + PRIMEIROS POSTS

| Dia | Produção | Publicação LinkedIn | Repo |
|-----|----------|-------------------|------|
| Sex 04 | Setup repos GitHub + README | Post: "Vou dissecar o código do Claude Code em público" | anatomia |
| Sáb 05 | N01-o-leak.md (rascunho) | Post: "O que aconteceu com o leak do Claude Code" | anatomia |
| Dom 06 | Extrair dados básicos do código | Post: "512K linhas de código: o que tem dentro" | anatomia |
| Seg 07 | N02-o-que-e-agente.md | Post: "Claude Code não é uma ferramenta — é um agente" | anatomia |
| Ter 08 | Dados de tools e permissões | Post: "As 40+ ferramentas do Claude Code, catalogadas" | dados |
| Qua 09 | Cartografia C0 com dados reais | Post: "Primeira cartografia interativa de um agente de IA" | cartografias |
| Qui 10 | N03-metodo.md (Joler/Foucault) | Post: "Por que analiso código como um sociólogo" | anatomia |

### Semana 2 (11-17 abr): NÚCLEO TÉCNICO + LEAD MAGNET

| Dia | Produção | Publicação LinkedIn |
|-----|----------|-------------------|
| Sex 11 | N04-arquitetura.md | "A arquitetura do Claude Code em um diagrama" |
| Sáb 12 | N05-loop-agente.md | "QueryEngine: 46K linhas que fazem o agente pensar" |
| Dom 13 | Token Calculator (artifact) | "Ferramenta gratuita: calcule seu gasto com Claude Code" |
| Seg 14 | N06-permissoes.md | "O three-gate: como o Claude Code decide o que pode fazer" |
| Ter 15 | N07-contexto-prompts.md | "Quem escreve o prompt governa o agente" |
| Qua 16 | Cartografia C3 (permissões) | "Mapa de segurança do Claude Code" |
| Qui 17 | Submissão Mila (se ainda aberto) | "O Undercover Mode e por que você deveria se preocupar" |

### Semana 3 (18-24 abr): MONETIZAÇÃO + ANÁLISE

| Dia | Produção | Publicação LinkedIn |
|-----|----------|-------------------|
| Sex 18 | Guia de Otimização (rascunho) | "Como o Claude Code conta seus tokens (e como economizar)" |
| Sáb 19 | Guia de Otimização (finalizar) | "Model routing: quando o Claude Code usa Opus vs Sonnet" |
| Dom 20 | Setup Gumroad + landing page | "Lancei o Guia de Otimização do Claude Code (R$47)" |
| Seg 21 | N08-memoria.md + A1-governanca | "O agente que sonha: autoDream e autonomia sem supervisão" |
| Ter 22 | CLAUDE.md Templates Pack | "Templates de CLAUDE.md que economizam 30% de contexto" |
| Qua 23 | N09-multi-agent.md | "Multi-agent: quando o Claude Code vira um time inteiro" |
| Qui 24 | Cartografia C6 (multi-agent) | "Como funcionam os squads híbridos humano-agente" |

### Semana 4 (25-30 abr): EDIÇÕES SETORIAIS + CONSOLIDAÇÃO

| Dia | Produção | Publicação LinkedIn |
|-----|----------|-------------------|
| Sex 25 | Gov Edition (montagem) | "IA agente no setor público: o que o código revela" |
| Sáb 26 | A2-regulacao.md | "EU AI Act vs PL 2338: o que cobrem e o que não cobrem" |
| Dom 27 | Cartografia C7 (governança overlay) | "A cartografia de governança: regulação sobre código" |
| Seg 28 | Health Edition (montagem) | "Agentes de IA em saúde: do Claude Code ao SUS" |
| Ter 29 | Skills Pack otimizado | "Skills que economizam tokens: pack #2" |
| Qua 30 | Dev Edition (montagem) | "Claude Code por dentro: o guia técnico em PT-BR" |

---

## 5. Estratégia de Publicação Diária no LinkedIn

### Formato padrão de post
```
[GANCHO — 1 linha provocativa]

[CONTEXTO — 2-3 frases sobre o que analisei hoje]

[ACHADO — o insight principal, com dado concreto do código]

[IMPLICAÇÃO — por que isso importa para o leitor]

[CTA — link para o repo/artigo/ferramenta]

#ClaudeCode #IA #GovernaçaDeIA #EngenhariaReversa
```

### Exemplo concreto (Dia 1)
```
Na terça o código-fonte inteiro do Claude Code vazou.
512 mil linhas de TypeScript. Eu vou dissecar cada uma — em público.

Comecei hoje. Vou documentar a arquitetura de um dos agentes 
de IA mais avançados do mundo, do código à política pública.

Cada dia: um módulo analisado, um post aqui, um commit no GitHub.

O projeto se chama "Anatomia de um Agente de IA" e é inspirado 
no trabalho de Vladan Joler que cartografou o Amazon Echo em 2018.
A diferença: a minha cartografia é interativa e navegável.

Acompanhe: [link do repo]

#ClaudeCode #IA #CartografiaCrítica
```

### Cadência
- **LinkedIn:** 1 post/dia (seg-qui), mais leve sex-dom
- **GitHub:** 1 commit/dia (o diário + o que produziu)
- **Instagram:** 1 carrossel/semana (condensando os achados)

---

## 6. Otimização do Budget de $100/mês

### Como maximizar o Claude Pro
```
MANHÃ (tokens frescos):
  → Análise de código pesada (módulos grandes como QueryEngine)
  → Geração de capítulos longos
  → Cartografias interativas (React artifacts)

TARDE (tokens mais escassos):
  → Revisão e edição de rascunhos
  → Posts LinkedIn (curtos)
  → Organização de dados extraídos

NOITE (se sobrar):
  → Tradução ES
  → Refinamento de artifacts
```

### Estratégias de economia de tokens
- Trabalhar com chunks: analisar um módulo por vez, não o código inteiro
- Manter CLAUDE.md do workspace enxuto e preciso
- Usar artifacts para visualizações (renderiza no browser, não gasta tokens pós-geração)
- Reusar análises: o que extraiu num dia vira input do próximo
- Offline: organizar, formatar e publicar posts sem gastar tokens

### Quando ampliar o budget
- Receita do projeto de planilhas cobre ampliação natural
- Primeiro produto vendido (Guia R$47) → reinvestir em tokens
- Meta: a partir de mês 2, o projeto se auto-sustenta
- Se atingir R$500/mês em vendas → upgrade para plano com mais capacidade

---

## 7. Funil de Monetização

```
TOPO (gratuito — atrai público)
│
├── Posts LinkedIn diários
├── Repo GitHub público (livro em construção)
├── Cartografias interativas (artifacts)
├── Token Calculator (lead magnet)
│
MEIO (baixo custo — converte)
│
├── Guia de Otimização Claude Code — R$47
├── Pack CLAUDE.md Templates — R$27
├── Pack Skills Otimizados — R$37
├── Dev Edition (EPUB/PDF) — R$49
│
BASE (valor alto — monetiza expertise)
│
├── Context Window Masterclass — R$97
├── Gov Edition + Workshop Kit — R$197
├── Health Edition — R$97
├── Consultoria/palestra — sob demanda
│
TOPO ACADÊMICO (prestígio — não monetiza diretamente)
│
├── Papers publicados
├── Mila Fellowship
├── Convites para conferências
└── Citações
```

---

## 8. Métricas Semanais (Acompanhamento)

| Métrica | Semana 1 | Semana 2 | Semana 3 | Semana 4 |
|---------|----------|----------|----------|----------|
| Posts LinkedIn | 7 | 7 | 7 | 6 |
| Commits GitHub | 7 | 7 | 7 | 6 |
| Módulos escritos | 3 | 4 | 3 | 3 |
| Cartografias | 1 (C0) | 1 (C3) | 1 (C6) | 1 (C7) |
| Produtos lançados | 0 | 1 (calc) | 2 (guia+pack) | 2 (editions) |
| Receita | R$0 | R$0 | R$47-500 | R$100-1000 |
| Stars GitHub | 50 | 200 | 500 | 1000 |
| Seguidores LinkedIn +N | 100 | 300 | 500 | 800 |

---

## 9. Checklist Dia 1 (Hoje/Amanhã)

- [ ] Criar repo `anatomia-agente-ia` no GitHub
- [ ] Escrever README.md com manifesto do projeto
- [ ] Criar estrutura de diretórios (nucleo/, analise/, cartografias/, diario/)
- [ ] Escrever diario/2026-04-04.md (primeiro entry)
- [ ] Adaptar a Cartografia C0 com dados do protótipo atual → commit
- [ ] Publicar primeiro post LinkedIn
- [ ] Começar rascunho de N01-o-leak.md
- [ ] Criar issue tracker com milestones das 4 semanas
