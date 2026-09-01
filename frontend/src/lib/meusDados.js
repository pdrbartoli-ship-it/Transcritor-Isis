import { supabase } from './supabase'
import { displayTitle } from './conversas'

// "Meus dados": levar tudo embora e apagar tudo. São as duas metades concretas
// de "o dado é seu" — sem elas a frase é só marketing.
//
// O exportar também é a rede de segurança da migração para criptografia: com um
// backup legível na mão do usuário, reescrever o banco deixa de ser uma aposta.

// Em lotes: uma conta com centenas de horas gravadas estoura o limite padrão de
// linhas do PostgREST numa consulta só, e o export sairia silenciosamente pela
// metade — que é a pior falha possível num backup.
const PAGE = 100

async function fetchAllPages(build) {
  const todas = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    todas.push(...(data || []))
    if (!data || data.length < PAGE) return todas
  }
}

export async function fetchEverything(userId) {
  const conversas = await fetchAllPages(() =>
    supabase.from('sessions')
      .select('id, title, created_at, source_type, duration_s, transcript, summary, segments, insights')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  )

  const chats = await fetchAllPages(() =>
    supabase.from('chats')
      .select('id, session_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  )

  const mensagens = chats.length
    ? await fetchAllPages(() =>
        supabase.from('chat_messages')
          .select('chat_id, role, content, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
      )
    : []

  // As perguntas de cada conversa entram junto dela: no arquivo exportado, o
  // que o usuário quer reencontrar é "aquela reunião e o que perguntei sobre
  // ela", não duas listas soltas que ele teria de cruzar na mão.
  const chatPorSessao = new Map()
  for (const c of chats) chatPorSessao.set(c.id, c.session_id)

  const perguntasPorSessao = new Map()
  for (const m of mensagens) {
    const sessionId = chatPorSessao.get(m.chat_id)
    if (!sessionId) continue
    if (!perguntasPorSessao.has(sessionId)) perguntasPorSessao.set(sessionId, [])
    perguntasPorSessao.get(sessionId).push({ papel: m.role, texto: m.content, em: m.created_at })
  }

  return conversas.map(c => ({ ...c, perguntas: perguntasPorSessao.get(c.id) || [] }))
}

function dataLegivel(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const ORIGEM = { record: 'Gravação', file: 'Arquivo', url: 'Link' }

// O resumo vem do modelo e às vezes traz cabeçalhos próprios ("## Decisões").
// Soltos no arquivo, eles se misturam aos títulos das conversas e o índice do
// documento passa a mentir — um resumo vira o que parece ser outra conversa.
// Rebaixá-los para o nível 4 mantém cada um dentro da conversa a que pertence.
function rebaixarTitulos(markdown) {
  return String(markdown || '').replace(/^(#{1,3})\s+/gm, '#### ')
}

// Markdown, e não JSON: o backup precisa ser legível por uma pessoa daqui a
// dois anos, sem o Dito instalado e sem ninguém para explicar o formato. O
// JSON vai junto no mesmo download, para quem quiser reimportar algum dia.
export function toMarkdown(conversas) {
  const linhas = [
    '# Minhas conversas no Dito',
    '',
    `Exportado em ${dataLegivel(new Date().toISOString())} · ${conversas.length} conversa(s)`,
    '',
  ]

  for (const c of conversas) {
    linhas.push('---', '', `## ${displayTitle(c)}`, '')
    const origem = ORIGEM[c.source_type] || 'Captura'
    const duracao = c.duration_s ? ` · ${Math.round(c.duration_s / 60)} min` : ''
    linhas.push(`${origem} · ${dataLegivel(c.created_at)}${duracao}`, '')

    if (c.summary) linhas.push('### Resumo', '', rebaixarTitulos(c.summary), '')

    const todos = c.insights?.todos || []
    if (todos.length) {
      linhas.push('### Tarefas', '')
      for (const t of todos) linhas.push(`- [ ] ${typeof t === 'string' ? t : (t.texto || t.text || '')}`)
      linhas.push('')
    }

    if (c.transcript) linhas.push('### Transcrição', '', c.transcript, '')

    if (c.perguntas.length) {
      linhas.push('### Perguntas que fiz sobre esta conversa', '')
      for (const p of c.perguntas) {
        linhas.push(p.papel === 'user' ? `**Você:** ${p.texto}` : `**Dito:** ${p.texto}`, '')
      }
    }
  }

  return linhas.join('\n')
}

export function toJson(conversas) {
  return JSON.stringify({
    exportadoEm: new Date().toISOString(),
    versao: 1,
    conversas,
  }, null, 2)
}

// Apaga tudo do usuário. A ordem importa: as mensagens dependem dos chats, que
// dependem das sessões. `chat_messages` e `chats` têm `on delete cascade` a
// partir de sessions, mas apagar explicitamente cobre os chats órfãos de
// versões antigas — e não custa nada.
export async function deleteEverything(userId) {
  for (const tabela of ['chat_messages', 'chats', 'sessions']) {
    const { error } = await supabase.from(tabela).delete().eq('user_id', userId)
    if (error) throw error
  }
}
