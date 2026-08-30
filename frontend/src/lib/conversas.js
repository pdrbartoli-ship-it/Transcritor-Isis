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

export async function createConversation(userId, result, sourceType, fallbackName) {
  const clientId = await ensureInbox(userId)
  const title =
    result.title?.trim() ||
    result.insights?.title?.trim() ||
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

export function formatDurationLabel(seconds) {
  if (!seconds) return null
  const m = Math.round(seconds / 60)
  return m < 1 ? 'menos de 1 min' : `${m} min`
}
