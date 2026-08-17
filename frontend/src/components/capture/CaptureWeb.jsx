import { useState, useRef } from 'react'
import { IconMic } from '../Icons'
import { formatTime } from './estimate'
import { ProcessingBox, RecordingReview, LinkOrFile } from './CaptureShared'

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

      <div className="capture-divider">ou envie um arquivo / link</div>

      <div className="capture-secondary">
        <LinkOrFile
          url={url}
          setUrl={setUrl}
          onSubmitUrl={handleUrl}
          loading={loading}
          fileRef={fileRef}
          onPickFile={() => !loading && fileRef.current?.click()}
          onFileChange={e => submitFile(e.target.files[0])}
          hint="Ou arraste aqui um arquivo de áudio ou vídeo — MP3, M4A, WAV, OGG, OPUS, MP4, MOV e outros"
          dragOver={dragOver}
          dragProps={{
            onDragOver: e => { e.preventDefault(); setDragOver(true) },
            onDragLeave: () => setDragOver(false),
            onDrop: e => { e.preventDefault(); setDragOver(false); submitFile(e.dataTransfer.files[0]) },
          }}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
    </>
  )
}
