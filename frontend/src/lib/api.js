import { supabase } from './supabase'
import { MODO_COMPLETA } from '../components/capture/modos'
import { getIdioma } from './prefs'

export const API_URL = 'https://transcritor-backend.onrender.com'

// Um token que ainda vale no instante do envio pode já ter vencido quando o
// backend o confere: o Render hiberna e a requisição espera a instância subir,
// e uma captura grande passa minutos no ar. Era isso que fazia aparecer "Entre
// na sua conta" para quem estava logado. Renovar o que está perto de vencer
// ANTES de enviar fecha essa janela.
const RENOVAR_SE_FALTAR_S = 60

// Renovar é rotativo: cada renovação aposenta o token anterior. Duas chamadas
// simultâneas viravam duas rotações, e bastava o app fechar antes de a segunda
// ser gravada em disco para o token guardado já estar queimado — e a próxima
// abertura cair no login. Quem pedir no meio de uma renovação espera a mesma,
// e quem pedir logo depois de uma reaproveita o resultado em vez de rotacionar
// de novo.
const JANELA_DE_REAPROVEITAMENTO_MS = 10000
let renovacaoEmVoo = null
let ultimaRenovacaoMs = 0

function renovarSessao() {
  if (!renovacaoEmVoo) {
    renovacaoEmVoo = supabase.auth.refreshSession().finally(() => {
      renovacaoEmVoo = null
      ultimaRenovacaoMs = Date.now()
    })
  }
  return renovacaoEmVoo
}

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

    // Acabou de renovar: o token que o getSession devolveu já é o novo, e
    // rotacionar outra vez só criaria mais uma chance de perder a gravação.
    // Se mesmo assim vier 401, o problema não é o token estar velho.
    if (Date.now() - ultimaRenovacaoMs < JANELA_DE_REAPROVEITAMENTO_MS) {
      return { Authorization: `Bearer ${session.access_token}` }
    }

    // Se a renovação falhar (rede caída, por exemplo), mandar o token velho
    // ainda é melhor do que mandar nada: ele pode continuar valendo, e o
    // backend é quem decide.
    const { data } = await renovarSessao()
    const token = data?.session?.access_token || session.access_token
    return { Authorization: `Bearer ${token}` }
  } catch {
    return {}
  }
}

// Uma volta de envio, com as retentativas de rede. Fica separada do cuidado com
// o token para que repetir por 401 não consuma o orçamento de retentativas de
// conexão — são dois problemas diferentes.
async function enviar(path, { body, headers, signal }, retries) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(`${API_URL}${path}`, { method: 'POST', body, headers, signal })
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
async function comRenovacao(path, montarHeaders, body, retries, signal) {
  let headers = await montarHeaders()
  let res = await enviar(path, { body, headers, signal }, retries)
  if (res.status === 401 && headers.Authorization) {
    headers = await montarHeaders({ forcar: true })
    if (headers.Authorization) res = await enviar(path, { body, headers, signal }, retries)
  }
  return res
}

// `fetch` rejeita com TypeError quando a conexão falha antes de haver resposta
// — no celular isso aparecia como "Failed to fetch", sem dizer nada ao usuário.
const NETWORK_ERROR = 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const isNetworkError = err => err instanceof TypeError

// Um 5xx quase nunca é o nosso código falando: é o proxy do Render enquanto a
// instância acorda, e o corpo vem em HTML, não em JSON. Sem esta distinção o
// fallback mostrava o `statusText` cru — "Bad Gateway" aparecendo no meio do
// pagamento. As mensagens que o backend escreve (`detail`) continuam passando.
const SERVER_ERROR = 'O servidor não respondeu como esperado. Tente de novo em instantes.'

async function handleResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const erro = new Error(err.detail || (res.status >= 500 ? SERVER_ERROR : 'Erro desconhecido'))
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
async function postWithRetry(path, body, { retries = 1, signal } = {}) {
  return comRenovacao(path, authHeaders, body, retries, signal)
}

// Teto genérico para qualquer chamada que possa ficar presa numa conexão
// morta: sem ele, `fetch` nunca desiste sozinho, e a tela some numa
// carga/envio infinito, sem erro e sem saída (era assim que o botão de
// cobrança prendia em "Abrindo…" antes deste mesmo cuidado).
async function comTeto(chamar, ms, mensagemTeto) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await chamar(controller.signal)
  } catch (err) {
    // `abort` rejeita com AbortError, que não é erro de rede nem resposta do
    // servidor: sem este caso a tela mostraria o texto cru do DOMException.
    if (err?.name === 'AbortError') throw new Error(mensagemTeto)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Mesma proteção de rede das capturas, para as rotas que mandam JSON.
async function postJson(path, payload, { retries = 1, signal } = {}) {
  const montarHeaders = async opts => ({
    'Content-Type': 'application/json',
    ...(await authHeaders(opts)),
  })
  const res = await comRenovacao(path, montarHeaders, JSON.stringify(payload), retries, signal)
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
//
// Uma reunião de horas legitimamente demora minutos para transcrever — o teto
// precisa ser generoso o bastante para não interromper um envio que só está
// lento, e mesmo assim finito, para não prender a tela para sempre numa
// conexão que morreu no meio do caminho.
const CAPTURA_TIMEOUT_MS = 15 * 60 * 1000
const CAPTURA_TIMEOUT_MSG = 'O envio demorou demais e foi interrompido. Verifique sua conexão e tente de novo.'

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
  return comTeto(
    signal => postWithRetry('/transcribe', formData, { signal }).then(handleResponse),
    CAPTURA_TIMEOUT_MS,
    CAPTURA_TIMEOUT_MSG,
  )
}

export async function processUrl(url, mode = MODO_COMPLETA) {
  const formData = new FormData()
  formData.append('url', url)
  formData.append('mode', mode)
  formData.append('language', getIdioma())
  return comTeto(
    signal => postWithRetry('/process-url', formData, { signal }).then(handleResponse),
    CAPTURA_TIMEOUT_MS,
    CAPTURA_TIMEOUT_MSG,
  )
}

// Duração do vídeo de um link, sem baixá-lo — para o botão dizer quantos
// minutos a captura vai consumir. Null quando não dá para saber; nunca lança,
// porque a estimativa é informação e não pode travar o envio.
export async function duracaoDoLink(url) {
  try {
    const { duracao_s } = await postJson('/duracao-link', { url })
    return duracao_s || null
  } catch {
    return null
  }
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
    .select('minutos_usados, perguntas_usadas, periodo_fim')
    .eq('user_id', userId)
    .maybeSingle()

  const vencido = !data?.periodo_fim || new Date(data.periodo_fim) <= new Date()
  return {
    minutosUsados: vencido ? 0 : Number(data.minutos_usados || 0),
    // As perguntas do mês moram na mesma linha e viram junto com os minutos.
    perguntasUsadas: vencido ? 0 : Number(data.perguntas_usadas || 0),
    periodoFim: vencido ? null : data.periodo_fim,
  }
}

// O `fetch` não desiste sozinho: uma instância do Render subindo devagar podia
// deixar um botão de cobrança preso em "Abrindo…" por minutos, sem erro e sem
// saída — e era isso que levava a pessoa a recarregar a página e tentar de
// novo, que é como nascia a cobrança dupla. Com o teto, a espera vira uma
// mensagem com saída. Vale tanto para abrir o checkout quanto o portal: os
// dois são a mesma instância do Render acordando.
const BILLING_TIMEOUT_MS = 45000

async function postJsonComTeto(path, payload, mensagemTeto) {
  return comTeto(
    signal => postJson(path, payload, { signal }),
    BILLING_TIMEOUT_MS,
    mensagemTeto,
  )
}

// Só a versão web assina por aqui — o app Android é distribuído pela Play
// Store, que exige Google Play Billing para assinatura consumida dentro do
// app. Devolve a URL do Checkout hospedado do Stripe; quem chama só precisa
// redirecionar (window.location.href = url).
export async function criarCheckout(plano, ciclo) {
  return postJsonComTeto(
    '/billing/create-checkout-session',
    { plano, ciclo },
    'O servidor demorou demais para responder. Nada foi cobrado. Tente de novo.',
  )
}

// Troca de plano, mudança de forma de pagamento e cancelamento não são
// telas nossas: é o Portal do Stripe, aberto para a assinatura já existente.
// Ele modifica a MESMA assinatura em vez de criar outra — é o que faz a troca
// de plano não virar uma segunda cobrança do lado da primeira.
export async function abrirPortalAssinatura() {
  return postJsonComTeto(
    '/billing/portal-session',
    {},
    'O servidor demorou demais para responder. Tente de novo.',
  )
}

// O chat fala sobre UMA conversa. O backend marca a transcrição com
// cache_control, então a partir da segunda pergunta ela não é recobrada.
export async function askConversation(question, conversation, { history = [], makeTitle = false } = {}) {
  return postJson('/chat', {
    question,
    // Qual transcrição: o limite de perguntas do plano é contado por ela.
    session_id: conversation.id,
    title: conversation.title,
    date: new Date(conversation.created_at).toLocaleDateString('pt-BR'),
    transcript: conversation.transcript,
    summary: conversation.summary || null,
    history,
    make_title: makeTitle,
  })
}
