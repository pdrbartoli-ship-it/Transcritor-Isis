import { supabase } from './supabase'
import { cifrarLinha, decifrarLinha, decifrarLista, ENC_ATUAL } from './cofre'

// Uma "conversa" é qualquer captura: gravação, arquivo de áudio/vídeo ou link.
// No banco continua sendo a tabela `sessions` — o que mudou foi o produto, que
// deixou de pedir ao usuário que escolhesse uma pasta antes de ver o resultado.

// As pastas saíram da interface, mas `sessions.client_id` é NOT NULL e a RLS
// das tabelas antigas depende dele. Em vez de uma migração destrutiva, cada
// usuário ganha uma pasta técnica, criada na primeira captura e nunca exibida.
const INBOX_NAME = '__inbox'

export async function ensureInbox(userId) {
  const { data: existing } = await supabase
    .from('clients').select('id')
    .eq('user_id', userId).eq('name', INBOX_NAME)
    .limit(1).maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('clients').insert({ user_id: userId, name: INBOX_NAME })
    .select('id').single()
  if (error) throw error
  return data.id
}

// Campos da listagem. `transcript` fica de fora de propósito: é a coluna mais
// pesada da tabela e a home não mostra nada dela. `summary` entra porque os
// cards da home mostram duas linhas de prévia — sem elas o card tem duas
// linhas de conteúdo dentro de uma caixa alta, que é o que fazia a seção
// parecer vazia mesmo cheia.
const LIST_FIELDS = 'id, title, created_at, source_type, duration_s, summary, pinned, enc_version'
const LIST_FIELDS_BASE = 'id, title, created_at, source_type, summary'
const FULL_FIELDS = 'id, title, created_at, source_type, transcript, summary, segments, insights, duration_s, enc_version'
const FULL_FIELDS_BASE = 'id, title, created_at, source_type, transcript, summary'

// As colunas novas (segments, insights, duration_s) vêm de conversas.sql. Se o
// script ainda não rodou, o Postgres devolve 42703 e a consulta inteira falha —
// o app ficaria em branco no intervalo entre publicar e rodar a migração. Cair
// para as colunas antigas mantém tudo de pé; é o mesmo padrão que a sidebar já
// usava para as colunas de pin/arquivar.
const MISSING_COLUMN = '42703'

async function selectWithFallback(build, fields, baseFields) {
  const { data, error } = await build(fields)
  if (!error) return data
  if (error.code !== MISSING_COLUMN) throw error
  const { data: baseData, error: baseError } = await build(baseFields)
  if (baseError) throw baseError
  return baseData
}

export async function listConversations(userId, { limit = 50 } = {}) {
  const data = await selectWithFallback(
    fields => supabase.from('sessions').select(fields)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
    LIST_FIELDS, LIST_FIELDS_BASE,
  )
  return decifrarLista(data)
}

export async function getConversation(id) {
  const linha = await selectWithFallback(
    fields => supabase.from('sessions').select(fields).eq('id', id).single(),
    FULL_FIELDS, FULL_FIELDS_BASE,
  )
  return decifrarLinha(linha)
}

// Nomes de site conhecidos, para o rótulo dizer de onde veio em vez de repetir
// o domínio cru. O que não estiver aqui vira o domínio sem o "www.".
const SITE_NAMES = {
  'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
  'vimeo.com': 'Vimeo', 'drive.google.com': 'Google Drive',
  'open.spotify.com': 'Spotify', 'soundcloud.com': 'SoundCloud',
  'x.com': 'X', 'twitter.com': 'X', 'instagram.com': 'Instagram',
  'tiktok.com': 'TikTok', 'linkedin.com': 'LinkedIn', 'meet.google.com': 'Google Meet',
}

// Uma URL inteira como título deixava a barra lateral com seis linhas
// "https://www.youtube.com/watch?v=…" idênticas e truncadas no mesmo ponto.
// Isto é só o último recurso: quando o modelo devolve um título, ele ganha.
export function labelForLink(url, quando) {
  if (!url) return null
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const site = SITE_NAMES[host] || host
    const dia = new Date(quando || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    return `Link do ${site} · ${dia}`
  } catch {
    return null
  }
}

// As conversas capturadas antes desta correção já foram gravadas com a URL
// inteira no título. Reescrever o banco seria mexer em dado que o usuário pode
// ter renomeado à mão; trocar só na exibição resolve a tela sem esse risco.
export function displayTitle(conversation) {
  const title = conversation?.title || ''
  if (!/^https?:\/\//i.test(title.trim())) return title
  return labelForLink(title.trim(), conversation.created_at) || title
}

export async function createConversation(userId, result, sourceType, fallbackName) {
  const clientId = await ensureInbox(userId)
  const title =
    result.title?.trim() ||
    result.insights?.title?.trim() ||
    (sourceType === 'url' ? labelForLink(fallbackName) : null) ||
    fallbackName ||
    `Conversa de ${new Date().toLocaleDateString('pt-BR')}`

  const row = {
    client_id: clientId,
    user_id: userId,
    title,
    source_type: sourceType,
    transcript: result.transcript,
    summary: result.summary,
  }
  const enriched = {
    ...row,
    segments: result.segments || [],
    insights: result.insights || null,
    duration_s: result.duration_s || 0,
  }

  // A conversa nasce cifrada. Se não houver chave neste aparelho, cifrarLinha
  // falha — e falhar é o certo: gravar em texto puro achando que cifrou seria
  // o pior desfecho possível, porque ninguém ficaria sabendo.
  const cifrada = await cifrarLinha(enriched)

  // Mesma proteção da listagem: sem a migração, gravar só o que já existia é
  // muito melhor do que perder a transcrição que acabou de custar tempo e API.
  let { data, error } = await supabase.from('sessions').insert(cifrada).select(LIST_FIELDS).single()
  if (error?.code === MISSING_COLUMN) {
    const base = await cifrarLinha(row)
    ;({ data, error } = await supabase.from('sessions').insert(base).select(LIST_FIELDS_BASE).single())
  }
  if (error) throw error
  invalidarBuscaLocal()
  return decifrarLinha(data)
}

// Renomear tem de respeitar o formato da linha: cifrar o título de uma conversa
// antiga (que segue em texto puro) deixaria a linha meio cifrada e o título
// ilegível, porque a leitura decide pelo enc_version da linha inteira.
export async function renameConversation(id, title, encVersion) {
  const patch = encVersion === ENC_ATUAL ? await cifrarLinha({ title }) : { title }
  const { error } = await supabase.from('sessions').update(patch).eq('id', id)
  if (error) throw error
  invalidarBuscaLocal()
}

export async function deleteConversation(id) {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  if (error) throw error
  invalidarBuscaLocal()
}

// Erro de "coluna não existe" na hora de fixar. A migração fixar_conversa.sql
// pode ainda não ter rodado, e nesse caso o certo é dizer isso em português na
// tela — não deixar o clique falhar em silêncio.
export class SemColunaPinError extends Error {
  constructor() { super('Fixar ainda não está disponível nesta conta.') }
}

export async function setPinned(id, pinned) {
  const { error } = await supabase.from('sessions').update({ pinned }).eq('id', id)
  if (error?.code === MISSING_COLUMN) throw new SemColunaPinError()
  if (error) throw error
}

// Busca em dois passos, na ordem que o usuário espera: primeiro as conversas
// cujo TÍTULO casa (é o que ele costuma lembrar), depois as que só mencionam o
// termo em algum ponto da transcrição. Uma conversa que aparece nos dois não é
// repetida embaixo.
//
// Antes quem procurava era o Postgres, com `ilike` e índice. Com o conteúdo
// cifrado isso deixou de ser possível: o banco vê bytes embaralhados, e um
// `ilike` neles não casa com nada — ele não daria erro, apenas responderia
// "não achei" para sempre, que é a pior forma de quebrar uma busca.
//
// Então o acervo é trazido, decifrado e procurado aqui. Na escala do Dito isso
// é barato: uma hora de reunião dá ~50 KB de texto, e procurar em memória leva
// milissegundos. O custo real é a primeira busca de cada sessão, que baixa o
// acervo — por isso ele fica em cache até a lista mudar.
const PAGINA = 200
let cacheAcervo = { userId: null, linhas: null }

export function invalidarBuscaLocal() {
  cacheAcervo = { userId: null, linhas: null }
}

async function carregarAcervo(userId) {
  if (cacheAcervo.userId === userId && cacheAcervo.linhas) return cacheAcervo.linhas

  const todas = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from('sessions')
      .select('id, title, created_at, source_type, duration_s, summary, transcript, enc_version')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(de, de + PAGINA - 1)
    if (error) throw error
    todas.push(...(data || []))
    if (!data || data.length < PAGINA) break
  }

  const linhas = await decifrarLista(todas)
  cacheAcervo = { userId, linhas }
  return linhas
}

export async function searchConversations(userId, term) {
  const query = term.trim()
  if (!query) return { titles: [], transcripts: [] }

  const acervo = await carregarAcervo(userId)
  const alvo = query.toLowerCase()
  const contem = texto => String(texto || '').toLowerCase().includes(alvo)

  const titles = acervo.filter(c => contem(c.title)).slice(0, 20)
  const vistos = new Set(titles.map(c => c.id))

  const transcripts = acervo
    .filter(c => !vistos.has(c.id) && contem(c.transcript))
    .slice(0, 20)
    // A transcrição inteira não vai para a tela: só o trecho em volta do termo.
    .map(c => ({ ...c, excerpt: excerptAround(c.transcript, query), transcript: undefined }))

  return { titles: titles.map(c => ({ ...c, transcript: undefined })), transcripts }
}

// Trecho curto em volta da primeira ocorrência, para o resultado mostrar em que
// contexto a palavra apareceu em vez de só afirmar que apareceu.
function excerptAround(transcript, term, radius = 70) {
  if (!transcript) return ''
  const at = transcript.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return transcript.slice(0, radius * 2).trim()
  const start = Math.max(0, at - radius)
  const end = Math.min(transcript.length, at + term.length + radius)
  return `${start > 0 ? '…' : ''}${transcript.slice(start, end).trim()}${end < transcript.length ? '…' : ''}`
}

export function formatCapturedAt(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// A lista chega ordenada do banco (created_at desc); aqui ela só ganha as
// quebras. Sem elas são vinte títulos numa coluna só, sem nenhum eixo de tempo
// — e a busca vira o único jeito de achar o que foi capturado ontem.
const DIA = 86400000

export function groupConversations(list) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const inicioDoDia = hoje.getTime()

  const grupos = []
  let atual = null

  // As fixadas saem da linha do tempo e sobem para um grupo próprio: fixar só
  // vale a pena se a conversa deixa de descer conforme o acervo cresce. A
  // ordenação por data continua valendo dentro de cada grupo, porque a lista
  // já chega ordenada do banco.
  const fixadas = list.filter(c => c.pinned)
  if (fixadas.length) grupos.push({ label: 'Fixadas', items: fixadas })

  for (const c of list.filter(c => !c.pinned)) {
    const rotulo = labelForAge(new Date(c.created_at).getTime(), inicioDoDia)
    if (!atual || atual.label !== rotulo) {
      atual = { label: rotulo, items: [] }
      grupos.push(atual)
    }
    atual.items.push(c)
  }
  return grupos
}

function labelForAge(quando, inicioDoDia) {
  if (quando >= inicioDoDia) return 'Hoje'
  if (quando >= inicioDoDia - DIA) return 'Ontem'
  if (quando >= inicioDoDia - 7 * DIA) return 'Últimos 7 dias'
  if (quando >= inicioDoDia - 30 * DIA) return 'Últimos 30 dias'
  return 'Mais antigas'
}

// O resumo vem em markdown com bullets, e os antigos ainda começam com um
// cabeçalho fixo ("Resumo da Transcrição -- 🎯 Tema principal"). No card isso
// ocuparia a primeira linha inteira sem dizer nada, então sai fora: o que
// interessa ali é a primeira frase de conteúdo.
export function previewOf(conversation, max = 110) {
  let raw = (conversation?.summary || '')
    .replace(/[*_`#>]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Os resumos antigos abrem com um cabeçalho de forma variável ("Resumo da
  // Transcrição -- Tema principal", "Resumo do Áudio — … -- Tema Principal").
  // Em vez de tentar casar cada variante, corto tudo que vem antes do rótulo:
  // o conteúdo começa logo depois dele. Os resumos novos não têm o rótulo e
  // passam intactos.
  const rotulo = raw.match(/tema\s+principal:?\s*/i)
  if (rotulo && rotulo.index < 80) raw = raw.slice(rotulo.index + rotulo[0].length)

  if (!raw) return ''
  if (raw.length <= max) return raw
  const corte = raw.slice(0, max)
  return corte.slice(0, corte.lastIndexOf(' ')) + '…'
}

export function formatDurationLabel(seconds) {
  if (!seconds) return null
  const m = Math.round(seconds / 60)
  return m < 1 ? 'menos de 1 min' : `${m} min`
}
