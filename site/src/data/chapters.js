export const NUCLEO = [
  { code: 'N01', slug: 'n01-arquitetura',    title: 'Projeto e Arquitetura',        file: 'N01-projeto-e-arquitetura' },
  { code: 'N02', slug: 'n02-inicializacao',  title: 'Inicialização e Bootstrap',    file: 'N02-inicializacao-bootstrap' },
  { code: 'N03', slug: 'n03-tipos',          title: 'Sistema de Tipos',             file: 'N03-sistema-de-tipos' },
  { code: 'N04', slug: 'n04-estado',         title: 'Gerenciamento de Estado',      file: 'N04-gerenciamento-estado' },
  { code: 'N05', slug: 'n05-loop',           title: 'Loop do Agente',               file: 'N05-loop-agente' },
  { code: 'N06', slug: 'n06-ferramentas',    title: 'Sistema de Ferramentas',       file: 'N06-sistema-ferramentas' },
  { code: 'N07', slug: 'n07-permissoes',     title: 'Permissões e Segurança',       file: 'N07-permissoes-seguranca' },
  { code: 'N08', slug: 'n08-comandos',       title: 'Sistema de Comandos',          file: 'N08-sistema-comandos' },
  { code: 'N09', slug: 'n09-query-engine',   title: 'Query Engine e SDK',           file: 'N09-query-engine-sdk' },
  { code: 'N10', slug: 'n10-terminal-ui',    title: 'Terminal UI (Ink)',             file: 'N10-terminal-ui-ink' },
  { code: 'N11', slug: 'n11-repl',           title: 'REPL e Sessão',                file: 'N11-repl-sessao' },
  { code: 'N12', slug: 'n12-componentes',    title: 'Componentes e Design System',  file: 'N12-componentes-design' },
  { code: 'N13', slug: 'n13-hooks',          title: 'Hooks e Lógica',               file: 'N13-hooks-logica' },
  { code: 'N14', slug: 'n14-contexto',       title: 'Contexto e Prompts',           file: 'N14-contexto-prompts' },
  { code: 'N15', slug: 'n15-mcp',            title: 'MCP Protocol',                 file: 'N15-mcp-protocolo' },
  { code: 'N16', slug: 'n16-multi-agent',    title: 'Multi-Agent e Coordinator',    file: 'N16-multi-agent' },
  { code: 'N17', slug: 'n17-skills',         title: 'Skills e Plugins',             file: 'N17-skills-plugins' },
  { code: 'N18', slug: 'n18-servicos',       title: 'Serviços, API e LSP',          file: 'N18-servicos-api-lsp' },
  { code: 'N19', slug: 'n19-configuracao',   title: 'Configuração e Hooks',         file: 'N19-configuracao-hooks' },
  { code: 'N20', slug: 'n20-perifericos',    title: 'Periféricos e Utilitários',    file: 'N20-perifericos-utilitarios' },
]

export const CARTOGRAFIAS = [
  { code: 'C0', slug: 'c0-visao-geral',  title: 'Visão Orbital',         file: 'c0-visao-geral' },
]

// Flat list of all navigable chapters (for prev/next)
export const ALL_CHAPTERS = [...NUCLEO]
