import { formatTime } from './estimate'
import { IconPause, IconPlay, IconPopOut } from '../Icons'

// Peças visuais idênticas nas duas plataformas. O que diverge (arrastar
// arquivo, textos do microfone, tamanho dos alvos de toque) fica em
// CaptureWeb/CaptureNative; o que não diverge fica aqui.

export function ProcessingBox({ waking, estimate, elapsed }) {
  if (waking) {
    return (
      <div className="processing-box">
        <div className="spinner" />
        <div className="processing-title">Acordando o servidor…</div>
        <div className="processing-hint">
          O servidor hiberna quando fica parado. Só na primeira vez isso leva alguns segundos —
          estamos esperando ele subir antes de enviar seu arquivo.
        </div>
      </div>
    )
  }

  // Enquanto a estimativa se sustenta, mostramos quanto falta; se estourar,
  // voltamos ao tempo decorrido em vez de exibir um contador travado em zero.
  const remaining = estimate ? Math.max(0, estimate - elapsed) : 0
  // O aviso de hibernação só faz sentido depois que a estimativa acabou.
  const overEstimate = estimate ? elapsed >= estimate : elapsed >= 12

  return (
    <div className="processing-box">
      <div className="spinner" />
      <div className="processing-title">Transcrevendo e resumindo…</div>
      <div className="processing-hint">
        {remaining > 0
          ? <>Leva de alguns segundos a poucos minutos, conforme a duração do áudio. Tempo estimado: {formatTime(remaining)}</>
          : <>Leva de alguns segundos a poucos minutos, conforme a duração do áudio. Tempo decorrido: {elapsed}s</>}
      </div>
      {overEstimate && (
        <div className="processing-warn">
          O servidor pode ter hibernado — a primeira vez demora mais. Já estamos quase lá.
        </div>
      )}
      <div className="processing-hint">⚠️ Não feche nem saia desta tela enquanto processa.</div>
    </div>
  )
}

// Controles que só existem com uma gravação em andamento: pausar/retomar e
// destacar numa janelinha flutuante. Antes o botão grande era tudo — começar e
// encerrar — e não havia como interromper sem encerrar de vez.
//
// "Destacar" só aparece onde a janelinha existe de verdade (app nativo, ou
// Chrome/Edge no desktop). No app nativo ela também aparece sozinha quando o
// Dito é minimizado; o botão é para quem quer deixá-la à vista antes disso.
export function RecordingControls({ paused, onPause, onResume, mini }) {
  return (
    <div className="record-controls">
      <button className="btn-ghost btn-sm" onClick={paused ? onResume : onPause}>
        {paused
          ? <><IconPlay width={14} height={14} /> Retomar</>
          : <><IconPause width={14} height={14} /> Pausar</>}
      </button>
      {mini?.supported && !mini.isOpen && (
        <button className="btn-ghost btn-sm" onClick={mini.open}>
          <IconPopOut width={14} height={14} /> Destacar
        </button>
      )}
    </div>
  )
}

export function RecordingReview({ recordingTime, onSubmit, onReset, loading }) {
  return (
    <>
      <p className="record-label">Gravação concluída — {formatTime(recordingTime)}</p>
      <div className="record-actions">
        <button className="btn-primary" onClick={onSubmit} disabled={loading}>
          {loading ? <><span className="spinner spinner-sm" /> Processando...</> : 'Transcrever'}
        </button>
        <button className="btn-ghost" onClick={onReset} disabled={loading}>Regravar</button>
      </div>
    </>
  )
}

export function UrlForm({ url, setUrl, onSubmit, loading }) {
  return (
    <form className="url-form" onSubmit={onSubmit}>
      <input
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="Cole um link do YouTube"
        disabled={loading}
      />
      <button type="submit" className="btn-primary" disabled={loading || !url.trim()}>
        {loading ? '...' : 'Processar'}
      </button>
    </form>
  )
}

// Rótulo do painel. "Arquivos" sozinho não conta a ninguém que dá para jogar
// ali o áudio do WhatsApp — o título é onde isso é dito.
export const MODE_TITLE = {
  file: 'Transcreva áudios do WhatsApp',
  url: 'Transcreva vídeos do YouTube',
}
