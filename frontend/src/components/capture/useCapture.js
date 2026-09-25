import { useState, useEffect } from 'react'
import { wakeBackend } from '../../lib/api'
import { labelForLink } from '../../lib/conversas'
import { useGravacaoAtual } from '../../contexts/GravacaoContext'
import { useTranscricoes } from '../../contexts/TranscricoesContext'
import { readMediaDuration, formatTime } from './estimate'
import { MODO_COMPLETA } from './modos'

// A metade que ENVIA: escolher e mandar arquivo, processar link, tratar erro.
// Gravar saiu daqui para o GravacaoProvider (ver useGravacao) — não por
// arrumação, mas porque este hook é montado pelo painel de captura, que só
// existe na home: enquanto a gravação morava aqui, trocar de tela no meio de
// uma reunião a matava.
//
// Enviar também deixou de esperar aqui. O pedido vai para a fila de
// transcrições (TranscricoesContext), acima das telas, e o painel volta ao
// repouso na hora: dá para gravar a próxima reunião enquanto a anterior ainda
// está sendo transcrita. O resultado vira conversa lá, e não aqui.
//
// As telas (CaptureWeb, CaptureNative) continuam recebendo um objeto só, com as
// duas metades juntas.
//
// Todo envio leva um `mode`: 'simples' (resumo curto e o chat) ou 'completa'
// (tópicos, tarefas e capítulos). Quem escolhe é o usuário, no botão de
// transcrever; a recomendação que já vem marcada mora em ./modos.
export function useCapture() {
  const gravacao = useGravacaoAtual()
  const { transcrever } = useTranscricoes()
  const [error, setError] = useState(null)

  // O Render hiberna, e a primeira chamada depois disso leva dezenas de
  // segundos — inclusive a que calcula a duração do link colado, que roda
  // ANTES de qualquer envio. Acordar ao abrir a tela de captura faz o servidor
  // já estar de pé quando a pessoa chegar ao link.
  useEffect(() => { wakeBackend().catch(() => {}) }, [])

  // O arquivo escolhido, esperando o usuário dizer QUAL transcrição quer.
  // `durationSec` vem junto porque é lido uma vez, na escolha, e é ele que
  // decide qual modo aparece recomendado.
  const [pendingFile, setPendingFile] = useState(null) // { file, durationSec }

  const { recordedBlob, recordingTime, resetRecording } = gravacao

  // Erro é um campo só para quem desenha: a tela não tem por que saber se o
  // problema foi do microfone (gravação) ou da escolha do arquivo.
  function limparErro(valor = null) {
    setError(valor)
    if (!valor) gravacao.setErro(null)
  }

  function submitRecording(mode = MODO_COMPLETA) {
    if (!recordedBlob) return
    // O nome tem de combinar com o container: o Groq decide pela extensão se
    // aceita o arquivo, e um ogg chamado .webm era recusado.
    const filename = `gravacao.${extensionFor(recordedBlob.type)}`
    // resetRecording() zera recordingTime logo abaixo — ler a duração antes.
    const duracao = recordingTime
    transcrever({
      origem: 'record',
      modo: mode,
      arquivo: new File([recordedBlob], filename, { type: recordedBlob.type }),
      duracaoS: duracao,
      rotulo: `Gravação de ${formatTime(duracao)}`,
    })
    limparErro(null)
    resetRecording()
  }

  // Escolher o arquivo e enviá-lo são gestos separados: entre os dois está a
  // escolha do tipo de transcrição. `pickFile` só guarda o arquivo (e lê a
  // duração, que decide qual modo aparece recomendado); quem envia é
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
  function sendFile(file, mode = MODO_COMPLETA, durationSec = null) {
    if (!file) return
    transcrever({ origem: 'file', modo: mode, arquivo: file, duracaoS: durationSec, rotulo: file.name })
    limparErro(null)
  }

  function submitFile(mode = MODO_COMPLETA) {
    if (!pendingFile) return
    const { file, durationSec } = pendingFile
    sendFile(file, mode, durationSec)
    setPendingFile(null)
  }

  // `duracaoS` é a do vídeo, quando a tela já a conhece: entra na conta do
  // saldo comprometido enquanto a transcrição não termina.
  function submitUrl(url, mode = MODO_COMPLETA, duracaoS = null) {
    const clean = url.trim()
    if (!clean) return false
    transcrever({
      origem: 'url',
      modo: mode,
      url: clean,
      duracaoS,
      rotulo: labelForLink(clean) || clean,
    })
    limparErro(null)
    return true
  }

  return {
    ...gravacao,
    // O painel não espera mais a transcrição; o campo fica para as telas que
    // ainda o leem, sempre falso.
    loading: false,
    error: error || gravacao.erro,
    setError: limparErro,
    errorStatus: null,
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
  // O gravador nativo do celular grava AAC em quadros soltos (ADTS).
  'audio/aac': 'aac',
  'video/webm': 'webm',
}

function extensionFor(mime) {
  return EXTENSION_BY_MIME[(mime || '').split(';')[0].trim()] || 'webm'
}
