# Spec: Site Vite — Anatomia de um Agente de IA
**Data:** 2026-04-04  
**Status:** Aprovado

---

## Visão Geral

Site completo de leitura para o projeto "Anatomia de um Agente de IA", hospedado no GitHub Pages. Experiência visual imersiva dark com hero split, leitura completa dos 20 capítulos com URLs próprias, e integração das cartografias React existentes.

---

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Build | Vite 5 |
| UI | React 18 |
| Roteamento | React Router 6 (`HashRouter` para GitHub Pages) |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` |
| Estilo | CSS Modules ou Tailwind (a definir na implementação) |
| Deploy | GitHub Actions → branch `gh-pages` |
| Base URL | `/anatomia-agente-ia/` |

> **HashRouter**: GitHub Pages não suporta reescrita de URLs server-side. HashRouter (`/#/nucleo/n01`) resolve deep links sem configuração adicional.

---

## Estrutura de Diretórios

```
site/
├── public/
│   └── favicon.ico
├── src/
│   ├── main.jsx              # Entry point
│   ├── App.jsx               # Router setup
│   ├── pages/
│   │   ├── Home.jsx          # Landing page
│   │   ├── Chapter.jsx       # Página genérica de capítulo (recebe slug)
│   │   └── Cartografia.jsx   # Wrapper para cartografias React
│   ├── components/
│   │   ├── Sidebar.jsx       # Navegação lateral fixa
│   │   ├── NavBar.jsx        # Barra de navegação top
│   │   ├── MarkdownRenderer.jsx  # react-markdown + estilos
│   │   └── PrevNext.jsx      # Botões anterior/próximo
│   ├── data/
│   │   └── chapters.js       # Índice de capítulos (slug, título, arquivo)
│   └── styles/
│       └── global.css        # CSS global + variáveis dark theme
├── index.html
├── vite.config.js
└── package.json
```

---

## Rotas

```
/                          → Home (landing)
/#/nucleo/n01-arquitetura  → Capítulo N01
/#/nucleo/n02-inicializacao
...
/#/nucleo/n20-perifericos
/#/cartografias/c0-visao-geral
/#/cartografias/c2-fluxo
/#/analise/a1-governanca   (placeholder, conteúdo vem depois)
```

Rotas geradas a partir do array em `src/data/chapters.js` — zero configuração manual por capítulo novo.

---

## Landing Page (`/`)

**Layout:** Grid 2 colunas, full-viewport height.

**Coluna esquerda — Manifesto:**
- Label: `ENGENHARIA REVERSA · PT-BR` (monospace, uppercase)
- Headline: *"O código-fonte do agente mais avançado do mundo dissecado em público."*
- Subtítulo: 2-3 frases contextualizando o leak e o projeto
- CTAs: `Começar pelo N01 →` (primário, roxo) + `Ver Cartografias` (secundário)
- Stats strip: 20 capítulos · 512K linhas · 7 cartografias · PT-BR

**Coluna direita — Índice:**
- Header: `NÚCLEO TÉCNICO — 20 CAPÍTULOS`
- Lista dos capítulos: N01 destacado (background), restantes neutros, todos clicáveis
- Teaser da Cartografia C0 com link

**Navbar:**
- Logo/título à esquerda
- Links: Núcleo · Análise · Cartografias · Edições
- CTA: `Ler agora` (botão roxo)

**Paleta:**
- Background: `#0d1117`
- Surface: `#161b22`
- Bordas: `#21262d`
- Texto principal: `#e6edf3`
- Texto secundário: `#8b949e`
- Accent: `#6366f1` / `#818cf8`

---

## Página de Capítulo (`/#/nucleo/:slug`)

**Layout:** Sidebar fixa (200px) + conteúdo central (flex-1).

**Sidebar:**
- Seção "Núcleo Técnico" com todos os 20 capítulos
- Capítulo atual destacado (background accent leve)
- Seção "Cartografias" com links C0, C2...
- Seção "Análise" (links, conteúdo progressivo)

**Conteúdo:**
- Breadcrumb: `N01 · PROJETO E ARQUITETURA`
- Título H1
- Markdown renderizado via `react-markdown`
- Syntax highlighting (código TypeScript/JS)
- Tabelas, blockquotes, listas — todos estilizados no tema dark
- PrevNext: botões anterior/próximo fixos no rodapé do conteúdo

**Importação de markdown:** `import content from '../../nucleo/N01-*.md?raw'` — Vite suporta `?raw` nativamente, retorna o arquivo como string.

---

## Cartografias (`/#/cartografias/:slug`)

Wrapper que importa e renderiza os componentes `.jsx` existentes em `cartografia/`. Sem reescrita — `c0-visao-geral.jsx` funciona diretamente.

---

## Deploy (GitHub Actions)

Workflow `.github/workflows/deploy.yml`:
1. Trigger: push na branch `main`
2. `npm ci` → `npm run build`
3. Deploy do `dist/` para branch `gh-pages` via `peaceiris/actions-gh-pages`

`vite.config.js`:
```js
export default {
  base: '/anatomia-agente-ia/',
}
```

---

## O que está fora do escopo

- SSR / geração estática (não necessário para GitHub Pages + HashRouter)
- Busca full-text (pode ser adicionada depois com Fuse.js)
- Modo claro (dark only por ora)
- Internacionalização ES (fase futura)
- Analytics (fase futura)
