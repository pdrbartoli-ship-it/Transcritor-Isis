import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useLocation, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { createConversation, seedChatWithSummary } from '../lib/conversas'
import { MODO_SIMPLES } from '../components/capture/modos'
import CapturePanel from '../components/CapturePanel'
import ContadorMinutos from '../components/ContadorMinutos'
import { IconMic, IconLink, IconFile } from '../components/Icons'

// As três origens de captura. Viviam pequenas na barra lateral; centralizadas
// e maiores aqui, é a primeira coisa que a home mostra — não uma nav perdida
// ao lado do resto da navegação. Os rótulos dizem o que se faz em cada uma:
// "Áudio" aceitava vídeo e "Vídeo" era, na verdade, colar um link.
const CAPTURE_MODES = [
  { to: '/', label: 'Gravar', Icon: IconMic },
  { to: '/audio', label: 'Arquivo', Icon: IconFile },
  { to: '/video', label: 'Link', Icon: IconLink },
]

export default function Home({ mode = 'record' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { refreshConversations, abrirPlano, saldo, convidado } = useOutletContext()
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
  //
  // Onde ele cai depende do que pediu. A transcrição completa abre na visão
  // geral, que é onde moram os tópicos, as tarefas e a linha do tempo. A
  // simples abre direto no chat, com o resumo já como primeira mensagem: ali o
  // resumo É o resultado, e o que vem depois dele é uma pergunta.
  async function handleResult(result, sourceType, sourceName, mode) {
    setSaving(true)
    setError(null)
    try {
      // O convidado (sem conta, sem senha) não tem chave de criptografia
      // possível — a conversa dele nasce em texto puro, não cifrada.
      const cifrar = !convidado
      const conversation = await createConversation(user.id, result, sourceType, sourceName, { cifrar })
      // Vale o modo que o backend RODOU, não o pedido: no plano Grátis um
      // pedido de completa (de uma versão antiga do app, que não conhece o
      // cadeado) é atendido como simples, e cairia numa tela sem tópicos.
      const simples = (result.mode || mode) === MODO_SIMPLES
      if (simples) await seedChatWithSummary(user.id, conversation.id, result.summary, { cifrar })
      await refreshConversations()
      navigate(`/conversa/${conversation.id}${simples ? '/chat' : ''}`)
    } catch (err) {
      setError(`Não foi possível salvar a conversa: ${err.message}`)
      setSaving(false)
    }
  }

  return (
    <div className="home">
      {/* O lugar do relógio existe antes de o saldo chegar: sem ele, o título
          desceria alguns pixels sozinho quando o contador aparecesse. */}
      <div className="home-topo">
        {saldo && <ContadorMinutos usados={saldo.usados} limite={saldo.limite} convidado={convidado} />}
      </div>

      <div className="home-capture">
        {/* Nomeia a tarefa, sem cumprimento de chatbot. O subtítulo que repetia
            "grave, envie ou cole" saiu: as abas logo abaixo já dizem isso. */}
        <div className="home-greeting">
          <h1>Nova conversa</h1>
        </div>

        <nav className="capture-nav home-capture-nav" aria-label="O que você quer transcrever">
          {CAPTURE_MODES.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon width={18} height={18} /> {label}
            </NavLink>
          ))}
        </nav>

        <CapturePanel
          onVerPlanos={abrirPlano}
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
