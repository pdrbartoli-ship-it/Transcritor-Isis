import { useState, useEffect, useCallback } from 'react'
import { useParams, Outlet, useOutletContext, useLocation } from 'react-router-dom'
import { getConversation } from '../../lib/conversas'
import { track } from '../../lib/analytics'
import { useTranscricoes } from '../../contexts/TranscricoesContext'
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

  // Aberta, deixa de ser novidade: a bolinha verde da lateral some.
  const { marcarLida } = useTranscricoes()
  useEffect(() => { marcarLida(id) }, [id, marcarLida])

  // O saldo de perguntas é do mês, e não da conversa: vem do Layout, que o lê
  // junto com os minutos. A barra de perguntar aparece em todas as abas da
  // conversa e o número tem de ser o mesmo nelas.
  const { perguntasRestantes, atualizarPerguntasRestantes } = outer

  if (error && !conversation) return <div className="alert alert-error">{error}</div>
  // A forma da página antes do conteúdo: título, data e dois blocos. Um
  // spinner no meio da tela vazia fazia a conversa "saltar" para o lugar
  // quando chegava.
  if (!conversation) {
    return (
      <div className="conversa-shell">
        <div className="conversa esqueleto-conversa" aria-label="Carregando a conversa">
          <span className="esqueleto-linha titulo" />
          <span className="esqueleto-linha" style={{ width: '32%' }} />
          <span className="esqueleto-bloco" />
          <span className="esqueleto-bloco" />
        </div>
      </div>
    )
  }

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
