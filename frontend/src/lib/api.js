import { supabase } from './supabase'
import { MODO_COMPLETA } from '../components/capture/modos'
import { getIdioma } from './prefs'

const API_URL = 'https://transcritor-backend.onrender.com'

// Um token que ainda vale no instante do envio pode já ter vencido quando o
// backend o confere: o Render hiberna e a requisição espera a instância subir,
// e uma captura grande passa minutos no ar. Era isso que fazia aparecer "Entre
// na sua conta" para quem estava logado. Renovar o que está perto de vencer
// ANTES de enviar fecha essa janela.
const RENOVAR_SE_FALTAR_S = 60

// O backend precisa saber quem está chamando: as rotas que gastam crédito de
// IA são fechadas para quem não tem conta. O token é o mesmo que o Supabase já
// mantém para a sessão — não há nada novo a guardar.
//
// Falhar em silêncio (devolver {}) é de propósito: sem sessão a chamada segue
// sem o cabeçalho e o backend responde 401, que a tela já sabe mostrar. Travar
// aqui só trocaria uma mensagem clara por uma tela quebrada.
async function authHeaders({ forcar = false } = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return {}

    const faltam = (session.expires_at ?? 0) - Math.floor(Date.now() / 1000)
    if (!forcar && faltam > RENOVAR_SE_FALTAR_S) {
      return { Authorization: `Bearer ${session.access_token}` }
    }

    // Se a renovação falhar (rede caída, por exemplo), mandar o token velho
    // ainda é melhor do que mandar nada: ele pode continuar valendo, e o
    // backend é quem decide.
    const { data } = await supabase.auth.refreshSession()
    const token = data?.session?.access_token || session.access_token
    return { Authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
}

// Uma volta de envio, com as retentativas de rede. Fica separada do cuidado com
// o token para que repetir por 401 não consuma o orçamento de retentativas de
// conexão — são dois problemas diferentes.
async function enviar(path, { body, headers }, retries) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(`${API_URL}${path}`, { method: 'POST', body, headers })
    } catch (err) {
      if (!isNetworkError(err) || attempt >= retries) {
        throw isNetworkError(err) ? new Error(NETWORK_ERROR) : err
      }
      await sleep(1500)
    }
  }
}

// Um 401 em quem mandou token quase nunca é falta de login: é o token que
// venceu no caminho. Renovar e repetir uma vez antes de acusar o usuário de
// estar deslogado.
async function comRenovacao(path, montarHeaders, body, retries) {
  let headers = await montarHeaders()
  let res = await enviar(path, { body, headers }, retries)
  if (res.status === 401 && headers.Authorization) {
    headers = await montarHeaders({ forcar: true })
    if (headers.Authorization) res = await enviar(path, { body, headers }, retries)
  }
  return res
}

// `fetch` rejeita com TypeError quando a conexão falha antes de haver resposta
// — no celular isso aparecia como "Failed to fetch", sem dizer nada ao usuário.
const NETWORK_ERROR = 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const isNetworkError = err => err instanceof TypeError

async function handleResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const erro = new Error(err.detail || 'Erro desconhecido')
    // O 402 (saldo do mês esgotado) merece um convite para assinar, e não a
    // mesma cara de "deu erro" de uma queda de rede — quem mostra precisa
    // conseguir distinguir os dois.
    erro.status = res.status
    throw erro
  }
  return res.json()
}

// O backend roda no plano gratuito do Render, que hiberna depois de alguns
// minutos parado. Enviar um arquivo para uma instância dormindo faz a conexão
// cair no meio do upload — daí o "Failed to fetch". Acordar primeiro com um GET
// barato faz o upload sempre encontrar o servidor de pé.
// Retorna quando acordar; desiste em silêncio no limite, porque tentar o envio
// mesmo assim é melhor do que travar o usuário.
export async function wakeBackend({ timeoutMs = 90000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/`, { cache: 'no-store' })
      if (res.ok) return true
    } catch {
      // Instância ainda subindo; tentamos de novo.
    }
    await sleep(2000)
  }
  return false
}

// Alguns arquivos escolhidos pelo seletor do Android (típico do armazenamento
// interno do WhatsApp) chegam vazios ou ilegíveis. Sem esta checagem o envio
// falhava com o mesmo "Failed to fetch" de um problema de rede, escondendo a
// causa real.
async function assertReadable(file) {
  if (!file || file.size === 0) {
    throw new Error('O arquivo chegou vazio. Tente compartilhá-lo de novo, ou salve-o antes na pasta Downloads.')
  }
  try {
    await file.slice(0, Math.min(file.size, 64 * 1024)).arrayBuffer()
  } catch {
    throw new Error('Não conseguimos ler este arquivo no seu aparelho. Salve-o na pasta Downloads e envie de lá.')
  }
}

// Uma falha de rede num upload longo costuma ser transitória (troca de Wi-Fi
// para dados, servidor acordando). Uma segunda tentativa resolve a maioria.
async function postWithRetry(path, body, { retries = 1 } = {}) {
  return comRenovacao(path, authHeaders, body, retries)
}

// Mesma proteção de rede das capturas, para as rotas que mandam JSON.
async function postJson(path, payload, { retries = 1 } = {}) {
  const montarHeaders = async opts => ({
    'Content-Type': 'application/json',
    ...(await authHeaders(opts)),
  })
  const res = await comRenovacao(path, montarHeaders, JSON.stringify(payload), retries)
  return handleResponse(res)
}

// Mesmo teto do backend (main.py: MAX_UPLOAD_BYTES). Conferir aqui é o que
// evita subir 1 GB por vários minutos só para receber um 413 no fim.
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

// `mode` é a profundidade da análise: 'completa' (4 tópicos, tarefas, resumo
// minuto a minuto) ou 'simples' (um resumo curto e o chat). O backend trata
// qualquer valor desconhecido como 'completa', que é o que ele fazia antes
// deste campo existir.
//
// Já o idioma de saída é lido aqui dentro, e não recebido por parâmetro: é uma
// preferência global, e são cinco caminhos de captura (gravação, arquivo,
// link, compartilhamento de outro app, reanálise) que teriam de lembrar de
// repassá-la. Ler no ponto do envio garante que nenhum deles escape.
export async function transcribeFile(file, mode = MODO_COMPLETA) {
  await assertReadable(file)
  if (file.size > MAX_UPLOAD_BYTES) {
    const gb = (file.size / (1024 ** 3)).toFixed(1)
    throw new Error(
      `Este arquivo tem ${gb} GB e o limite é 1 GB (cerca de 8 horas de gravação). ` +
      'Se for vídeo, envie só o áudio.'
    )
  }
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mode', mode)
  formData.append('language', getIdioma())
  return handleResponse(await postWithRetry('/transcribe', formData))
}

export async function processUrl(url, mode = MODO_COMPLETA) {
  const formData = new FormData()
  formData.append('url', url)
  formData.append('mode', mode)
  formData.append('language', getIdioma())
  return handleResponse(await postWithRetry('/process-url', formData))
}

// Reanálise de uma conversa que já tem transcrição. É o caminho das conversas
// capturadas antes desta versão, que não têm `insights` nem `segments`: custa
// uma chamada de texto e não depende da mídia original, que nunca guardamos.
export async function generateInsights(transcript, segments = []) {
  return postJson('/insights', { transcript, segments, language: getIdioma() })
}

// Saldo do ciclo corrente, para o "Meu plano" e o aviso de saldo baixo. Um
// período já vencido conta como zero: a virada acontece na próxima captura
// (backend: registrar_uso), e sem isto o consumo do mês passado apareceria no
// começo do mês novo.
export async function lerSaldo(userId) {
  const { data } = await supabase
    .from('uso_mensal')
    .select('minutos_usados, periodo_fim')
    .eq('user_id', userId)
    .maybeSingle()

  const vencido = !data?.periodo_fim || new Date(data.periodo_fim) <= new Date()
  return {
    minutosUsados: vencido ? 0 : Number(data.minutos_usados || 0),
    periodoFim: vencido ? null : data.periodo_fim,
  }
}

// Só a versão web assina por aqui — o app Android é distribuído pela Play
// Store, que exige Google Play Billing para assinatura consumida dentro do
// app. Devolve a URL do Checkout hospedado do Stripe; quem chama só precisa
// redirecionar (window.location.href = url).
export async function criarCheckout(plano, ciclo) {
  return postJson('/billing/create-checkout-session', { plano, ciclo })
}

// O chat fala sobre UMA conversa. O backend marca a transcrição com
// cache_control, então a partir da segunda pergunta ela não é recobrada.
export async function askConversation(question, conversation, { history = [], makeTitle = false } = {}) {
  return postJson('/chat', {
    question,
    title: conversation.title,
    date: new Date(conversation.created_at).toLocaleDateString('pt-BR'),
    transcript: conversation.transcript,
    summary: conversation.summary || null,
    history,
    make_title: makeTitle,
  })
}
