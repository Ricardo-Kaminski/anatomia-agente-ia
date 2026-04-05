import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { NUCLEO } from '../data/chapters.js'
import Sidebar from '../components/Sidebar.jsx'
import MarkdownRenderer from '../components/MarkdownRenderer.jsx'
import PrevNext from '../components/PrevNext.jsx'

// Lazily load all .md files from nucleo/ (parent directory of site/)
const mdFiles = import.meta.glob('../../nucleo/*.md', { as: 'raw' })

function keyFor(file) {
  return `../../nucleo/${file}.md`
}

export default function Chapter() {
  const { slug } = useParams()
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)

  const chapter = NUCLEO.find(ch => ch.slug === slug)

  useEffect(() => {
    if (!chapter) return
    const key = keyFor(chapter.file)
    const loader = mdFiles[key]
    if (!loader) {
      setError(`Arquivo não encontrado: ${key}`)
      return
    }
    setContent('')
    setError(null)
    loader().then(setContent).catch(() => setError('Erro ao carregar capítulo.'))
  }, [slug, chapter])

  if (!chapter) return (
    <div style={{ paddingTop: 'var(--nav-h)', paddingLeft: 'var(--sidebar-w)' }}>
      <div style={{ padding: '48px' }}>
        <p style={{ color: 'var(--text-muted)' }}>Capítulo não encontrado: {slug}</p>
      </div>
    </div>
  )

  return (
    <div style={{ paddingTop: 'var(--nav-h)', display: 'flex' }}>
      <Sidebar currentSlug={slug} />

      <main style={{
        marginLeft: 'var(--sidebar-w)',
        flex: 1,
        padding: '48px 56px',
        maxWidth: '900px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
          color: 'var(--text-muted)', letterSpacing: '0.1em',
          marginBottom: '24px',
        }}>
          {chapter.code} · {chapter.title.toUpperCase()}
        </div>

        {error && <p style={{ color: '#f87171' }}>{error}</p>}
        <MarkdownRenderer content={content} />
        <PrevNext currentSlug={slug} />
      </main>
    </div>
  )
}
