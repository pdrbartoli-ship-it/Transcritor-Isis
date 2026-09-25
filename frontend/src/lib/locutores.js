import { supabase } from './supabase'
import { cifrarLinha, ENC_ATUAL } from './cofre'
import { invalidarBuscaLocal } from './conversas'
import { apagarConversa as apagarDoIndice } from './acervo/indice'

// Trocar o nome de quem fala numa conversa, em todos os lugares de uma vez.
//
// O nome de um locutor não mora num campo só: ele está nas marcas de troca de
// voz (`speaker_turns`, que é o que a transcrição desenha), na lista de
// `speakers` e nos responsáveis das tarefas. Mudar só um deles deixava a
// conversa dizendo "Júlia" na transcrição e "Locutor 2" na lista de tarefas.
//
// A gravação segue o mesmo cuidado do renomear a conversa: uma conversa antiga
// (sem cifra) continua sem cifra, porque a leitura decide pelo `enc_version` da
// linha inteira e meio cifrada ela ficaria ilegível.
export async function renomearLocutor(conversation, de, para) {
  const antigo = (de || '').trim()
  const novo = (para || '').trim()
  if (!antigo || !novo || antigo === novo) return conversation.insights

  const insights = trocarNosInsights(conversation.insights, antigo, novo)
  const patch = conversation.enc_version === ENC_ATUAL
    ? await cifrarLinha({ insights })
    : { insights }
  const { error } = await supabase.from('sessions').update(patch).eq('id', conversation.id)
  if (error) throw error

  // O índice do Perguntar guarda os trechos desta conversa com os nomes de
  // antes. Sem isto, a resposta de amanhã ainda citaria "Locutor 2".
  invalidarBuscaLocal()
  apagarDoIndice(conversation.id).catch(() => { /* o índice se refaz sozinho */ })
  return insights
}

function trocarNosInsights(insights, antigo, novo) {
  if (!insights) return insights
  const igual = valor => (valor || '').trim() === antigo

  return {
    ...insights,
    speakers: (insights.speakers || []).map(s => (
      igual(s.name) || (!s.name && igual(s.label))
        // `confidence` passa a "alta": quem renomeou sabe quem é, e é esse
        // nome que manda a partir de agora.
        ? { ...s, name: novo, confidence: 'alta' }
        : s
    )),
    speaker_turns: (insights.speaker_turns || []).map(t => (
      igual(t.speaker) ? { ...t, speaker: novo } : t
    )),
    todos: (insights.todos || []).map(t => (
      (t.owners || []).some(igual)
        ? { ...t, owners: t.owners.map(o => (igual(o) ? novo : o)) }
        : t
    )),
  }
}

// Os nomes que aparecem nesta conversa, para a tela oferecer a troca. Sai da
// lista de locutores quando ela existe, e das marcas de troca quando não (é o
// caso das conversas analisadas antes de a lista existir).
export function locutoresDaConversa(insights) {
  if (!insights) return []
  const daLista = (insights.speakers || []).map(s => (s.name || s.label || '').trim())
  const dasMarcas = (insights.speaker_turns || []).map(t => (t.speaker || '').trim())
  return [...new Set([...daLista, ...dasMarcas].filter(Boolean))]
}
