import { useState, useRef } from 'react'
import { IconMic } from '../Icons'
import { formatTime } from './estimate'
import { ProcessingBox, RecordingReview, LinkOrFile } from './CaptureShared'

// Captura no celular. Diferenças reais em relação ao desktop:
// - não existe arrastar arquivo: o alvo vira um botão de toque, sem a área
//   pontilhada que no touch só ocupa espaço e não sugere nada;
// - o vocabulário é "toque", não "clique";
// - o aviso do microfone fala de permissão do aparelho, não do navegador —
//   é lá que o usuário precisa ir resolver.
export default function CaptureNative({ capture, variant }) {
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
          hint="Ou toque no clipe para enviar um áudio ou vídeo — do WhatsApp, gravação de reunião, etc."
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
    </>
  )
}
