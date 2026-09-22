import { useEffect, useRef } from 'react'
import { usePlatform } from '../lib/platform'
import { sharedFileToFile } from '../lib/sharedContent'
import { useCapture } from './capture/useCapture'
import { useOutletContext } from 'react-router-dom'
import { modoRecomendado, MODO_SIMPLES } from './capture/modos'
import { planoPorId } from '../lib/planos'
import { readMediaDuration } from './capture/estimate'
import CaptureWeb from './capture/CaptureWeb'
import CaptureNative from './capture/CaptureNative'

// Superfície de captura. A regra vive em useCapture (uma só, compartilhada); o
// que muda entre celular e desktop é apenas a tela — arrastar arquivo, textos e
// alvos de toque. Escolher aqui, num ponto só, é o que permite as duas
// plataformas divergirem sem duplicar lógica de negócio.
//
// Chama onResult(result, sourceType, sourceName, mode) quando uma transcrição
// termina — `mode` é a profundidade que o usuário escolheu no botão de
// transcrever ('simples' ou 'completa'), e decide em que tela ele cai. `variant="hero"` aumenta o botão de gravar na tela inicial;
// "compact" é usado dentro de uma pasta.
//
// `autoCapture` vem do "Compartilhar" de outro app: { kind: 'url', url } ou
// { kind: 'file', path, name }. Processa sozinho, sem o usuário tocar em nada.
//
// `extraLoading` deixa a tela de processamento acesa por mais tempo do que o
// próprio hook pediria — usado pelo Home para cobrir o intervalo entre a
// transcrição terminar e a sugestão de pasta chegar, sem esse hiato mostrar a
// tela normal por trás.
export default function CapturePanel({ onResult, variant = 'hero', mode = 'record', autoCapture = null, onAutoCaptureDone, extraLoading = false, onVerPlanos }) {
  const { isNative, isMobile } = usePlatform()
  const { plano } = useOutletContext() || {}
  // O compartilhamento de outro app processa sozinho, sem o botão onde o
  // cadeado aparece: no Grátis a escolha automática já nasce simples.
  const modoAutomatico = opcoes => (
    !plano || planoPorId(plano).completa ? modoRecomendado(opcoes) : MODO_SIMPLES
  )
  const capture = useCapture({ onResult })
  const handledRef = useRef(null)

  // A janelinha flutuante subiu para o GravacaoProvider junto com a gravação:
  // ela mostra o que está sendo gravado, e não a tela onde a pessoa está. Aqui
  // ela só é repassada para as views, que desenham o botão de destacar.
  const { mini } = capture

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
          await capture.submitUrl(autoCapture.url, modoAutomatico({ origem: 'url' }))
        } else {
          const file = await sharedFileToFile(autoCapture)
          if (cancelled) return
          // O compartilhamento processa sozinho, sem tela onde escolher — então
          // a recomendação vira a escolha. É o mesmo critério do botão: a
          // duração manda, e sem ela um arquivo compartilhado vale como áudio
          // curto.
          const durationSec = await readMediaDuration(file)
          if (cancelled) return
          await capture.sendFile(file, modoAutomatico({ origem: 'file', durationSec }), durationSec)
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
      <View capture={viewCapture} variant={variant} mode={mode} mini={mini} onVerPlanos={onVerPlanos} />
    </div>
  )
}
