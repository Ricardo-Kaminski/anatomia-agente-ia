export default function NavBar() {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: 'var(--nav-h)',
      background: 'rgba(13,17,23,0.95)',
      borderBottom: '1px solid var(--border)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: '32px',
    }}>
      <a href="#/" style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', textDecoration: 'none', flexShrink: 0 }}>
        Anatomia de um Agente de IA
      </a>
      <div style={{ display: 'flex', gap: '20px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        <a href="#/nucleo/n01-arquitetura" style={{ color: 'inherit', textDecoration: 'none' }}>Núcleo</a>
        <a href="#/cartografias/c0-visao-geral" style={{ color: 'inherit', textDecoration: 'none' }}>Cartografias</a>
        <a href="https://github.com/Ricardo-Kaminski/anatomia-agente-ia" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>GitHub</a>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <a href="#/nucleo/n01-arquitetura" style={{
          background: 'var(--accent)', color: '#fff',
          padding: '6px 16px', borderRadius: '6px',
          fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none',
        }}>
          Ler agora
        </a>
      </div>
    </nav>
  )
}
