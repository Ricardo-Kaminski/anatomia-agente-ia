const e=`> Capítulo traduzido e adaptado de [claude-code-cookbook](https://github.com/zhu1090093659/claude-code-cookbook) por zhu1090093659 (Licença MIT). Tradução PT-BR e camada analítica: Ricardo Kaminski.

---

# Capítulo 02: Inicialização e Bootstrap

## O que você vai aprender

Ao final deste capítulo, você será capaz de:

* Traçar o caminho completo de inicialização desde a invocação de \`claude\` até o primeiro prompt REPL renderizado, identificando cada arquivo executado ao longo do caminho
* Explicar por que \`src/entrypoints/init.ts\` estrutura a inicialização em fases distintas separadas pelo diálogo de confiança, e o que quebraria se esse limite fosse removido
* Distinguir \`src/bootstrap/state.ts\` (singleton global de tempo de processo) de \`AppState\` em \`src/state/\` (estado React de sessão), e saber qual consultar para cada tipo de dado
* Ler qualquer implementação de ferramenta em \`src/tools/\` com plena compreensão do objeto \`ToolUseContext\` que ela recebe, sabendo exatamente como esse objeto foi montado

---

## A Arquitetura de Inicialização em Uma Frase

A sequência de inicialização do Claude Code é uma cascata deliberada de imports lazy, prefetches de I/O paralelos e carregamentos de módulos diferidos, tudo orquestrado para chegar ao primeiro prompt REPL renderizado o mais rápido possível, garantindo que operações sensíveis à segurança nunca sejam executadas antes de o usuário ter concedido confiança.

---

## O Ponto de Entrada: \`src/entrypoints/cli.tsx\`

\`cli.tsx\` é o verdadeiro ponto de entrada do binário. Sua única responsabilidade arquitetural é decidir qual caminho de código ativar, importando o mínimo possível para isso.

O arquivo começa com três side-effects incondicionais de nível superior antes mesmo que a função \`main\` seja executada:

\`\`\`typescript
// src/entrypoints/cli.tsx:5
process.env.COREPACK_ENABLE_AUTO_PIN = '0';
\`\`\`

\`\`\`typescript
// src/entrypoints/cli.tsx:9-14
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  const existing = process.env.NODE_OPTIONS || '';
  process.env.NODE_OPTIONS = existing
    ? \`\${existing} --max-old-space-size=8192\`
    : '--max-old-space-size=8192';
}
\`\`\`

### O Fast-Path de Versão

\`\`\`typescript
// src/entrypoints/cli.tsx:37-42
if (
  args.length === 1 &&
  (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')
) {
  console.log(\`\${MACRO.VERSION} (Claude Code)\`);
  return;
}
\`\`\`

\`MACRO.VERSION\` é uma constante de tempo de build injetada pelo Bun. Executar \`claude --version\` avalia exatamente um arquivo e realiza zero imports dinâmicos.

### O Profiler de Inicialização

\`\`\`typescript
// src/entrypoints/cli.tsx:45-48
const { profileCheckpoint } = await import('../utils/startupProfiler.js');
profileCheckpoint('cli_entry');
\`\`\`

### Fast-Paths com Feature Flags

Após o profiler, \`cli.tsx\` verifica uma série de modos especiais controlados por feature flags. Os gates em ordem são: \`DUMP_SYSTEM_PROMPT\`, Chrome extension MCP (\`--claude-in-chrome-mcp\`), Chrome native host (\`--chrome-native-host\`), \`CHICAGO_MCP\`, daemon worker \`DAEMON\`, controle remoto \`BRIDGE_MODE\`, supervisor \`DAEMON\`, gerenciamento de sessão \`BG_SESSIONS\`, jobs de template \`TEMPLATES\`, \`BYOC_ENVIRONMENT_RUNNER\`, \`SELF_HOSTED_RUNNER\`, e o fast-path \`--worktree --tmux\`.

### Entrando no CLI Principal

\`\`\`typescript
// src/entrypoints/cli.tsx:289-298
const { startCapturingEarlyInput } = await import('../utils/earlyInput.js');
startCapturingEarlyInput();
profileCheckpoint('cli_before_main_import');
const { main: cliMain } = await import('../main.js');
profileCheckpoint('cli_after_main_import');
await cliMain();
profileCheckpoint('cli_after_main_complete');
\`\`\`

---

## Side-Effects no Topo de \`src/main.tsx\`

\`\`\`typescript
// src/main.tsx:1-20
import { profileCheckpoint } from './utils/startupProfiler.js';
profileCheckpoint('main_tsx_entry');
import { startMdmRawRead } from './utils/settings/mdm/rawRead.js';
startMdmRawRead();
import { startKeychainPrefetch } from './utils/secureStorage/keychainPrefetch.js';
startKeychainPrefetch();
\`\`\`

\`startMdmRawRead()\` e \`startKeychainPrefetch()\` lançam subprocesso e I/O do keychain como operações assíncronas em background. Enquanto os ~135 ms restantes de imports estáticos avaliam sincronamente, essas operações rodam concorrentemente. É a otimização de inicialização mais impactante do codebase.

---

## Inicialização: \`src/entrypoints/init.ts\`

\`\`\`typescript
// src/entrypoints/init.ts:57
export const init = memoize(async (): Promise<void> => {
\`\`\`

O wrapper \`memoize\` garante que a segunda chamada a \`init()\` retorne imediatamente a promise já resolvida.

### Fase 1: Operações Pré-Confiança

\`\`\`typescript
enableConfigs()
applySafeConfigEnvironmentVariables()
applyExtraCACertsFromConfig()
setupGracefulShutdown()

void populateOAuthAccountInfoIfNeeded()
void initJetBrainsDetection()
void detectCurrentRepository()

configureGlobalMTLS()
configureGlobalAgents()
preconnectAnthropicApi()
\`\`\`

\`applyExtraCACertsFromConfig()\` deve acontecer antes da primeira conexão TLS porque o Bun armazena em cache o repositório de certificados TLS na inicialização via BoringSSL.

\`preconnectAnthropicApi()\` dispara um handshake TCP+TLS para \`api.anthropic.com\` que roda em background. Quando a primeira requisição de API disparar, a conexão já estará aquecida.

### Por que o Limite de Duas Fases Existe

Git hooks, \`core.fsmonitor\`, \`diff.external\` e entradas similares de configuração git podem executar código arbitrário quando comandos git rodam. A estrutura de duas fases garante que git commands, aplicação completa de variáveis de ambiente e inicialização de telemetria aguardem até após o usuário ter explicitamente confiado no diretório.

\`\`\`typescript
// src/main.tsx:360-380
function prefetchSystemContextIfSafe(): void {
  const isNonInteractiveSession = getIsNonInteractiveSession();
  if (isNonInteractiveSession) {
    void getSystemContext();
    return;
  }
  const hasTrust = checkHasTrustDialogAccepted();
  if (hasTrust) {
    void getSystemContext();
  }
}
\`\`\`

### Fase 2: Operações Pós-Confiança

\`\`\`typescript
initializeTelemetryAfterTrust()
applyConfigEnvironmentVariables()
\`\`\`

Os módulos de ~400 KB do OpenTelemetry e protobuf são carregados lazily dentro de \`doInitializeTelemetry()\` — não existem no cache de módulos para sessões que nunca inicializam telemetria.

---

## Estado Global: \`src/bootstrap/state.ts\`

\`\`\`typescript
// src/bootstrap/state.ts:31
// NÃO ADICIONE MAIS ESTADO AQUI - SEJA CRITERIOSO COM ESTADO GLOBAL
\`\`\`

O arquivo cresceu para mais de 240 campos de estado e mais de 80 exportações de pares getter/setter.

**Categorias de dados:**
- **Identidade de sessão:** \`sessionId\`, \`parentSessionId\`, \`originalCwd\`, \`projectRoot\`, \`cwd\`
- **Acumuladores de custo e tempo:** \`totalCostUSD\`, \`totalAPIDuration\`, \`totalToolDuration\`
- **Configuração de modelo:** \`mainLoopModelOverride\`, \`initialMainLoopModel\`, \`modelUsage\`
- **Infraestrutura de telemetria:** \`meter\`, \`sessionCounter\`, \`loggerProvider\`, \`tracerProvider\`
- **Flags de sessão:** \`isInteractive\`, \`sessionBypassPermissionsMode\`, \`sessionTrustAccepted\`
- **Caches de infraestrutura:** \`agentColorMap\`, \`lastAPIRequest\`, \`registeredHooks\`

### bootstrap/state.ts vs AppState

\`src/bootstrap/state.ts\` é um objeto simples em nível de módulo. Inicializado antes do React, persiste por resets de sessão, sem reatividade — nada re-renderiza quando um valor muda.

\`src/state/AppStateStore.ts\` é uma store estilo Zustand que conduz a renderização React. Quando uma ferramenta chama \`setAppState(...)\`, o React agenda uma re-renderização.

**Regra prática:** se mudar um valor deve atualizar o display do terminal imediatamente → \`AppState\`. Se é infraestrutura de escopo de processo ou acumulador de estatísticas → \`bootstrap/state.ts\`.

---

## A Árvore de Modos: Como \`main.tsx\` Ramifica

**Modo REPL interativo** (sem flag \`-p\`, stdin é terminal): \`showSetupScreens()\` → monta \`ToolUseContext\` → \`launchRepl()\`

**Modo headless** (flag \`-p\` ou stdin redirecionado): pula diálogo de confiança e React, chama \`runHeadless()\` diretamente

**Modo servidor MCP** (\`mcp serve\`): \`initMcpServer()\` de \`src/entrypoints/mcp.ts\`

**Modo remoto/coordinator** (feature flag \`COORDINATOR_MODE\`): \`coordinatorModeModule.run()\` — ausente de builds externas via DCE

**Modo assistant** (feature flag \`KAIROS\`): \`assistantModule.run()\` — ausente de builds externas

**Modo print** (flag \`--print\`): variante headless para scripts shell

---

## O Sistema de Migrações

\`\`\`typescript
// src/main.tsx:325-352
const CURRENT_MIGRATION_VERSION = 11;
function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateAutoUpdatesToSettings();
    migrateBypassPermissionsAcceptedToSettings();
    // ...
    saveGlobalConfig(prev =>
      prev.migrationVersion === CURRENT_MIGRATION_VERSION
        ? prev
        : { ...prev, migrationVersion: CURRENT_MIGRATION_VERSION }
    );
  }
  migrateChangelogFromConfig().catch(() => {});
}
\`\`\`

Cada função de migração vive em \`src/migrations/\` e realiza transformação única de \`~/.claude/settings.json\`. As migrações são idempotentes e rodam em ordem.

---

## Montando o ToolUseContext

\`\`\`typescript
const context: ToolUseContext = {
  options: {
    tools,
    commands,
    mcpClients: mcpConnections,
    mcpResources,
    mainLoopModel: getMainLoopModel(),
    debug: options.debug ?? false,
    verbose: options.verbose ?? false,
  },
  abortController: new AbortController(),
  getAppState: () => store.getState(),
  setAppState: (f) => store.setState(f(store.getState())),
};
\`\`\`

**\`options.tools\`**: filtrado por feature flags. **\`options.mcpClients\`**: conexões ativas de servidores MCP. **\`getAppState\`/\`setAppState\`**: closures sobre a store Zustand. **\`abortController\`**: sinal de cancelamento de nível de sessão — quando \`Escape\` ou \`Ctrl+C\` é pressionado, \`abortController.abort()\` é chamado.

Sub-agentes recebem contexto clonado com \`abortController\` novo e \`setAppState\` no-op.

---

## Prefetches Diferidos

\`\`\`typescript
export function startDeferredPrefetches(): void {
  void initUser();
  void getUserContext();
  prefetchSystemContextIfSafe();
  void getRelevantTips();
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), []);
  void initializeAnalyticsGates();
  void prefetchOfficialMcpUrls();
  void refreshModelCapabilities();
  void settingsChangeDetector.initialize();
  void skillChangeDetector.initialize();
}
\`\`\`

Diferidos porque spawnam processos filhos ou fazem requisições de rede. Rodam em background enquanto o usuário digita a primeira mensagem.

---

## Lançamento do REPL: \`src/replLauncher.tsx\`

\`\`\`typescript
export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>
): Promise<void> {
  const { App } = await import('./components/App.js');
  const { REPL } = await import('./screens/REPL.js');
  await renderAndRun(root, <App {...appProps}><REPL {...replProps} /></App>);
}
\`\`\`

\`renderAndRun\` é injetado como parâmetro (de \`src/interactiveHelpers.ts\`) em vez de importado diretamente — isso torna \`replLauncher.tsx\` testável em isolamento.

---

## Principais Conclusões

**Imports lazy são pervasivos por design.** \`cli.tsx\` não tem imports estáticos de código da aplicação.

**I/O paralelo é disparado antes do trabalho bloqueante.** \`startMdmRawRead()\` e \`startKeychainPrefetch()\` rodam concorrentemente com ~135 ms de avaliação de imports estáticos.

**O diálogo de confiança é um limite de segurança rígido.** Git hooks podem executar código arbitrário. A estrutura de duas fases de \`init.ts\` garante que comandos git e inicialização de telemetria aguardem o usuário confiar no diretório.

**\`bootstrap/state.ts\` é infraestrutura, \`AppState\` é UI.**

**\`ToolUseContext\` é a espinha dorsal de injeção de dependências.** Toda chamada de ferramenta recebe o mesmo objeto de contexto montado.

---

## Implicações

> **Esta seção será adicionada pelo autor com análise de governança, regulação e implicações organizacionais deste módulo.**

---

*Próximo: O Capítulo 03 examina o sistema de tipos central — as interfaces e tipos que formam a fundação de toda arquitetura do Claude Code.*
`;export{e as default};
