import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useLocation, NavLink } from 'react-router-dom'
import CapturePanel from '../components/CapturePanel'
import ContadorMinutos from '../components/ContadorMinutos'
import { PainelEmAndamento } from '../components/EmAndamento'
import { useGravacaoAtual } from '../contexts/GravacaoContext'
import { IconMic, IconWhatsapp, IconYoutube } from '../components/Icons'

// As três origens de captura. Viviam pequenas na barra lateral; centralizadas
// e maiores aqui, é a primeira coisa que a home mostra — não uma nav perdida
// ao lado do resto da navegação. Os rótulos dizem o que se faz em cada uma:
// "Áudio" aceitava vídeo e "Vídeo" era, na verdade, colar um link.
const CAPTURE_MODES = [
  { to: '/', label: 'Gravação', Icon: IconMic },
  { to: '/audio', label: 'Áudio', Icon: IconWhatsapp },
  { to: '/video', label: 'Vídeo', Icon: IconYoutube },
]

export default function Home({ mode = 'record' }) {
  const navigate = useNavigate()
  const { abrirPlano, saldo, convidado } = useOutletContext()
  const location = useLocation()
  const { isRecording, isFinalizing, recordedBlob } = useGravacaoAtual()

  const [shared, setShared] = useState(null)   // vindo do "Compartilhar" de outro app

  // O Layout deposita aqui o que foi compartilhado. Limpamos o state da rota em
  // seguida para que voltar a esta tela não reprocesse o mesmo conteúdo.
  useEffect(() => {
    if (!location.state?.shared) return
    setShared(location.state.shared)
    navigate('.', { replace: true, state: null })
  }, [location.state, navigate])

  // Gravar é um modo, e não mais um estado do botão: enquanto grava (e
  // enquanto revisa o que gravou), somem o título e as abas. Trocar de aba no
  // meio de uma reunião não faz sentido, e a tela inteira fica para o que está
  // acontecendo agora: o tempo, a onda da voz e o botão de parar.
  const gravando = mode === 'record' && (isRecording || isFinalizing || !!recordedBlob)

  return (
    <div className={`home ${gravando ? 'gravando' : ''}`}>
      {/* O lugar do relógio existe antes de o saldo chegar: sem ele, o título
          desceria alguns pixels sozinho quando o contador aparecesse. No
          celular ele mora no topo da tela (Layout), e este some. */}
      <div className="home-topo">
        {saldo && <ContadorMinutos usados={saldo.usados} limite={saldo.limite} extra={saldo.minutosExtra} convidado={convidado} />}
      </div>

      <div className="home-capture">
        {!gravando && (
          <>
            {/* Nomeia a tarefa, sem cumprimento de chatbot. */}
            <div className="home-greeting">
              <h1>O que você quer transcrever?</h1>
            </div>

            <nav className="capture-nav home-capture-nav" aria-label="O que você quer transcrever">
              {CAPTURE_MODES.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>
                  <Icon width={22} height={22} /> {label}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        <CapturePanel
          onVerPlanos={abrirPlano}
          variant="hero"
          mode={mode}
          autoCapture={shared}
          onAutoCaptureDone={() => setShared(null)}
        />

        {/* O que já foi mandado e ainda está sendo transcrito. No celular a
            lateral fica escondida, e quem acabou de tocar em "Transcrever"
            precisa ver, ali mesmo, que o pedido foi aceito. */}
        {!gravando && <PainelEmAndamento />}
      </div>
    </div>
  )
}
