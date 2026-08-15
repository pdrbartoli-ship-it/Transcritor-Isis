import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, Outlet, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { consumeSharedContent, onSharedContent } from '../lib/sharedContent'
import NewFolderModal from './NewFolderModal'
import SettingsModal from './SettingsModal'
import FeedbackModal from './FeedbackModal'
import WelcomeModal from './WelcomeModal'
import { hasSeenWelcome, markWelcomeSeen } from '../lib/prefs'
import {
  IconSidebar, IconPlus, IconFolder, IconChevron, IconSettings, IconLogout, IconMic, IconMessage,
  IconMore, IconEdit, IconTrash, IconPin, IconArchive,
} from './Icons'

const PAGE = 5 // sessions shown per folder before "Mostrar mais"

export default function Layout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { folderId: activeFolderId } = useParams()

  const [folders, setFolders] = useState([])
  const [expanded, setExpanded] = useState(() => new Set())
  const [showAll, setShowAll] = useState(() => new Set())
  const [showNew, setShowNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Inline action menus for sources (sessions), conversations (chats) and folders.
  const [sessionMenu, setSessionMenu] = useState(null)   // session id with its action row open
  const [moveFor, setMoveFor] = useState(null)           // session id picking a destination folder
  const [renamingSession, setRenamingSession] = useState(null) // { id, value }
  const [chatMenu, setChatMenu] = useState(null)         // chat id with its action row open
  const [moveChatFor, setMoveChatFor] = useState(null)   // chat id picking a destination folder
  const [renamingChat, setRenamingChat] = useState(null) // { id, value }
  const [folderMenu, setFolderMenu] = useState(null)     // folder id with its action row open
  const [renamingFolder, setRenamingFolder] = useState(null)   // { id, value }
  const [showArchived, setShowArchived] = useState(false)

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('dito-sidebar-collapsed') === '1' } catch { return false }
  })

  const refreshFolders = useCallback(async () => {
    // A sidebar precisa das conversas (chats) e das fontes (sessions): antes só
    // trazia sessions, então uma conversa sem fonte nenhuma simplesmente não
    // aparecia no dropdown da pasta, mesmo estando salva.
    const FULL = 'id, name, description, created_at, pinned, sessions(id, title, created_at, archived), chats(id, title, updated_at)'
    const BASE = 'id, name, description, created_at, sessions(id, title, created_at), chats(id, title, updated_at)'
    // Try with the pin/archive columns; if the migration hasn't run yet, fall
    // back to the base columns so the sidebar still loads.
    let { data, error } = await supabase
      .from('clients').select(FULL).order('created_at', { ascending: false })
    if (error) {
      ({ data } = await supabase
        .from('clients').select(BASE).order('created_at', { ascending: false }))
    }
    setFolders(
      (data || [])
        .map(f => ({
          ...f,
          sessions: (f.sessions || []).sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          ),
          chats: (f.chats || []).sort(
            (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
          ),
        }))
        // Pinned folders float to the top, otherwise newest first.
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    )
  }, [])

  useEffect(() => { refreshFolders() }, [refreshFolders])

  // Boas-vindas no primeiro acesso da conta. Fica no Layout porque é a primeira
  // tela montada depois do login, seja em conta nova ou existente.
  useEffect(() => {
    if (user?.id && !hasSeenWelcome(user.id)) setShowWelcome(true)
  }, [user?.id])

  function dismissWelcome() {
    setShowWelcome(false)
    markWelcomeSeen(user?.id)
  }

  // Conteúdo compartilhado de outro app (áudio do WhatsApp, link do YouTube).
  // Fica aqui porque o Layout está sempre montado: o compartilhamento pode
  // chegar com o usuário em qualquer tela, e daqui levamos para a inicial, que
  // é onde o fluxo de captura e sugestão de pasta vive.
  useEffect(() => {
    let active = true
    const receive = shared => {
      if (active && shared) navigate('/', { state: { shared } })
    }
    consumeSharedContent().then(receive)
    const unsubscribe = onSharedContent(receive)
    return () => { active = false; unsubscribe() }
  }, [navigate])
  useEffect(() => { setDrawerOpen(false); closeAllMenus() }, [location.pathname])
  // Auto-expand the folder you're currently viewing.
  useEffect(() => {
    if (activeFolderId) setExpanded(prev => new Set(prev).add(activeFolderId))
  }, [activeFolderId])

  function closeAllMenus() {
    setSessionMenu(null); setMoveFor(null); setRenamingSession(null)
    setChatMenu(null); setMoveChatFor(null); setRenamingChat(null)
    setFolderMenu(null); setRenamingFolder(null)
  }

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('dito-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

  function toggleExpand(id, e) {
    e?.stopPropagation()
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openFolder(id) {
    setExpanded(prev => new Set(prev).add(id))
    navigate(`/folders/${id}`)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  // ── Chat (session) actions ───────────────────────────────
  async function saveSessionRename() {
    const { id, value } = renamingSession
    const title = value.trim()
    setRenamingSession(null)
    if (!title) return
    await supabase.from('sessions').update({ title }).eq('id', id)
    await refreshFolders()
  }

  async function archiveSession(id, archived) {
    closeAllMenus()
    await supabase.from('sessions').update({ archived }).eq('id', id)
    await refreshFolders()
  }

  async function deleteSession(id) {
    closeAllMenus()
    if (!confirm('Excluir este chat? Esta ação não pode ser desfeita.')) return
    await supabase.from('sessions').delete().eq('id', id)
    await refreshFolders()
  }

  async function moveSession(id, clientId) {
    closeAllMenus()
    await supabase.from('sessions').update({ client_id: clientId }).eq('id', id)
    setExpanded(prev => new Set(prev).add(clientId))
    await refreshFolders()
  }

  // ── Conversation (chat) actions ──────────────────────────
  async function saveChatRename() {
    const { id, value } = renamingChat
    const title = value.trim()
    setRenamingChat(null)
    if (!title) return
    await supabase.from('chats').update({ title }).eq('id', id)
    await refreshFolders()
  }

  async function deleteChat(id) {
    closeAllMenus()
    if (!confirm('Excluir esta conversa? Esta ação não pode ser desfeita.')) return
    await supabase.from('chats').delete().eq('id', id)
    await refreshFolders()
  }

  async function moveChat(id, clientId) {
    closeAllMenus()
    await supabase.from('chats').update({ client_id: clientId }).eq('id', id)
    setExpanded(prev => new Set(prev).add(clientId))
    await refreshFolders()
  }

  // ── Folder actions ───────────────────────────────────────
  async function togglePin(folder) {
    closeAllMenus()
    await supabase.from('clients').update({ pinned: !folder.pinned }).eq('id', folder.id)
    await refreshFolders()
  }

  async function saveFolderRename() {
    const { id, value } = renamingFolder
    const name = value.trim()
    setRenamingFolder(null)
    if (!name) return
    await supabase.from('clients').update({ name }).eq('id', id)
    await refreshFolders()
  }

  async function deleteFolder(folder) {
    closeAllMenus()
    if (!confirm(`Excluir a pasta "${folder.name}" e todos os seus chats? Esta ação não pode ser desfeita.`)) return
    await supabase.from('clients').delete().eq('id', folder.id)
    await refreshFolders()
    if (activeFolderId === folder.id) navigate('/')
  }

  const archivedSessions = folders.flatMap(f =>
    f.sessions.filter(s => s.archived).map(s => ({ ...s, folderId: f.id, folderName: f.name }))
  )

  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}
      {collapsed && (
        <button className="desktop-reopen" onClick={toggleCollapsed} aria-label="Abrir barra lateral">
          <IconSidebar />
        </button>
      )}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <span className="brand" onClick={() => navigate('/')}>Dito<span className="dot">.</span></span>
          <button className="sidebar-toggle" onClick={toggleCollapsed} aria-label="Recolher barra lateral">
            <IconSidebar />
          </button>
        </div>

        <button className="sidebar-cta" onClick={() => navigate('/')}>
          <IconMic width={16} height={16} /> Nova gravação
        </button>

        <nav className="sidebar-nav">
          <button className="nav-item" onClick={() => setShowNew(true)}>
            <IconPlus /> Nova pasta
          </button>
        </nav>

        <div className="sidebar-section-label">Pastas</div>
        <div className="sidebar-folders">
          {folders.length === 0 ? (
            <p className="sidebar-empty">Nenhuma pasta ainda.</p>
          ) : (
            folders.map(f => {
              const isOpen = expanded.has(f.id)
              const visible = f.sessions.filter(s => !s.archived)
              const sessions = showAll.has(f.id) ? visible : visible.slice(0, PAGE)
              const allChats = f.chats || []
              const chats = showAll.has(f.id) ? allChats : allChats.slice(0, PAGE)
              return (
                <div className="folder-block" key={f.id}>
                  {renamingFolder?.id === f.id ? (
                    <input
                      className="inline-rename"
                      value={renamingFolder.value}
                      onChange={e => setRenamingFolder(r => ({ ...r, value: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveFolderRename(); if (e.key === 'Escape') setRenamingFolder(null) }}
                      onBlur={saveFolderRename}
                      autoFocus
                    />
                  ) : (
                    <div
                      className={`folder-row ${activeFolderId === f.id ? 'active' : ''}`}
                      onClick={() => openFolder(f.id)}
                    >
                      <IconChevron
                        className={`folder-caret ${isOpen ? 'open' : ''}`}
                        width={14} height={14}
                        onClick={e => toggleExpand(f.id, e)}
                      />
                      {f.pinned ? <IconPin width={15} height={15} className="folder-pinned" /> : <IconFolder width={16} height={16} />}
                      <span className="folder-name">{f.name}</span>
                      <button
                        className="row-more"
                        aria-label="Opções da pasta"
                        onClick={e => { e.stopPropagation(); setFolderMenu(folderMenu === f.id ? null : f.id) }}
                      >
                        <IconMore width={16} height={16} />
                      </button>
                    </div>
                  )}

                  {folderMenu === f.id && (
                    <div className="row-actions">
                      <button onClick={() => togglePin(f)}>
                        <IconPin width={14} height={14} /> {f.pinned ? 'Desafixar' : 'Fixar pasta'}
                      </button>
                      <button onClick={() => { setRenamingFolder({ id: f.id, value: f.name }); setFolderMenu(null) }}>
                        <IconEdit width={14} height={14} /> Renomear
                      </button>
                      <button className="danger" onClick={() => deleteFolder(f)}>
                        <IconTrash width={14} height={14} /> Excluir pasta
                      </button>
                    </div>
                  )}

                  {isOpen && (
                    <div className="folder-children">
                      {allChats.length === 0 && visible.length === 0 ? (
                        <span className="children-empty">Vazia</span>
                      ) : (
                        <>
                          {/* Conversas primeiro: é o que o usuário abre no dia a dia. */}
                          {chats.map(c => (
                            renamingChat?.id === c.id ? (
                              <input
                                key={c.id}
                                className="inline-rename session-rename"
                                value={renamingChat.value}
                                onChange={e => setRenamingChat(r => ({ ...r, value: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') saveChatRename(); if (e.key === 'Escape') setRenamingChat(null) }}
                                onBlur={saveChatRename}
                                autoFocus
                              />
                            ) : (
                              <div className="session-row" key={c.id}>
                                <button
                                  className="session-item"
                                  onClick={() => navigate(`/folders/${f.id}`, { state: { openChat: c } })}
                                >
                                  <IconMessage width={13} height={13} className="row-kind-icon" />
                                  <span className="folder-name">{c.title}</span>
                                </button>
                                <button
                                  className="row-more"
                                  aria-label="Opções da conversa"
                                  onClick={e => { e.stopPropagation(); setMoveChatFor(null); setChatMenu(chatMenu === c.id ? null : c.id) }}
                                >
                                  <IconMore width={16} height={16} />
                                </button>
                                {chatMenu === c.id && (
                                  <div className="row-actions">
                                    <button onClick={() => { setRenamingChat({ id: c.id, value: c.title }); setChatMenu(null) }}>
                                      <IconEdit width={14} height={14} /> Renomear
                                    </button>
                                    <button onClick={() => setMoveChatFor(moveChatFor === c.id ? null : c.id)}>
                                      <IconFolder width={14} height={14} /> Mover para pasta
                                    </button>
                                    {moveChatFor === c.id && (
                                      <div className="move-list">
                                        {folders.filter(o => o.id !== f.id).length === 0 ? (
                                          <span className="move-empty">Nenhuma outra pasta</span>
                                        ) : (
                                          folders.filter(o => o.id !== f.id).map(o => (
                                            <button key={o.id} className="move-target" onClick={() => moveChat(c.id, o.id)}>
                                              <IconFolder width={13} height={13} /> {o.name}
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    )}
                                    <button className="danger" onClick={() => deleteChat(c.id)}>
                                      <IconTrash width={14} height={14} /> Excluir
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          ))}

                          {/* Fontes agrupadas à parte: são o material, não a conversa. */}
                          {visible.length > 0 && <div className="children-label">Fontes</div>}
                          {sessions.map(s => (
                            renamingSession?.id === s.id ? (
                              <input
                                key={s.id}
                                className="inline-rename session-rename"
                                value={renamingSession.value}
                                onChange={e => setRenamingSession(r => ({ ...r, value: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') saveSessionRename(); if (e.key === 'Escape') setRenamingSession(null) }}
                                onBlur={saveSessionRename}
                                autoFocus
                              />
                            ) : (
                              <div className="session-row" key={s.id}>
                                <button
                                  className="session-item"
                                  onClick={() => navigate(`/folders/${f.id}`, { state: { openSession: s.id } })}
                                >
                                  <span className="dot-mark" />
                                  <span className="folder-name">{s.title}</span>
                                </button>
                                <button
                                  className="row-more"
                                  aria-label="Opções da fonte"
                                  onClick={e => { e.stopPropagation(); setMoveFor(null); setSessionMenu(sessionMenu === s.id ? null : s.id) }}
                                >
                                  <IconMore width={16} height={16} />
                                </button>
                                {sessionMenu === s.id && (
                                  <div className="row-actions">
                                    <button onClick={() => { setRenamingSession({ id: s.id, value: s.title }); setSessionMenu(null) }}>
                                      <IconEdit width={14} height={14} /> Renomear
                                    </button>
                                    <button onClick={() => setMoveFor(moveFor === s.id ? null : s.id)}>
                                      <IconFolder width={14} height={14} /> Mover para pasta
                                    </button>
                                    {moveFor === s.id && (
                                      <div className="move-list">
                                        {folders.filter(o => o.id !== f.id).length === 0 ? (
                                          <span className="move-empty">Nenhuma outra pasta</span>
                                        ) : (
                                          folders.filter(o => o.id !== f.id).map(o => (
                                            <button key={o.id} className="move-target" onClick={() => moveSession(s.id, o.id)}>
                                              <IconFolder width={13} height={13} /> {o.name}
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    )}
                                    <button onClick={() => archiveSession(s.id, true)}>
                                      <IconArchive width={14} height={14} /> Arquivar
                                    </button>
                                    <button className="danger" onClick={() => deleteSession(s.id)}>
                                      <IconTrash width={14} height={14} /> Excluir
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          ))}
                          {(visible.length > PAGE || allChats.length > PAGE) && (
                            <button
                              className="show-more"
                              onClick={() => setShowAll(prev => {
                                const n = new Set(prev)
                                n.has(f.id) ? n.delete(f.id) : n.add(f.id)
                                return n
                              })}
                            >
                              {showAll.has(f.id)
                                ? 'Mostrar menos'
                                : `Mostrar mais (${Math.max(0, visible.length - PAGE) + Math.max(0, allChats.length - PAGE)})`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {archivedSessions.length > 0 && (
            <div className="archived-section">
              <button className="archived-toggle" onClick={() => setShowArchived(v => !v)}>
                <IconArchive width={14} height={14} /> Arquivados ({archivedSessions.length})
              </button>
              {showArchived && archivedSessions.map(s => (
                <div className="session-row archived" key={s.id}>
                  <button
                    className="session-item"
                    onClick={() => navigate(`/folders/${s.folderId}`, { state: { openSession: s.id } })}
                    title={`${s.title} · ${s.folderName}`}
                  >
                    <span className="dot-mark" />
                    <span className="folder-name">{s.title}</span>
                  </button>
                  <button className="row-more" aria-label="Desarquivar" title="Desarquivar" onClick={() => archiveSession(s.id, false)}>
                    <IconArchive width={15} height={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setShowSettings(true)}>
            <IconSettings /> Configurações
          </button>
          <button className="nav-item nav-feedback" onClick={() => setShowFeedback(true)}>
            <IconMessage /> Fale com a gente
          </button>
          <div className="foot-user">
            <span className="foot-avatar">{user?.email?.charAt(0).toUpperCase()}</span>
            <span className="email">{user?.email}</span>
            <button className="btn-icon" onClick={handleLogout} title="Sair" aria-label="Sair"><IconLogout width={16} height={16} /></button>
          </div>
        </div>
      </aside>

      <div className="content-wrap">
        <div className="topbar-mobile">
          <button className="hamburger" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu">☰</button>
          <span className="brand" onClick={() => navigate('/')}>Dito<span className="dot">.</span></span>
        </div>
        <div className="content">
          <Outlet context={{ folders, refreshFolders }} />
        </div>
      </div>

      {showNew && (
        <NewFolderModal
          onClose={() => setShowNew(false)}
          onCreated={async folder => {
            setShowNew(false)
            await refreshFolders()
            navigate(`/folders/${folder.id}`)
          }}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showWelcome && (
        <WelcomeModal
          onClose={dismissWelcome}
          onOpenFeedback={() => { dismissWelcome(); setShowFeedback(true) }}
        />
      )}
    </div>
  )
}
