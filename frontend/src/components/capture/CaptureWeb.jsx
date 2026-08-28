import { useState, useRef } from 'react'
import { IconMic, IconScreen, IconFile, IconLink } from '../Icons'
import { ACCEPTED_FILES, formatTime } from './estimate'
import { ProcessingBox, RecordingReview, UrlForm } from './CaptureShared'

// Captura no navegador de desktop: existe mouse, então arrastar arquivo faz
// sentido e o vocabulário é "clique".
export default function CaptureWeb({ capture, variant }) {
  const {
    loading, waking, error, elapsed, estimate,
    isRecording, recordedBlob, recordingTime, recordingKind,
    startRecording, startSystemRecording, stopRecording, resetRecording,
    submitRecording, submitFile, submitUrl,
  } = capture

  const [mode, setMode] = useState('file')
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
            <div className="record-btn-group">
              <div className="record-btn-item">
                <button
                  className={`record-btn ${variant === 'hero' ? 'hero' : ''} ${isRecording && recordingKind === 'mic' ? 'recording' : ''}`}
                  onClick={isRecording && recordingKind === 'mic' ? stopRecording : startRecording}
                  disabled={loading || (isRecording && recordingKind === 'system')}
                  aria-label={isRecording && recordingKind === 'mic' ? 'Parar gravação' : 'Gravar microfone'}
                >
                  <IconMic width={26} height={26} />
                </button>
                <p className="record-btn-caption">Microfone</p>
              </div>
              <div className="record-btn-item">
                <button
                  className={`record-btn ${variant === 'hero' ? 'hero' : ''} ${isRecording && recordingKind === 'system' ? 'recording' : ''}`}
                  onClick={isRecording && recordingKind === 'system' ? stopRecording : startSystemRecording}
                  disabled={loading || (isRecording && recordingKind === 'mic')}
                  aria-label={isRecording && recordingKind === 'system' ? 'Parar gravação' : 'Gravar reunião'}
                >
                  <IconScreen width={26} height={26} />
                </button>
                <p className="record-btn-caption">Reunião</p>
              </div>
            </div>
            <p className="record-label">
              {isRecording
                ? <><span className="rec-dot" /> {recordingKind === 'system' ? 'Gravando reunião' : 'Gravando'} — {formatTime(recordingTime)}</>
                : 'Clique para gravar'}
            </p>
            {variant === 'hero' && !isRecording && (
              <p className="mic-hint">
                Microfone: o navegador pede acesso na primeira vez. Reunião: escolha "Tela inteira" e marque o áudio do sistema ao compartilhar.
              </p>
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

      <div className="capture-divider">ou envie um arquivo / link</div>

      <div className="capture-secondary">
        <div className="capture-tabs">
          <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}><IconFile /> Arquivo</button>
          <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}><IconLink /> Link</button>
        </div>

        {mode === 'file' ? (
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
      </div>

      {error && <div className="alert alert-error">{error}</div>}
    </>
  )
}
