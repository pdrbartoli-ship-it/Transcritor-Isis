import { useState, useEffect, useCallback } from 'react'
import { useParams, Outlet, useOutletContext, useLocation } from 'react-router-dom'
import { getConversation } from '../../lib/conversas'
import { supabase } from '../../lib/supabase'
import { planoPorId } from '../../lib/planos'
import { track } from '../../lib/analytics'
import AskBar from './AskBar'

// As quatro telas da conversa (visão geral, tópico, tarefas, timeline) são
// rotas irmãs sobre o MESMO dado. Carregar aqui, uma vez, evita que navegar
// entre elas rebusque a transcrição inteira a cada clique.
export default function ConversaLayout() {
  const { id } = useParams()
  const outer = useOutletContext()
  const location = useLocation()

  // O chat tem o campo dele; duas caixas de digitar empilhadas no rodapé
  // seriam a mesma pergunta em dois lugares.
  const noChat = location.pathname.endsWith('/chat')

  const [conversation, setConversation] = useState(null)
  const [error, setError] = useState(null)
  const [perguntasUsadas, setPerguntasUsadas] = useState(null)

  const load = useCallback(async () => {
    try {
      setConversation(await getConversation(id))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    setConversation(null)
    setError(null)
    load()
  }, [load])

  useEffect(() => { track('conversa_aberta') }, [id])

  // Quantas perguntas desta transcrição já foram feitas. Mora aqui, e não no
  // chat, porque a barra de perguntar aparece em todas as abas da conversa e o
  // número tem de ser o mesmo nelas. Sem linha no banco = nenhuma pergunta
  // ainda; com erro de leitura, a contagem simplesmente não aparece.
  useEffect(() => {
    let ativo = true
    setPerguntasUsadas(null)
    supabase.from('perguntas_transcricao')
      .select('perguntas_usadas')
      .eq('session_id', id)
      .maybeSingle()
      .then(({ data, error: erroLeitura }) => {
        if (ativo && !erroLeitura) setPerguntasUsadas(data?.perguntas_usadas ?? 0)
      })
    return () => { ativo = false }
  }, [id])

  // null = plano sem limite, ou dado ainda não lido: nos dois casos a tela não
  // mostra contagem nenhuma.
  const limite = outer.plano ? planoPorId(outer.plano).perguntas : null
  const perguntasRestantes = limite == null || perguntasUsadas == null
    ? null
    : Math.max(0, limite - perguntasUsadas)

  // O servidor é quem conta; a tela só acompanha o número que ele devolve a
  // cada resposta, em vez de somar por conta própria e divergir dele.
  const atualizarPerguntasRestantes = useCallback(restantes => {
    if (limite == null || restantes == null) return
    setPerguntasUsadas(limite - restantes)
  }, [limite])

  if (error && !conversation) return <div className="alert alert-error">{error}</div>
  if (!conversation) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className={`conversa-shell ${noChat ? '' : 'com-ask'}`}>
      <Outlet context={{
        ...outer,
        conversation,
        setConversation,
        reloadConversation: load,
        perguntasRestantes,
        atualizarPerguntasRestantes,
      }} />
      {!noChat && (
        <div className="ask-dock">
          <AskBar restantes={perguntasRestantes} onVerPlanos={outer.abrirPlano} />
        </div>
      )}
    </div>
  )
}
