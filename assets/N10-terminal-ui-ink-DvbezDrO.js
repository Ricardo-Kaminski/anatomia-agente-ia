const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 10: Framework Customizado de UI de Terminal (Ink)

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Explicar por que o Claude Code mantém um fork completo do Ink em \`src/ink/\` em vez de depender do pacote npm upstream, e articular as preocupações específicas de produção que impulsionaram essa decisão
* Ler \`src/ink/reconciler.ts\` e entender como um reconciliador React customizado funciona: quais funções de host config são necessárias, o que um \`InkNode\` representa e como a fase de commit se conecta à saída do terminal
* Descrever o papel do Yoga WASM no layout do terminal e traçar um cálculo de layout desde os props brutos do componente até as coordenadas finais
* Seguir o pipeline completo de renderização desde a fase de commit React até a geração de sequência de escape ANSI e saída diferencial
* Descrever como \`src/ink/termio/\` lida com input bruto do terminal, incluindo o parsing de fluxo de bytes de sequências de escape ANSI multi-byte
* Explicar como o sistema de gerenciamento de foco do Ink roteia eventos de teclado para o componente correto
* Entender scrolling virtual, quebra de texto com consciência CJK e as primitivas de componente Box e Text

---

## 10.1 Por que Forkar o Ink?

O Ink, a biblioteca da Meta para construir UIs de terminal com React, é uma conquista real de engenharia. Trouxe o modelo de componente declarativo — que engenheiros frontend já conhecem — para um meio (o terminal) que sempre exigiu manipulação imperativa de cursor.

Mas o Claude Code não é um projeto de fim de semana. É um CLI de produção usado continuamente por engenheiros que o tratam como parte central de seu fluxo de trabalho. Esse contexto impõe requisitos que a biblioteca Ink upstream, projetada para ampla compatibilidade, não pode satisfazer sem modificação.

O fork vive em \`src/ink/\` — 85 arquivos implementando um renderizador React completo voltado para saída de terminal. O \`src/ink.ts\` raiz é apenas um barrel de re-exportação: coleta a API pública do fork e re-exporta para que o resto do codebase possa \`import { Box, Text, useInput } from '../ink.js'\` sem saber nada sobre a estrutura interna.

### 10.1.1 Performance sob Carga Contínua

O Ink upstream renderiza em um timer. Debounce mudanças de estado React e aciona um re-render completo em intervalo fixo. Para o Claude Code — que mantém uma lista de mensagens potencialmente grande, transmite tokens em tempo real, roda saída de ferramentas por realce de sintaxe e deve permanecer responsivo mesmo após horas de uso contínuo — uma estratégia de renderização baseada em timer cria latência observável.

O fork substitui o timer por um scheduler conduzido pelo próprio ciclo de vida do reconciliador React. Mais importante, o fork implementa **renderização diferencial**: em vez de repintar o terminal inteiro em cada atualização, computa quais linhas do terminal mudaram e escreve apenas aquelas. Em um terminal de 200 linhas exibindo uma conversa longa, isso reduz a saída por token de aproximadamente 200 reescritas de linha para tipicamente dois ou três.

### 10.1.2 Controle sobre o Pipeline de Renderização

O pipeline de renderização do Ink upstream é uma caixa preta. O Claude Code precisava interceptar a renderização em múltiplos pontos: aplicar temas de cores customizados, integrar streaming de tokens com estado React, implementar scrolling virtual para listas longas de mensagens e lidar com eventos de redimensionamento do terminal de formas que recomputam o layout. Nenhuma dessas mudanças necessárias poderia ser expressa como plugins ou opções de configuração do Ink.

### 10.1.3 Compatibilidade com Bun e WASM

O Claude Code roda no Bun, não no Node.js. O Ink upstream depende de \`yoga-layout-prebuilt\`, que vem com binários addon nativos compilados para versões específicas do Node.js — que falham ao carregar no Bun. O fork migra a dependência do Yoga para \`yoga-layout\` — o build WASM puro — que funciona corretamente sob qualquer runtime JavaScript que suporte WASM.

### 10.1.4 Requisitos de CLI de Produção

Três preocupações adicionais empurram o fork mais distante do upstream:

**Controle preciso sobre entrada/saída do modo raw.** Quando um subcomando spawna um processo filho que precisa interagir com o terminal (ex: um editor de texto aberto por \`$VISUAL\`), o loop de renderização deve se suspender completamente, restaurar o terminal ao modo normal, aguardar e retomar após a saída do subprocesso.

**Suporte a modo de paste com brackets.** Quando usuários colam grandes blocos de texto no REPL, sequências de paste com brackets (\`\\x1B[200~\` ... \`\\x1B[201~\`) envolvem o conteúdo colado. Sem lidar com isso, cada nova linha dentro do paste aciona um submit prematuro.

**Suporte mais completo a eventos de mouse.** O fork estende o suporte do upstream para lidar com distinção de botões, eventos de scroll e os vários protocolos estendidos de mouse que terminais modernos suportam.

---

## 10.2 Reconciliador React: \`src/ink/reconciler.ts\`

React é um motor de reconciliação, não de renderização. O trabalho do React é computar o conjunto mínimo de mudanças necessárias para levar um estado anterior ao estado desejado. O meio de saída real é responsabilidade de um "host renderer" que o React chama via interface bem definida.

\`ReactDOM\` é um host renderer. O renderer do React Native é outro. O \`src/ink/reconciler.ts\` do fork do Ink é um terceiro, voltado para saída de terminal.

### 10.2.1 O Pacote React Reconciler

React vem com seu reconciliador como pacote chamado \`react-reconciler\`. Quando você chama \`react-reconciler(hostConfig)\`, obtém de volta uma factory de renderer. O objeto \`hostConfig\` é onde você descreve as operações primitivas do seu ambiente host.

\`\`\`typescript
const reconciler = ReactReconciler(hostConfig)

export function createRenderer(container: InkContainer) {
  return reconciler.createContainer(container, 0, null, false, null, '', {}, null)
}

export function render(root: React.ReactElement, container: InkContainer) {
  reconciler.updateContainer(root, container, null, null)
}
\`\`\`

### 10.2.2 O Tipo \`InkNode\`

\`\`\`typescript
type InkNode = {
  nodeName: 'ink-box' | 'ink-text' | 'ink-virtual-text'
  style: Style
  textContent: string
  yogaNode: Yoga.Node | undefined  // undefined para nós de texto virtual
  parentNode: InkNode | InkContainer | null
  childNodes: Array<InkNode | InkTextNode>
  onRender?: () => void
}
\`\`\`

Um \`InkNode\` com \`nodeName: 'ink-box'\` é o equivalente terminal de um \`<div>\`. Um \`InkNode\` com \`nodeName: 'ink-text'\` é o equivalente terminal de um \`<span>\` estilizado. O campo \`yogaNode\` é a ponte entre a árvore do React e o motor de layout Yoga.

Nós de texto virtual (\`ink-virtual-text\`) são uma otimização — pulam a alocação do Yoga inteiramente e existem apenas para conter conteúdo que o estágio de renderização lerá das dimensões medidas da box pai.

### 10.2.3 Métodos do Host Config Necessários

**\`createInstance(type, props)\`**: Factory para novas instâncias de componentes host. Chamada quando o React precisa criar um novo nó host. Aloca um \`Yoga.Node\` para instâncias de box imediatamente.

**\`appendChild\`, \`insertBefore\`, \`removeChild\`**: Espelham os métodos de mutação do DOM. \`appendChild\` também chama \`yogaParent.insertChild(yogaChild, index)\` para manter a árvore Yoga sincronizada.

**\`prepareUpdate(instance, type, oldProps, newProps)\`**: Chamado durante a fase de renderização. Computa um objeto de props parcial contendo apenas as chaves que mudaram. Retornar \`null\` diz ao React que esta instância não precisa de atualização.

**\`commitUpdate(instance, updatePayload)\`**: Chamado na fase de commit. Aplica os props parciais ao \`InkNode\` e marca o nó Yoga como sujo.

**\`resetAfterCommit(container)\`**: Chamado após todas as mutações. É aqui que o passo de layout + renderização é acionado:

\`\`\`typescript
resetAfterCommit(container: InkContainer): void {
  computeLayout(container)           // 1. Calcular layout Yoga
  const output = renderToString(container)  // 2. Converter para strings ANSI
  container.onRender(output)         // 3. Emitir para terminal com atualização diferencial
}
\`\`\`

### 10.2.4 A Fase de Commit e Prioridades de Fiber

O React divide o trabalho de renderização em duas fases: a fase de render (pura, interruptível) e a fase de commit (síncrona, não pode ser interrompida). O fork aciona o layout Yoga exclusivamente em \`resetAfterCommit\`, garantindo que seja executado exatamente uma vez por atualização lógica.

---

## 10.3 Motor de Layout: Yoga WASM e o Modelo CSS Flexbox para Terminais

Yoga é o motor de layout da Meta. Implementa CSS Flexbox — a mesma especificação que os browsers usam — como uma biblioteca standalone. O Ink usa isso para responder a pergunta fundamental do layout de terminal: dado uma árvore de nós com estilos flex, quais são as coordenadas exatas (coluna, linha, largura, altura) de cada nó?

### 10.3.1 Ciclo de Vida do Nó Yoga

Cada \`InkNode\` com \`nodeName === 'ink-box'\` possui exatamente um \`Yoga.Node\`. Quando \`createInstance\` cria um novo nó de box, chama \`Yoga.Node.create()\` para alocar um nó de layout correspondente. Quando \`removeChild\` é chamado, o filho Yoga é removido de seu pai e então liberado via \`yogaChild.freeRecursive()\` — o gerenciamento de memória é explícito porque a memória WASM está fora do alcance do garbage collector do JavaScript.

### 10.3.2 Aplicando Estilos a Nós Yoga

A função \`applyProps\` traduz os props estilo React do Ink em chamadas de API Yoga:

\`\`\`typescript
function applyYogaProps(yogaNode: Yoga.Node, style: Style): void {
  if (style.flexDirection !== undefined) {
    yogaNode.setFlexDirection(
      style.flexDirection === 'row'
        ? Yoga.FLEX_DIRECTION_ROW
        : Yoga.FLEX_DIRECTION_COLUMN,
    )
  }
  if (style.width !== undefined) {
    if (typeof style.width === 'number') {
      yogaNode.setWidth(style.width)
    } else if (style.width.endsWith('%')) {
      yogaNode.setWidthPercent(parseFloat(style.width))
    }
  }
  if (style.gap !== undefined) {
    yogaNode.setGap(Yoga.GUTTER_ALL, style.gap)
  }
  // ... e assim por diante para todas as propriedades CSS Flexbox
}
\`\`\`

Todos os valores numéricos são interpretados como células de caractere — \`width: 10\` significa 10 colunas de largura. Larguras percentuais funcionam corretamente porque o Yoga as computa em relação à largura medida do pai.

### 10.3.3 O Cálculo de Layout

O layout roda uma vez por commit, em \`computeLayout\`:

\`\`\`typescript
function computeLayout(container: InkContainer): void {
  const rootYogaNode = container.yogaNode
  rootYogaNode.setWidth(process.stdout.columns)
  rootYogaNode.setHeight(Yoga.UNDEFINED)  // sem limites — conteúdo do terminal rola verticalmente

  rootYogaNode.calculateLayout(
    process.stdout.columns,
    Yoga.UNDEFINED,
    Yoga.DIRECTION_LTR,
  )
  // Após isso, cada nó tem dimensões computadas disponíveis:
  // yogaNode.getComputedLeft(), getComputedTop(), getComputedWidth(), getComputedHeight()
}
\`\`\`

O algoritmo de layout do Yoga é O(n) para a maioria das árvores — linear no número de nós. Para a lista de mensagens típica do Claude Code com dezenas de componentes, a passagem de layout leva bem menos de um milissegundo.

### 10.3.4 Restrições de Layout Específicas do Terminal

\`position: absolute\` não é suportado — todo posicionamento é baseado em fluxo. \`overflow: hidden\` tem significado específico do terminal — sinaliza que um nó deve recortar seu conteúdo à largura medida. \`display: flex\` é o padrão para todo nó — não há \`display: block\` ou \`display: inline\`.

---

## 10.4 O Pipeline de Renderização

O pipeline tem três estágios distintos:

### Estágio 1: Fase de Commit React

A fase de commit atualiza objetos \`InkNode\` in-place. Quando \`resetAfterCommit\` é chamado, a árvore InkNode reflete exatamente a árvore de elementos React que acabou de ser renderizada.

### Estágio 2: Cálculo de Layout

\`computeLayout\` define a largura do terminal, chama \`yogaNode.calculateLayout()\` e o módulo WASM Yoga preenche as dimensões computadas para cada nó.

### Estágio 3: Geração de Output

O Estágio 3 converte a árvore InkNode anotada em uma string de códigos de escape ANSI. O output é um buffer de caracteres bidimensional inicializado com espaços, com dimensões correspondendo à largura do terminal e à altura computada do nó raiz. A travessia então "pinta" o conteúdo de cada nó no buffer em sua posição computada.

### Renderização Diferencial

A renderização diferencial é a otimização que faz a UI de terminal do Claude Code parecer rápida. Compara o novo \`OutputBuffer\` com o anterior célula por célula e emite sequências ANSI apenas para as células que mudaram:

\`\`\`typescript
function diff(prev: OutputBuffer, next: OutputBuffer): Array<{ row: number; startCol: number; endCol: number }> {
  const changes = []
  for (let row = 0; row < next.height; row++) {
    let changeStart = -1, changeEnd = -1
    for (let col = 0; col < next.width; col++) {
      if (!cellsEqual(prev.getCell(row, col), next.getCell(row, col))) {
        if (changeStart === -1) changeStart = col
        changeEnd = col
      }
    }
    if (changeStart !== -1) changes.push({ row, startCol: changeStart, endCol: changeEnd })
  }
  return changes
}
\`\`\`

Para output de token em streaming, isso significa escrever um punhado de caracteres por token em vez de uma repintura completa da tela.

---

## 10.5 I/O de Terminal: \`src/ink/termio/\`

### Modo Raw

Em modo raw, cada pressionamento de tecla é entregue imediatamente como um ou mais bytes. O fork entra no modo raw durante a inicialização e explicitamente lida com Ctrl+C restaurando o terminal e saindo do processo.

### O Fluxo de Bytes de Input

Em modo raw, teclas especiais chegam como sequências de escape ANSI multi-byte. O parser usa uma heurística de tempo: se um byte \`\\x1B\` não é seguido por outro byte dentro de uma janela curta (tipicamente 50ms), é tratado como o pressionamento da tecla Escape. Se mais bytes seguem, são consumidos como parte de uma sequência de escape.

\`\`\`typescript
const SEQUENCES: Record<string, KeyEvent> = {
  '\\x1B[A':   { key: 'upArrow',   ctrl: false, meta: false, shift: false },
  '\\x1B[B':   { key: 'downArrow', ctrl: false, meta: false, shift: false },
  '\\x1B[C':   { key: 'rightArrow',ctrl: false, meta: false, shift: false },
  '\\x1B[D':   { key: 'leftArrow', ctrl: false, meta: false, shift: false },
  '\\x7F':     { key: 'backspace', ctrl: false, meta: false, shift: false },
  '\\r':       { key: 'return',    ctrl: false, meta: false, shift: false },
  '\\x1B[Z':   { key: 'tab',       ctrl: false, meta: false, shift: true }, // shift+tab
}
\`\`\`

### Modo de Paste com Brackets

O fork habilita o modo de paste com brackets na entrada e parseia as sequências delimitadoras para emitir um único \`PasteEvent\` com o conteúdo colado completo, em vez de despachar cada caractere ou linha separadamente.

### Eventos de Mouse

Mouse tracking é habilitado usando o protocolo SGR estendido (\`\\x1B[?1006h\`), que usa números decimais para codificar coordenadas — eliminando o limite de coordenada < 223 do protocolo clássico X10.

---

## 10.6 Gerenciamento de Foco, Scrolling Virtual e Quebra de Texto

### Gerenciamento de Foco

O focus é implementado como um registro global com mecanismo controlado de ciclagem Tab. Componentes que querem ser focalizáveis chamam \`useFocus()\`. O registro é mantido em \`FocusContext\`. Pressionamentos de Tab são interceptados no nível raiz pelo gerenciador de foco, que avança o \`activeId\` para o próximo focalizável registrado.

\`useInput()\` — usado por componentes focalizáveis para lidar com eventos de teclado — verifica automaticamente se o componente está focado antes de entregar eventos. O parser despacha todos os eventos de tecla para todos os assinantes; o hook \`useInput\` os filtra com base no estado de foco.

### Scrolling Virtual

A lista de mensagens do Claude Code cresce sem limite durante uma sessão longa. O scrolling virtual endereça isso renderizando apenas as mensagens que cabem na viewport atual.

O scrolling virtual mantém uma lista de alturas de itens acumuladas em um array de somas de prefixo para pesquisas de offset O(1). O scroller renderiza apenas os itens no \`[startIndex, endIndex]\` visível. O scroller sempre rola para o fundo em novas mensagens — implementado por um \`useEffect\` que roda após cada append à lista de mensagens.

### Quebra de Texto

O terminal não realiza quebra de texto automaticamente — o Ink deve lidar com isso explicitamente. A lógica de quebra vive em \`src/ink/text/wrapText.ts\`.

A função \`getCharWidth(char)\` é o hook de tratamento CJK. Caracteres em blocos Unicode como Ideógrafos Unificados CJK, Hangul e Latin de largura completa ocupam duas colunas. Uma implementação ingênua que trata cada caractere como uma coluna produzirá layout desalinhado com caracteres CJK presentes.

\`\`\`typescript
function getCharWidth(char: string): 1 | 2 {
  const cp = char.codePointAt(0)!
  if (cp >= 0x4E00 && cp <= 0x9FFF) return 2  // CJK Ideógrafos Unificados
  if (cp >= 0xAC00 && cp <= 0xD7A3) return 2  // Sílabas Hangul
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2  // Latin de largura completa
  return 1
}
\`\`\`

---

## 10.7 Primitivas de Componente: Box, Text e Além

### Box

\`Box\` é o container de layout fundamental. Mapeia para \`ink-box\` na árvore InkNode e sempre tem um \`Yoga.Node\` correspondente. Toda propriedade de layout é expressa através de \`Box\`.

\`\`\`tsx
<Box flexDirection="column" gap={1} paddingX={2} width="100%">
  <Box flexDirection="row" justifyContent="space-between">
    <Text bold>Session ID</Text>
    <Text color="gray">{sessionId}</Text>
  </Box>
  <Box borderStyle="single" padding={1}>
    {messages.map(msg => <MessageCard key={msg.id} message={msg} />)}
  </Box>
</Box>
\`\`\`

\`Box\` aceita um prop \`borderStyle\` que desenha caracteres de desenho de caixa ASCII ou Unicode ao redor do limite do nó. Estilos disponíveis: \`single\` (\`┌─┐│└─┘\`), \`double\` (\`╔═╗║╚═╝\`), \`round\` (\`╭─╮│╰─╯\`), \`bold\` (\`┏━┓┃┗━┛\`), \`classic\` (ASCII: \`+-+|+-+\`).

### Text

\`Text\` é a primitiva para exibir conteúdo de caractere estilizado. Não possui um \`Yoga.Node\` diretamente — seu tamanho é determinado pelo layout da Box pai.

\`\`\`tsx
<Text bold color="cyan">Título</Text>
<Text dimColor>Informação secundária</Text>
<Text color="#ff6b6b" underline>Mensagem de erro</Text>
<Text wrap="truncate">{longPath}</Text>
\`\`\`

O sistema de cores aceita cores nomeadas do conjunto padrão de 16 cores do terminal, nomes de cores de 8 bits e cores hex de 24 bits (\`#rrggbb\`). O estágio de renderização converte cada especificação de cor para a sequência de escape ANSI apropriada com base no nível de suporte de cores detectado do terminal.

---

## 10.8 Integração do Ciclo de Vida

### Inicialização do Framework

O framework é inicializado em \`src/replLauncher.tsx\` via a função \`renderAndRun\`:

1. Cria o container Ink
2. Entra no modo raw no stdin
3. Habilita o modo de paste com brackets
4. Habilita o rastreamento de mouse
5. Registra handlers de resize para o evento \`resize\` de \`process.stdout\`
6. Chama \`updateContainer\` para realizar o render React inicial

O handler de resize aciona um re-render completo (forçando o Yoga a recalcular o layout com a nova largura do terminal) e uma repintura completa da tela (limpando qualquer conteúdo obsoleto).

### Encerramento Limpo

A função de limpeza registra o cleanup em três lugares: como handler de sinal \`SIGTERM\`, \`SIGINT\` e via \`process.on('exit')\`. O cleanup realiza: sai do modo raw, desabilita o paste com brackets, desabilita o rastreamento de mouse, mostra o cursor e escreve uma nova linha final.

---

## Principais Conclusões

A decisão de forkar o Ink em vez de depender do pacote upstream foi impulsionada por quatro requisitos concretos de produção: renderização diferencial para streaming suave de tokens, compatibilidade Bun/WASM para layout Yoga, ciclo de vida de modo raw controlado e tratamento de paste com brackets.

O reconciliador React em \`src/ink/reconciler.ts\` é a fundação de todo o sistema. Implementa a interface de host config \`react-reconciler\`, traduzindo as operações da fase de commit do React em mutações em uma árvore de objetos \`InkNode\`.

O Yoga WASM fornece layout CSS Flexbox em contexto de terminal. As dimensões são em células de caractere; a largura do terminal é lida de \`process.stdout.columns\` em tempo de renderização; a altura é deixada sem limites.

O renderer diferencial é o que torna a UI eficiente. Mantendo um \`OutputBuffer\` do frame anterior e comparando-o célula a célula com o novo frame, o estágio de saída emite apenas as sequências ANSI necessárias para atualizar as células alteradas.

A camada termio lida com todas as complexidades do input bruto do terminal: a heurística de 50ms, o modo de paste com brackets e o protocolo de mouse estendido SGR.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 11 examina o próprio REPL — \`src/screens/REPL.tsx\` e sua árvore de componentes circundante — que é a camada de aplicação que consome este framework.*
`;export{e as default};
