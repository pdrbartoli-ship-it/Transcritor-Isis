import { useState, useRef, useEffect } from 'react'
import { transcribeFile, processUrl, wakeBackend } from '../../lib/api'
import { getPrefs } from '../../lib/prefs'
import { track } from '../../lib/analytics'
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
  // 'mic' (só microfone) ou 'system' (áudio do sistema + microfone) — decide
  // nome de arquivo, rótulo e qual botão fica desabilitado durante a gravação.
  const [recordingKind, setRecordingKind] = useState(null)

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
    setRecordingKind(null)
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
      setRecordingKind('mic')
      setIsRecording(true)
      setRecordingTime(0)
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      setError(micErrorMessage(err))
    }
  }

  // Grava tudo que sai das caixas de som do PC (reunião, vídeo, o que for),
  // misturado com o microfone — um único arquivo, igual à gravação normal.
  // Só existe em navegador desktop (CaptureWeb não entra no app nativo/mobile).
  async function startSystemRecording() {
    setError(null)
    resetRecording()
    let displayStream, micStream, audioCtx
    try {
      // video:true é exigido pelo Chrome pra oferecer a opção de "áudio do
      // sistema" no seletor — pedimos o menor tamanho possível já que não
      // usamos a imagem, só o áudio.
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1 },
        audio: true,
      })
      const systemAudioTracks = displayStream.getAudioTracks()
      if (systemAudioTracks.length === 0) {
        displayStream.getTracks().forEach(t => t.stop())
        setError('Nenhum áudio do sistema foi compartilhado. Ao compartilhar, escolha "Tela inteira" e marque a opção de áudio do sistema.')
        return
      }

      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        // Sem microfone disponível/autorizado: segue só com o áudio do sistema.
      }

      audioCtx = new AudioContext()
      const destination = audioCtx.createMediaStreamDestination()
      audioCtx.createMediaStreamSource(new MediaStream(systemAudioTracks)).connect(destination)
      if (micStream) audioCtx.createMediaStreamSource(micStream).connect(destination)

      const recorder = new MediaRecorder(destination.stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        displayStream.getTracks().forEach(t => t.stop())
        micStream?.getTracks().forEach(t => t.stop())
        audioCtx.close()
        setRecordedBlob(new Blob(chunksRef.current, { type: 'audio/webm' }))
        clearInterval(timerRef.current)
      }
      // Se a pessoa parar o compartilhamento pela barra do próprio Chrome
      // (em vez do botão do Dito), a gravação também precisa encerrar.
      displayStream.getVideoTracks()[0].onended = () => stopRecording()

      recorder.start()
      setRecordingKind('system')
      setIsRecording(true)
      setRecordingTime(0)
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      displayStream?.getTracks().forEach(t => t.stop())
      micStream?.getTracks().forEach(t => t.stop())
      audioCtx?.close()
      setError(systemAudioErrorMessage(err))
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
    const kind = recordingKind
    const filename = kind === 'system' ? 'gravacao-reuniao.webm' : 'gravacao.webm'
    const sourceName = kind === 'system' ? 'Gravação de reunião' : 'Gravação de áudio'
    // resetRecording() zera recordingTime mais adiante — ler a duração antes.
    const seconds = estimateSeconds({ kind: 'audio', durationSec: recordingTime, bytes: recordedBlob.size })
    const result = await runCapture(() => {
      const file = new File([recordedBlob], filename, { type: 'audio/webm' })
      return transcribeFile(file, getPrefs())
    }, seconds)
    if (!result) return
    if (isEmpty(result)) {
      setError('Não captamos áudio suficiente. Tente gravar novamente, mais perto do microfone.')
      resetRecording()
      return
    }
    track('captura', { origem: kind === 'system' ? 'gravacao_sistema' : 'gravacao', midia: 'audio', duracao_s: recordingTime, usage: result.usage })
    onResult(result, 'file', sourceName)
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
    track('captura', {
      origem: 'arquivo',
      midia: file.type.startsWith('video/') ? 'video' : 'audio',
      duracao_s: durationSec || null,
      usage: result.usage,
    })
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
    // A URL em si não é guardada: só o fato de ter vindo por link e o consumo.
    track('captura', { origem: 'link', midia: result.usage?.audio_seconds ? 'video' : 'texto', usage: result.usage })
    // Nomeia a sessão pelo título do vídeo/página, não pela URL crua.
    onResult(result, 'url', result.title?.trim() || clean)
    return true
  }

  return {
    loading, waking, error, setError,
    elapsed, estimate,
    isRecording, recordedBlob, recordingTime, recordingKind,
    startRecording, startSystemRecording, stopRecording, resetRecording,
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

// Idem, para o getDisplayMedia da gravação de sistema.
function systemAudioErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Compartilhamento cancelado. Clique em gravar reunião de novo e escolha o que compartilhar.'
    case 'NotReadableError':
      return 'Não foi possível capturar o áudio do sistema agora. Tente de novo.'
    default:
      return 'Não foi possível gravar o áudio do sistema. Verifique as permissões e tente de novo.'
  }
}
