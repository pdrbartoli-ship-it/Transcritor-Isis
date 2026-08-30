import { useState, useRef } from 'react'
import { IconMic, IconFile } from '../Icons'
import { ACCEPTED_FILES, formatTime } from './estimate'
import { ProcessingBox, RecordingReview, UrlForm, MODE_TITLE } from './CaptureShared'

// Captura no celular. Diferenças reais em relação ao desktop:
// - não existe arrastar arquivo: o alvo vira um botão de toque, sem a área
//   pontilhada que no touch só ocupa espaço e não sugere nada;
// - o vocabulário é "toque", não "clique";
// - o aviso do microfone fala de permissão do aparelho, não do navegador —
//   é lá que o usuário precisa ir resolver.
export default function CaptureNative({ capture, variant, mode = 'record' }) {
  const {
    loading, waking, error, elapsed, estimate,
    isRecording, recordedBlob, recordingTime,
    startRecording, stopRecording, resetRecording,
    submitRecording, submitFile, submitUrl,
  } = capture

  const [url, setUrl] = useState('')
  const fileRef = useRef()

  async function handleUrl(e) {
    e.preventDefault()
    if (await submitUrl(url)) setUrl('')
  }

  if (loading) return <ProcessingBox waking={waking} estimate={estimate} elapsed={elapsed} />

  return (
    <>
      {mode === 'record' && (
        <div className="hero-record">
          {!recordedBlob ? (
            <>
              <button
                className={`record-btn ${variant === 'hero' ? 'hero' : ''} ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={loading}
                aria-label={isRecording ? 'Parar gravação' : 'Iniciar gravação'}
              >
                <IconMic width={26} height={26} />
              </button>
              <p className="record-label">
                {isRecording
                  ? <><span className="rec-dot" /> Gravando — {formatTime(recordingTime)}</>
                  : 'Toque para gravar'}
              </p>
              {variant === 'hero' && !isRecording && (
                <p className="mic-hint">Mantenha a tela ligada enquanto grava.</p>
              )}
            </>
          ) : (
            <RecordingReview
              recordingTime={recordingTime}
              onSubmit={submitRecording}
              onReset={resetRecording}
              loading={loading}
            />
          )}
        </div>
      )}

      {mode === 'file' && (
        <div className="capture-mode">
          <p className="capture-mode-title">{MODE_TITLE.file}</p>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_FILES}
            style={{ display: 'none' }}
            onChange={e => submitFile(e.target.files[0])}
          />
          <button
            className="pick-file"
            onClick={() => !loading && fileRef.current?.click()}
            disabled={loading}
          >
            <IconFile width={18} height={18} />
            Escolher áudio ou vídeo
          </button>
          <p className="text-muted text-sm pick-file-hint">
            Serve áudio do WhatsApp, gravação de reunião, vídeo salvo — MP3, M4A, OGG, OPUS, MP4 e outros.
          </p>
        </div>
      )}

      {mode === 'url' && (
        <div className="capture-mode">
          <p className="capture-mode-title">{MODE_TITLE.url}</p>
          <UrlForm url={url} setUrl={setUrl} onSubmit={handleUrl} loading={loading} />
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
    </>
  )
}
