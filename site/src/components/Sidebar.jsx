import { NUCLEO, CARTOGRAFIAS } from '../data/chapters.js'

export default function Sidebar({ currentSlug }) {
  const sectionLabel = {
    fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.1em',
    color: 'var(--text-muted)', textTransform: 'uppercase',
    fontFamily: 'var(--font-mono)', marginBottom: '8px', marginTop: '20px',
    paddingLeft: '8px',
  }

  return (
    <aside style={{
      position: 'fixed',
      top: 'var(--nav-h)', left: 0,
      width: 'var(--sidebar-w)',
      height: 'calc(100vh - var(--nav-h))',
      background: 'var(--bg)',
      borderRight: '1px solid var(--border)',
      overflowY: 'auto',
      padding: '16px 12px',
      flexShrink: 0,
    }}>
      <div style={sectionLabel}>Núcleo Técnico</div>
      {NUCLEO.map(ch => {
        const active = ch.slug === currentSlug
        return (
          <a
            key={ch.slug}
            href={`#/nucleo/${ch.slug}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '5px 8px', borderRadius: '5px',
              fontSize: '0.82rem', textDecoration: 'none',
              background: active ? 'var(--accent-bg)' : 'transparent',
              color: active ? 'var(--accent-2)' : 'var(--text-muted)',
              borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '2px',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: active ? 'var(--accent)' : 'var(--border-2)', minWidth: '28px' }}>{ch.code}</span>
            <span>{ch.title}</span>
          </a>
        )
      })}

      <div style={sectionLabel}>Cartografias</div>
      {CARTOGRAFIAS.map(c => (
        <a
          key={c.slug}
          href={`#/cartografias/${c.slug}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '5px 8px', borderRadius: '5px',
            fontSize: '0.82rem', textDecoration: 'none',
            color: 'var(--text-muted)', marginBottom: '2px',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--border-2)', minWidth: '28px' }}>{c.code}</span>
          <span>{c.title}</span>
        </a>
      ))}
    </aside>
  )
}
