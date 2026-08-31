import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePlatform } from '../lib/platform'
import { sharedFileToFile } from '../lib/sharedContent'
import { useCapture } from './capture/useCapture'
import { useMiniRecorder } from './recorder/useMiniRecorder'
import MiniRecorder from './recorder/MiniRecorder'
import CaptureWeb from './capture/CaptureWeb'
import CaptureNative from './capture/CaptureNative'

// Superfície de captura. A regra vive em useCapture (uma só, compartilhada); o
// que muda entre celular e desktop é apenas a tela — arrastar arquivo, textos e
// alvos de toque. Escolher aqui, num ponto só, é o que permite as duas
// plataformas divergirem sem duplicar lógica de negócio.
//
// Chama onResult(result, sourceType, sourceName) quando uma transcrição
// termina. `variant="hero"` aumenta o botão de gravar na tela inicial;
// "compact" é usado dentro de uma pasta.
//
// `autoCapture` vem do "Compartilhar" de outro app: { kind: 'url', url } ou
// { kind: 'file', path, name }. Processa sozinho, sem o usuário tocar em nada.
//
// `extraLoading` deixa a tela de processamento acesa por mais tempo do que o
// próprio hook pediria — usado pelo Home para cobrir o intervalo entre a
// transcrição terminar e a sugestão de pasta chegar, sem esse hiato mostrar a
// tela normal por trás.
export default function CapturePanel({ onResult, variant = 'hero', mode = 'record', autoCapture = null, onAutoCaptureDone, extraLoading = false }) {
  const { isNative, isMobile } = usePlatform()
  const capture = useCapture({ onResult })
  const handledRef = useRef(null)

  // A janelinha flutuante mora aqui, e não dentro de CaptureWeb/CaptureNative,
  // porque é aqui que a gravação existe: as duas telas são só desenho, e a
  // janelinha precisa da mesma gravação que elas mostram.
  const mini = useMiniRecorder({
    isRecording: capture.isRecording,
    isPaused: capture.isPaused,
    startedAt: capture.startedAt,
    pausedMs: capture.pausedMs,
    pausedAt: capture.pausedAt,
    onPause: capture.pauseRecording,
    onResume: capture.resumeRecording,
    onStop: capture.stopRecording,
  })

  useEffect(() => {
    if (!autoCapture) return
    // Um mesmo compartilhamento não pode ser processado duas vezes se o
    // componente re-renderizar antes de terminar.
    const token = autoCapture.url || autoCapture.path
    if (handledRef.current === token) return
    handledRef.current = token

    let cancelled = false
    ;(async () => {
      try {
        if (autoCapture.kind === 'url') {
          await capture.submitUrl(autoCapture.url)
        } else {
          const file = await sharedFileToFile(autoCapture)
          if (!cancelled) await capture.submitFile(file)
        }
      } catch (err) {
        if (!cancelled) capture.setError(err.message)
      } finally {
        if (!cancelled) onAutoCaptureDone?.()
      }
    })()
    return () => { cancelled = true }
    // capture muda a cada render; depender só do conteúdo compartilhado é o
    // que mantém este efeito disparando uma vez por compartilhamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture])

  // O app empacotado é sempre a versão de celular; no navegador, decide o
  // tamanho da tela — quem abre o site no celular merece a mesma interface.
  const View = isNative || isMobile ? CaptureNative : CaptureWeb
  const viewCapture = extraLoading ? { ...capture, loading: true } : capture

  // A escolha da origem mora na barra lateral. Aqui fica só a superfície de
  // captura em si, sem moldura: o quadro em volta somava uma borda que não
  // dizia nada e encolhia o alvo. A altura mínima é o que mantém "Últimas
  // conversas" no mesmo lugar quando se troca de origem.
  return (
    <div className="capture-panel">
      <View capture={viewCapture} variant={variant} mode={mode} mini={mini} />
      {/* No navegador a janelinha é um documento separado, mas no MESMO
          contexto de JS: um portal desenha o React direto lá dentro, e o
          estado chega sem passar por evento nenhum. */}
      {mini.pipWindow && createPortal(
        <MiniRecorder
          seconds={capture.recordingTime}
          paused={capture.isPaused}
          onPause={capture.pauseRecording}
          onResume={capture.resumeRecording}
          onStop={() => { capture.stopRecording(); mini.close() }}
          onClose={mini.close}
        />,
        mini.pipWindow.document.body,
      )}
    </div>
  )
}
