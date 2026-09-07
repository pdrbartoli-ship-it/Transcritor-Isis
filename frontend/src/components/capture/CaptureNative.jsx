import { useState, useRef } from 'react'
import { IconMic, IconFile } from '../Icons'
import { ACCEPTED_FILES, formatTime } from './estimate'
import { ProcessingBox, RecordingReview, RecordingControls, FileReview, UrlForm, MODE_TITLE } from './CaptureShared'

// Captura no celular. Diferenças reais em relação ao desktop:
// - não existe arrastar arquivo: o alvo vira um botão de toque, sem a área
//   pontilhada que no touch só ocupa espaço e não sugere nada;
// - o vocabulário é "toque", não "clique";
// - o aviso do microfone fala de permissão do aparelho, não do navegador —
//   é lá que o usuário precisa ir resolver.
export default function CaptureNative({ capture, variant, mode = 'record', mini }) {
  const {
    loading, error, pendingFile,
    isRecording, isPaused, isFinalizing, recordedBlob, recordingTime,
    startRecording, stopRecording, resetRecording,
    pauseRecording, resumeRecording,
    pickFile, clearFile,
    submitRecording, submitFile, submitUrl,
  } = capture

  const [url, setUrl] = useState('')
  const fileRef = useRef()

  // `modo` aqui é a profundidade da transcrição, não o `mode` do painel (que
  // diz qual origem está aberta) — nomes diferentes para não confundir os dois.
  async function handleUrl(modo) {
    if (await submitUrl(url, modo)) setUrl('')
  }

  if (loading) return <ProcessingBox />

  return (
    <>
      {mode === 'record' && (
        <div className="hero-record">
          {!recordedBlob ? (
            <>
              <button
                className={`record-btn ${variant === 'hero' ? 'hero' : ''} ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={loading || isFinalizing}
                aria-label={isRecording ? 'Parar gravação' : 'Iniciar gravação'}
              >
                <IconMic width={26} height={26} />
              </button>
              <p className="record-label">
                {isRecording
                  ? <><span className={`rec-dot ${isPaused ? 'paused' : ''}`} /> {isPaused ? 'Pausado' : 'Gravando'} — {formatTime(recordingTime)}</>
                  : isFinalizing
                    ? <><span className="spinner spinner-sm" /> Finalizando a gravação — {formatTime(recordingTime)}</>
                    : 'Toque para gravar'}
              </p>
              {isRecording && !isFinalizing && (
                <RecordingControls
                  paused={isPaused}
                  onPause={pauseRecording}
                  onResume={resumeRecording}
                  mini={mini}
                />
              )}
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
            onChange={e => pickFile(e.target.files[0])}
          />
          {pendingFile ? (
            <FileReview
              pendingFile={pendingFile}
              onSubmit={submitFile}
              onReset={() => { clearFile(); fileRef.current.value = '' }}
              loading={loading}
            />
          ) : (
            <>
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
            </>
          )}
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
