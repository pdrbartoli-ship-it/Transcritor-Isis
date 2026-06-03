import { useState, useRef, useEffect } from 'react'
import { transcribeFile, processUrl } from '../lib/api'

// Reusable capture surface: a central record button plus a secondary
// file/link area. Calls onResult(result, sourceType, sourceName) when a
// transcription finishes. `variant="hero"` enlarges the record button for the
// home screen; "compact" is used inside a folder.
export default function CapturePanel({ onResult, variant = 'hero' }) {
  const [mode, setMode] = useState('file')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const fileRef = useRef()

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  function resetRecording() {
    setRecordedBlob(null)
    setRecordingTime(0)
    setIsRecording(false)
    chunksRef.current = []
  }

  async function startRecording() {
    setError(null)
    resetRecording()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        setRecordedBlob(new Blob(chunksRef.current, { type: 'audio/webm' }))
        clearInterval(timerRef.current)
      }
      recorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch {
      setError('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    clearInterval(timerRef.current)
  }

  async function runCapture(fn) {
    setLoading(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function handleRecording() {
    if (!recordedBlob) return
    const result = await runCapture(() => {
      const file = new File([recordedBlob], 'gravacao.webm', { type: 'audio/webm' })
      return transcribeFile(file)
    })
    if (result) { onResult(result, 'file', 'Gravação de áudio'); resetRecording() }
  }

  async function handleFile(file) {
    if (!file) return
    const result = await runCapture(() => transcribeFile(file))
    if (result) onResult(result, 'file', file.name)
  }

  async function handleUrl(e) {
    e.preventDefault()
    if (!url.trim()) return
    const result = await runCapture(() => processUrl(url.trim()))
    if (result) { onResult(result, 'url', url.trim()); setUrl('') }
  }

  function formatTime(s) {
    const m = String(Math.floor(s / 60)).padStart(2, '0')
    const sec = String(s % 60).padStart(2, '0')
    return `${m}:${sec}`
  }

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
              <span className="record-icon" />
            </button>
            <p className="record-label">
              {loading ? (
                <><span className="spinner spinner-sm" /> Processando...</>
              ) : isRecording ? (
                <><span className="rec-dot" /> Gravando — {formatTime(recordingTime)}</>
              ) : (
                'Clique para gravar'
              )}
            </p>
          </>
        ) : (
          <>
            <p className="record-label">Gravação concluída — {formatTime(recordingTime)}</p>
            <div className="record-actions">
              <button className="btn-primary" onClick={handleRecording} disabled={loading}>
                {loading ? <><span className="spinner spinner-sm" /> Processando...</> : 'Transcrever'}
              </button>
              <button className="btn-ghost" onClick={resetRecording} disabled={loading}>Regravar</button>
            </div>
          </>
        )}
      </div>

      <div className="capture-divider">ou envie um arquivo / link</div>

      <div className="capture-secondary">
        <div className="capture-tabs">
          <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Arquivo</button>
          <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>Link</button>
        </div>

        {mode === 'file' ? (
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${loading ? 'is-loading' : ''}`}
            onClick={() => !loading && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov,.avi"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />
            <p className="text-muted">Arraste um arquivo ou clique para selecionar</p>
            <p className="text-muted text-sm">MP3, M4A, WAV, MP4, MOV</p>
          </div>
        ) : (
          <form className="url-form" onSubmit={handleUrl}>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Cole um link do YouTube, Instagram, TikTok..."
              disabled={loading}
            />
            <button type="submit" className="btn-primary" disabled={loading || !url.trim()}>
              {loading ? '...' : 'Processar'}
            </button>
          </form>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
    </>
  )
}
