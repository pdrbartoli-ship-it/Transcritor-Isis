import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from './AuthContext'
import { useGravacao } from '../components/capture/useGravacao'
import { useMiniRecorder } from '../components/recorder/useMiniRecorder'
import MiniRecorder from '../components/recorder/MiniRecorder'

// A gravação vive AQUI, acima das rotas, e não dentro do painel de captura.
//
// Antes ela morava no painel, que vive na home: abrir uma conversa da barra
// lateral no meio de uma reunião desmontava o painel, o JS perdia cronômetro e
// áudio, e o Rust continuava gravando sozinho — a gravação seguinte falhava com
// "já existe uma gravação em andamento".
//
// Acima das ROTAS, e não dentro do Layout: a casca do app desmonta ao ir para
// o login ou para a volta do pagamento, e uma gravação não pode depender de a
// pessoa não sair da casca no meio. (Até 25/09/2026 a home e as conversas
// tinham cada uma o seu <Layout>, e bastava abrir uma conversa.)
//
// A janelinha flutuante vem junto pelo mesmo motivo: ela mostra a gravação, e
// não a tela. Presa ao painel, ela sumia quando a pessoa saía da home.
const GravacaoContext = createContext(null)

export function useGravacaoAtual() {
  const valor = useContext(GravacaoContext)
  if (!valor) throw new Error('useGravacaoAtual precisa de um GravacaoProvider acima na árvore')
  return valor
}

export function GravacaoProvider({ children }) {
  const { user } = useAuth()
  const gravacao = useGravacao({ userId: user?.id, convidado: !!user?.is_anonymous })

  const mini = useMiniRecorder({
    isRecording: gravacao.isRecording,
    isPaused: gravacao.isPaused,
    startedAt: gravacao.startedAt,
    pausedMs: gravacao.pausedMs,
    pausedAt: gravacao.pausedAt,
    onPause: gravacao.pauseRecording,
    onResume: gravacao.resumeRecording,
    onStop: gravacao.stopRecording,
  })

  return (
    <GravacaoContext.Provider value={{ ...gravacao, mini }}>
      {children}
      {/* No navegador a janelinha é um documento separado, mas no MESMO
          contexto de JS: um portal desenha o React direto lá dentro, e o
          estado chega sem passar por evento nenhum. */}
      {mini.pipWindow && createPortal(
        <MiniRecorder
          seconds={gravacao.recordingTime}
          paused={gravacao.isPaused}
          getLevel={gravacao.getLevel}
          onPause={gravacao.pauseRecording}
          onResume={gravacao.resumeRecording}
          onStop={() => { gravacao.stopRecording(); mini.close() }}
          onClose={mini.close}
        />,
        mini.pipWindow.document.body,
      )}
    </GravacaoContext.Provider>
  )
}
