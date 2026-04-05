import { NUCLEO } from '../data/chapters.js'

const STATS = [
  { value: '20', label: 'capítulos' },
  { value: '512K', label: 'linhas' },
  { value: '7', label: 'cartografias' },
  { value: 'PT-BR', label: '1º no idioma' },
]

export default function Home() {
  return (
    <div style={{ paddingTop: 'var(--nav-h)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Hero */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1 }}>

        {/* Left — Manifesto */}
        <div style={{
          padding: '56px 48px',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
            letterSpacing: '0.2em', color: 'var(--text-muted)',
            marginBottom: '20px',
          }}>
            ENGENHARIA REVERSA · PT-BR
          </div>

          <h1 style={{
            fontSize: '2.2rem', fontWeight: 900, lineHeight: 1.15,
            marginBottom: '20px', color: 'var(--text)',
          }}>
            O código-fonte do agente mais avançado do mundo{' '}
            <span style={{ color: 'var(--accent-2)' }}>dissecado em público.</span>
          </h1>

          <p style={{
            fontSize: '0.95rem', color: 'var(--text-muted)',
            lineHeight: 1.7, marginBottom: '32px', maxWidth: '440px',
          }}>
            Em março de 2025, 512K linhas de TypeScript do Claude Code vazaram no npm.
            Este é o primeiro livro técnico em português que analisa esse artefato —
            do código à governança, da arquitetura à regulação.
          </p>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '40px' }}>
            <a href="#/nucleo/n01-arquitetura" style={{
              background: 'var(--accent)', color: '#fff',
              padding: '10px 22px', borderRadius: '7px',
              fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none',
            }}>
              Começar pelo N01 →
            </a>
            <a href="#/cartografias/c0-visao-geral" style={{
              border: '1px solid var(--border-2)', color: 'var(--text-muted)',
              padding: '10px 18px', borderRadius: '7px',
              fontSize: '0.9rem', textDecoration: 'none',
            }}>
              Ver Cartografias
            </a>
          </div>

          {/* Stats */}
          <div style={{
            display: 'flex', gap: '28px',
            paddingTop: '24px', borderTop: '1px solid var(--border)',
          }}>
            {STATS.map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>{s.value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Chapter Index */}
        <div style={{ padding: '48px 40px', overflowY: 'auto' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
            letterSpacing: '0.15em', color: 'var(--accent-2)',
            marginBottom: '20px',
          }}>
            NÚCLEO TÉCNICO — 20 CAPÍTULOS
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {NUCLEO.map((ch, i) => (
              <a
                key={ch.slug}
                href={`#/nucleo/${ch.slug}`}
                className={i !== 0 ? 'chapter-link' : ''}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '8px 12px', borderRadius: '7px',
                  textDecoration: 'none',
                  background: i === 0 ? 'var(--surface)' : 'transparent',
                  border: i === 0 ? '1px solid var(--border)' : '1px solid transparent',
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                  color: i === 0 ? 'var(--accent)' : 'var(--border-2)',
                  minWidth: '32px',
                }}>
                  {ch.code}
                </span>
                <span style={{ fontSize: '0.88rem', color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                  {ch.title}
                </span>
                {i === 0 && (
                  <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: '0.85rem' }}>→</span>
                )}
              </a>
            ))}
          </div>

          {/* Cartografia teaser */}
          <div style={{
            marginTop: '24px', padding: '16px',
            background: 'var(--accent-bg)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: '8px',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
              letterSpacing: '0.12em', color: 'var(--accent-2)',
              marginBottom: '6px',
            }}>
              CARTOGRAFIA C0 — VISÃO ORBITAL
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Grafo interativo dos módulos — clique para explorar
            </div>
            <a href="#/cartografias/c0-visao-geral" style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>
              Abrir cartografia →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
