import { ALL_CHAPTERS } from '../data/chapters.js'

export default function PrevNext({ currentSlug }) {
  const idx = ALL_CHAPTERS.findIndex(ch => ch.slug === currentSlug)
  const prev = idx > 0 ? ALL_CHAPTERS[idx - 1] : null
  const next = idx < ALL_CHAPTERS.length - 1 ? ALL_CHAPTERS[idx + 1] : null

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginTop: '48px', paddingTop: '24px',
      borderTop: '1px solid var(--border)',
    }}>
      {prev ? (
        <a href={`#/nucleo/${prev.slug}`} style={{
          display: 'flex', flexDirection: 'column', gap: '4px',
          textDecoration: 'none', maxWidth: '45%',
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>← Anterior</span>
          <span style={{ fontSize: '0.9rem', color: 'var(--accent-2)', fontWeight: 600 }}>{prev.code} — {prev.title}</span>
        </a>
      ) : null}

      {next ? (
        <a href={`#/nucleo/${next.slug}`} style={{
          display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end',
          textDecoration: 'none', maxWidth: '45%',
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Próximo →</span>
          <span style={{ fontSize: '0.9rem', color: 'var(--accent-2)', fontWeight: 600 }}>{next.code} — {next.title}</span>
        </a>
      ) : null}
    </div>
  )
}
