const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 19: Configuração de Settings e o Sistema de Hooks

## O que você vai aprender

1. Descrever a hierarquia de configuração de seis camadas do Claude Code e a localização física de cada camada
2. Entender a estratégia de mesclagem de array \`settingsMergeCustomizer\` e por que difere fundamentalmente de um \`Object.assign\` simples
3. Explicar por que managed settings enterprise usam "primeiro a chegar vence" enquanto settings normais usam deep merge
4. Ler e entender os quatro tipos de comando de hook (command, prompt, agent, http)
5. Aplicar o protocolo de código de saída de hook: 0 significa sucesso, 2 bloqueia o modelo, outros valores apenas notificam o usuário
6. Escrever um hook \`PostToolUse\` completo que envia notificações após chamadas de ferramentas
7. Entender a estrutura de configuração de keybindings e suas 17 zonas de contexto de UI

---

## 19.1 A Estrutura de Configuração de Seis Camadas

A configuração do Claude Code não é um único arquivo — é o resultado de mesclar seis fontes em ordem de prioridade:

\`\`\`typescript
export const SETTING_SOURCES = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
] as const
\`\`\`

**Settings globais do usuário**: \`~/.claude/settings.json\` — onde vive a maioria da configuração pessoal.

**Settings do projeto**: \`.claude/settings.json\` relativo à raiz do projeto, commitado ao controle de versão e compartilhado com a equipe.

**Settings locais do projeto**: \`.claude/settings.local.json\` — adicionado automaticamente ao \`.gitignore\` pelo Claude Code, o lugar certo para overrides pessoais que não devem ser compartilhados.

**Settings de flag CLI**: especificados via \`--settings <path>\` ou injetados via SDK. Permitem que scripts de automação injetem configuração temporária sem tocar qualquer arquivo persistente.

**Managed settings enterprise** (policySettings) seguem regras diferentes de todos os outros. Em vez de participar do pipeline de deep merge, implementam estratégia "primeiro a chegar vence", com prioridade de maior para menor:

1. Remote managed settings (enviados via API Anthropic)
2. MDM de nível de sistema: domínio de preferência macOS \`com.anthropic.claudecode\` (admin apenas); chave de registro Windows \`HKLM\\SOFTWARE\\Policies\\ClaudeCode\` (admin apenas)
3. Baseado em arquivo: \`managed-settings.json\` mais diretório drop-in \`managed-settings.d/*.json\`
4. Registro gravável pelo usuário: Windows \`HKCU\\SOFTWARE\\Policies\\ClaudeCode\` (menor prioridade)

---

## 19.2 A Estratégia de Deep Merge

\`\`\`typescript
export function settingsMergeCustomizer(
  objValue: unknown,
  srcValue: unknown,
): unknown {
  if (Array.isArray(objValue) && Array.isArray(srcValue)) {
    return mergeArrays(objValue, srcValue)  // uniq([...target, ...source])
  }
  return undefined  // deixar lodash tratar mesclagem padrão para não-arrays
}
\`\`\`

O detalhe crítico: **arrays são mesclados e deduplicados, não substituídos**. Settings globais do usuário com \`allow: ["Read(~/projects/**)", "Bash(git status)"]\` e settings do projeto com \`allow: ["Write(./**)", "Bash(npm run *)"]\` produzem permissões efetivas: \`["Read(~/projects/**)", "Bash(git status)", "Write(./**)", "Bash(npm run *)"]\`.

Para campos escalares como \`model: "claude-opus-4-5"\`, a fonte de maior prioridade simplesmente substitui a de menor. O resultado: usuários nunca precisam se preocupar que uma configuração de projeto vai apagar suas regras de permissão globais pessoais, porque arrays de permissão sempre acumulam.

---

## 19.3 O SettingsSchema: Tour de Campos

**permissions**: Regras de permissão de uso de ferramentas (cross-referenciado com o Capítulo 7)

\`\`\`json
{
  "permissions": {
    "allow": ["Read(**)", "Bash(git *)"],
    "deny": ["Bash(rm -rf *)"],
    "ask": ["Write(**/*.prod.*)", "Bash(kubectl *)"],
    "defaultMode": "default"
  }
}
\`\`\`

**hooks**: Definições de hook (tema principal deste capítulo, coberto abaixo).

**model**: Substituir o modelo padrão.

**env**: Variáveis de ambiente injetadas em todos os subprocessos.

**disableAllHooks**: Kill switch de emergência para todos os hooks e scripts de linha de status.

**allowManagedHooksOnly**: Quando definido como \`true\` em managed settings, todos os hooks de usuário/projeto/local são silenciosamente ignorados; apenas hooks gerenciados por enterprise executam.

---

## 19.4 O Sistema de Hooks

Hooks permitem que você anexe lógica arbitrária ao ciclo de vida de cada chamada de ferramenta. O sistema de hooks é o mecanismo de extensibilidade mais poderoso do Claude Code.

### 19.4.1 O Modelo de Execução de Hook

Hooks são definidos em \`settings.json\` sob a chave \`hooks\`. Cada hook especifica: um evento de ciclo de vida (quando rodar), um matcher (quais ferramentas disparam o hook), e um ou mais comandos de hook (o que executar).

\`\`\`json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'Claude ran a bash command'",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
\`\`\`

### 19.4.2 Eventos de Ciclo de Vida de Hook

Há quatro pontos de gancho no ciclo de vida da ferramenta:

**PreToolUse**: Roda antes de uma ferramenta executar. Se o hook sai com código 2, a ferramenta é bloqueada. Se sai com qualquer outro código não-zero, o usuário é notificado mas a ferramenta ainda roda.

**PostToolUse**: Roda após uma ferramenta executar. Código de saída 2 não tem efeito especial pós-execução (a ferramenta já rodou). Útil para logging, notificações, ou atualização de sistemas externos.

**UserPromptSubmit**: Roda quando o usuário submete um prompt. Código de saída 2 cancela o prompt antes de ser enviado ao modelo.

**Notification**: Roda quando o Claude Code precisa notificar o usuário de algo (ex: aprovação de permissão necessária). Útil para integrações de notificação customizadas.

### 19.4.3 Os Quatro Tipos de Comando de Hook

**\`command\`**: Executa um comando shell. O hook recebe uma carga JSON via stdin descrevendo o evento de ciclo de vida. O stdout e stderr do hook são capturados.

\`\`\`json
{
  "type": "command",
  "command": "/opt/scripts/audit-tool-use.sh",
  "timeout": 10000
}
\`\`\`

**\`prompt\`**: Injeta um prompt adicional no contexto do modelo antes ou após a chamada de ferramenta. Útil para fornecer contexto adicional ou instruções baseadas no que acabou de acontecer.

\`\`\`json
{
  "type": "prompt",
  "prompt": "After running bash commands, always check if the exit code was 0."
}
\`\`\`

**\`agent\`**: Spawna um sub-agente separado para processar o evento. O sub-agente recebe os detalhes do evento e pode tomar suas próprias ações — útil para lógica de validação complexa.

\`\`\`json
{
  "type": "agent",
  "agent": "validation-agent",
  "model": "claude-haiku-4-5"
}
\`\`\`

**\`http\`**: Faz uma requisição HTTP POST para um endpoint. O body é o payload JSON do evento de ciclo de vida.

\`\`\`json
{
  "type": "http",
  "url": "https://audit.company.com/claude-events",
  "headers": { "Authorization": "Bearer \${AUDIT_TOKEN}" },
  "timeout": 5000
}
\`\`\`

### 19.4.4 O Protocolo de Código de Saída

Para hooks \`PreToolUse\` e \`UserPromptSubmit\`, o código de saída do hook tem comportamento especial:

- **Código 0**: Sucesso. O hook passou, a ferramenta ou prompt continua.
- **Código 2**: Bloquear. A ferramenta é cancelada (PreToolUse) ou o prompt é descartado (UserPromptSubmit). O modelo recebe uma mensagem de resultado de ferramenta indicando que a ação foi bloqueada pelo hook.
- **Qualquer outro código não-zero**: Avisar. O usuário é notificado do problema mas a ferramenta ou prompt ainda procede.

Para hooks \`PostToolUse\` e \`Notification\`, o código de saída apenas indica sucesso ou falha do hook em si — sem efeito no fluxo de execução principal.

### 19.4.5 Carga JSON do Hook

Quando um hook de comando é executado, recebe via stdin um objeto JSON descrevendo o contexto do evento. Para \`PreToolUse\` e \`PostToolUse\`:

\`\`\`json
{
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm run test"
  },
  "tool_result": {
    "output": "Tests passed: 42",
    "exit_code": 0
  },
  "timestamp": "2025-01-15T10:30:00Z",
  "working_directory": "/home/user/project"
}
\`\`\`

O campo \`tool_result\` está presente apenas em \`PostToolUse\`. A ausência de \`tool_result\` em \`PreToolUse\` é intencional — a ferramenta ainda não rodou.

### 19.4.6 Exemplo: Hook de Auditoria PostToolUse

Script de shell completo para logging de auditoria:

\`\`\`bash
#!/bin/bash
# Lê carga JSON do stdin
PAYLOAD=$(cat)

# Extrai campos
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name')
SESSION_ID=$(echo "$PAYLOAD" | jq -r '.session_id')
TIMESTAMP=$(echo "$PAYLOAD" | jq -r '.timestamp')

# Log para arquivo de auditoria
echo "[$TIMESTAMP] Session $SESSION_ID used tool: $TOOL_NAME" >> /var/log/claude-audit.log

# Envia para endpoint de auditoria (falha silenciosamente se endpoint indisponível)
echo "$PAYLOAD" | curl -s -X POST https://audit.company.com/events \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $AUDIT_TOKEN" \\
  -d @- || true

exit 0
\`\`\`

Configuração em \`settings.json\`:

\`\`\`json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/opt/scripts/audit-claude.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
\`\`\`

---

## 19.5 Correspondência de Hook

O campo \`matcher\` em cada entrada de hook determina para quais ferramentas o hook roda. Três formas de correspondência:

**Por nome de ferramenta**: \`"matcher": "Bash"\` — roda apenas para invocações do BashTool.

**Por coringa**: \`"matcher": "*"\` — roda para todas as ferramentas.

**Por ferramenta MCP**: \`"matcher": "mcp__serverName"\` — roda para todas as ferramentas do servidor MCP especificado.

Múltiplos hooks para o mesmo evento são executados em sequência. Se qualquer hook \`PreToolUse\` retornar código 2, a ferramenta é bloqueada imediatamente sem executar hooks subsequentes.

---

## 19.6 Configuração de Keybindings

O Claude Code suporta keybindings personalizáveis via \`settings.json\` sob a chave \`keybindings\`. As 17 zonas de contexto de UI incluem: \`global\` (ativo em qualquer lugar), \`promptInput\` (quando a caixa de input tem foco), \`messageList\` (quando rolando mensagens), \`permissionDialog\` (quando um diálogo de permissão está visível), e mais.

\`\`\`json
{
  "keybindings": {
    "global": {
      "ctrl+shift+c": "copy-last-response",
      "ctrl+shift+e": "expand-all-messages"
    },
    "promptInput": {
      "ctrl+enter": "submit",
      "shift+enter": "newline"
    },
    "permissionDialog": {
      "y": "allow-once",
      "a": "allow-always",
      "n": "deny"
    }
  }
}
\`\`\`

---

## Principais Conclusões

A hierarquia de configuração de seis camadas é o que permite que o Claude Code seja ao mesmo tempo personalizável por usuários individuais e governável por organizações enterprise — sem que uma camada interfira inadvertidamente com outra.

A estratégia de merge de array \`settingsMergeCustomizer\` — concatenar e deduplicar em vez de substituir — garante que regras de permissão de múltiplas camadas se acumulem em vez de se sobrescreverem.

Managed settings enterprise usam "primeiro a chegar vence" em vez de deep merge, garantindo que restrições de política não possam ser contornadas por overrides de nível mais baixo.

O sistema de hooks é o mecanismo de extensibilidade mais poderoso do Claude Code. O protocolo de código de saída — onde código 2 bloqueia em \`PreToolUse\` mas apenas avisa em \`PostToolUse\` — é a interface limpa que separa ação preventiva de logging pós-evento.

Os quatro tipos de comando de hook (command, prompt, agent, http) fornecem cobertura de caso de uso progressivamente mais poderosa: de simples scripts shell para agentes Claude completos coordenando validação complexa.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 20 examina os recursos periféricos e utilitários — as ferramentas e recursos de suporte que completam o sistema Claude Code.*
`;export{e as default};
