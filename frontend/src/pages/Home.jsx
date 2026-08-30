import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { createConversation, formatCapturedAt, formatDurationLabel, displayTitle, previewOf } from '../lib/conversas'
import CapturePanel from '../components/CapturePanel'
import { IconMic, IconLink, IconFile } from '../components/Icons'

const KIND_ICON = { url: IconLink, record: IconMic, file: IconFile }

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { conversations, refreshConversations, loadingConversations } = useOutletContext()
  const location = useLocation()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [shared, setShared] = useState(null)   // vindo do "Compartilhar" de outro app

  // O Layout deposita aqui o que foi compartilhado. Limpamos o state da rota em
  // seguida para que voltar a esta tela não reprocesse o mesmo conteúdo.
  useEffect(() => {
    if (!location.state?.shared) return
    setShared(location.state.shared)
    navigate('.', { replace: true, state: null })
  }, [location.state, navigate])

  // A captura terminou: a conversa já existe e o usuário vai direto para ela.
  // Antes havia um passo no meio pedindo que ele escolhesse uma pasta antes de
  // ver qualquer resultado — era a maior fricção do fluxo.
  async function handleResult(result, sourceType, sourceName) {
    setSaving(true)
    setError(null)
    try {
      const conversation = await createConversation(user.id, result, sourceType, sourceName)
      await refreshConversations()
      navigate(`/conversa/${conversation.id}`)
    } catch (err) {
      setError(`Não foi possível salvar a conversa: ${err.message}`)
      setSaving(false)
    }
  }

  return (
    <div className="home">
      {/* A captura fica numa coluna estreita — é uma decisão de cada vez. A
          lista embaixo é varredura, e por isso usa a largura toda. */}
      <div className="home-capture">
        <div className="home-greeting">
          <h1>O que vamos registrar hoje?</h1>
          <p className="text-muted">Grave, envie um arquivo ou cole um link — a gente transcreve e organiza.</p>
        </div>

        <CapturePanel
          onResult={handleResult}
          variant="hero"
          autoCapture={shared}
          onAutoCaptureDone={() => setShared(null)}
          extraLoading={saving}
        />

        {error && <div className="alert alert-error">{error}</div>}
      </div>

      <section className="recent">
        <h2 className="recent-title">Últimas conversas</h2>

        {loadingConversations ? (
          <div className="recent-empty"><span className="spinner spinner-sm" /> Carregando…</div>
        ) : conversations.length === 0 ? (
          <div className="recent-empty">
            Suas conversas aparecem aqui depois da primeira gravação, arquivo ou link.
          </div>
        ) : (
          <ul className="conversation-list">
            {conversations.map(c => (
              <ConversationRow key={c.id} conversation={c} onOpen={() => navigate(`/conversa/${c.id}`)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// Card da grade. A meta (origem, duração, data) sobe para uma tarja no topo e
// o corpo fica com título e prévia — assim o card carrega quatro informações
// no lugar das duas de antes, que era o que deixava a seção com cara de vazia.
export function ConversationRow({ conversation, onOpen, excerpt }) {
  const duration = formatDurationLabel(conversation.duration_s)
  const Icon = KIND_ICON[conversation.source_type] || IconFile
  const preview = excerpt || previewOf(conversation)
  return (
    <li>
      <div
        className="conversation-card"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
        }}
      >
        <div className="conversation-meta">
          <Icon width={14} height={14} />
          {/* O ponto só separa se houver duas coisas para separar. */}
          {duration && <><span>{duration}</span><span className="dot-sep">·</span></>}
          <span>{formatCapturedAt(conversation.created_at)}</span>
        </div>
        <span className="conversation-title">{displayTitle(conversation)}</span>
        {preview && <span className="conversation-excerpt">{preview}</span>}
      </div>
    </li>
  )
}
