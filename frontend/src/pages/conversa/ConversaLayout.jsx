import { useState, useEffect, useCallback } from 'react'
import { useParams, Outlet, useOutletContext } from 'react-router-dom'
import { getConversation } from '../../lib/conversas'
import { track } from '../../lib/analytics'

// As quatro telas da conversa (visão geral, tópico, tarefas, timeline) são
// rotas irmãs sobre o MESMO dado. Carregar aqui, uma vez, evita que navegar
// entre elas rebusque a transcrição inteira a cada clique.
export default function ConversaLayout() {
  const { id } = useParams()
  const outer = useOutletContext()

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

  return <Outlet context={{ ...outer, conversation, setConversation, reloadConversation: load }} />
}
