import { useEffect, useRef } from 'react'
import { formatTime } from '../capture/estimate'
import { IconClose, IconPause, IconPlay, IconStopCircle } from '../Icons'

// Cada barra responde a uma fração diferente do nível, senão as cinco subiriam
// e desceriam como um bloco só — que lê como uma barra de progresso, não como
// som. As do meio reagem mais, como num medidor de verdade.
const WAVE_WEIGHTS = [0.45, 0.8, 1, 0.75, 0.5]
const MIN_SCALE = 0.12
const GAIN = 1.8

// A janelinha em si — só desenho, nenhuma regra de gravação. Os dois
// hospedeiros (a janela nativa do Windows e a janela de picture-in-picture do
// navegador) montam este mesmo componente, então a janelinha é idêntica nos
// dois e só existe uma versão dela para manter.
//
// `getLevel` devolve o nível do áudio (0..1) no instante em que é chamado. É
// uma função, e não um valor, de propósito: a onda se redesenha dezenas de
// vezes por segundo, e passá-la como prop faria o React reconciliar a árvore
// inteira a cada quadro. Aqui o laço escreve o `transform` direto no elemento.
//
// `nativeDrag` só é ligado no app nativo: a janela não tem barra de título, e
// `data-tauri-drag-region` é o que deixa o usuário arrastá-la pelo corpo para
// tirá-la da frente do que está fazendo. Os botões são filhos sem o atributo,
// então continuam clicáveis em vez de arrastar a janela.
export default function MiniRecorder({
  seconds, paused, getLevel, onPause, onResume, onStop, onClose, nativeDrag = false,
}) {
  const barsRef = useRef([])

  useEffect(() => {
    // O laço roda no requestAnimationFrame da janela em que este componente
    // está — que é a janelinha, sempre visível. O da janela principal é
    // congelado pelo navegador quando ela é minimizada, que é justamente
    // quando esta aqui está sendo olhada.
    const view = barsRef.current[0]?.ownerDocument?.defaultView || window
    let raf = null

    const draw = () => {
      const level = paused ? 0 : (getLevel?.() || 0)
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        const scale = Math.max(MIN_SCALE, Math.min(1, level * WAVE_WEIGHTS[i] * GAIN))
        bar.style.transform = `scaleY(${scale})`
      })
      raf = view.requestAnimationFrame(draw)
    }
    draw()
    return () => view.cancelAnimationFrame(raf)
  }, [getLevel, paused])

  return (
    <div className="mini-recorder" data-tauri-drag-region={nativeDrag ? '' : undefined}>
      <div className="mini-brand" aria-hidden="true">
        <span className="brand">D<span className="dot">.</span></span>
      </div>

      {/* A altura vem do áudio que está entrando, não de uma animação em laço:
          uma onda decorativa diria "estou captando" mesmo com o microfone mudo
          — exatamente quando o usuário mais precisa da verdade. Em silêncio as
          barras ficam no mínimo; pausado, idem. */}
      <div className={`mini-wave ${paused ? 'paused' : ''}`} aria-hidden="true">
        {WAVE_WEIGHTS.map((_, i) => (
          <span key={i} ref={el => { barsRef.current[i] = el }} />
        ))}
      </div>

      <div className="mini-status">
        <span className="mini-time">{formatTime(seconds)}</span>
        <span className="mini-label">{paused ? 'Pausado' : 'Gravando'}</span>
      </div>

      <div className="mini-actions">
        {paused ? (
          <button className="mini-btn" onClick={onResume} title="Retomar gravação" aria-label="Retomar gravação">
            <IconPlay width={15} height={15} />
          </button>
        ) : (
          <button className="mini-btn" onClick={onPause} title="Pausar gravação" aria-label="Pausar gravação">
            <IconPause width={15} height={15} />
          </button>
        )}
        <button className="mini-btn stop" onClick={onStop} title="Encerrar gravação" aria-label="Encerrar gravação">
          <IconStopCircle width={16} height={16} />
        </button>
        <button className="mini-btn close" onClick={onClose} title="Esconder esta janela (continua gravando)" aria-label="Esconder esta janela">
          <IconClose width={13} height={13} />
        </button>
      </div>
    </div>
  )
}
