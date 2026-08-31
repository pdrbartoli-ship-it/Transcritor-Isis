import { useState, useEffect, useRef } from 'react'
import { useOutletContext, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { askConversation } from '../../lib/api'
import { track } from '../../lib/analytics'
import ChatTextarea from '../../components/chat/ChatTextarea'
import MarkdownText from '../../components/chat/MarkdownText'
import { IconSend, IconMessage } from '../../components/Icons'
import ConversaHeader from './ConversaHeader'

// Cada mensagem reenvia o histórico; sem teto, uma conversa longa cresce sem
// parar. O corte é por mensagem, para uma resposta gigante não comer o espaço
// das outras.
const MAX_CHARS_PER_TURN = 2000

// Uma thread persistente cresce para sempre entre visitas; sem limite de
// turnos, reabrir uma conversa antiga depois de meses passaria a pagar (em
// tokens e em latência) por perguntas que não têm mais nada a ver com a de
// agora. 20 mensagens é dez idas e vindas — sobra contexto de sobra.
const MAX_HISTORY_MESSAGES = 20

// O estado vazio era um parágrafo e seiscentos pixels de nada. Quem acabou de
// transcrever uma reunião não sabe o que dá para perguntar, então não pergunta
// — e o recurso mais caro do app fica sem uso.
const SUGESTOES = [
  'Quais foram as decisões?',
  'O que ficou pendente e com quem?',
  'Resuma para quem não estava presente',
  'Que números foram citados?',
]

// Uma conversa tem UMA thread de chat, não várias. Perguntar de novo sobre a
// mesma gravação continua a mesma leitura, com o que já foi perguntado ali em
// cima — não um chat novo que esconde o anterior atrás de uma aba de
// histórico. O id da thread mora em `chats.session_id`; a primeira pergunta
// cria a linha, as seguintes só acrescentam mensagens a ela.
export default function Chat() {
  const { user } = useAuth()
  const { conversation } = useOutletContext()
  const location = useLocation()
  const navigate = useNavigate()

  const [ready, setReady] = useState(false)
  const [chatId, setChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const firstScrollRef = useRef(true)

  // Carrega a thread existente desta conversa, se houver, antes de qualquer
  // outra coisa: perguntar de novo precisa enxergar o que já foi perguntado.
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setChatId(null)
    setMessages([])
    firstScrollRef.current = true
    ;(async () => {
      const { data: chat } = await supabase
        .from('chats').select('id')
        .eq('session_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(1).maybeSingle()
      if (cancelled) return
      if (chat) {
        setChatId(chat.id)
        const { data: msgs } = await supabase
          .from('chat_messages').select('role, content')
          .eq('chat_id', chat.id).order('created_at')
        if (!cancelled) setMessages(msgs || [])
      }
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [conversation.id])

  // Reentrar numa conversa que já tem histórico disparava uma sequência de
  // rolagens ANIMADAS em cima da outra — carregou o histórico, entrou a
  // pergunta, entrou o "Pensando…", entrou a resposta — e a tela sacudia do
  // topo até o fim quatro vezes. A primeira posição é um salto seco: ninguém
  // precisa ver a tela percorrer meses de conversa. Só o que chega DEPOIS,
  // com o usuário já olhando, rola suave.
  useEffect(() => {
    if (!ready) return
    const behavior = firstScrollRef.current ? 'auto' : 'smooth'
    firstScrollRef.current = false
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [messages, sending, ready])

  // Pergunta digitada na barra fixa da conversa: chega pelo state da rota e é
  // enviada assim que a thread termina de carregar — antes disso, `messages`
  // ainda não reflete o histórico salvo, e a pergunta perderia o contexto.
  const pending = location.state?.ask
  useEffect(() => {
    if (!pending || !ready) return
    navigate('.', { replace: true, state: null })
    send(null, pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ready])

  // Um chip não passa pelo campo: mandar o texto direto evita depender de o
  // setState ter sido aplicado antes do submit.
  function ask(texto) { send(null, texto) }

  async function send(e, texto) {
    e?.preventDefault()
    const text = (texto ?? question).trim()
    if (!text || sending) return

    setQuestion('')
    setError(null)
    setSending(true)
    const asked = [...messages, { role: 'user', content: text }]
    setMessages(asked)

    try {
      const history = messages
        .slice(-MAX_HISTORY_MESSAGES)
        .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_TURN) }))
      const result = await askConversation(text, conversation, { history })

      setMessages([...asked, { role: 'assistant', content: result.answer }])
      await persist(text, result)
      track('chat', { usage: result.usage })
    } catch (err) {
      setError(err.message)
      // A pergunta volta para o campo: perdê-la porque a rede caiu é a pior
      // parte de um erro aqui.
      setMessages(messages)
      setQuestion(text)
    } finally {
      setSending(false)
    }
  }

  // Best-effort: uma falha ao gravar não pode apagar a resposta da tela.
  async function persist(text, result) {
    try {
      let id = chatId
      if (!id) {
        const { data, error: insertError } = await supabase.from('chats')
          .insert({ session_id: conversation.id, user_id: user.id })
          .select('id').single()
        if (insertError) throw insertError
        id = data.id
        setChatId(id)
      }
      await supabase.from('chat_messages').insert([
        { chat_id: id, user_id: user.id, role: 'user', content: text },
        { chat_id: id, user_id: user.id, role: 'assistant', content: result.answer },
      ])
    } catch {}
  }

  return (
    <div className="conversa chat-page">
      <ConversaHeader
        conversation={conversation}
        title="Pergunte qualquer coisa"
        subtitle="Sobre esta conversa"
      />

      <div className="chat-messages">
        {ready && messages.length === 0 && !sending && (
          <div className="chat-starter">
            <IconMessage width={26} height={26} />
            <p>Pergunte o que quiser sobre esta conversa — o que ficou decidido, o que fulano disse, o que faltou.</p>
            <div className="starter-chips">
              {SUGESTOES.map(texto => (
                <button key={texto} type="button" onClick={() => ask(texto)} disabled={sending}>
                  {texto}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="bubble">
              {m.role === 'assistant' ? <MarkdownText text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="message assistant">
            <div className="bubble"><span className="spinner spinner-sm" /> Pensando…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form className="chat-input" onSubmit={send}>
        <ChatTextarea
          value={question}
          onChange={setQuestion}
          onSubmit={send}
          placeholder="Pergunte qualquer coisa sobre esta conversa"
          disabled={sending}
        />
        <button type="submit" className="btn-icon" disabled={sending || !question.trim()} aria-label="Enviar">
          <IconSend width={18} height={18} />
        </button>
      </form>
    </div>
  )
}
