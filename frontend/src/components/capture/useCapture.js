import { useState, useEffect } from 'react'
import { transcribeFile, processUrl, wakeBackend } from '../../lib/api'
import { track } from '../../lib/analytics'
import { useGravacaoAtual } from '../../contexts/GravacaoContext'
import { readMediaDuration } from './estimate'
import { MODO_COMPLETA } from './modos'

// A metade que ENVIA: escolher e mandar arquivo, processar link, tratar erro.
// Gravar saiu daqui para o GravacaoProvider (ver useGravacao) — não por
// arrumação, mas porque este hook é montado pelo painel de captura, que só
// existe na home: enquanto a gravação morava aqui, trocar de tela no meio de
// uma reunião a matava.
//
// As telas (CaptureWeb, CaptureNative) continuam recebendo um objeto só, com as
// duas metades juntas, e não souberam da mudança.
//
// Todo envio leva um `mode`: 'simples' (resumo curto no Haiku, e o chat) ou
// 'completa' (tópicos, tarefas e capítulos). Quem escolhe é o usuário, no botão
// de transcrever; a recomendação que já vem marcada mora em ./modos.
export function useCapture({ onResult }) {
  const gravacao = useGravacaoAtual()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [errorStatus, setErrorStatus] = useState(null)

  // O Render hiberna, e a primeira chamada depois disso leva dezenas de
  // segundos — inclusive a que calcula a duração do link colado, que roda
  // ANTES de qualquer envio. Acordar ao abrir a tela de captura faz o servidor
  // já estar de pé quando a pessoa chegar ao link.
  useEffect(() => { wakeBackend().catch(() => {}) }, [])

  // O arquivo escolhido, esperando o usuário dizer QUAL transcrição quer. Antes
  // escolher o arquivo já disparava o envio; agora há uma decisão no meio, e
  // ela precisa de um lugar onde o arquivo espere. `durationSec` vem junto
  // porque é lido uma vez, na escolha, e é ele que decide qual modo aparece
  // recomendado.
  const [pendingFile, setPendingFile] = useState(null) // { file, durationSec }

  const { recordedBlob, recordingTime, resetRecording } = gravacao

  // Erro é um campo só para quem desenha: a tela não tem por que saber se o
  // problema foi do microfone (gravação) ou do upload (envio).
  function limparErro(valor = null) {
    setError(valor)
    if (!valor) gravacao.setErro(null)
  }

  // Avisa antes de sair da página no meio de um processamento. O contador de
  // segundos que vivia aqui saiu junto com a estimativa: a tela de carregamento
  // agora diz o que está acontecendo, e não quanto falta.
  useEffect(() => {
    if (!loading) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [loading])

  async function runCapture(fn) {
    setLoading(true)
    limparErro(null)
    // O plano gratuito do Render hiberna: mandar o arquivo para uma instância
    // dormindo derrubava a conexão no meio do upload ("Failed to fetch").
    // Acordamos antes e só então enviamos. Isso não aparece mais na tela — para
    // quem espera, acordar o servidor e transcrever são a mesma espera.
    try {
      await wakeBackend()
    } catch {
      // Não conseguir acordar não impede a tentativa de envio.
    }
    try {
      return await fn()
    } catch (err) {
      setError(err.message)
      // 402 é o saldo do mês esgotado: a tela oferece o "Ver planos" em vez de
      // só mostrar o texto do erro.
      setErrorStatus(err.status || null)
      return null
    } finally {
      setLoading(false)
    }
  }

  // Evita criar uma sessão inútil a partir de uma gravação muda ou de um
  // arquivo sem fala.
  function isEmpty(result) {
    return !result?.transcript || result.transcript.trim().length < 5
  }

  async function submitRecording(mode = MODO_COMPLETA) {
    if (!recordedBlob) return
    // O nome tem de combinar com o container: o Groq decide pela extensão se
    // aceita o arquivo, e um ogg chamado .webm era recusado.
    const filename = `gravacao.${extensionFor(recordedBlob.type)}`
    // resetRecording() zera recordingTime mais adiante — ler a duração antes.
    const duracao = recordingTime
    const result = await runCapture(() => {
      const file = new File([recordedBlob], filename, { type: recordedBlob.type })
      return transcribeFile(file, mode)
    })
    if (!result) return
    if (isEmpty(result)) {
      setError('Não captamos áudio suficiente. Tente gravar novamente, mais perto do microfone.')
      resetRecording()
      return
    }
    track('captura', { origem: 'gravacao', midia: 'audio', duracao_s: duracao, modo: mode, usage: result.usage })
    onResult(result, 'record', 'Gravação de áudio', mode)
    resetRecording()
  }

  // Escolher o arquivo e enviá-lo deixaram de ser o mesmo gesto: entre os dois
  // está a escolha do tipo de transcrição. `pickFile` só guarda o arquivo (e lê
  // a duração, que decide qual modo aparece recomendado); quem envia é
  // `submitFile`, já com a decisão tomada.
  async function pickFile(file) {
    if (!file) return
    limparErro(null)
    setPendingFile({ file, durationSec: null })
    const durationSec = await readMediaDuration(file)
    // O usuário pode ter desistido enquanto a duração era lida.
    setPendingFile(atual => (atual?.file === file ? { file, durationSec } : atual))
  }

  function clearFile() {
    setPendingFile(null)
  }

  // Envia um arquivo qualquer. Fica separado de `submitFile` porque o
  // compartilhamento de outro app entra por aqui: lá o arquivo nunca passa pelo
  // seletor, e não há tela onde ele possa esperar por uma escolha.
  async function sendFile(file, mode = MODO_COMPLETA, durationSec = null) {
    if (!file) return
    const result = await runCapture(() => transcribeFile(file, mode))
    if (!result) return
    if (isEmpty(result)) { setError('Não conseguimos extrair áudio/texto deste arquivo.'); return }
    track('captura', {
      origem: 'arquivo',
      midia: file.type.startsWith('video/') ? 'video' : 'audio',
      duracao_s: durationSec || null,
      modo: mode,
      usage: result.usage,
    })
    onResult(result, 'file', file.name, mode)
  }

  async function submitFile(mode = MODO_COMPLETA) {
    if (!pendingFile) return
    const { file, durationSec } = pendingFile
    await sendFile(file, mode, durationSec)
    setPendingFile(null)
  }

  async function submitUrl(url, mode = MODO_COMPLETA) {
    const clean = url.trim()
    if (!clean) return false
    const result = await runCapture(() => processUrl(clean, mode))
    if (!result) return false
    if (isEmpty(result)) { setError('Não conseguimos extrair conteúdo deste link.'); return false }
    // A URL em si não é guardada: só o fato de ter vindo por link e o consumo.
    track('captura', { origem: 'link', midia: result.usage?.audio_seconds ? 'video' : 'texto', modo: mode, usage: result.usage })
    // Nomeia a sessão pelo título do vídeo/página, não pela URL crua.
    onResult(result, 'url', result.title?.trim() || clean, mode)
    return true
  }

  return {
    ...gravacao,
    loading,
    error: error || gravacao.erro,
    setError: limparErro,
    errorStatus,
    pendingFile,
    pickFile, clearFile, sendFile,
    submitRecording, submitFile, submitUrl,
  }
}

// Extensão a partir do MIME do blob, ignorando o `;codecs=...`.
const EXTENSION_BY_MIME = {
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'video/webm': 'webm',
}

function extensionFor(mime) {
  return EXTENSION_BY_MIME[(mime || '').split(';')[0].trim()] || 'webm'
}
