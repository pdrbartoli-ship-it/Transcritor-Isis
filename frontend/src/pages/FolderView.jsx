import { useState, useEffect, useRef } from 'react'
import { useParams, useOutletContext, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { chatWithSessions } from '../lib/api'
import CapturePanel from '../components/CapturePanel'
import { IconSend, IconTrash, IconMore, IconEdit, IconFile, IconDownload, IconChevron, IconMessage } from '../components/Icons'

// Builds the "official" document for a session: title, date, summary and the
// full transcript. Offered as a downloadable .txt so everything is in one place.
function buildSessionDoc(session) {
  const date = new Date(session.created_at || Date.now()).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  return [
    session.title, date, '',
    '═══ RESUMO ═══', '',
    (session.summary || '—').replace(/[#*_]/g, ''), '',
    '═══ TRANSCRIÇÃO ═══', '',
    session.transcript || '—', '',
  ].join('\n')
}

function attachmentFor(session) {
  return { name: `${session.title}.txt`, content: buildSessionDoc(session) }
}

export default function FolderView() {
  const { folderId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { refreshFolders } = useOutletContext()

  const [folder, setFolder] = useState(null)
  const [sessions, setSessions] = useState([])     // "Fontes" (transcripts)
  const [chats, setChats] = useState([])           // saved conversations
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('conversas')      // 'conversas' | 'fontes'

  const [activeChat, setActiveChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const [adding, setAdding] = useState(false)
  const [expandedSource, setExpandedSource] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const endRef = useRef(null)

  useEffect(() => { fetchData() }, [folderId])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Arriving from a capture or the sidebar opens the "Fontes" tab on that source.
  useEffect(() => {
    if (loading) return
    const open = location.state?.openSession
    const ns = location.state?.newSession
    if (open) { setActiveChat(null); setTab('fontes'); setExpandedSource(open) }
    else if (ns) { setActiveChat(null); setTab('fontes') }
  }, [location.state, loading])

  const activeSources = sessions.filter(s => !s.archived)

  async function fetchData() {
    setLoading(true)
    const [{ data: folderData }, { data: sessionsData }, { data: chatsData }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', folderId).single(),
      supabase.from('sessions').select('*').eq('client_id', folderId).order('created_at', { ascending: false }),
      supabase.from('chats').select('*').eq('client_id', folderId).order('updated_at', { ascending: false }),
    ])
    setFolder(folderData)
    setSessions(sessionsData || [])
    setChats(chatsData || [])
    setActiveChat(null)
    setMessages([])
    setLoading(false)
  }

  async function refreshChats() {
    const { data } = await supabase.from('chats').select('*').eq('client_id', folderId).order('updated_at', { ascending: false })
    setChats(data || [])
  }

  function sessionContext() {
    return activeSources.map(s => ({
      title: s.title,
      date: new Date(s.created_at).toLocaleDateString('pt-BR'),
      transcript: s.transcript,
      summary: s.summary,
    }))
  }

  async function openChat(chat) {
    setActiveChat(chat)
    setMessages([])
    const { data } = await supabase
      .from('chat_messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true })
    setMessages((data || []).map(m => ({ role: m.role, content: m.content })))
  }

  async function deleteChat(chat, e) {
    e?.stopPropagation()
    if (!confirm('Excluir esta conversa?')) return
    await supabase.from('chats').delete().eq('id', chat.id)
    if (activeChat?.id === chat.id) { setActiveChat(null); setMessages([]) }
    refreshChats()
  }

  async function handleSend(e) {
    e.preventDefault()
    const question = input.trim()
    if (!question || sending) return
    setInput('')
    if (activeChat) await continueChat(question)
    else await startNewChat(question)
  }

  async function startNewChat(question) {
    setSending(true)
    setMessages([{ role: 'user', content: question }])
    const { data: chat, error } = await supabase.from('chats').insert({
      client_id: folderId, user_id: user.id, title: 'Nova conversa', preview: question.slice(0, 120),
    }).select().single()
    if (error || !chat) { setSending(false); setMessages([]); alert('Erro ao criar conversa.'); return }
    setActiveChat(chat)
    await supabase.from('chat_messages').insert({ chat_id: chat.id, user_id: user.id, role: 'user', content: question })
    try {
      const { answer, title } = await chatWithSessions(question, folder?.name, sessionContext(), { makeTitle: true })
      await supabase.from('chat_messages').insert({ chat_id: chat.id, user_id: user.id, role: 'assistant', content: answer })
      setMessages(prev => [...prev, { role: 'assistant', content: answer }])
      const finalTitle = (title || question).slice(0, 80)
      await supabase.from('chats').update({ title: finalTitle, updated_at: new Date().toISOString() }).eq('id', chat.id)
      setActiveChat(c => c ? { ...c, title: finalTitle } : c)
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${err.message}` }])
    } finally {
      setSending(false)
      refreshChats()
    }
  }

  async function continueChat(question) {
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setSending(true)
    await supabase.from('chat_messages').insert({ chat_id: activeChat.id, user_id: user.id, role: 'user', content: question })
    try {
      const { answer } = await chatWithSessions(question, folder?.name, sessionContext(), { history })
      await supabase.from('chat_messages').insert({ chat_id: activeChat.id, user_id: user.id, role: 'assistant', content: answer })
      setMessages(prev => [...prev, { role: 'assistant', content: answer }])
      await supabase.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', activeChat.id)
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${err.message}` }])
    } finally {
      setSending(false)
      refreshChats()
    }
  }

  async function handleNewCapture(result, sourceType, sourceName) {
    setAdding(true)
    const title = sourceName || `Sessão ${new Date().toLocaleDateString('pt-BR')}`
    const { data, error } = await supabase.from('sessions').insert({
      client_id: folderId, user_id: user.id, title, source_type: sourceType,
      transcript: result.transcript, summary: result.summary,
    }).select().single()
    setAdding(false)
    if (!error && data) {
      setSessions(prev => [data, ...prev])
      setExpandedSource(data.id)
      await refreshFolders()
    }
  }

  // ── Folder rename / delete ───────────────────────────────
  function startRename() { setRenameValue(folder?.name || ''); setRenaming(true); setMenuOpen(false) }
  async function saveRename() {
    const name = renameValue.trim()
    if (!name || name === folder.name) { setRenaming(false); return }
    const { error } = await supabase.from('clients').update({ name }).eq('id', folderId)
    if (!error) { setFolder(f => ({ ...f, name })); await refreshFolders() }
    setRenaming(false)
  }
  async function deleteFolder() {
    setMenuOpen(false)
    if (!confirm(`Excluir a pasta "${folder.name}" e todo o seu conteúdo? Esta ação não pode ser desfeita.`)) return
    await supabase.from('clients').delete().eq('id', folderId)
    await refreshFolders()
    navigate('/')
  }

  async function deleteSource(id, e) {
    e.stopPropagation()
    if (!confirm('Excluir esta fonte?')) return
    await supabase.from('sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    await refreshFolders()
  }

  if (loading) return <div className="empty-state"><div className="spinner" /></div>

  const showChatInput = tab === 'conversas'

  return (
    <div className="folder-view">
      <header className="folder-header">
        {activeChat ? (
          <button className="btn-icon" onClick={() => { setActiveChat(null); setMessages([]) }} aria-label="Voltar">
            <IconChevron width={18} height={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
        ) : (
          <div className="avatar">{folder?.name?.charAt(0).toUpperCase()}</div>
        )}
        {renaming ? (
          <input
            className="folder-rename-input"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false) }}
            onBlur={saveRename}
            autoFocus
          />
        ) : (
          <h2>{activeChat ? activeChat.title : folder?.name}</h2>
        )}
        {!activeChat && (
          <div className="folder-menu">
            <button className="btn-icon" onClick={() => setMenuOpen(v => !v)} aria-label="Opções da pasta"><IconMore /></button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenuOpen(false)} />
                <div className="folder-menu-pop">
                  <button onClick={startRename}><IconEdit width={15} height={15} /> Renomear</button>
                  <button className="danger" onClick={deleteFolder}><IconTrash width={15} height={15} /> Excluir pasta</button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {!activeChat && (
        <div className="folder-tabs">
          <button className={tab === 'conversas' ? 'active' : ''} onClick={() => setTab('conversas')}>
            Conversas {chats.length > 0 && <span className="tab-count">{chats.length}</span>}
          </button>
          <button className={tab === 'fontes' ? 'active' : ''} onClick={() => setTab('fontes')}>
            Fontes {activeSources.length > 0 && <span className="tab-count">{activeSources.length}</span>}
          </button>
        </div>
      )}

      {/* ── Active conversation thread ── */}
      {activeChat ? (
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="bubble"><MarkdownText text={msg.content} /></div>
            </div>
          ))}
          {sending && <div className="message assistant"><div className="bubble thinking">Pensando...</div></div>}
          <div ref={endRef} />
        </div>
      ) : tab === 'conversas' ? (
        /* ── Conversation list ── */
        <div className="chat-list">
          {sending && messages.length > 0 && (
            <div className="chat-list-item pending">
              <div className="chat-list-title">Nova conversa…</div>
              <div className="chat-list-preview">{messages[0]?.content}</div>
            </div>
          )}
          {chats.length === 0 && !sending ? (
            <div className="list-empty">
              <IconMessage width={26} height={26} />
              <p><strong>Nenhuma conversa ainda</strong></p>
              <p className="text-muted text-sm">Faça uma pergunta na barra abaixo para começar a conversar sobre esta pasta.</p>
            </div>
          ) : (
            chats.map(c => (
              <button key={c.id} className="chat-list-item" onClick={() => openChat(c)}>
                <div className="chat-list-main">
                  <div className="chat-list-title">{c.title}</div>
                  {c.preview && <div className="chat-list-preview">{c.preview}</div>}
                </div>
                <span className="chat-list-date">
                  {new Date(c.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                </span>
                <span className="chat-list-del" onClick={e => deleteChat(c, e)} role="button" aria-label="Excluir conversa">
                  <IconTrash width={15} height={15} />
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        /* ── Sources (Fontes) ── */
        <div className="sources-panel">
          <CapturePanel onResult={handleNewCapture} variant="compact" />
          {adding && <p className="text-muted text-sm" style={{ marginTop: 8 }}>Salvando fonte...</p>}

          <h4 style={{ marginTop: 22 }}>Fontes ({activeSources.length})</h4>
          {activeSources.length === 0 ? (
            <p className="text-muted text-sm">Nenhuma fonte ainda. Grave, envie um arquivo ou cole um link acima.</p>
          ) : (
            <div className="sessions-list">
              {activeSources.map(s => (
                <div key={s.id} className="session-card">
                  <div className="session-card-header">
                    <div>
                      <h5 onClick={() => setExpandedSource(expandedSource === s.id ? null : s.id)}>{s.title}</h5>
                      <span className="text-muted text-sm">
                        {new Date(s.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </span>
                    </div>
                    <button className="btn-icon danger" onClick={e => deleteSource(s.id, e)} aria-label="Excluir fonte"><IconTrash width={15} height={15} /></button>
                  </div>
                  {expandedSource === s.id ? (
                    <>
                      <FileAttachment attachment={attachmentFor(s)} />
                      <div className="session-transcript">{s.transcript}</div>
                    </>
                  ) : s.summary && (
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

      {(activeChat || showChatInput) && (
        <form className="chat-input" onSubmit={handleSend}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={activeChat ? 'Continuar a conversa...' : `Perguntar sobre ${folder?.name || 'esta pasta'}...`}
            disabled={sending}
          />
          <button type="submit" className="btn-icon" disabled={sending || !input.trim()} aria-label="Enviar">
            <IconSend width={18} height={18} />
          </button>
        </form>
      )}
    </div>
  )
}

// A compact file card that downloads the session document as a .txt on click.
function FileAttachment({ attachment }) {
  function download() {
    const blob = new Blob([attachment.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = attachment.name
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }
  return (
    <button className="file-chip" onClick={download} title="Baixar transcrição">
      <span className="file-chip-icon"><IconFile width={18} height={18} /></span>
      <span className="file-chip-info">
        <span className="file-chip-name">{attachment.name}</span>
        <span className="file-chip-meta">Documento · TXT</span>
      </span>
      <span className="file-chip-download"><IconDownload width={16} height={16} /></span>
    </button>
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
