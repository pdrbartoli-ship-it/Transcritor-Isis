import { useState, useRef } from 'react'
import { IconMic } from '../Icons'
import { ACCEPTED_FILES, formatTime } from './estimate'
import { ProcessingBox, RecordingReview, UrlForm, CaptureSecondary } from './CaptureShared'

// Captura no navegador de desktop: existe mouse, então arrastar arquivo faz
// sentido e o vocabulário é "clique".
export default function CaptureWeb({ capture, variant }) {
  const {
    loading, waking, error, elapsed, estimate,
    isRecording, recordedBlob, recordingTime,
    startRecording, stopRecording, resetRecording,
    submitRecording, submitFile, submitUrl,
  } = capture

  const [url, setUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  async function handleUrl(e) {
    e.preventDefault()
    if (await submitUrl(url)) setUrl('')
  }

  if (loading) return <ProcessingBox waking={waking} estimate={estimate} elapsed={elapsed} />

  return (
    <>
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
                : 'Clique para gravar'}
            </p>
            {variant === 'hero' && !isRecording && (
              <p className="mic-hint">Na primeira vez, o navegador vai pedir acesso ao microfone.</p>
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

      <CaptureSecondary loading={loading}>
        {mode => mode === 'file' ? (
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${loading ? 'is-loading' : ''}`}
            onClick={() => !loading && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); submitFile(e.dataTransfer.files[0]) }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_FILES}
              style={{ display: 'none' }}
              onChange={e => submitFile(e.target.files[0])}
            />
            <p className="text-muted">Arraste um arquivo ou clique para selecionar</p>
            <p className="text-muted text-sm">Áudio ou vídeo — MP3, M4A, WAV, OGG, OPUS, MP4, MOV e outros</p>
          </div>
        ) : (
          <UrlForm url={url} setUrl={setUrl} onSubmit={handleUrl} loading={loading} />
        )}
      </CaptureSecondary>

      {error && <div className="alert alert-error">{error}</div>}
    </>
  )
}
