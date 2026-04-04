> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 12: Biblioteca de Componentes e Design System

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Navegar o diretório `src/components/` e saber qual subdiretório possui cada categoria de preocupação de UI
* Identificar os quatro primitivos centrais do design system — Dialog, Tabs, FuzzyPicker, ThemedBox — e descrever o que cada um é responsável
* Traçar como `AssistantMessage`, `ToolUseMessage` e `ToolResultMessage` são renderizados
* Entender como o sistema de tema do Claude Code degrada graciosamente em terminais com capacidade de cor variável
* Percorrer a arquitetura interna do FuzzyPicker em profundidade suficiente para modificá-lo ou estendê-lo

---

## 12.1 Organização de Diretórios

`src/components/` é o lar de todos os componentes de UI, contendo aproximadamente 389 arquivos. É organizado por responsabilidade:

**`messages/`**: componente de renderização dedicado para cada tipo de mensagem que pode aparecer no histórico de conversa.

**`permissions/`**: diálogos que bloqueiam a execução quando uma ferramenta requer aprovação do usuário.

**`design-system/`**: primitivos de UI de baixo nível não específicos a nenhuma feature. Estes são os blocos de construção que componentes em todo o resto de `src/components/` compõem.

**`agents/`**: componentes para visualizar fluxos de trabalho multi-agente.

**`mcp/`**: componentes para exibir status de servidor MCP e registros de ferramentas.

**`PromptInput/`**: o componente de input do usuário coberto no Capítulo 11.

O princípio central: **`design-system/` não tem imports de nenhum diretório irmão**. Tudo pode importar de `design-system/`, mas `design-system/` não pode importar deles. Isso previne dependências circulares e mantém as primitivas genuinamente reutilizáveis.

---

## 12.2 Primitivos do Design System

### 12.2.1 Dialog

`src/components/design-system/Dialog.tsx`

Um "modal" em um terminal é um desafio conceitual — não há eixo Z para flutuar uma camada acima do conteúdo existente. A solução do Dialog é simular o efeito visual de um modal desenhando um Box com borda sobre o conteúdo. Expõe três slots composicionais: área de título no topo, área de conteúdo no meio e área de botões na parte inferior.

```typescript
type DialogProps = {
  title: string
  children: React.ReactNode      // slot de conteúdo
  buttons?: React.ReactNode      // slot de área de ação inferior
}
```

A borda é implementada com `<Box borderStyle="round">` do Ink. Cantos "round" dão uma aparência ligeiramente mais suave do que a arte ASCII de canto reto — uma escolha estética deliberada, pois diálogos de permissão já são interruptivos.

### 12.2.2 Tabs

`src/components/design-system/Tabs.tsx`

Tabs implementam alternância de abas horizontais para views com múltiplas seções nomeadas. A aba ativa é realçada com sublinhado ou vídeo reverso dependendo do suporte do terminal. Navegação por teclado usa teclas Left e Right (`←` / `→`).

```typescript
type TabsProps = {
  tabs: string[]
  activeIndex: number
  onTabChange: (index: number) => void
}
```

Tabs não renderiza conteúdo de aba — apenas a barra de abas. O componente pai é responsável por renderizar condicionalmente o conteúdo certo baseado em `activeIndex`.

### 12.2.3 FuzzyPicker

`src/components/design-system/FuzzyPicker.tsx`

FuzzyPicker é o primitivo mais arquiteturalmente interessante e mais amplamente reutilizado. Alimenta completion de comandos, seleção de arquivo, e qualquer outro contexto onde o usuário precisa escolher de uma lista longa digitando uma string parcial. Coberto em detalhes na Seção 12.5.

### 12.2.4 ThemedBox

`src/components/design-system/ThemedBox.tsx`

ThemedBox é um wrapper fino ao redor do `<Box>` do Ink que adiciona consciência de tema. Componentes que precisam de cor de fundo ou cor de borda usam ThemedBox e recebem os valores corretos para a capacidade de cor do terminal atual automaticamente.

```typescript
type ThemedBoxProps = {
  variant: 'default' | 'info' | 'warning' | 'error' | 'success'
  children: React.ReactNode
}
```

O prop `variant` seleciona um papel de cor nomeado do tema ativo em vez de uma string de cor bruta — "error" mapeia para vermelho em qualquer tema, mas o valor hex exato, código ANSI ou índice de 256 cores depende do suporte do terminal.

---

## 12.3 Sistema de Renderização de Mensagens

### 12.3.1 AssistantMessage

`src/components/messages/AssistantMessage.tsx`

Renderiza respostas de texto do modelo com suporte a Markdown em quatro elementos estruturais:

**Títulos** (`#`, `##`, etc.) são renderizados com negrito e foreground levemente mais brilhante. Hierarquia é expressa por indentação já que não há diferença de tamanho de fonte em terminais.

**Texto em negrito e itálico** (`**negrito**`, `_itálico_`) usam atributos ANSI correspondentes. Itálico faz fallback gracioso quando não suportado — renderiza com foreground mais dim.

**Blocos de código** (regiões com triple-backtick) recebem mais atenção: realce de sintaxe com cores chalk e números de linha à esquerda.

**Renderização em streaming**: como o modelo transmite tokens, AssistantMessage re-renderiza com cada novo caractere. Como o reconciliador do Ink faz renderização diferencial, esse padrão de append-only custa aproximadamente um repaint de linha por token — não um repaint de tela completa.

Respostas muito longas são truncadas com um toggle `[expandir]`. Isso mantém o terminal de ser sobrecarregado por dumps de código de mil linhas que o usuário já passou.

### 12.3.2 ToolUseMessage

`src/components/messages/ToolUseMessage.tsx`

Renderizado antes da ferramenta realmente executar. A renderização não é uniforme entre ferramentas:

**BashTool**: string de comando renderizada em box de fundo escuro com realce de sintaxe, similar a um bloco de código. Comandos com operações potencialmente destrutivas (`rm -rf`, `git reset --hard`, `DROP TABLE`) são sinalizados com cor de aviso.

**FileReadTool**: exibe caminho de arquivo e intervalo de linha de forma minimalista — uma leitura é a ação menos destrutiva.

**FileEditTool**: exibe o diff que está prestes a ser aplicado — linhas removidas em vermelho com prefixo `-`, linhas adicionadas em verde com prefixo `+`.

**AgentTool**: exibe mensagem como "Lançando sub-agente..." com a descrição da tarefa abaixo.

### 12.3.3 ToolResultMessage

`src/components/messages/ToolResultMessage.tsx`

**Resultados bem-sucedidos**: ThemedBox com `variant: 'success'` (borda verde). Resultados muito longos são truncados com toggle `[mostrar saída completa]`.

**Resultados com falha**: `variant: 'error'` (borda vermelha). Mensagens de erro são mostradas na íntegra sem truncamento — uma mensagem de erro truncada que corta a parte relevante de um stack trace seria pior que inútil.

**Resultados de imagem**: representação ASCII art de baixa resolução quando FileReadTool lê um arquivo de imagem. O fallback para ASCII significa que o componente nunca precisa assumir suporte a sixel ou protocolo kitty.

---

## 12.4 Sistema de Tema

Projetado em torno de uma única restrição: a aplicação deve parecer correta em qualquer terminal, desde terminais modernos Truecolor até sessões SSH legadas de 16 cores.

### 12.4.1 Detecção de Cor do Terminal

Produz um de quatro níveis:

1. **Truecolor (RGB 24-bit)**: cores RGB arbitrárias. Terminais modernos (iTerm2, Windows Terminal, maioria dos emuladores Linux).
2. **256 cores**: paleta de 256 cores. Cores são aproximadas selecionando a entrada mais próxima na tabela.
3. **16 cores ANSI**: apenas as oito cores padrão e suas variantes brilhantes. Mapeamentos semânticos: "success" → verde ANSI, "error" → vermelho ANSI, "info" → ciano ANSI.
4. **Sem cor (texto simples)**: `NO_COLOR=1` ou terminal sem suporte. Todos os códigos de cor são suprimidos.

O Claude Code também detecta se o fundo do terminal é claro ou escuro e ajusta as cores de foreground automaticamente.

### 12.4.2 O Hook `useTheme()`

Componentes acessam cores através de nomes semânticos, não strings de cor bruta:

```typescript
const theme = useTheme()

<Text color={theme.colors.success}>Operação concluída.</Text>
<Text color={theme.colors.errorForeground}>Permissão negada.</Text>
<Box borderColor={theme.colors.border}>{children}</Box>
```

O hook lê de um contexto React populado uma vez na inicialização pela lógica de detecção de cor. Regra: qualquer referência de cor em um componente deve passar por `useTheme()`. Strings de cor hardcoded são bugs esperando acontecer.

---

## 12.5 Walkthroughs de Componentes Representativos

### 12.5.1 FuzzyPicker: Mergulho Profundo na Arquitetura

FuzzyPicker é genérico sobre seu tipo de item, delega toda renderização de itens individuais a um callback e possui apenas a lógica de filtragem e navegação.

**Interface de props**:

```typescript
type FuzzyPickerProps<T> = {
  items: T[]
  renderItem: (item: T, isSelected: boolean) => React.ReactNode
  onSelect: (item: T) => void
  onCancel?: () => void
  placeholder?: string
  initialFilterText?: string
  getItemText: (item: T) => string   // usado para correspondência fuzzy
}
```

**Estado interno**:

```typescript
const [filterText, setFilterText] = React.useState(initialFilterText ?? '')
const [selectedIndex, setSelectedIndex] = React.useState(0)
```

`filterText` alimenta diretamente na chamada de correspondência fuzzy a cada render — sem debounce, pois a lista é tipicamente curta o suficiente para que a re-filtragem em cada toque de tecla seja imperceptível.

**Matching fuzzy** usa fuse.js (ou equivalente) que retorna índices de correspondência — posições dentro de cada string de item onde os caracteres da query corresponderam. FuzzyPicker usa esses índices para renderizar caracteres correspondentes em uma cor realçada.

**Tratamento de teclado**:

```typescript
useInput((input, key) => {
  if (key.upArrow) {
    setSelectedIndex(i => Math.max(0, i - 1))
    return
  }
  if (key.downArrow) {
    setSelectedIndex(i => Math.min(filteredItems.length - 1, i + 1))
    return
  }
  if (key.return) {
    if (filteredItems[selectedIndex]) onSelect(filteredItems[selectedIndex].item)
    return
  }
  if (key.escape) { onCancel?.(); return }
  if (key.backspace || key.delete) {
    setFilterText(t => t.slice(0, -1))
    return
  }
  if (input && !key.ctrl && !key.meta) {
    setFilterText(t => t + input)
  }
})
```

**Renderização de lista virtual**:

```typescript
const VISIBLE_ROWS = 10
const windowStart = Math.max(0, selectedIndex - Math.floor(VISIBLE_ROWS / 2))
const windowEnd = Math.min(filteredItems.length, windowStart + VISIBLE_ROWS)
const visibleItems = filteredItems.slice(windowStart, windowEnd)
```

O item selecionado é sempre mantido no centro da janela visível quando possível — a lista rola conforme o usuário navega em vez de pular para uma nova página.

### 12.5.2 Diálogo de Permissão: Especialização da BashTool

A estrutura geral compartilhada por todos os diálogos de permissão usa Dialog do design system: barra de título, área de detalhes e linha de botões com "permitir uma vez", "sempre permitir" e "negar". Atalhos de teclado consistentes: `y`, `a`, `n`.

O diálogo de permissão da BashTool mostra a string completa de comando com realce de sintaxe — não truncada. O check `detectsSandboxEscape` inspeciona a string de comando para padrões que indicam que o comando operará fora do diretório de trabalho atual. O aviso é informativo, não bloqueante.

O diálogo de permissão da FileEditTool substitui a exibição de comando por um diff renderizado — o mesmo componente de diff compartilhado com ToolUseMessage.

### 12.5.3 Streaming de AssistantMessage: O Loop de Render

Quando o modelo começa a transmitir uma resposta, o loop agêntico atualiza a store de mensagens com cada novo token. A atualização da store faz o React agendar um re-render do AssistantMessage. O reconciliador do Ink executa o re-render e então roda sua passagem de saída diferencial.

A consequência: transmitir uma resposta longa não fica mais lento conforme a resposta cresce. Se a resposta já preencheu 300 linhas e o cursor está na linha 301, o renderer diferencial toca apenas a linha 301 por novo token. Esse comportamento de render em streaming no AssistantMessage depende diretamente da renderização diferencial do fork — que a biblioteca Ink upstream não implementa.

---

## 12.6 Adicionando um Novo Componente: Orientação Prática

Regras práticas:

**Comece de ThemedBox e Dialog** em vez de `<Box>` bruto do Ink. ThemedBox garante que o comportamento de degradação de cor seja herdado automaticamente.

**Roteie todas as referências de cor por `useTheme()`**. Escrever `color="red"` diretamente em JSX é um bug esperando acontecer.

**Para qualquer lista picker, use FuzzyPicker** com callback `renderItem` customizado em vez de escrever um novo componente de navegação de lista.

**Para novos diálogos de permissão**, componha a partir da estrutura Dialog existente e do componente `PermissionButtons` compartilhado. Reutilize os atalhos `y`/`a`/`n` para que todos os diálogos se comportem de forma idêntica.

---

## Principais Conclusões

`src/components/` é organizado por responsabilidade, não por feature. `design-system/` é a fundação isolada; `messages/` e `permissions/` constroem sobre ela. A isolação é imposta pela regra de que `design-system/` não tem imports de diretórios irmãos.

Os quatro primitivos do design system — Dialog, Tabs, FuzzyPicker, ThemedBox — cobrem as necessidades estruturais de quase todo componente no codebase.

Os componentes de renderização de mensagens (AssistantMessage, ToolUseMessage, ToolResultMessage) não são intercambiáveis. Cada um tem lógica de renderização adaptada ao seu tipo de conteúdo.

Diálogos de permissão compartilham um shell estrutural (Dialog + PermissionButtons + atalhos de teclado consistentes) mas têm áreas de detalhes especializadas por ferramenta.

O sistema de tema é uma hierarquia de degradação, não uma paleta fixa. Componentes acessam cores por nomes semânticos de `useTheme()`; o tema resolve esses nomes para a melhor representação de cor que o terminal atual suporta.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 13 examina a camada de hooks — os hooks React customizados que formam a ponte entre a lógica de negócio e a UI do REPL.*
