import { supabase } from './supabase'

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
// pesada da tabela e a home não mostra nada dela.
const LIST_FIELDS = 'id, title, created_at, source_type, duration_s'
const LIST_FIELDS_BASE = 'id, title, created_at, source_type'
const FULL_FIELDS = 'id, title, created_at, source_type, transcript, summary, segments, insights, duration_s'
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
  return data || []
}

export async function getConversation(id) {
  return selectWithFallback(
    fields => supabase.from('sessions').select(fields).eq('id', id).single(),
    FULL_FIELDS, FULL_FIELDS_BASE,
  )
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

  // Mesma proteção da listagem: sem a migração, gravar só o que já existia é
  // muito melhor do que perder a transcrição que acabou de custar tempo e API.
  let { data, error } = await supabase.from('sessions').insert(enriched).select(LIST_FIELDS).single()
  if (error?.code === MISSING_COLUMN) {
    ({ data, error } = await supabase.from('sessions').insert(row).select(LIST_FIELDS_BASE).single())
  }
  if (error) throw error
  return data
}

export async function renameConversation(id, title) {
  const { error } = await supabase.from('sessions').update({ title }).eq('id', id)
  if (error) throw error
}

export async function deleteConversation(id) {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  if (error) throw error
}

// Busca em dois passos, na ordem que o usuário espera: primeiro as conversas
// cujo TÍTULO casa (é o que ele costuma lembrar), depois as que só mencionam o
// termo em algum ponto da transcrição. Uma conversa que aparece nos dois não é
// repetida embaixo.
export async function searchConversations(userId, term) {
  const query = term.trim()
  if (!query) return { titles: [], transcripts: [] }

  // `%` e `_` são curingas do ilike: sem escapar, buscar "100%" traz tudo.
  const pattern = `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`

  const [titles, byTranscript] = await Promise.all([
    selectWithFallback(
      fields => supabase.from('sessions').select(fields)
        .eq('user_id', userId).ilike('title', pattern)
        .order('created_at', { ascending: false }).limit(20),
      LIST_FIELDS, LIST_FIELDS_BASE,
    ),
    selectWithFallback(
      fields => supabase.from('sessions').select(fields)
        .eq('user_id', userId).ilike('transcript', pattern)
        .order('created_at', { ascending: false }).limit(20),
      `${LIST_FIELDS}, transcript`, `${LIST_FIELDS_BASE}, transcript`,
    ),
  ])

  const seen = new Set((titles || []).map(c => c.id))
  const transcripts = (byTranscript || [])
    .filter(c => !seen.has(c.id))
    .map(c => ({ ...c, excerpt: excerptAround(c.transcript, query), transcript: undefined }))

  return { titles: titles || [], transcripts }
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

  for (const c of list) {
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

export function formatDurationLabel(seconds) {
  if (!seconds) return null
  const m = Math.round(seconds / 60)
  return m < 1 ? 'menos de 1 min' : `${m} min`
}
