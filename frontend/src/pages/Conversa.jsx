import { useState, useEffect } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import { getConversation, formatCapturedAt, formatDurationLabel } from '../lib/conversas'
import { generateInsights } from '../lib/api'
import { supabase } from '../lib/supabase'
import { IconChevron } from '../components/Icons'

// Os resumos antigos foram gerados em Markdown com títulos em negrito. Aqui
// não há renderizador de Markdown, e mostrar os asteriscos crus fica pior do
// que não tê-los — os novos já vêm em bullets estruturados.
function stripMarkdown(text) {
  return text.replace(/\*\*/g, '').replace(/^#+ */gm, '').trim()
}

// Fase 1: a conversa já existe, tem título, data e resumo. A grade com os 4
// tópicos, a lista de to-do's e a timeline entram na Fase 2 — o que está aqui
// é o suficiente para o fluxo de captura fechar de ponta a ponta.
export default function Conversa() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { refreshConversations } = useOutletContext()

  const [conversation, setConversation] = useState(null)
  const [error, setError] = useState(null)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    let active = true
    setConversation(null)
    setError(null)
    getConversation(id)
      .then(c => { if (active) setConversation(c) })
      .catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [id])

  // Conversas capturadas antes desta versão não têm insights nem segmentos. A
  // mídia original nunca foi guardada, mas a transcrição sim — então reanalisar
  // custa uma chamada de texto, e não uma nova transcrição.
  async function regenerate() {
    setRegenerating(true)
    setError(null)
    try {
      const { insights, summary } = await generateInsights(conversation.transcript, conversation.segments || [])
      const { error: dbError } = await supabase.from('sessions')
        .update({ insights, summary, duration_s: insights.duration_s || conversation.duration_s })
        .eq('id', id)
      if (dbError) throw dbError
      setConversation(c => ({ ...c, insights, summary }))
      await refreshConversations()
    } catch (err) {
      setError(`Não foi possível analisar esta conversa: ${err.message}`)
    } finally {
      setRegenerating(false)
    }
  }

  if (error && !conversation) return <div className="alert alert-error">{error}</div>
  if (!conversation) return <div className="loading-screen"><div className="spinner" /></div>

  const duration = formatDurationLabel(conversation.duration_s)
  const bullets = conversation.insights?.summary_bullets || []

  return (
    <div className="conversa">
      <button className="back-link" onClick={() => navigate('/')}>
        <IconChevron width={14} height={14} style={{ transform: 'rotate(180deg)' }} /> Conversas
      </button>

      <header className="conversa-head">
        <h1>{conversation.title}</h1>
        <p className="text-muted text-sm">
          {formatCapturedAt(conversation.created_at)}{duration && <> · {duration}</>}
        </p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {bullets.length > 0 ? (
        <section className="conversa-block">
          <h2>Resumo</h2>
          <ul className="bullet-list">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </section>
      ) : (
        <section className="conversa-block">
          <h2>Resumo</h2>
          {conversation.summary
            ? <p className="legacy-summary">{stripMarkdown(conversation.summary)}</p>
            : <p className="text-muted">Esta conversa ainda não foi analisada.</p>}
          <button className="btn-secondary" onClick={regenerate} disabled={regenerating}>
            {regenerating ? <><span className="spinner spinner-sm" /> Analisando…</> : 'Gerar novos insights'}
          </button>
        </section>
      )}

      <section className="conversa-block">
        <h2>Transcrição</h2>
        <p className="conversa-transcript">{conversation.transcript}</p>
      </section>
    </div>
  )
}
