import { useState, useEffect, useCallback } from 'react'
import { useParams, Outlet, useOutletContext, useLocation } from 'react-router-dom'
import { getConversation } from '../../lib/conversas'
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

  if (error && !conversation) return <div className="alert alert-error">{error}</div>
  if (!conversation) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className={`conversa-shell ${noChat ? '' : 'com-ask'}`}>
      <Outlet context={{ ...outer, conversation, setConversation, reloadConversation: load }} />
      {!noChat && <div className="ask-dock"><AskBar /></div>}
    </div>
  )
}
