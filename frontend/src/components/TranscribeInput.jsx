import { useState, useRef } from 'react'
import { transcribeFile, processUrl } from '../lib/api'

export default function TranscribeInput({ onResult }) {
  const [mode, setMode] = useState('file')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  async function handleFile(file) {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const result = await transcribeFile(file)
      onResult(result, 'file', file.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUrl(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await processUrl(url.trim())
      onResult(result, 'url', url.trim())
      setUrl('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="transcribe-input">
      <div className="input-tabs">
        <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Arquivo</button>
        <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>URL / Link</button>
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
          {loading ? (
            <>
              <div className="spinner" />
              <p>Processando... isso pode levar alguns minutos</p>
            </>
          ) : (
            <>
              <p>Arraste um arquivo ou clique para selecionar</p>
              <p className="text-muted text-sm">MP3, M4A, WAV, MP4, MOV</p>
            </>
          )}
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
            {loading ? 'Processando...' : 'Processar'}
          </button>
        </form>
      )}

      {error && <div className="alert alert-error">{error}</div>}
    </div>
  )
}
