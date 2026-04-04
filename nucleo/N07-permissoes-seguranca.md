> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 07: O Modelo de Permissão e Segurança

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Nomear e distinguir todos os sete valores de `PermissionMode`, incluindo os dois modos apenas internos que nunca aparecem em arquivos de configuração
* Explicar o modelo de três estados `PermissionBehavior` (`allow`, `deny`, `ask`) e articular exatamente quando cada estado é produzido
* Ler um valor `PermissionDecisionReason` e reconstruir o caminho de decisão que o produziu, usando-o como trilha de auditoria
* Traçar qualquer chamada de ferramenta pelo motor de decisão de onze etapas `hasPermissionsToUseToolInner()`, prevendo a saída em cada etapa
* Entender o wrapper externo `hasPermissionsToUseTool()` e explicar como o modo `dontAsk` e o modo `auto` transformam um resultado `ask` em outra coisa
* Seguir os quatro caminhos dentro do hook React `useCanUseTool()` que lidam com o estado `ask` retornado pelo wrapper externo
* Escrever regras `settings.json` usando as três sintaxes de regra — exata, prefixo e wildcard — e prever corretamente sua precedência

---

## 7.1 Modos de Permissão: Os Sete Valores de PermissionMode

O Claude Code roda em um de vários modos de permissão. O modo controla a disposição padrão de todo o sistema de permissão: o quão agressivamente o agente assume que pode agir e quanta confirmação do usuário é necessária.

Cinco modos são "externos" — podem aparecer em arquivos de configuração, flags CLI ou ser definidos por política enterprise:

| Modo | Descrição | Ativação Típica |
| --- | --- | --- |
| `default` | Modo interativo padrão. O sistema pergunta ao usuário antes de qualquer chamada de ferramenta que não tem regra de permissão explícita. | Padrão quando nenhuma flag está definida |
| `acceptEdits` | Edições de arquivo (escritas, patches) são aceitas automaticamente sem confirmação. Comandos Bash e outras ferramentas com efeitos colaterais ainda requerem aprovação do usuário. | Flag CLI `--accept-edits` |
| `bypassPermissions` | Todas as verificações de permissão são puladas. Toda chamada de ferramenta é permitida incondicionalmente. Modo "perigoso" referenciado pela flag `--dangerously-skip-permissions`. | `--dangerously-skip-permissions` |
| `dontAsk` | Quando o motor de decisão normalmente retornaria `ask`, o modo `dontAsk` converte silenciosamente esse resultado para `deny`. Nenhum diálogo é mostrado. | Cenários programáticos/headless |
| `plan` | Modo read-only. Ferramentas de escrita, Bash e outras ferramentas destrutivas são desabilitadas. O agente pode inspecionar o codebase e formular um plano, mas não pode executá-lo. | Flag CLI `--plan` |

Dois modos adicionais são modos de runtime internos nunca diretamente definidos em configuração:

| Modo | Descrição | Como Surge |
| --- | --- | --- |
| `auto` | O classificador de IA (o "YoloClassifier") substitui o diálogo interativo. Ativado pela feature flag `TRANSCRIPT_CLASSIFIER`. | Feature-flagged, definido em runtime |
| `bubble` | Usado quando um sub-agente precisa elevar uma decisão de permissão para seu coordinator pai. O sub-agente não decide sozinho; encaminha a questão para cima. | Topologia coordinator/worker multi-agente |

---

## 7.2 Comportamento de Três Estados: allow, deny, ask

Toda decisão de permissão no codebase resolve para exatamente um de três estados:

```typescript
export type PermissionBehavior = 'allow' | 'deny' | 'ask'
```

`allow` significa que a chamada de ferramenta prossegue imediatamente sem interação do usuário. De uma perspectiva do usuário, uma decisão `allow` é invisível.

`deny` significa que a chamada de ferramenta é rejeitada. O loop gera uma mensagem sintética de resultado de ferramenta explicando que a permissão foi negada. O resultado `deny` carrega uma string `message` e um `decisionReason` — juntos formam o registro de auditoria de por que a chamada foi bloqueada. O loop agêntico registra chamadas negadas no campo `permissionDenials` do estado de sessão.

`ask` significa que nenhum lado tem autoridade para decidir sozinho. No modo interativo, `ask` aciona a exibição de um diálogo de permissão na UI do terminal. No modo headless, `ask` é transformado em `deny` (pelo modo `dontAsk` ou pelo flag `shouldAvoidPermissionPrompts`), porque não há humano para responder ao diálogo.

---

## 7.3 A Trilha de Auditoria: PermissionDecisionReason

Toda `PermissionDecision` carrega um campo `decisionReason` do tipo `PermissionDecisionReason`. Essa union com onze variantes age como um log de auditoria estruturado:

| Variante `type` | Condição de Trigger | Exemplo Concreto |
| --- | --- | --- |
| `rule` | Uma regra de permissão correspondeu à chamada de ferramenta. | O usuário tem `"deny": ["Bash(rm -rf *)"]` — um comando de delete corresponde e é negado. |
| `mode` | O `PermissionMode` atual determinou o resultado diretamente, sem correspondência de regra. | Modo `bypassPermissions` produz `allow` com essa razão; modo `dontAsk` produz `deny`. |
| `subcommandResults` | O BashTool decompôs um comando composto em sub-comandos. O mapa `reasons` é indexado por string de sub-comando. | `git add . && npm publish` é dividido; `git add .` é permitido mas `npm publish` é negado. |
| `permissionPromptTool` | Um `PermissionPromptTool` externo (delegado de permissão baseado em MCP) retornou uma decisão. | Um servidor de auditoria enterprise registrado como PermissionPromptTool rejeita uma leitura sensível. |
| `hook` | Um script de hook `PermissionRequest` determinou o resultado. | Um script de hook verifica um sistema de tickets e nega uma escrita de arquivo porque não há ticket aberto. |
| `asyncAgent` | A sessão está rodando como agente headless e o motor de decisão chegou a `ask` sem resolução automatizada. A chamada é auto-negada. | Uma chamada QueryEngine programática sem hooks de permissão chega a uma chamada de ferramenta que normalmente mostraria um diálogo. |
| `sandboxOverride` | A camada de sandbox interveio. A razão é `'excludedCommand'` ou `'dangerouslyDisableSandbox'`. | O sandbox lista `sudo` como comando excluído; qualquer chamada Bash com prefixo `sudo` é negada. |
| `classifier` | O classificador de IA fez a decisão. O nome do classificador e uma razão legível são incluídos. | No modo `auto`, o classificador de transcrição aprova um comando `git commit -m "fix typo"`. |
| `workingDir` | Há um problema com o contexto do diretório de trabalho. | Um `FileRead` para `/etc/passwd` é negado porque está fora do projeto raiz. |
| `safetyCheck` | O caminho ou comando toca um local protegido: `.git/`, `.claude/`, ou arquivos de configuração de shell. `classifierApprovable` indica se o classificador pode substituir essa verificação. | Tentativa de sobrescrever `.git/config` é capturada e negada mesmo no modo `bypassPermissions`. |
| `other` | Catch-all para decisões que não se encaixam em nenhuma categoria estruturada. | Uma ferramenta implementa uma verificação de permissão interna sem melhor tipo para usar. |

A variante `safetyCheck` merece atenção especial. Quando `classifierApprovable` é `false`, a verificação de segurança é absoluta — não pode ser substituída pelo modo `bypassPermissions`, por regras ou pelo classificador. Este é o limite rígido do sistema protegendo a própria configuração do repositório.

---

## 7.4 O Motor de Decisão Central: `hasPermissionsToUseToolInner()`

O coração do sistema de permissão é `hasPermissionsToUseToolInner()` em `src/utils/permissions/permissions.ts`. É uma função `async` que aceita uma `Tool`, seu `input` e o `ToolUseContext` atual, e retorna `Promise<PermissionDecision>`.

A função roda exatamente onze etapas lógicas, em ordem. Cada etapa produz uma `PermissionDecision` final e retorna cedo, ou cai para a próxima etapa.

### Etapa 1: Gates de Regra e Segurança

**Etapa 0 (guard de abort):** Se o usuário cancelou a operação atual, lança um `AbortError` imediatamente.

**Etapa 1a — Regras de negação:** `getDenyRuleForTool()` busca qualquer regra em `alwaysDenyRules` cujo `toolName` e `ruleContent` opcional correspondam a esta ferramenta e input. Se uma regra de negação corresponder, execução para imediatamente com `behavior: 'deny'` e `decisionReason` do tipo `rule`. Regras de negação têm a maior prioridade de qualquer tipo de regra — não podem ser substituídas por regras de permissão ou por modo.

**Etapa 1b — Regra de ask para toda a ferramenta:** Verifica se há uma regra `alwaysAsk` para esta ferramenta (ex: `alwaysAsk: ["Bash"]`). Exceção: se o BashTool está rodando em ambiente sandbox que pode auto-permitir a chamada, a regra ask é contornada.

**Etapa 1c — `tool.checkPermissions()`:** Delega para lógica ciente do conteúdo implementada por ferramenta. Para `FileReadTool`, verifica se o caminho está dentro de um diretório de trabalho permitido. Para `BashTool`, roda a correspondência de regras shell, a verificação do classificador especulativo e a decomposição de subcomandos.

**Etapa 1d:** Retorna imediatamente se `tool.checkPermissions()` produziu `deny`. Uma ferramenta que nega no nível de conteúdo não pode ser substituída por regra de permissão ou modo.

**Etapa 1e:** Lida com ferramentas que têm `requiresUserInteraction()` retornando `true` e cuja verificação de conteúdo produziu `ask`.

**Etapas 1f e 1g — Saídas imunes a bypass:** 1f captura o caso onde `checkPermissions()` produziu `ask` com `decisionReason.rule.ruleBehavior === 'ask'` — uma regra ask específica de conteúdo correspondeu. 1g faz o mesmo para resultados `safetyCheck`. As proteções de diretório `.git/` e `.claude/` são limites rígidos que nem `--dangerously-skip-permissions` pode substituir.

### Etapa 2: Fast Paths de Modo e Regra de Permissão

**Etapa 2a — Modo `bypassPermissions`:** Se a sessão está em `bypassPermissions`, execução pula diretamente para `allow`. O `decisionReason` registra `type: 'mode'`.

**Etapa 2b — Regra de permissão para toda a ferramenta:** `toolAlwaysAllowedRule()` retorna a primeira regra correspondente em `alwaysAllowRules`. Se encontrada, o resultado é `allow` com `decisionReason.type === 'rule'`.

### Etapa 3: Padrão para ask

Se nenhuma das etapas anteriores retornou, a Etapa 3 é alcançada. Se o resultado é `passthrough` (a ferramenta diz "não tenho opinião específica de conteúdo; use o padrão"), a Etapa 3 o converte para `ask` com uma mensagem genérica de requisição de permissão. Se o resultado já é `ask`, é retornado como está.

---

## 7.5 O Wrapper Externo: `hasPermissionsToUseTool()`

`hasPermissionsToUseTool()` é o ponto de entrada público do sistema de permissão. Chama `hasPermissionsToUseToolInner()` e aplica duas transformações adicionais ao resultado se a função interna retornou `ask`.

### 7.5.1 Conversão do Modo dontAsk

```typescript
if (innerResult.behavior === 'ask' && mode === 'dontAsk') {
  return { behavior: 'deny', decisionReason: { type: 'mode', mode: 'dontAsk' }, message: ... }
}
```

Comportamento correto para cenários de automação onde você quer que o agente opere apenas dentro de seu conjunto de regras pré-aprovadas e rejeite silenciosamente qualquer coisa fora delas.

### 7.5.2 Modo auto e o YoloClassifier

Quando o modo é `auto`, o wrapper externo roda o pipeline do classificador de IA antes de decidir se mostra um diálogo ou nega. O pipeline tem quatro verificações ordenadas:

1. **Gate de safetyCheck não aprovável pelo classificador:** Se o resultado tem `decisionReason.type === 'safetyCheck'` e `classifierApprovable` é `false`, o classificador é completamente pulado.

2. **Fast path de acceptEdits:** Certas ferramentas suportam explicitamente o modo `acceptEdits`. Se o modo atual permitir, retorna `allow` imediatamente sem invocar o classificador.

3. **Rastreamento de negação:** O sistema mantém contagem de negações consecutivas produzidas pelo classificador. Se a contagem exceder o limiar `DENIAL_LIMITS`, o classificador é considerado não confiável para esse contexto e o wrapper cai de volta para o diálogo interativo.

4. **O YoloClassifier:** Avalia a transcrição da conversa e a chamada de ferramenta proposta, retornando:
   - `unavailable` com `iron_gate_closed: true` → `deny`
   - `unavailable` com `iron_gate_closed: false` → cai de volta para o diálogo
   - `transcriptTooLong` → no modo headless lança `AbortError`; no interativo cai para o diálogo
   - `shouldBlock: true` → `deny`, contador de negação incrementado
   - `shouldBlock: false` → `allow`, contador de negação zerado

---

## 7.6 O Hook React: `useCanUseTool()`

`useCanUseTool()` em `src/hooks/useCanUseTool.tsx` é a ponte entre o motor de decisão de permissão e a UI do terminal. É chamado após `hasPermissionsToUseTool()` ter retornado `ask` — as camadas automatizadas esgotaram suas opções.

O hook roteia o `ask` por um de quatro caminhos, verificados em ordem:

### Caminho A: Modo de Worker Coordinator

Quando `awaitAutomatedChecksBeforeDialog` é `true` em `ToolPermissionContext`, a sessão está rodando como worker coordinator. O hook chama `handleCoordinatorPermission()`, que roda os hooks `PermissionRequest` e o classificador em serial. Se algum produz `allow` ou `deny`, essa decisão é usada. Se ambos retornam sem resolução, a execução cai para o Caminho B.

### Caminho B: Encaminhamento de Worker Swarm

Se a sessão é um worker swarm (sub-agente em grupo de tarefas paralelas), o hook chama `handleSwarmWorkerPermission()`, que escreve uma mensagem para o mailbox do líder do swarm: "Preciso de uma decisão de permissão para esta chamada de ferramenta." O líder processa a requisição e escreve a decisão de volta.

### Caminho C: Classificador Especulativo (Corrida de 2 Segundos)

Aplica-se apenas a chamadas do `BashTool` quando a feature `BASH_CLASSIFIER` está habilitada. Quando o modelo começa a transmitir um comando Bash, o classificador é iniciado imediatamente em background — antes da verificação de permissão começar. O hook então faz uma corrida entre o resultado do classificador e um timeout de 2 segundos:

```typescript
const raceResult = await Promise.race([
  speculativePromise.then(r => ({ type: 'result', result: r })),
  new Promise(res => setTimeout(res, 2000, { type: 'timeout' })),
])
```

Se a corrida completa com `type: 'result'`, o hook verifica se o resultado do classificador corresponde ao comando E se a confiança é `'high'`. Ambas as condições devem valer. Se a corrida expira — o classificador levou mais de 2 segundos — a execução cai para o Caminho D.

### Caminho D: Diálogo Interativo

O caminho padrão. `handleInteractivePermission()` renderiza o diálogo do terminal usando Ink, apresentando ao usuário o nome da ferramenta, o comando ou caminho específico e botões para "Permitir uma vez", "Sempre permitir", "Negar uma vez" e "Sempre negar." Enquanto o diálogo está visível, hooks e o classificador continuam rodando em background.

---

## 7.7 Permissões Baseadas em Regras

### 7.7.1 Sintaxe de Regra (exata, prefixo, wildcard)

Todas as regras Bash são analisadas em `src/utils/permissions/shellRuleMatching.ts` em uma das três formas sintáticas:

```typescript
export type ShellPermissionRule =
  | { type: 'exact';    command: string  }   // "git status"
  | { type: 'prefix';   prefix: string   }   // "npm:*"  → prefixo "npm"
  | { type: 'wildcard'; pattern: string  }   // "git *"
```

**Regras exatas** correspondem apenas se a string de comando inteira é uma correspondência caractere por caractere. A string de regra `"Bash(git status)"` produz uma regra exata para `git status`.

**Regras de prefixo** usam a sintaxe legada `toolName:*`. A string de regra `"Bash(npm:*)"` produz uma regra de prefixo para `npm`. Corresponde a qualquer comando que começa com o prefixo seguido de espaço em branco.

**Regras wildcard** são as mais poderosas. A string de regra `"Bash(git *)"` produz uma regra wildcard com padrão `git *`. O token `*` corresponde a qualquer sequência de caracteres não-newline, permitindo regras expressivas como `"git commit -m *"`.

Para ferramentas não-Bash, a sintaxe é mais simples:
- `"FileRead"` — aplica-se à ferramenta `FileRead` inteira, todos os inputs
- `"mcp__server1"` — aplica-se a todas as ferramentas do servidor MCP `server1`
- `"mcp__server1__toolname"` — aplica-se a uma ferramenta MCP específica

### 7.7.2 Fontes de Regras e Precedência

Regras podem originar de oito fontes:

| Fonte | Localização | Notas |
| --- | --- | --- |
| `flagSettings` | Aplicado por Enterprise/MDM | Maior autoridade efetiva; não pode ser substituído |
| `policySettings` | Configuração de política | Camada de política organizacional |
| `cliArg` | Flags CLI passados na invocação | `--allow-tool Bash(git *)` |
| `userSettings` | `~/.claude/settings.json` | Settings globais por usuário |
| `projectSettings` | `.claude/settings.json` | Settings por projeto, versionado |
| `localSettings` | `.claude/settings.local.json` | Overrides locais por projeto, tipicamente gitignored |
| `command` | Adicionado em runtime durante a conversa | Via `addPermissionRule` durante uma sessão |
| `session` | Regras temporárias de escopo de sessão | Adicionadas via fluxo `grantTemporaryPermission` |

Ordem de precedência: **regras de negação sempre vencem sobre regras de permissão independentemente da ordem de fonte.** Dentro do mesmo tipo de comportamento, a primeira regra correspondente vence, e fontes são avaliadas na ordem listada acima (flag settings primeiro, session por último).

---

## 7.8 Permissões Baseadas em Hook: PermissionRequest

Além de regras declarativas, o Claude Code suporta lógica de permissão imperativa via hooks `PermissionRequest`. Um hook é um script externo que recebe um payload JSON descrevendo a chamada de ferramenta pendente e escreve uma decisão JSON para stdout.

Configuração em `settings.json` sob a chave `hooks`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/check-bash-policy",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

O hook recebe um payload contendo o nome da ferramenta, o input parseado, o diretório de trabalho atual e o ID de sessão. Deve sair com código 0 e escrever uma das respostas JSON:

```json
{ "decision": "allow", "reason": "Command is on the approved list" }
{ "decision": "deny", "reason": "Command modifies protected config files" }
{ "decision": "ask", "reason": "Ambiguous — escalate to user" }
```

Se o hook sai com código não-zero, expira ou escreve JSON inválido, o sistema de permissão trata o resultado como `ask` e cai para o próximo caminho. Falhas de hook não produzem negações automáticas — o design fail-open previne que um hook com bug bloqueie completamente o uso de ferramentas.

Hooks são poderosos para imposição de política organizacional: verificações de ticket-gate, limitação de taxa, ou consciência de ambiente ("este é um diretório de trabalho de produção?").

---

## 7.9 Guia de Configuração de settings.json

Exemplo completo e anotado de `settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log)",
      "Bash(git add *)",
      "Bash(git commit -m *)",
      "Bash(git push)",
      "Bash(npm:*)",
      "Bash(yarn:*)",
      "FileRead",
      "FileEdit",
      "mcp__filesystem"
    ],

    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo:*)",
      "Bash(curl * | bash)",
      "Bash(wget * | sh)",
      "mcp__network__httpRequest"
    ],

    "ask": [
      "Bash(git push --force*)",
      "Bash(git rebase*)",
      "Bash(npm publish*)",
      "Bash(docker run*)"
    ]
  }
}
```

A lista `deny` usa wildcards para bloquear padrões perigosos em vez de comandos exatos. Os padrões pipe-to-shell (`curl * | bash`) protegem contra um vetor de ataque comum à cadeia de suprimentos.

A lista `ask` é para operações de alto risco que ainda devem ser possíveis mas requerem confirmação a cada vez.

Para deployments enterprise, a mesma estrutura se aplica sob `flagSettings` e essas regras não podem ser substituídas por usuários:

```json
{
  "flagSettings": {
    "permissions": {
      "deny": [
        "Bash(curl*)",
        "Bash(wget*)",
        "mcp__externalApi"
      ]
    }
  }
}
```

Para habilitar modo `acceptEdits` (edições de arquivo sem confirmação mas Bash ainda confirmado):

```json
{ "permissionMode": "acceptEdits" }
```

---

## Principais Conclusões

O sistema de permissão no Claude Code é um pipeline de decisão multi-camada e ordenado. Cada camada tem uma responsabilidade específica e uma posição específica na ordem de avaliação.

O motor de decisão `hasPermissionsToUseToolInner()` roda onze etapas em sequência estrita. Regras de negação vêm primeiro e não podem ser substituídas. Verificações de segurança em caminhos `.git/` e `.claude/` vêm a seguir e são igualmente imunes a bypass. Apenas após todas as verificações de negação e segurança passarem é que a função verifica o modo `bypassPermissions` e as regras de permissão.

O union `PermissionDecisionReason` com onze variantes é um mecanismo de auditoria de primeira classe. O array `permissionDenials` surfaçado em `SDKResultMessage` expõe o histórico completo de negações para chamadores programáticos.

O hook `useCanUseTool()` lida com o estado `ask` através de uma cadeia de prioridade de quatro caminhos: delegação de coordinator, encaminhamento de swarm, classificador especulativo (com timeout estrito de 2 segundos) e finalmente o diálogo interativo.

A sintaxe de regra tem três formas — exata, prefixo e wildcard — e diferem em escopo e especificidade. Regras exatas são mais seguras para invocações conhecidamente seguras; regras de negação devem preferir wildcards para capturar variações de ortografia.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 08 examina o sistema de comandos — como slash commands são implementados, registrados e despachados.*
