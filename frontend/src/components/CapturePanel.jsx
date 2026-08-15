import { useEffect, useRef } from 'react'
import { usePlatform } from '../lib/platform'
import { sharedFileToFile } from '../lib/sharedContent'
import { useCapture } from './capture/useCapture'
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
export default function CapturePanel({ onResult, variant = 'hero', autoCapture = null, onAutoCaptureDone }) {
  const { isNative, isMobile } = usePlatform()
  const capture = useCapture({ onResult })
  const handledRef = useRef(null)

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
  return <View capture={capture} variant={variant} />
}
