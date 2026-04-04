> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 15: Integração do Protocolo MCP

## O que você vai aprender

Este capítulo disseca como o Claude Code se conecta a servidores externos MCP (Model Context Protocol). Ao final do capítulo você entenderá: o problema que o MCP resolve; o sistema de configuração de cinco escopos; os cinco tipos de transporte; como `connectToServer` estabelece uma conexão; o design do wrapper `MCPTool`; a convenção de nomenclatura `mcp__serverName__toolName`; o fluxo de autenticação OAuth; e a diferença entre MCP Resources e Tools.

---

## 15.1 O que é MCP e Por que Existe

Construir um assistente de codificação de IA confronta uma tensão fundamental: Claude precisa de acesso a uma ampla variedade de capacidades externas — consultar bancos de dados, chamar APIs REST, gerenciar repositórios Git, postar mensagens no Slack — mas hardcodar toda essa lógica no Claude Code não é realista nem sustentável.

A ideia central do MCP é **separar o provedor de capacidades (o servidor) do consumidor de capacidades (o cliente, ou seja, o Claude Code)** e conectar os dois com um protocolo padronizado. Servidores podem ser escritos por qualquer pessoa em qualquer linguagem; desde que sigam o protocolo, o Claude Code pode descobrir e usar as ferramentas, recursos e templates de prompt que expõem.

O protocolo é construído sobre JSON-RPC 2.0 e define três primitivos centrais:
- **Tools**: funções chamáveis com schemas de input estruturados e saídas estruturadas
- **Resources**: dados legíveis identificados por URI, análogo a um sistema de arquivos
- **Prompt templates**: fragmentos de prompt predefinidos que Claude pode reutilizar

Por que não adicionar mais ferramentas built-in? Ferramentas built-in como `BashTool` e `ReadTool` são determinadas em tempo de compilação. Ferramentas MCP são descobertas em runtime — usuários adicionam ou removem servidores em um arquivo de config, e o Claude Code ganha novas capacidades sem recompilação.

---

## 15.2 O Sistema de Configuração

### 15.2.1 Quatro Escopos

O Claude Code carrega configurações de servidores MCP de quatro fontes, implementadas em `src/services/mcp/config.ts`:

| Escopo | Local de Armazenamento | Notas |
| --- | --- | --- |
| plugin | Sistema de plugins | Servidores empacotados com plugins |
| user | `~/.claude.json` campo `mcpServers` | Configuração global do usuário |
| project | `.mcp.json` (buscado para cima do CWD) | Nível de projeto; pode ser commitado |
| local | Config local do projeto | Não commitado ao VCS |
| enterprise | `managed-mcp.json` gerenciado | Maior prioridade; se presente, assume controle exclusivo |

```typescript
const configs = Object.assign(
  {},
  dedupedPluginServers,
  userServers,
  approvedProjectServers,
  localServers,
)
```

Entradas mescladas mais tarde substituem as anteriores, então `local` vence sobre `user` para o mesmo nome de servidor. Modo enterprise: uma vez que `managed-mcp.json` é detectado, todos os outros escopos são ignorados inteiramente.

### 15.2.2 Formato de Configuração

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    },
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/api/v1",
      "headers": { "Authorization": "Bearer ${SLACK_BOT_TOKEN}" }
    },
    "filesystem": {
      "type": "sse",
      "url": "http://localhost:8080/sse"
    }
  }
}
```

A sintaxe `${GITHUB_TOKEN}` é expandida por `expandEnvVarsInString` no tempo de carregamento da config. Se uma variável não está definida, o carregador de config não aborta — registra o problema como erro de validação de nível `warning` e continua.

Os seis tipos de transporte: `stdio`, `sse`, `sse-ide`, `http`, `ws`, `sdk`. `sse-ide` e `ws-ide` são tipos internos para extensões de IDE e não podem ser usados em arquivos de config do usuário. `sdk` é um canal SDK V2 especial — chamadas de ferramentas roteiam de volta pelo SDK em vez de abrir uma conexão de rede real.

### 15.2.3 Controles de Política

Deployments enterprise podem configurar `allowedMcpServers` e `deniedMcpServers` com três modos de correspondência: por nome, por comando ou por URL (com suporte a wildcard). A lista de negação sempre tem precedência absoluta sobre a lista de permissão.

---

## 15.3 Implementações de Transporte

### 15.3.1 Transporte stdio

O tipo mais comum. O Claude Code spawna o servidor MCP como processo filho e troca mensagens JSON-RPC via stdin/stdout:

```typescript
transport = new StdioClientTransport({
  command: finalCommand,
  args: finalArgs,
  env: { ...subprocessEnv(), ...serverRef.env } as Record<string, string>,
  stderr: 'pipe', // previne que a saída de erro do servidor imprima na UI
})
```

`stderr: 'pipe'` é intencional: a saída de erro do processo filho é capturada em buffer na memória (limitado a 64 MB) e emitida como informação de diagnóstico em caso de falha de conexão. O cleanup de processo na saída segue estratégia de três passos escalando: SIGINT → SIGTERM → SIGKILL, com breves esperas entre cada passo.

### 15.3.2 Transporte SSE

Conexão HTTP persistente usando Server-Sent Events para push do servidor ao cliente. O stream SSE em si deve viver indefinidamente e não pode ter timeout; mas refresh de token OAuth e outras requisições POST precisam de proteção de timeout. O código lida com isso com duas implementações distintas de `fetch`:

```typescript
// Stream SSE de longa duração: SEM wrapper de timeout
transportOptions.eventSourceInit = {
  fetch: async (url, init) => {
    const tokens = await authProvider.tokens()
    if (tokens) authHeaders.Authorization = `Bearer ${tokens.access_token}`
    return fetch(url, { ...init, headers: { ...authHeaders } })
  },
}
// Chamadas de API regulares: COM wrapper de timeout de 60 segundos
fetch: wrapFetchWithTimeout(
  wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
),
```

### 15.3.3 Transporte HTTP Streamable

Introduzido na especificação MCP 2025-03-26. Cada requisição é um POST HTTP independente; a resposta pode ser JSON ou stream SSE. O cliente deve inspecionar o cabeçalho `Content-Type` da resposta para determinar qual formato usar.

### 15.3.4 Transporte WebSocket

Usado para conexões bidirecionais de baixa latência onde múltiplas mensagens podem ser trocadas rapidamente. A implementação suporta reconexão automática com backoff exponencial quando a conexão cai.

### 15.3.5 Transporte SDK

Canal especial para integração profunda com o SDK V2 da Anthropic. Diferente dos outros transportes, as chamadas de ferramentas não saem do processo — elas roteiam de volta pelo SDK local, permitindo que o servidor MCP acesse capacidades Claude diretamente.

---

## 15.4 Conectando a um Servidor: connectToServer

`connectToServer` em `src/services/mcp/client.ts` (a função mais longa do arquivo, em torno de 100 linhas) realiza cinco operações em sequência:

**1. Construção do transporte**: Seleciona e instancia o objeto de transporte correto baseado no `type` do servidor.

**2. Criação do cliente**: Instancia um `Client` do SDK MCP, passando o transporte e os metadados de capacidade do cliente.

**3. Handshake de conexão**: `client.connect(transport)` inicia o handshake JSON-RPC, que negocia versões de protocolo e troca listas de capacidades.

**4. Descoberta de capacidades**: Após a conexão, o código imediatamente chama `client.listTools()`, `client.listResources()` e `client.listPrompts()` para descobrir o que o servidor expõe.

**5. Configuração de heartbeat**: Para transporte SSE, um timer de heartbeat é iniciado. Se nenhuma mensagem chegar dentro de `HEARTBEAT_TIMEOUT_MS` (tipicamente 30 segundos), o cliente assume que a conexão caiu e inicia reconexão.

---

## 15.5 O Wrapper MCPTool

Ferramentas MCP devem funcionar como ferramentas built-in de primeira classe no sistema de ferramentas do Claude Code. O wrapper `MCPTool` em `src/tools/McpTool.ts` implementa a interface `Tool<Input, Output>` fazendo proxy de todas as chamadas para o servidor MCP remoto.

### 15.5.1 Convenção de Nomenclatura

Ferramentas MCP são nomeadas como `mcp__serverName__toolName`:

```typescript
export function getMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}
```

Essa convenção serve ao sistema de permissão: as regras de `settings.json` podem usar `mcp__github` para cobrir todas as ferramentas do servidor GitHub, ou `mcp__github__create_issue` para uma ferramenta específica.

### 15.5.2 Delegação de Chamadas

O método `call` do wrapper delega ao cliente MCP:

```typescript
async call(args, context) {
  const result = await mcpClient.callTool({
    name: toolDefinition.name,
    arguments: args,
  })
  return {
    data: result.content,
    mcpMeta: { _meta: result._meta, structuredContent: result.structuredContent },
  }
}
```

O `mcpMeta` em `ToolResult` (descrito no Capítulo 6) carrega metadados de protocolo MCP que SDK V2 precisa para processar saídas estruturadas.

### 15.5.3 Schema de Input de Ferramentas MCP

Diferente de ferramentas built-in que usam schemas Zod, ferramentas MCP fornecem JSON Schema diretamente no campo `inputJSONSchema`:

```typescript
// MCPTool usa inputJSONSchema em vez de inputSchema
readonly inputJSONSchema: ToolInputJSONSchema = toolDefinition.inputSchema
readonly inputSchema = undefined  // não usado para ferramentas MCP
```

A interface `Tool` suporta ambas as formas — o executor de ferramentas verifica `inputJSONSchema` primeiro e volta para `inputSchema` se ausente.

---

## 15.6 MCP Resources

Resources são dados legíveis identificados por URI, análogos a um sistema de arquivos. Diferente das ferramentas, eles não são chamáveis — são lidos via `client.readResource(uri)`.

O esquema URI é definido pelo servidor. Um servidor de sistema de arquivos pode usar `file:///path/to/file`; um servidor de banco de dados pode usar `db://table/row_id`; um servidor de API pode usar `https://api.example.com/resource/id`.

No Claude Code, resources são disponibilizados para o modelo de duas formas: como contexto no system prompt (quando o servidor registra recursos que devem ser sempre incluídos) e como resultado de ferramenta quando o modelo usa a ferramenta `mcp__serverName__readResource`.

---

## 15.7 Autenticação OAuth

Servidores MCP podem requerir autenticação OAuth. O Claude Code implementa o fluxo OAuth 2.0 Authorization Code com PKCE para servidores que anunciam suporte a OAuth em suas capacidades.

### 15.7.1 Detecção de Autenticação

O Claude Code verifica se um servidor requer auth antes de tentar conectar. Isso é feito com um cache de um bit por servidor — o `needsAuthCache` — que é populado na primeira tentativa de conexão e então reutilizado para evitar detecção redundante de auth.

### 15.7.2 O Fluxo OAuth

Quando a auth é necessária, o Claude Code:

1. Gera um par de chaves PKCE (code verifier e code challenge)
2. Abre o URL de autorização do servidor no browser padrão do sistema
3. Inicia um servidor HTTP local na porta 0 (porta atribuída pelo SO) para capturar o callback OAuth
4. Aguarda o callback, extrai o código de autorização
5. Troca o código por tokens de acesso e refresh via chamada POST
6. Armazena tokens no keychain do SO (macOS Keychain, Windows DPAPI, Linux Secret Service)

Tokens de acesso expirados são atualizados automaticamente usando o token de refresh. Se o refresh falhar, o fluxo completo de autorização é acionado novamente.

---

## Principais Conclusões

MCP resolve o problema de extensibilidade do Claude Code separando o provedor de capacidades do consumidor de capacidades. O protocolo padronizado permite que servidores sejam escritos por qualquer pessoa e ganhos pelo Claude Code sem recompilação.

O sistema de configuração de quatro escopos — plugin, user, project, enterprise — segue o mesmo padrão de precedência que `settings.json`. O escopo enterprise é único: quando presente, anula todos os outros escopos inteiramente.

Os cinco tipos de transporte cobrem o espectro de necessidades de integração: stdio para processos locais, SSE e HTTP Streamable para servidores web, WebSocket para conexões bidirecionais de baixa latência, e SDK para integração profunda.

O wrapper `MCPTool` faz ferramentas MCP funcionarem como ferramentas built-in de primeira classe. A convenção de nomenclatura `mcp__serverName__toolName` é crítica para o sistema de permissão — ela permite que regras cubram servidores inteiros ou ferramentas individuais.

O fluxo OAuth com PKCE garante que credenciais sensíveis nunca apareçam no histórico de URL ou em logs. Armazenar tokens no keychain do SO fornece segurança de nível do sistema sem exigir que os usuários gerenciem credenciais manualmente.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 16 examina coordenação de sub-agentes e multi-agentes — como o Claude Code spawna, gerencia e coordena múltiplos agentes Claude trabalhando em paralelo.*
