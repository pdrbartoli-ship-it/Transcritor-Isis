import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { readFile } from '@tauri-apps/plugin-fs'
import { transcribeFile, processUrl, wakeBackend } from '../../lib/api'
import { track } from '../../lib/analytics'
import { isTauriApp } from '../../lib/platform'
import { estimateSeconds, readMediaDuration } from './estimate'

// Toda a regra de captura — gravar, enviar arquivo, processar link, estimar
// tempo e tratar erro. As telas (CaptureWeb, CaptureNative) só desenham; nada
// de lógica de negócio duplicada entre plataformas.
//
// startRecording/stopRecording tratam duas gravações por trás do mesmo botão:
// dentro do app nativo (Windows/Tauri), invoke('start_recording'/'stop_recording')
// aciona a captura WASAPI (sistema + microfone, ver src-tauri/src/audio); no
// navegador comum é getUserMedia + MediaRecorder, só microfone, como sempre.
// O resto do fluxo (upload, estimativa, erro de transcrição vazia) é o mesmo
// pros dois casos — só o jeito de gravar muda.
export function useCapture({ onResult }) {
  const [loading, setLoading] = useState(false)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [estimate, setEstimate] = useState(null) // segundos previstos, null = desconhecido

  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [recordingTime, setRecordingTime] = useState(0)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const unlistenWarningRef = useRef(null)

  // O cronômetro contava +1 por tick de setInterval. Isso funciona enquanto a
  // janela está na frente e quebra exatamente quando ela não está: minimizada
  // (ou em aba de fundo) o navegador estrangula os timers, e a gravação
  // aparecia com metade do tempo que tinha de verdade. Guardando os instantes
  // e derivando o tempo de Date.now(), um tick atrasado só se corrige sozinho
  // no tick seguinte — e é o mesmo cálculo que a janelinha flutuante usa.
  const startedAtRef = useRef(null)
  const pausedMsRef = useRef(0)
  const pausedAtRef = useRef(null)

  function elapsedSeconds() {
    if (!startedAtRef.current) return 0
    const until = pausedAtRef.current ?? Date.now()
    return Math.max(0, Math.floor((until - startedAtRef.current - pausedMsRef.current) / 1000))
  }

  function startTimer() {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setRecordingTime(elapsedSeconds()), 500)
  }

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    unlistenWarningRef.current?.()
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
    setIsPaused(false)
    startedAtRef.current = null
    pausedMsRef.current = 0
    pausedAtRef.current = null
    chunksRef.current = []
  }

  function beginTiming() {
    startedAtRef.current = Date.now()
    pausedMsRef.current = 0
    pausedAtRef.current = null
    setRecordingTime(0)
    startTimer()
  }

  // Pausar no app nativo é o Rust parando de escrever no .wav (os dispositivos
  // seguem abertos); no navegador é o próprio MediaRecorder. Nos dois casos o
  // relógio para junto, senão o tempo mostrado não seria o tempo do áudio.
  async function pauseRecording() {
    if (!isRecording || pausedAtRef.current) return
    try {
      if (isTauriApp()) {
        await invoke('set_recording_paused', { paused: true })
      } else if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.pause()
      }
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Não foi possível pausar a gravação.')
      return
    }
    pausedAtRef.current = Date.now()
    setIsPaused(true)
    setRecordingTime(elapsedSeconds())
  }

  async function resumeRecording() {
    if (!isRecording || !pausedAtRef.current) return
    try {
      if (isTauriApp()) {
        await invoke('set_recording_paused', { paused: false })
      } else if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume()
      }
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Não foi possível retomar a gravação.')
      return
    }
    pausedMsRef.current += Date.now() - pausedAtRef.current
    pausedAtRef.current = null
    setIsPaused(false)
    startTimer()
  }

  async function startRecording() {
    setError(null)
    resetRecording()

    // Dentro do app nativo (Windows/Tauri) grava sistema + microfone
    // misturados via WASAPI (ver src-tauri/src/audio). No navegador comum
    // segue como sempre — getUserMedia + MediaRecorder, só microfone.
    if (isTauriApp()) {
      try {
        unlistenWarningRef.current = await listen('recording-warning', event => {
          setError(event.payload)
        })
        await invoke('start_recording')
        setIsRecording(true)
        beginTiming()
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Não foi possível iniciar a gravação.')
      }
      return
    }

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
      beginTiming()
    } catch (err) {
      setError(micErrorMessage(err))
    }
  }

  async function stopRecording() {
    // O tempo final é fixado ANTES de parar o relógio: `recordingTime` é o que
    // alimenta a estimativa de processamento mais adiante, e um último tick
    // que não chegasse a rodar deixaria a gravação com alguns segundos a menos.
    const finalSeconds = elapsedSeconds()

    if (isTauriApp()) {
      setIsRecording(false)
      setIsPaused(false)
      setRecordingTime(finalSeconds)
      clearInterval(timerRef.current)
      unlistenWarningRef.current?.()
      unlistenWarningRef.current = null
      try {
        const path = await invoke('stop_recording')
        const bytes = await readFile(path)
        setRecordedBlob(new Blob([bytes], { type: 'audio/wav' }))
      } catch (err) {
        setError(typeof err === 'string' ? err : 'Não foi possível finalizar a gravação.')
      }
      return
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    setIsPaused(false)
    setRecordingTime(finalSeconds)
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
    // Dentro do app nativo o blob já vem como .wav (lido do arquivo que o
    // Rust gravou); no navegador é o .webm de sempre do MediaRecorder.
    const filename = recordedBlob.type === 'audio/wav' ? 'gravacao.wav' : 'gravacao.webm'
    // resetRecording() zera recordingTime mais adiante — ler a duração antes.
    const seconds = estimateSeconds({ kind: 'audio', durationSec: recordingTime, bytes: recordedBlob.size })
    const result = await runCapture(() => {
      const file = new File([recordedBlob], filename, { type: recordedBlob.type })
      return transcribeFile(file)
    }, seconds)
    if (!result) return
    if (isEmpty(result)) {
      setError('Não captamos áudio suficiente. Tente gravar novamente, mais perto do microfone.')
      resetRecording()
      return
    }
    track('captura', { origem: 'gravacao', midia: 'audio', duracao_s: recordingTime, usage: result.usage })
    onResult(result, 'record', 'Gravação de áudio')
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
    const result = await runCapture(() => transcribeFile(file), seconds)
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
      () => processUrl(clean),
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
    isRecording, isPaused, recordedBlob, recordingTime,
    // Os instantes crus vazam de propósito: a janelinha flutuante calcula o
    // relógio dela a partir deles, em vez de receber um contador que atrasa
    // junto com os timers da janela minimizada.
    startedAt: startedAtRef.current,
    pausedMs: pausedMsRef.current,
    pausedAt: pausedAtRef.current,
    startRecording, stopRecording, resetRecording,
    pauseRecording, resumeRecording,
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
