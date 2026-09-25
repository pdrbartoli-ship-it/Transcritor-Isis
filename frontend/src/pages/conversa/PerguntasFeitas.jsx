import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { decifrarMensagens } from '../../lib/cofre'
import { track } from '../../lib/analytics'
import { IconClock } from '../../components/Icons'

// As perguntas já feitas nesta conversa, na visão geral dela.
//
// Antes elas só existiam dentro do chat, e a única porta para o chat era a
// barra de perguntar: para reler o que já tinha perguntado, a pessoa precisava
// começar uma pergunta nova. Aqui elas ficam à vista, logo abaixo do resumo,
// com a mesma cara da lista do Perguntar.
//
// A conversa é lida direto do banco, e não do que a tela do chat carrega: os
// dois são irmãos, e fazer a visão geral depender do chat obrigaria a montar o
// chat inteiro para mostrar três linhas.
const NA_TELA = 3

export default function PerguntasFeitas({ conversation }) {
  const navigate = useNavigate()
  const [perguntas, setPerguntas] = useState([])

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const { data: chats } = await supabase.from('chats')
          .select('id').eq('session_id', conversation.id)
          .order('created_at', { ascending: true }).limit(1)
        if (!chats?.length || cancelado) return

        const { data: msgs } = await supabase.from('chat_messages')
          .select('id, content, enc_version, created_at')
          .eq('chat_id', chats[0].id).eq('role', 'user')
          .order('created_at', { ascending: false })
        if (cancelado) return
        const abertas = await decifrarMensagens(msgs || [])
        if (!cancelado) setPerguntas(abertas.filter(m => (m.content || '').trim()))
      } catch {
        // A lista é um extra: sem ela a visão geral continua inteira.
      }
    })()
    return () => { cancelado = true }
  }, [conversation.id])

  // Conversa sem pergunta nenhuma não ganha um bloco vazio dizendo isso: quem
  // nunca perguntou não precisa saber que existe uma lista.
  if (!perguntas.length) return null

  function abrir(id) {
    track('pergunta_da_conversa_aberta')
    navigate('chat', { state: { focar: id } })
  }

  return (
    <section className="conversa-block">
      <h2>Suas perguntas</h2>
      <div className="ask-anteriores perguntas-feitas">
        {perguntas.slice(0, NA_TELA).map(p => (
          <button key={p.id} type="button" onClick={() => abrir(p.id)} title={p.content}>
            <IconClock width={15} height={15} />
            <span>{p.content}</span>
          </button>
        ))}
        {perguntas.length > NA_TELA && (
          <button type="button" className="ask-anteriores-mais" onClick={() => navigate('chat')}>
            Ver todas as {perguntas.length}
          </button>
        )}
      </div>
    </section>
  )
}
