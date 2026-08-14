import { useState, useRef, useEffect } from 'react'
import { transcribeFile, processUrl, wakeBackend } from '../../lib/api'
import { getPrefs } from '../../lib/prefs'
import { estimateSeconds, readMediaDuration } from './estimate'

// Toda a regra de captura — gravar, enviar arquivo, processar link, estimar
// tempo e tratar erro. As telas (CaptureWeb, CaptureNative) só desenham; nada
// de lógica de negócio duplicada entre plataformas.
//
// A gravação aqui é a do navegador (MediaRecorder). A versão nativa vai
// substituir apenas essa parte por um serviço em segundo plano, mantendo o
// resto — que é justamente o motivo de separar.
export function useCapture({ onResult }) {
  const [loading, setLoading] = useState(false)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [estimate, setEstimate] = useState(null) // segundos previstos, null = desconhecido

  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [recordingTime, setRecordingTime] = useState(0)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  // Conta os segundos enquanto processa + avisa antes de sair da página.
  useEffect(() => {
    if (!loading) { setElapsed(0); return }
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { clearInterval(t); window.removeEventListener('beforeunload', warn) }
  }, [loading])

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
    } catch (err) {
      setError(micErrorMessage(err))
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    clearInterval(timerRef.current)
  }

  async function runCapture(fn, estimateSec = null) {
    setEstimate(estimateSec)
    setLoading(true)
    setError(null)
    // O plano gratuito do Render hiberna: mandar o arquivo para uma instância
    // dormindo derrubava a conexão no meio do upload ("Failed to fetch").
    // Acordamos antes e só então enviamos.
    setWaking(true)
    try {
      await wakeBackend()
    } catch {
      // Não conseguir acordar não impede a tentativa de envio.
    }
    setWaking(false)
    try {
      return await fn()
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
      setEstimate(null)
    }
  }

  // Evita criar uma sessão inútil a partir de uma gravação muda ou de um
  // arquivo sem fala.
  function isEmpty(result) {
    return !result?.transcript || result.transcript.trim().length < 5
  }

  async function submitRecording() {
    if (!recordedBlob) return
    // resetRecording() zera recordingTime mais adiante — ler a duração antes.
    const seconds = estimateSeconds({ kind: 'audio', durationSec: recordingTime, bytes: recordedBlob.size })
    const result = await runCapture(() => {
      const file = new File([recordedBlob], 'gravacao.webm', { type: 'audio/webm' })
      return transcribeFile(file, getPrefs())
    }, seconds)
    if (!result) return
    if (isEmpty(result)) {
      setError('Não captamos áudio suficiente. Tente gravar novamente, mais perto do microfone.')
      resetRecording()
      return
    }
    onResult(result, 'file', 'Gravação de áudio')
    resetRecording()
  }

  async function submitFile(file) {
    if (!file) return
    const durationSec = await readMediaDuration(file)
    const seconds = estimateSeconds({
      kind: file.type.startsWith('video/') ? 'video' : 'audio',
      durationSec,
      bytes: file.size,
    })
    const result = await runCapture(() => transcribeFile(file, getPrefs()), seconds)
    if (!result) return
    if (isEmpty(result)) { setError('Não conseguimos extrair áudio/texto deste arquivo.'); return }
    onResult(result, 'file', file.name)
  }

  async function submitUrl(url) {
    const clean = url.trim()
    if (!clean) return false
    const result = await runCapture(
      () => processUrl(clean, getPrefs()),
      estimateSeconds({ kind: 'link' }),
    )
    if (!result) return false
    if (isEmpty(result)) { setError('Não conseguimos extrair conteúdo deste link.'); return false }
    // Nomeia a sessão pelo título do vídeo/página, não pela URL crua.
    onResult(result, 'url', result.title?.trim() || clean)
    return true
  }

  return {
    loading, waking, error, setError,
    elapsed, estimate,
    isRecording, recordedBlob, recordingTime,
    startRecording, stopRecording, resetRecording,
    submitRecording, submitFile, submitUrl,
  }
}

// O `catch` genérico de antes dizia sempre "verifique as permissões do
// navegador", mesmo quando o problema era outro. Os nomes de erro do
// getUserMedia são padronizados, então dá para ser específico.
function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Acesso ao microfone negado. Autorize o microfone nas permissões e tente de novo.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado neste aparelho.'
    case 'NotReadableError':
      return 'O microfone está em uso por outro aplicativo. Feche-o e tente de novo.'
    default:
      return 'Não foi possível acessar o microfone. Verifique as permissões e tente de novo.'
  }
}
