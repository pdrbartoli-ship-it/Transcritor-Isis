import { useState, useEffect, useRef } from 'react'
import { useParams, useOutletContext, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { chatWithSessions, suggestFolder, folderBriefing } from '../lib/api'
import { getPrefs } from '../lib/prefs'
import { useIsTouchInput } from '../lib/platform'
import { track } from '../lib/analytics'
import CapturePanel from '../components/CapturePanel'
import { IconSend, IconTrash, IconMore, IconEdit, IconFile, IconDownload, IconChevron } from '../components/Icons'

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
  const [msgsLoading, setMsgsLoading] = useState(false)
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

  // Arriving from the sidebar opens the source in "Fontes"; arriving from a
  // capture drops the user straight into the chat that was just created.
  useEffect(() => {
    if (loading) return
    const open = location.state?.openSession
    const ns = location.state?.newSession
    const chat = location.state?.openChat
    if (open) { setActiveChat(null); setTab('fontes'); setExpandedSource(open) }
    else if (chat) { setTab('conversas'); setActiveChat(chat); setMessages([]) }
    else if (ns) { setActiveChat(null); setTab('conversas') }
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

  // A barra lateral também lista as conversas, então toda mudança em `chats`
  // precisa recarregar as duas — senão a conversa recém-criada só aparece no
  // dropdown depois de um reload.
  async function refreshChats() {
    const { data } = await supabase.from('chats').select('*').eq('client_id', folderId).order('updated_at', { ascending: false })
    setChats(data || [])
    await refreshFolders()
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
    setMsgsLoading(true)
    const { data } = await supabase
      .from('chat_messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true })
    setMessages((data || []).map(m => ({ role: m.role, content: m.content })))
    setMsgsLoading(false)
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
      const { answer, title, usage } = await chatWithSessions(question, folder?.name, sessionContext(), {
        makeTitle: true,
        folderDescription: folder?.description || null,
        preferences: getPrefs(),
      })
      track('chat', { primeira_mensagem: true, usage })
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
    // Transcrições inteiras podem virar mensagens (botões-gatilho do starter) e
    // o backend já injeta todas as fontes no system prompt — truncar o histórico
    // evita mandar o mesmo texto duas vezes.
    const history = messages.map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setSending(true)
    await supabase.from('chat_messages').insert({ chat_id: activeChat.id, user_id: user.id, role: 'user', content: question })
    try {
      const { answer, usage } = await chatWithSessions(question, folder?.name, sessionContext(), {
        history,
        folderDescription: folder?.description || null,
        preferences: getPrefs(),
      })
      track('chat', { primeira_mensagem: false, usage })
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
    let title = sourceName || `Sessão ${new Date().toLocaleDateString('pt-BR')}`
    try {
      // A pasta já está decidida aqui; aproveitamos só o assunto específico
      // para dar à fonte um nome baseado no conteúdo, não no arquivo.
      const s = await suggestFolder(result.transcript, folder ? [folder] : [])
      if (s?.suggested_chat_name) title = s.suggested_chat_name
    } catch {
      // Sem sugestão, o nome do arquivo/vídeo continua servindo.
    }
    const { data, error } = await supabase.from('sessions').insert({
      client_id: folderId, user_id: user.id, title, source_type: sourceType,
      transcript: result.transcript, summary: result.summary,
    }).select().single()
    setAdding(false)
    if (!error && data) {
      const next = [data, ...sessions]
      setSessions(next)
      setExpandedSource(data.id)
      await refreshFolders()
      refreshBriefing(next)
    }
  }

  // O briefing dá ao assistente a noção do conjunto (do que a pasta trata), em
  // vez de só transcrições soltas. É best-effort: falhar aqui não pode impedir
  // que a fonte recém-salva apareça.
  async function refreshBriefing(sourceList) {
    const excerpts = sourceList
      .filter(s => !s.archived && s.transcript)
      .slice(0, 6)
      .map(s => `${s.title}\n${s.transcript.slice(0, 1500)}`)
    if (excerpts.length === 0) return
    try {
      const { description } = await folderBriefing(folder?.name || 'Pasta', excerpts)
      if (!description) return
      await supabase.from('clients').update({ description }).eq('id', folderId)
      setFolder(f => (f ? { ...f, description } : f))
    } catch {
      // Sem briefing o chat segue funcionando com as transcrições.
    }
  }

  // Os botões-gatilho do starter apenas trazem para o chat a transcrição/resumo
  // que já foram gerados na captura — nenhuma chamada nova à IA.
  async function insertFromSource(kind) {
    const source = activeSources[0]
    const content = kind === 'transcript' ? source?.transcript : source?.summary
    if (!content || sending) return
    const question = kind === 'transcript' ? 'Gerar transcrição' : 'Gerar resumo'
    setSending(true)
    try {
      let chat = activeChat
      if (!chat) {
        const label = kind === 'transcript' ? 'Transcrição' : 'Resumo'
        const { data } = await supabase.from('chats').insert({
          client_id: folderId, user_id: user.id,
          title: `${label} — ${source.title}`.slice(0, 80),
        }).select().single()
        if (!data) { alert('Erro ao criar conversa.'); return }
        chat = data
        setActiveChat(chat)
      }
      await supabase.from('chat_messages').insert([
        { chat_id: chat.id, user_id: user.id, role: 'user', content: question },
        { chat_id: chat.id, user_id: user.id, role: 'assistant', content },
      ])
      setMessages(prev => [...prev, { role: 'user', content: question }, { role: 'assistant', content }])
      await supabase.from('chats').update({
        preview: content.replace(/[#*_]/g, '').slice(0, 120),
        updated_at: new Date().toISOString(),
      }).eq('id', chat.id)
    } finally {
      setSending(false)
      refreshChats()
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
  // Estado inicial estilo Claude: vale para um chat ainda sem mensagens e para
  // a aba Conversas quando a pasta ainda não tem nenhuma conversa.
  const showStarter = !sending && (
    activeChat ? (messages.length === 0 && !msgsLoading) : (tab === 'conversas' && chats.length === 0)
  )

  function renderChatInput() {
    return (
      <form className="chat-input" onSubmit={handleSend}>
        <ChatTextarea
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder={messages.length > 0 ? 'Continuar a conversa...' : `Perguntar sobre ${folder?.name || 'esta pasta'}...`}
          disabled={sending}
        />
        <button type="submit" className="btn-icon" disabled={sending || !input.trim()} aria-label="Enviar">
          <IconSend width={18} height={18} />
        </button>
      </form>
    )
  }

  function renderStarter() {
    return (
      <div className="chat-starter">
        <h2>O que deseja saber?</h2>
        {renderChatInput()}
        {activeSources.length > 0 && (
          <div className="starter-actions">
            <button className="starter-chip" onClick={() => insertFromSource('transcript')} disabled={sending}>
              <IconFile width={16} height={16} /> Gerar transcrição
            </button>
            <button className="starter-chip" onClick={() => insertFromSource('summary')} disabled={sending}>
              <IconEdit width={16} height={16} /> Gerar resumo
            </button>
          </div>
        )}
      </div>
    )
  }

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
      {showStarter ? (
        renderStarter()
      ) : activeChat ? (
        <div className="chat-messages">
          {messages.map((msg, i) => {
            // Quando a mensagem é uma transcrição trazida pelo botão-gatilho,
            // oferecemos o mesmo chip de download usado na aba Fontes.
            const attached = msg.role === 'assistant'
              ? activeSources.find(s => s.transcript && s.transcript === msg.content)
              : null
            return (
              <div key={i} className={`message ${msg.role}`}>
                <div className="bubble">
                  <MarkdownText text={msg.content} />
                  {attached && <FileAttachment attachment={attachmentFor(attached)} />}
                </div>
              </div>
            )
          })}
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
          {chats.map(c => (
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
          ))}
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

      {/* O starter já traz a própria barra de pergunta, centralizada. */}
      {!showStarter && (activeChat || showChatInput) && renderChatInput()}
    </div>
  )
}

// Campo de pergunta multilinha. Um <input> de linha única impede selecionar,
// navegar e editar textos longos — que é exatamente o que se faz numa pergunta
// de verdade. Cresce até MAX_ROWS e depois rola internamente.
const MAX_ROWS = 6

function ChatTextarea({ value, onChange, onSubmit, placeholder, disabled }) {
  const ref = useRef(null)
  const touchInput = useIsTouchInput()

  // Auto-grow: zera a altura antes de medir, senão o scrollHeight nunca encolhe.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
    const padding = el.offsetHeight - el.clientHeight
    const max = lineHeight * MAX_ROWS + padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value])

  function handleKeyDown(e) {
    if (e.key !== 'Enter') return
    // No celular o Enter é quebra de linha e o envio fica só no botão; com
    // teclado físico, Enter envia e Shift+Enter quebra a linha.
    if (touchInput || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    onSubmit(e)
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
    />
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
