import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { chatWithSessions } from '../lib/api'
import Layout from '../components/Layout'

export default function SessionChat() {
  const { clientId, sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [client, setClient] = useState(null)
  const [allSessions, setAllSessions] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { fetchData() }, [sessionId])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function fetchData() {
    const [{ data: sessionData }, { data: clientData }, { data: allSessionsData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('sessions').select('id, title, transcript, summary, created_at').eq('client_id', clientId),
    ])
    setSession(sessionData)
    setClient(clientData)
    setAllSessions(allSessionsData || [])

    if (sessionData && clientData) {
      const others = (allSessionsData || []).filter(s => s.id !== sessionData.id)
      const contextNote = others.length > 0
        ? `Você também pode me perguntar sobre qualquer uma das outras ${others.length} sessão(ões) de **${clientData.name}**.`
        : `Você pode me perguntar sobre esta sessão de **${clientData.name}**.`

      setMessages([{
        role: 'assistant',
        content: `**Resumo — ${sessionData.title}**\n\n${sessionData.summary}\n\n---\n\n${contextNote}`,
      }])
    }

    setLoading(false)
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!input.trim() || sending) return

    const question = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setSending(true)

    try {
      const sessionsCtx = allSessions.map(s => ({
        title: s.title,
        date: new Date(s.created_at).toLocaleDateString('pt-BR'),
        transcript: s.transcript,
        summary: s.summary,
      }))
      const { answer } = await chatWithSessions(question, client?.name, sessionsCtx)
      setMessages(prev => [...prev, { role: 'assistant', content: answer }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${err.message}` }])
    } finally {
      setSending(false)
    }
  }

  if (loading) return <Layout><div className="empty-state"><div className="spinner" /></div></Layout>

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <button className="btn-back" onClick={() => navigate(`/clients/${clientId}`)}>
          ← {client?.name}
        </button>
        <div className="chat-header-title">
          <h3>{session?.title}</h3>
          <span className="text-muted text-sm">
            {new Date(session?.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => setShowTranscript(v => !v)}>
          {showTranscript ? 'Ocultar' : 'Transcrição'}
        </button>
      </header>

      {showTranscript && (
        <div className="transcript-panel">
          <strong>Transcrição completa</strong>
          <p>{session?.transcript}</p>
        </div>
      )}

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="bubble">
              <MarkdownText text={msg.content} />
            </div>
          </div>
        ))}
        {sending && (
          <div className="message assistant">
            <div className="bubble thinking">Pensando...</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`Pergunte sobre ${client?.name}...`}
          disabled={sending}
          autoFocus
        />
        <button type="submit" className="btn-primary" disabled={sending || !input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  )
}

function MarkdownText({ text }) {
  const lines = text.split('\n')
  return (
    <div className="md">
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4)
          return <p key={i}><strong>{line.slice(2, -2)}</strong></p>
        if (line === '---') return <hr key={i} />
        if (line === '') return <br key={i} />
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        )
      })}
    </div>
  )
}
