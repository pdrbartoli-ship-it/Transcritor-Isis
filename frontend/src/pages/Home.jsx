import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useLocation, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { createConversation } from '../lib/conversas'
import CapturePanel from '../components/CapturePanel'
import { IconMic, IconLink, IconFile } from '../components/Icons'

// As três origens de captura. Viviam pequenas na barra lateral; centralizadas
// e maiores aqui, é a primeira coisa que a home mostra — não uma nav perdida
// ao lado do resto da navegação.
const CAPTURE_MODES = [
  { to: '/', label: 'Gravação', Icon: IconMic },
  { to: '/audio', label: 'Áudio', Icon: IconFile },
  { to: '/video', label: 'Vídeo', Icon: IconLink },
]

export default function Home({ mode = 'record' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { refreshConversations } = useOutletContext()
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
      <div className="home-capture">
        <div className="home-greeting">
          <h1>O que vamos registrar hoje?</h1>
          <p className="text-muted">Grave, envie um arquivo ou cole um link — a gente transcreve e organiza.</p>
        </div>

        <nav className="capture-nav home-capture-nav" aria-label="O que você quer transcrever">
          {CAPTURE_MODES.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon width={18} height={18} /> {label}
            </NavLink>
          ))}
        </nav>

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
    </div>
  )
}
