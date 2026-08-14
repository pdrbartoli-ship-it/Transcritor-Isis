import { usePlatform } from '../lib/platform'
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
export default function CapturePanel({ onResult, variant = 'hero' }) {
  const { isNative, isMobile } = usePlatform()
  const capture = useCapture({ onResult })

  // O app empacotado é sempre a versão de celular; no navegador, decide o
  // tamanho da tela — quem abre o site no celular merece a mesma interface.
  const View = isNative || isMobile ? CaptureNative : CaptureWeb
  return <View capture={capture} variant={variant} />
}
