import { useState } from 'react'
import { IconFile, IconLink } from '../Icons'
import { formatTime } from './estimate'

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


// Arquivos e Link ficam recolhidos até serem pedidos. Antes eram abas sempre
// abertas, o que deixava uma área de soltar arquivo permanentemente na tela e
// competindo com o botão de gravar — que é o que o usuário quase sempre quer.
// Cada um abre com um título dizendo para que serve, porque "Arquivos" sozinho
// não conta a ninguém que dá para jogar ali o áudio do WhatsApp.
export function CaptureSecondary({ loading, children }) {
  const [open, setOpen] = useState(null)
  const toggle = key => setOpen(open === key ? null : key)

  return (
    <div className="capture-secondary">
      <div className="capture-options">
        <button
          className={`capture-option ${open === 'file' ? 'open' : ''}`}
          onClick={() => toggle('file')}
          disabled={loading}
          aria-expanded={open === 'file'}
        >
          <IconFile width={18} height={18} />
          Arquivos
        </button>
        <button
          className={`capture-option ${open === 'url' ? 'open' : ''}`}
          onClick={() => toggle('url')}
          disabled={loading}
          aria-expanded={open === 'url'}
        >
          <IconLink width={18} height={18} />
          Link
        </button>
      </div>

      {open && (
        <div className="capture-drawer">
          <p className="capture-drawer-title">
            {open === 'file' ? 'Transcreva áudios do WhatsApp' : 'Transcreva vídeos do YouTube'}
          </p>
          {children(open)}
        </div>
      )}
    </div>
  )
}
