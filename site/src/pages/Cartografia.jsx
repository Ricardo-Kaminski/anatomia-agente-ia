import { useParams } from 'react-router-dom'
import { Suspense, lazy } from 'react'

// Map slugs to lazy-loaded components from the existing cartografia/ directory (repo root)
const cartografiaMap = {
  'c0-visao-geral': lazy(() => import('../../../cartografia/c0-visao-geral.jsx')),
}

export default function Cartografia() {
  const { slug } = useParams()
  const CartografiaComponent = cartografiaMap[slug]

  if (!CartografiaComponent) return (
    <div style={{ paddingTop: 'var(--nav-h)', padding: '80px 48px' }}>
      <p style={{ color: 'var(--text-muted)' }}>Cartografia não encontrada: {slug}</p>
    </div>
  )

  return (
    <div style={{ paddingTop: 'var(--nav-h)', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '12px 24px', borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
        color: 'var(--text-muted)', letterSpacing: '0.1em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>{slug.toUpperCase()} — CARTOGRAFIA INTERATIVA</span>
        <a href="#/" style={{ color: 'var(--accent-2)', fontSize: '0.8rem' }}>← Voltar</a>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Suspense fallback={<p style={{ padding: '48px', color: 'var(--text-muted)' }}>Carregando cartografia...</p>}>
          <CartografiaComponent />
        </Suspense>
      </div>
    </div>
  )
}
