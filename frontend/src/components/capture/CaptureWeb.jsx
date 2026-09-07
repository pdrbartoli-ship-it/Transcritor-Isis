import { useState, useRef } from 'react'
import { IconMic } from '../Icons'
import { ACCEPTED_FILES, formatTime } from './estimate'
import { ProcessingBox, RecordingReview, RecordingControls, FileReview, UrlForm, MODE_TITLE } from './CaptureShared'

// Captura no navegador de desktop: existe mouse, então arrastar arquivo faz
// sentido e o vocabulário é "clique". Cada origem tem a sua rota, e este
// componente mostra só a que está aberta — antes as três disputavam a mesma
// tela e a gaveta empurrava o resto da página para baixo ao abrir.
export default function CaptureWeb({ capture, variant, mode = 'record', mini }) {
  const {
    loading, error, pendingFile,
    isRecording, isPaused, isFinalizing, recordedBlob, recordingTime,
    startRecording, stopRecording, resetRecording,
    pauseRecording, resumeRecording,
    pickFile, clearFile,
    submitRecording, submitFile, submitUrl,
  } = capture

  const [url, setUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
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
                    : 'Clique para gravar'}
              </p>
              {isRecording && !isFinalizing && (
                <RecordingControls
                  paused={isPaused}
                  onPause={pauseRecording}
                  onResume={resumeRecording}
                  mini={mini}
                />
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
          {/* O input fica fora do ramo condicional: montá-lo só junto da área
              de soltar faria o React descartá-lo ao escolher um arquivo, e o
              seletor do navegador cancelaria a escolha em curso. */}
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
            <div
              className={`drop-zone ${dragOver ? 'drag-over' : ''} ${loading ? 'is-loading' : ''}`}
              onClick={() => !loading && fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]) }}
            >
              <p className="text-muted">Arraste um arquivo ou clique para selecionar</p>
              <p className="text-muted text-sm">Áudio ou vídeo — MP3, M4A, WAV, OGG, OPUS, MP4, MOV e outros</p>
            </div>
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
