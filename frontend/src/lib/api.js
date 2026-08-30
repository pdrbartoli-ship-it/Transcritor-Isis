const API_URL = 'https://transcritor-backend.onrender.com'

// `fetch` rejeita com TypeError quando a conexão falha antes de haver resposta
// — no celular isso aparecia como "Failed to fetch", sem dizer nada ao usuário.
const NETWORK_ERROR = 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const isNetworkError = err => err instanceof TypeError

async function handleResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Erro desconhecido')
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
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(`${API_URL}${path}`, { method: 'POST', body })
    } catch (err) {
      if (!isNetworkError(err) || attempt >= retries) {
        throw isNetworkError(err) ? new Error(NETWORK_ERROR) : err
      }
      await sleep(1500)
    }
  }
}

// Mesma proteção de rede das capturas, para as rotas que mandam JSON.
async function postJson(path, payload, { retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return await handleResponse(res)
    } catch (err) {
      if (!isNetworkError(err) || attempt >= retries) {
        throw isNetworkError(err) ? new Error(NETWORK_ERROR) : err
      }
      await sleep(1500)
    }
  }
}

export async function transcribeFile(file) {
  await assertReadable(file)
  const formData = new FormData()
  formData.append('file', file)
  return handleResponse(await postWithRetry('/transcribe', formData))
}

export async function processUrl(url) {
  const formData = new FormData()
  formData.append('url', url)
  return handleResponse(await postWithRetry('/process-url', formData))
}

// Reanálise de uma conversa que já tem transcrição. É o caminho das conversas
// capturadas antes desta versão, que não têm `insights` nem `segments`: custa
// uma chamada de texto e não depende da mídia original, que nunca guardamos.
export async function generateInsights(transcript, segments = []) {
  return postJson('/insights', { transcript, segments })
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
