import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, NavLink, Outlet, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import NewFolderModal from './NewFolderModal'
import SettingsModal from './SettingsModal'
import FeedbackModal from './FeedbackModal'
import {
  IconSidebar, IconPlus, IconHome, IconFolder, IconChevron, IconSettings, IconLogout, IconMic, IconMessage,
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
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Inline action menus for chats (sessions) and folders.
  const [sessionMenu, setSessionMenu] = useState(null)   // session id with its action row open
  const [moveFor, setMoveFor] = useState(null)           // session id picking a destination folder
  const [renamingSession, setRenamingSession] = useState(null) // { id, value }
  const [folderMenu, setFolderMenu] = useState(null)     // folder id with its action row open
  const [renamingFolder, setRenamingFolder] = useState(null)   // { id, value }
  const [showArchived, setShowArchived] = useState(false)

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('dito-sidebar-collapsed') === '1' } catch { return false }
  })

  const refreshFolders = useCallback(async () => {
    // Try with the pin/archive columns; if the migration hasn't run yet, fall
    // back to the base columns so the sidebar still loads.
    let { data, error } = await supabase
      .from('clients')
      .select('id, name, description, created_at, pinned, sessions(id, title, created_at, archived)')
      .order('created_at', { ascending: false })
    if (error) {
      ({ data } = await supabase
        .from('clients')
        .select('id, name, description, created_at, sessions(id, title, created_at)')
        .order('created_at', { ascending: false }))
    }
    setFolders(
      (data || [])
        .map(f => ({
          ...f,
          sessions: (f.sessions || []).sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          ),
        }))
        // Pinned folders float to the top, otherwise newest first.
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    )
  }, [])

  useEffect(() => { refreshFolders() }, [refreshFolders])
  useEffect(() => { setDrawerOpen(false); closeAllMenus() }, [location.pathname])
  // Auto-expand the folder you're currently viewing.
  useEffect(() => {
    if (activeFolderId) setExpanded(prev => new Set(prev).add(activeFolderId))
  }, [activeFolderId])

  function closeAllMenus() {
    setSessionMenu(null); setMoveFor(null); setRenamingSession(null)
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

        <button className="sidebar-cta" onClick={() => navigate('/', { state: { autoRecord: Date.now() } })}>
          <IconMic width={16} height={16} /> Nova gravação
        </button>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <IconHome /> Início
          </NavLink>
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
                      {visible.length === 0 ? (
                        <span className="session-item" style={{ opacity: 0.6 }}>Sem chats</span>
                      ) : (
                        <>
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
                                  aria-label="Opções do chat"
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
                          {visible.length > PAGE && (
                            <button
                              className="show-more"
                              onClick={() => setShowAll(prev => {
                                const n = new Set(prev)
                                n.has(f.id) ? n.delete(f.id) : n.add(f.id)
                                return n
                              })}
                            >
                              {showAll.has(f.id) ? 'Mostrar menos' : `Mostrar mais (${visible.length - PAGE})`}
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
          <button className="nav-item" onClick={() => setShowNew(true)}>
            <IconPlus /> Nova pasta
          </button>
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
    </div>
  )
}
