import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { createConversation, formatCapturedAt, formatDurationLabel, displayTitle, previewOf } from '../lib/conversas'
import CapturePanel from '../components/CapturePanel'
import { IconMic, IconLink, IconFile } from '../components/Icons'

const KIND_ICON = { url: IconLink, record: IconMic, file: IconFile }

// Quantas conversas o centro mostra. A barra lateral é o arquivo completo; aqui
// é só o que se está retomando — repetir a lista inteira nos dois lugares era o
// que deixava a tela com cara de carregada.
const RECENT_LIMIT = 3

export default function Home({ mode = 'record' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { conversations, refreshConversations, loadingConversations, showAllConversations } = useOutletContext()
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
          mode={mode}
          autoCapture={shared}
          onAutoCaptureDone={() => setShared(null)}
          extraLoading={saving}
        />

        {error && <div className="alert alert-error">{error}</div>}
      </div>

      <section className="recent">
        <div className="recent-head">
          <h2 className="recent-title">Continuar de onde parou</h2>
          {conversations.length > RECENT_LIMIT && (
            <button className="recent-all" onClick={showAllConversations}>Ver todas</button>
          )}
        </div>

        {loadingConversations ? (
          <div className="recent-empty"><span className="spinner spinner-sm" /> Carregando…</div>
        ) : conversations.length === 0 ? (
          <div className="recent-empty">
            Suas conversas aparecem aqui depois da primeira gravação, arquivo ou link.
          </div>
        ) : (
          <ul className="conversation-list">
            {conversations.slice(0, RECENT_LIMIT).map(c => (
              <ConversationRow key={c.id} conversation={c} onOpen={() => navigate(`/conversa/${c.id}`)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// Linha da lista de retomada. O que ela precisa entregar é reconhecimento: o
// título sozinho, truncado como fica na barra lateral, não distingue duas
// conversas do mesmo assunto — daí a data e a primeira linha da transcrição.
// Em linha fina, e não em card: card grande com duas linhas de conteúdo é o
// que fazia a seção parecer preenchimento.
export function ConversationRow({ conversation, onOpen, excerpt }) {
  const duration = formatDurationLabel(conversation.duration_s)
  const Icon = KIND_ICON[conversation.source_type] || IconFile
  const preview = excerpt || previewOf(conversation)
  return (
    <li>
      <div
        className="conversation-row"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
        }}
      >
        <Icon className="row-icon" width={15} height={15} />
        <div className="row-body">
          <div className="row-head">
            <span className="row-title">{displayTitle(conversation)}</span>
            <span className="row-when">
              {/* O ponto só separa se houver duas coisas para separar. */}
              {duration && <>{duration}<span className="dot-sep"> · </span></>}
              {formatCapturedAt(conversation.created_at)}
            </span>
          </div>
          {preview && <span className="row-excerpt">{preview}</span>}
        </div>
      </div>
    </li>
  )
}
