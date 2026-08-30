import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { askConversation } from '../../lib/api'
import { track } from '../../lib/analytics'
import ChatTextarea from '../../components/chat/ChatTextarea'
import MarkdownText from '../../components/chat/MarkdownText'
import { IconSend, IconTrash, IconMessage } from '../../components/Icons'
import ConversaHeader from './ConversaHeader'

// Cada mensagem reenvia o histórico; sem teto, uma conversa longa cresce sem
// parar. O corte é por mensagem, para uma resposta gigante não comer o espaço
// das outras.
const MAX_CHARS_PER_TURN = 2000

export default function Chat() {
  const { user } = useAuth()
  const { conversation } = useOutletContext()

  const [tab, setTab] = useState('chat')
  const [chats, setChats] = useState([])
  const [activeChat, setActiveChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)

  async function loadChats() {
    const { data } = await supabase
      .from('chats').select('id, title, preview, updated_at')
      .eq('session_id', conversation.id)
      .order('updated_at', { ascending: false })
    setChats(data || [])
  }

  useEffect(() => { loadChats() }, [conversation.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function openChat(chat) {
    setActiveChat(chat)
    setTab('chat')
    const { data } = await supabase
      .from('chat_messages').select('role, content')
      .eq('chat_id', chat.id).order('created_at')
    setMessages(data || [])
  }

  function newChat() {
    setActiveChat(null)
    setMessages([])
    setTab('chat')
  }

  async function send(e) {
    e?.preventDefault()
    const text = question.trim()
    if (!text || sending) return

    setQuestion('')
    setError(null)
    setSending(true)
    const asked = [...messages, { role: 'user', content: text }]
    setMessages(asked)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_TURN) }))
      const result = await askConversation(text, conversation, { history, makeTitle: !activeChat })

      setMessages([...asked, { role: 'assistant', content: result.answer }])
      await persist(text, result, asked.length === 1)
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
  async function persist(text, result, isFirst) {
    try {
      let chat = activeChat
      if (!chat) {
        const { data } = await supabase.from('chats').insert({
          session_id: conversation.id,
          user_id: user.id,
          title: result.title || text.slice(0, 60),
          preview: result.answer.slice(0, 120),
        }).select('id, title, preview, updated_at').single()
        chat = data
        setActiveChat(chat)
      } else {
        await supabase.from('chats')
          .update({ preview: result.answer.slice(0, 120), updated_at: new Date().toISOString() })
          .eq('id', chat.id)
      }
      if (!chat) return
      await supabase.from('chat_messages').insert([
        { chat_id: chat.id, user_id: user.id, role: 'user', content: text },
        { chat_id: chat.id, user_id: user.id, role: 'assistant', content: result.answer },
      ])
      await loadChats()
    } catch {}
  }

  async function removeChat(id, e) {
    e.stopPropagation()
    if (!window.confirm('Apagar esta conversa do chat?')) return
    await supabase.from('chats').delete().eq('id', id)
    if (activeChat?.id === id) newChat()
    await loadChats()
  }

  return (
    <div className="conversa chat-page">
      <ConversaHeader
        conversation={conversation}
        backTo=".."
        backLabel={conversation.title}
        title="Pergunte qualquer coisa"
        subtitle={activeChat?.title || 'Sobre esta conversa'}
      />

      <div className="chat-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
        <button className={tab === 'historico' ? 'on' : ''} onClick={() => setTab('historico')}>
          Histórico{chats.length > 0 && ` (${chats.length})`}
        </button>
        {tab === 'chat' && messages.length > 0 && (
          <button className="chat-new" onClick={newChat}>Nova pergunta</button>
        )}
      </div>

      {tab === 'historico' ? (
        chats.length === 0 ? (
          <p className="text-muted">Nenhuma pergunta feita sobre esta conversa ainda.</p>
        ) : (
          <ul className="chat-history">
            {chats.map((c, i) => (
              <li key={c.id}>
                <div
                  className="chat-history-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => openChat(c)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(c) } }}
                >
                  <span className="chat-history-main">
                    <span className="chat-history-title">{i + 1}. {c.title}</span>
                    {c.preview && <span className="chat-history-preview">{c.preview}</span>}
                    <span className="chat-history-date">
                      {new Date(c.updated_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </span>
                  <button className="btn-icon" onClick={e => removeChat(c.id, e)} aria-label="Apagar">
                    <IconTrash width={15} height={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="chat-messages">
            {messages.length === 0 && !sending && (
              <div className="chat-starter">
                <IconMessage width={26} height={26} />
                <p>Pergunte o que quiser sobre esta conversa — o que ficou decidido, o que fulano disse, o que faltou.</p>
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
        </>
      )}
    </div>
  )
}
