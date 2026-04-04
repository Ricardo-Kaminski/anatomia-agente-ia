/**
 * Cartografia C0 — Visão Orbital do Claude Code
 *
 * Componente React interativo que mapeia os módulos do Claude Code
 * como grafo de dependências navegável.
 *
 * Como usar:
 *   1. Cole em https://claude.ai como React artifact, ou
 *   2. Monte em projeto React com: npm install (sem dependências externas)
 *
 * Dados: extraídos de dados/modulos.json
 * Capítulo de referência: nucleo/N01-projeto-e-arquitetura.md
 */

import { useState, useEffect, useRef, useCallback } from "react";

const MODULES = [
  { id: "queryEngine", label: "QueryEngine", lines: 46000, type: "core", x: 400, y: 300, desc: "Motor de inferência. 46K linhas. O coração do agente — recebe prompts, orquestra tools, gerencia tokens, decide quando parar.", risk: "alto", vsm: "S3 — Controle Operacional", chapter: "Cap. 7" },
  { id: "tools", label: "Tools (40+)", lines: 12000, type: "tools", x: 650, y: 200, desc: "Sistema de 40+ ferramentas: Bash, File I/O, LSP, Web, Sub-agent. Cada tool tem definição, validação e execução.", risk: "médio", vsm: "S1 — Operação", chapter: "Cap. 8" },
  { id: "permissions", label: "Permissões", lines: 4500, type: "security", x: 650, y: 420, desc: "Three-gate trigger architecture. Controla o que o agente pode fazer. Sandbox, allowlists, menor privilégio.", risk: "crítico", vsm: "S3* — Auditoria", chapter: "Cap. 9" },
  { id: "contextBuilder", label: "Context Builder", lines: 3200, type: "core", x: 200, y: 180, desc: "Monta o system prompt dinamicamente. Injeta CLAUDE.md, memories, contexto de sessão. A 'constituição operacional'.", risk: "alto", vsm: "S5 — Identidade", chapter: "Cap. 14" },
  { id: "coordinator", label: "Coordinator", lines: 5800, type: "agent", x: 200, y: 420, desc: "Orquestração multi-agent. Transforma Claude Code de agente solo em coordenador que spawna workers paralelos.", risk: "alto", vsm: "S2 — Coordenação", chapter: "Cap. 16" },
  { id: "autoDream", label: "autoDream", lines: 2100, type: "memory", x: 100, y: 300, desc: "Sistema de 'sonhos'. Consolida memória em background: Orient → Gather → Consolidate → Prune. Age sem input humano.", risk: "alto", vsm: "S4 — Inteligência", chapter: "Cap. 12" },
  { id: "repl", label: "REPL/UI", lines: 8500, type: "ui", x: 500, y: 100, desc: "Interface de terminal React/Ink. Captura input, renderiza output, gerencia sessão interativa.", risk: "baixo", vsm: "S1 — Interface", chapter: "Cap. 11" },
  { id: "mcp", label: "MCP Protocol", lines: 3800, type: "integration", x: 500, y: 480, desc: "Model Context Protocol. Padrão aberto para conectar a fontes externas: Google Drive, Slack, APIs.", risk: "médio", vsm: "S1 — Sensores", chapter: "Cap. 15" },
  { id: "skills", label: "Skills System", lines: 2400, type: "extension", x: 700, y: 320, desc: "Conhecimento codificado. SKILL.md como contrato. Marketplace de capacidades reutilizáveis.", risk: "médio", vsm: "S1 — Capacidades", chapter: "Cap. 17" },
  { id: "buddy", label: "Buddy 🥚", lines: 1800, type: "hidden", x: 350, y: 480, desc: "Sistema Tamagotchi escondido. 18 espécies, gacha determinístico, 'souls' escritas pelo Claude. Easter egg cultural.", risk: "nenhum", vsm: "—", chapter: "Cap. 14" },
  { id: "undercover", label: "Undercover Mode", lines: 800, type: "security", x: 150, y: 480, desc: "Oculta identidade AI em repos públicos. Bloqueia codenames, suprime atribuição. Ativado para funcionários Anthropic.", risk: "crítico-ético", vsm: "S5 — Identidade (oculta)", chapter: "Cap. 10" },
  { id: "kairos", label: "KAIROS", lines: 1500, type: "memory", x: 50, y: 200, desc: "Assistente proativo 'always-on'. Observa logs e age sem esperar input do usuário. Autonomia operacional máxima.", risk: "alto", vsm: "S4 — Vigilância", chapter: "Cap. 12" },
  { id: "bridge", label: "IDE Bridge", lines: 3200, type: "integration", x: 700, y: 100, desc: "Integração com VS Code e JetBrains. Diff view, review visual. O agente no ambiente do desenvolvedor.", risk: "baixo", vsm: "S1 — Interface", chapter: "Cap. 18" },
  { id: "services", label: "Services Layer", lines: 6500, type: "core", x: 300, y: 100, desc: "OAuth, analytics, telemetria, model cost. Camada de serviços backend.", risk: "médio", vsm: "S1 — Suporte", chapter: "Cap. 18" },
];

const EDGES = [
  { from: "repl", to: "contextBuilder", label: "input" },
  { from: "contextBuilder", to: "queryEngine", label: "prompt montado" },
  { from: "queryEngine", to: "tools", label: "tool_use" },
  { from: "tools", to: "permissions", label: "verifica" },
  { from: "permissions", to: "tools", label: "aprova/nega" },
  { from: "queryEngine", to: "coordinator", label: "spawna workers" },
  { from: "coordinator", to: "queryEngine", label: "resultados" },
  { from: "autoDream", to: "queryEngine", label: "memória" },
  { from: "kairos", to: "autoDream", label: "consolida" },
  { from: "mcp", to: "tools", label: "tools externas" },
  { from: "skills", to: "tools", label: "capacidades" },
  { from: "bridge", to: "repl", label: "IDE input" },
  { from: "services", to: "queryEngine", label: "auth, cost" },
  { from: "undercover", to: "contextBuilder", label: "injeta prompt" },
  { from: "contextBuilder", to: "autoDream", label: "CLAUDE.md" },
];

const TYPE_COLORS = {
  core: { bg: "#1a1a2e", border: "#e94560", text: "#e94560", label: "Núcleo" },
  tools: { bg: "#1a1a2e", border: "#0f3460", text: "#4ea8de", label: "Ferramentas" },
  security: { bg: "#1a1a2e", border: "#ff6b35", text: "#ff6b35", label: "Segurança" },
  agent: { bg: "#1a1a2e", border: "#7b2cbf", text: "#c77dff", label: "Multi-Agent" },
  memory: { bg: "#1a1a2e", border: "#2d6a4f", text: "#52b788", label: "Memória" },
  ui: { bg: "#1a1a2e", border: "#495057", text: "#adb5bd", label: "Interface" },
  integration: { bg: "#1a1a2e", border: "#0077b6", text: "#48cae4", label: "Integração" },
  extension: { bg: "#1a1a2e", border: "#e9c46a", text: "#e9c46a", label: "Extensão" },
  hidden: { bg: "#1a1a2e", border: "#6c757d", text: "#6c757d", label: "Oculto" },
};

const RISK_COLORS = {
  "nenhum": "#52b788",
  "baixo": "#adb5bd",
  "médio": "#e9c46a",
  "alto": "#e94560",
  "crítico": "#ff0a54",
  "crítico-ético": "#ff0a54",
};

const GOVERNANCE_NOTES = {
  queryEngine: "EU AI Act Art. 14: Supervisão humana obrigatória para sistemas de alto risco. O loop autônomo do QueryEngine precisa de pontos de interrupção auditáveis.",
  permissions: "PL 2338/2023 Art. 10: Sistemas de IA devem garantir transparência sobre suas capacidades e limitações. O three-gate é um modelo, mas os critérios são opacos.",
  undercover: "LGPD Art. 20 + EU AI Act Art. 52: Obrigação de transparência quando IA interage com humanos. O Undercover Mode viola este princípio deliberadamente.",
  autoDream: "EU AI Act Art. 14(4): O humano deve poder 'decidir não usar o sistema'. KAIROS e autoDream agem sem decisão humana.",
  coordinator: "Questão aberta em todos os frameworks: cadeia de accountability em multi-agent systems. Nenhuma regulação atual cobre adequadamente.",
  buddy: "Nenhuma implicação regulatória. Artefato cultural que revela a cultura de engenharia da Anthropic.",
  contextBuilder: "Q-FENG: O system prompt é a 'constituição' do agente. Quem escreve o prompt governa o comportamento. Accountability recai sobre o autor.",
  mcp: "EU AI Act Art. 28: Obrigações de provedores downstream. MCP cria cadeias de responsabilidade entre múltiplos provedores.",
  kairos: "EU AI Act Art. 14: Ação proativa sem supervisão humana. Caso-limite para regulação de autonomia.",
};

export default function ClaudeCodeCartography() {
  const [selected, setSelected] = useState(null);
  const [hovering, setHovering] = useState(null);
  const [filter, setFilter] = useState("all");
  const [showGovernance, setShowGovernance] = useState(false);
  const [viewMode, setViewMode] = useState("type");
  const svgRef = useRef(null);

  const filteredModules = MODULES.filter(m => filter === "all" || m.type === filter);
  const filteredIds = new Set(filteredModules.map(m => m.id));
  const filteredEdges = EDGES.filter(e => filteredIds.has(e.from) && filteredIds.has(e.to));

  const getModuleById = (id) => MODULES.find(m => m.id === id);

  const getNodeColor = (mod) => {
    if (viewMode === "risk") return RISK_COLORS[mod.risk] || "#adb5bd";
    return TYPE_COLORS[mod.type]?.border || "#adb5bd";
  };

  const getNodeRadius = (mod) => {
    const base = Math.sqrt(mod.lines) / 5;
    return Math.max(18, Math.min(45, base));
  };

  const selectedMod = selected ? getModuleById(selected) : null;

  return (
    <div style={{
      background: "#0a0a12",
      color: "#e0e0e0",
      minHeight: "100vh",
      fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid #1a1a2e",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "10px",
      }}>
        <div>
          <h1 style={{
            fontSize: "16px",
            fontWeight: 700,
            margin: 0,
            color: "#e94560",
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}>
            Cartografia Crítica do Claude Code
          </h1>
          <p style={{ fontSize: "10px", color: "#6c757d", margin: "2px 0 0" }}>
            C0 — Visão Orbital · v2.1.88 · 512K linhas · Inspirado em Joler/Crawford
          </p>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            onClick={() => setShowGovernance(!showGovernance)}
            style={{
              background: showGovernance ? "#e94560" : "transparent",
              color: showGovernance ? "#fff" : "#e94560",
              border: "1px solid #e94560",
              padding: "4px 10px",
              fontSize: "10px",
              cursor: "pointer",
              fontFamily: "inherit",
              borderRadius: "2px",
            }}
          >
            {showGovernance ? "◉" : "○"} GOVERNANÇA
          </button>
          <button
            onClick={() => setViewMode(viewMode === "type" ? "risk" : "type")}
            style={{
              background: "transparent",
              color: "#4ea8de",
              border: "1px solid #4ea8de",
              padding: "4px 10px",
              fontSize: "10px",
              cursor: "pointer",
              fontFamily: "inherit",
              borderRadius: "2px",
            }}
          >
            Cor: {viewMode === "type" ? "Tipo" : "Risco"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        padding: "8px 20px",
        borderBottom: "1px solid #1a1a2e",
        display: "flex",
        gap: "4px",
        flexWrap: "wrap",
      }}>
        {[{ key: "all", label: "Todos" }, ...Object.entries(TYPE_COLORS).map(([k, v]) => ({ key: k, label: v.label }))].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              background: filter === f.key ? (TYPE_COLORS[f.key]?.border || "#e94560") : "transparent",
              color: filter === f.key ? "#fff" : (TYPE_COLORS[f.key]?.text || "#adb5bd"),
              border: `1px solid ${TYPE_COLORS[f.key]?.border || "#333"}`,
              padding: "2px 8px",
              fontSize: "9px",
              cursor: "pointer",
              fontFamily: "inherit",
              borderRadius: "2px",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* SVG Canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "auto" }}>
          <svg
            ref={svgRef}
            viewBox="0 0 800 560"
            style={{ width: "100%", height: "auto", minHeight: "400px" }}
          >
            {/* Grid */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#111122" strokeWidth="0.5" />
              </pattern>
              <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#333" />
              </marker>
            </defs>
            <rect width="800" height="560" fill="url(#grid)" />

            {/* Edges */}
            {filteredEdges.map((edge, i) => {
              const from = getModuleById(edge.from);
              const to = getModuleById(edge.to);
              if (!from || !to) return null;
              const isHighlighted = selected === edge.from || selected === edge.to || hovering === edge.from || hovering === edge.to;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const rFrom = getNodeRadius(from);
              const rTo = getNodeRadius(to);
              const x1 = from.x + (dx / dist) * rFrom;
              const y1 = from.y + (dy / dist) * rFrom;
              const x2 = to.x - (dx / dist) * (rTo + 6);
              const y2 = to.y - (dy / dist) * (rTo + 6);

              return (
                <g key={i}>
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isHighlighted ? "#e94560" : "#1a1a2e"}
                    strokeWidth={isHighlighted ? 1.5 : 0.7}
                    markerEnd="url(#arrow)"
                    opacity={isHighlighted ? 1 : 0.4}
                  />
                  {isHighlighted && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 5}
                      fill="#6c757d"
                      fontSize="7"
                      textAnchor="middle"
                      fontFamily="inherit"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {filteredModules.map(mod => {
              const r = getNodeRadius(mod);
              const color = getNodeColor(mod);
              const isSelected = selected === mod.id;
              const isHovered = hovering === mod.id;
              const hasGov = showGovernance && GOVERNANCE_NOTES[mod.id];

              return (
                <g
                  key={mod.id}
                  onClick={() => setSelected(isSelected ? null : mod.id)}
                  onMouseEnter={() => setHovering(mod.id)}
                  onMouseLeave={() => setHovering(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Governance ring */}
                  {hasGov && (
                    <circle
                      cx={mod.x} cy={mod.y} r={r + 6}
                      fill="none"
                      stroke="#e94560"
                      strokeWidth="1.5"
                      strokeDasharray="3,3"
                      opacity={0.7}
                    >
                      <animate attributeName="stroke-dashoffset" from="0" to="12" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* Main circle */}
                  <circle
                    cx={mod.x} cy={mod.y} r={r}
                    fill={isSelected || isHovered ? color + "33" : "#0a0a12"}
                    stroke={color}
                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1}
                    opacity={isSelected || isHovered ? 1 : 0.75}
                  />
                  {/* LOC indicator */}
                  <text
                    x={mod.x} y={mod.y - 3}
                    fill={color}
                    fontSize="8"
                    textAnchor="middle"
                    fontFamily="inherit"
                    fontWeight="700"
                  >
                    {mod.lines >= 1000 ? `${(mod.lines/1000).toFixed(0)}K` : mod.lines}
                  </text>
                  {/* Label */}
                  <text
                    x={mod.x} y={mod.y + 8}
                    fill={isSelected || isHovered ? "#fff" : "#adb5bd"}
                    fontSize="7"
                    textAnchor="middle"
                    fontFamily="inherit"
                  >
                    {mod.label}
                  </text>
                  {/* Risk dot */}
                  {viewMode === "risk" && (
                    <circle
                      cx={mod.x + r - 3} cy={mod.y - r + 3} r={3}
                      fill={RISK_COLORS[mod.risk]}
                    />
                  )}
                </g>
              );
            })}

            {/* Title watermark */}
            <text x="780" y="545" fill="#111122" fontSize="8" textAnchor="end" fontFamily="inherit">
              ANATOMIA DE UM AGENTE DE IA · Kaminski 2026 · método: Joler/Crawford
            </text>
          </svg>
        </div>

        {/* Detail Panel */}
        <div style={{
          width: "280px",
          minWidth: "280px",
          borderLeft: "1px solid #1a1a2e",
          padding: "12px",
          overflowY: "auto",
          fontSize: "11px",
          lineHeight: "1.5",
        }}>
          {selectedMod ? (
            <>
              <div style={{
                borderBottom: `2px solid ${getNodeColor(selectedMod)}`,
                paddingBottom: "8px",
                marginBottom: "10px",
              }}>
                <h2 style={{
                  fontSize: "14px",
                  color: getNodeColor(selectedMod),
                  margin: "0 0 2px",
                  fontWeight: 700,
                }}>
                  {selectedMod.label}
                </h2>
                <span style={{
                  fontSize: "9px",
                  color: "#6c757d",
                  fontFamily: "inherit",
                }}>
                  {selectedMod.chapter} · {selectedMod.lines.toLocaleString()} linhas
                </span>
              </div>

              <p style={{ color: "#ccc", margin: "0 0 12px" }}>
                {selectedMod.desc}
              </p>

              <div style={{ margin: "0 0 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "#6c757d" }}>Tipo</span>
                  <span style={{ color: TYPE_COLORS[selectedMod.type]?.text }}>
                    {TYPE_COLORS[selectedMod.type]?.label}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "#6c757d" }}>Risco</span>
                  <span style={{ color: RISK_COLORS[selectedMod.risk] }}>
                    ● {selectedMod.risk}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ color: "#6c757d" }}>VSM</span>
                  <span style={{ color: "#52b788" }}>{selectedMod.vsm}</span>
                </div>
              </div>

              {/* Connections */}
              <div style={{ marginBottom: "12px" }}>
                <h3 style={{ fontSize: "10px", color: "#6c757d", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Conexões
                </h3>
                {EDGES.filter(e => e.from === selectedMod.id || e.to === selectedMod.id).map((e, i) => {
                  const other = e.from === selectedMod.id ? e.to : e.from;
                  const dir = e.from === selectedMod.id ? "→" : "←";
                  const otherMod = getModuleById(other);
                  return (
                    <div
                      key={i}
                      onClick={() => setSelected(other)}
                      style={{
                        padding: "3px 6px",
                        margin: "2px 0",
                        background: "#111122",
                        borderRadius: "2px",
                        cursor: "pointer",
                        fontSize: "10px",
                      }}
                    >
                      <span style={{ color: "#e94560" }}>{dir}</span>{" "}
                      <span style={{ color: TYPE_COLORS[otherMod?.type]?.text }}>
                        {otherMod?.label}
                      </span>
                      <span style={{ color: "#6c757d", marginLeft: "4px" }}>
                        ({e.label})
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Governance overlay */}
              {showGovernance && GOVERNANCE_NOTES[selectedMod.id] && (
                <div style={{
                  background: "#1a0a12",
                  border: "1px solid #e94560",
                  borderRadius: "2px",
                  padding: "8px",
                  marginTop: "8px",
                }}>
                  <h3 style={{
                    fontSize: "10px",
                    color: "#e94560",
                    margin: "0 0 4px",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}>
                    ⚖ Análise de Governança
                  </h3>
                  <p style={{ color: "#e0a0a0", margin: 0, fontSize: "10px", lineHeight: "1.4" }}>
                    {GOVERNANCE_NOTES[selectedMod.id]}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: "#6c757d", textAlign: "center", paddingTop: "40px" }}>
              <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.3 }}>◎</div>
              <p style={{ fontSize: "11px" }}>
                Clique em um módulo para explorar
              </p>
              <p style={{ fontSize: "9px", marginTop: "12px", lineHeight: "1.6" }}>
                Tamanho do nó = linhas de código<br/>
                Cor = {viewMode === "type" ? "tipo do módulo" : "nível de risco"}<br/>
                Setas = fluxos de dados e dependências<br/>
                {showGovernance && <>Anel tracejado = implicação regulatória<br/></>}
              </p>
              <div style={{
                marginTop: "20px",
                padding: "8px",
                background: "#111122",
                borderRadius: "2px",
                textAlign: "left",
              }}>
                <p style={{ fontSize: "9px", color: "#4ea8de", margin: "0 0 6px", fontWeight: 700 }}>
                  LEGENDA
                </p>
                {Object.entries(TYPE_COLORS).map(([key, val]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: val.border }} />
                    <span style={{ fontSize: "9px", color: val.text }}>{val.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer stats */}
      <div style={{
        padding: "6px 20px",
        borderTop: "1px solid #1a1a2e",
        display: "flex",
        justifyContent: "space-between",
        fontSize: "9px",
        color: "#6c757d",
      }}>
        <span>{filteredModules.length} módulos · {filteredEdges.length} conexões · {filteredModules.reduce((s, m) => s + m.lines, 0).toLocaleString()} linhas</span>
        <span>Cartografia Crítica · Método: Joler + Foucault + Beer · Q-FENG overlay</span>
      </div>
    </div>
  );
}
