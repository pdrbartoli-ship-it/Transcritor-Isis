// Uma conversa vira trechos buscáveis. É o passo 1 do "Perguntar ao acervo"
// (plano-busca-geral.md): acontece uma vez por conversa, no aparelho, e o
// resultado é o que depois vira vetor e vai para o índice local.
//
// Dois tipos de trecho, de propósito:
//   fala     ~1.400 caracteres de transcrição seguidos, com início e fim em
//            segundos. É o que faz a citação saber o minuto.
//   resumo   cada capítulo, tópico e tarefa que a IA já extraiu na captura.
//            São resumos prontos, e acertam bem as perguntas do tipo "o que
//            ficou decidido sobre...". Saem de graça: já estão gravados.

// ~350 tokens, cerca de 1,5 minuto de fala. É a medida usada no teste de
// recall que decidiu esta busca; mudá-la invalida aquele resultado.
export const ALVO_CHARS = 1400

// Conversa antiga sem `segments` (legenda de YouTube sem marcação, capturas
// anteriores à timeline): quebra por tamanho, sem tempo. A citação dela sai
// sem minuto, o que é melhor do que ela ficar fora da busca.
function trechosDoTextoCorrido(texto) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim()
  const out = []
  for (let i = 0; i < limpo.length; i += ALVO_CHARS) {
    out.push({ tipo: 'fala', ini: null, fim: null, texto: limpo.slice(i, i + ALVO_CHARS) })
  }
  return out
}

function trechosDosSegments(segments) {
  const out = []
  let buf = [], ini = null, fim = null, tamanho = 0
  for (const s of segments) {
    if (ini === null) ini = s.start
    buf.push(s.text)
    fim = s.end
    tamanho += String(s.text || '').length + 1
    if (tamanho >= ALVO_CHARS) {
      out.push({ tipo: 'fala', ini, fim, texto: buf.join(' ') })
      buf = []; ini = null; tamanho = 0
    }
  }
  if (buf.length) out.push({ tipo: 'fala', ini, fim, texto: buf.join(' ') })
  return out
}

// Intervalo de um tópico: ele traz uma lista de trechos citados, e o que
// interessa para a citação é onde o assunto começa.
function primeiroIntervalo(refs) {
  const par = (refs || []).find(r => Array.isArray(r) && r.length >= 2)
  return par ? { ini: par[0], fim: par[1] } : { ini: null, fim: null }
}

function trechosDosInsights(insights) {
  const out = []
  for (const c of insights?.chapters || []) {
    const corpo = [c.title, ...(c.bullets || [])].filter(Boolean).join('. ')
    if (corpo) out.push({ tipo: 'capitulo', ini: c.start ?? null, fim: c.end ?? null, texto: corpo })
  }
  for (const t of insights?.topics || []) {
    const corpo = [t.label, t.detail].filter(Boolean).join('. ')
    if (corpo) out.push({ tipo: 'topico', ...primeiroIntervalo(t.time_refs), texto: corpo })
  }
  for (const t of insights?.todos || []) {
    const quem = (t.owners || []).join(', ')
    const corpo = [t.task, t.description, quem && `Responsável: ${quem}`, t.due && `Prazo: ${t.due}`]
      .filter(Boolean).join('. ')
    if (corpo) {
      const [ini, fim] = Array.isArray(t.time_ref) ? t.time_ref : []
      out.push({ tipo: 'tarefa', ini: ini ?? null, fim: fim ?? null, texto: corpo })
    }
  }
  return out
}

// `conversa` é a linha já decifrada (o que `getConversation` devolve).
export function trechosDaConversa(conversa) {
  const segments = conversa.segments || []
  const falas = segments.length ? trechosDosSegments(segments) : trechosDoTextoCorrido(conversa.transcript)
  const resumos = trechosDosInsights(conversa.insights)

  // Trecho curto demais não responde nada e só ocupa uma das 8 vagas que vão
  // para a IA. O piso é baixo de propósito: uma tarefa legítima ("Comprar o
  // domínio") tem 17 caracteres.
  return [...falas, ...resumos]
    .filter(t => t.texto && t.texto.trim().length >= 12)
    .map((t, i) => ({
      ...t,
      id: `${conversa.id}:${i}`,
      sessionId: conversa.id,
      // Guardados no trecho para a busca e a citação não precisarem voltar ao
      // banco: o índice tem de bastar sozinho.
      titulo: conversa.title || '',
      data: conversa.created_at,
    }))
}

// Muda alguma coisa que obrigue a reindexar? A impressão digital é tirada da
// LISTA de conversas, que o app já tem em mãos — de propósito: só assim dá
// para saber que uma conversa mudou sem baixá-la inteira de novo. A duração e
// o tamanho do resumo mudam quando a conversa é reanalisada, que é o único
// jeito de o conteúdo de uma captura mudar depois de gravada.
//
// Renomear não entra: o título não vira vetor, e reindexar por causa dele
// seria pagar a indexação de novo à toa.
export function impressaoDaConversa(conversa) {
  return `${conversa.duration_s || 0}:${(conversa.summary || '').length}`
}
