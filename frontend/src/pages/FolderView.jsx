import { useState, useEffect, useRef } from 'react'
import { useParams, useOutletContext, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { chatWithSessions } from '../lib/api'
import CapturePanel from '../components/CapturePanel'
import { IconSend, IconTrash } from '../components/Icons'

export default function FolderView() {
  const { folderId } = useParams()
  const location = useLocation()
  const { user } = useAuth()
  const { refreshFolders } = useOutletContext()

  const [folder, setFolder] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { fetchData() }, [folderId])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  // When navigated here with a specific session (from the sidebar), open the
  // panel and expand that session's transcript.
  useEffect(() => {
    const open = location.state?.openSession
    if (open && !loading) {
      setPanelOpen(true)
      setExpanded(open)
    }
  }, [location.state, loading])

  async function fetchData() {
    setLoading(true)
    const [{ data: folderData }, { data: sessionsData }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', folderId).single(),
      supabase.from('sessions').select('*').eq('client_id', folderId).order('created_at', { ascending: false }),
    ])
    setFolder(folderData)
    setSessions(sessionsData || [])
    setMessages([{
      role: 'assistant',
      content: folderData
        ? `**${folderData.name}**\n\n${(sessionsData?.length ?? 0) > 0
            ? `Tenho ${sessionsData.length} sessão(ões) nesta pasta. Pergunte o que quiser sobre elas.`
            : 'Esta pasta ainda não tem sessões. Grave ou envie um arquivo para começar.'}`
        : '',
    }])
    setExpanded(null)
    setLoading(false)
  }

  async function handleNewCapture(result, sourceType, sourceName) {
    setAdding(true)
    const title = sourceName || `Sessão ${new Date().toLocaleDateString('pt-BR')}`
    const { data, error } = await supabase.from('sessions').insert({
      client_id: folderId,
      user_id: user.id,
      title,
      source_type: sourceType,
      transcript: result.transcript,
      summary: result.summary,
    }).select().single()
    setAdding(false)
    if (!error && data) {
      setSessions(prev => [data, ...prev])
      setPanelOpen(false) // collapse the capture panel so the chat takes over
      await refreshFolders()
    }
  }

  async function deleteSession(id, e) {
    e.stopPropagation()
    if (!confirm('Excluir esta sessão?')) return
    await supabase.from('sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    await refreshFolders()
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!input.trim() || sending) return
    const question = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setSending(true)
    try {
      const ctx = sessions.map(s => ({
        title: s.title,
        date: new Date(s.created_at).toLocaleDateString('pt-BR'),
        transcript: s.transcript,
        summary: s.summary,
      }))
      const { answer } = await chatWithSessions(question, folder?.name, ctx)
      setMessages(prev => [...prev, { role: 'assistant', content: answer }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${err.message}` }])
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="empty-state"><div className="spinner" /></div>

  return (
    <div className="folder-view">
      <header className="folder-header">
        <div className="avatar">{folder?.name?.charAt(0).toUpperCase()}</div>
        <h2>{folder?.name}</h2>
        <button className="btn-secondary btn-sm" onClick={() => setPanelOpen(v => !v)}>
          {panelOpen ? 'Fechar' : `Sessões (${sessions.length})`}
        </button>
      </header>

      {panelOpen && (
        <div className="folder-panel">
          <h4>Adicionar à pasta</h4>
          <CapturePanel onResult={handleNewCapture} variant="compact" />
          {adding && <p className="text-muted text-sm" style={{ marginTop: 8 }}>Salvando sessão...</p>}

          <h4 style={{ marginTop: 20 }}>Sessões ({sessions.length})</h4>
          {sessions.length === 0 ? (
            <p className="text-muted text-sm">Nenhuma sessão ainda.</p>
          ) : (
            <div className="sessions-list">
              {sessions.map(s => (
                <div key={s.id} className="session-card">
                  <div className="session-card-header">
                    <div>
                      <h5 onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{s.title}</h5>
                      <span className="text-muted text-sm">
                        {new Date(s.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </span>
                    </div>
                    <button className="btn-icon danger" onClick={e => deleteSession(s.id, e)} aria-label="Excluir sessão"><IconTrash width={15} height={15} /></button>
                  </div>
                  {expanded === s.id && (
                    <div className="session-transcript">{s.transcript}</div>
                  )}
                  {expanded !== s.id && s.summary && (
                    <p className="session-preview text-muted text-sm">
                      {s.summary.replace(/[#*_]/g, '').slice(0, 140)}...
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="bubble"><MarkdownText text={msg.content} /></div>
          </div>
        ))}
        {sending && (
          <div className="message assistant"><div className="bubble thinking">Pensando...</div></div>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`Pergunte sobre ${folder?.name || 'esta pasta'}...`}
          disabled={sending}
        />
        <button type="submit" className="btn-icon" disabled={sending || !input.trim()} aria-label="Enviar">
          <IconSend width={18} height={18} />
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
