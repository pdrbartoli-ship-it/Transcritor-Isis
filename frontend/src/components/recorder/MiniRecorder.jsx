import { formatTime } from '../capture/estimate'
import { IconClose, IconPause, IconPlay, IconStopCircle } from '../Icons'

// A janelinha em si — só desenho, nenhuma regra de gravação. Os dois
// hospedeiros (a janela nativa do Windows e a janela de picture-in-picture do
// navegador) montam este mesmo componente, então a janelinha é idêntica nos
// dois e só existe uma versão dela para manter.
//
// `nativeDrag` só é ligado no app nativo: a janela não tem barra de título, e
// `data-tauri-drag-region` é o que deixa o usuário arrastá-la pelo corpo para
// tirá-la da frente do que está fazendo. Os botões são filhos sem o atributo,
// então continuam clicáveis em vez de arrastar a janela.
export default function MiniRecorder({
  seconds, paused, onPause, onResume, onStop, onClose, nativeDrag = false,
}) {
  return (
    <div className="mini-recorder" data-tauri-drag-region={nativeDrag ? '' : undefined}>
      <div className="mini-brand" aria-hidden="true">
        <span className="brand">D<span className="dot">.</span></span>
      </div>

      {/* As barras param de ondular quando pausado: o estado da gravação
          precisa ser legível de relance, sem ler o texto. */}
      <div className={`mini-wave ${paused ? 'paused' : ''}`} aria-hidden="true">
        {[0, 1, 2, 3, 4].map(i => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
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
