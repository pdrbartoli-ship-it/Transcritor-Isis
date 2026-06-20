import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, NavLink, Outlet, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import NewFolderModal from './NewFolderModal'
import SettingsModal from './SettingsModal'
import FeedbackModal from './FeedbackModal'
import Toast from './Toast'
import {
  IconSidebar, IconPlus, IconHome, IconFolder, IconChevron, IconSettings, IconLogout, IconMic, IconMessage,
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
  const [toast, setToast] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('dito-sidebar-collapsed') === '1' } catch { return false }
  })

  const refreshFolders = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, name, description, created_at, sessions(id, title, created_at)')
      .order('created_at', { ascending: false })
    setFolders(
      (data || []).map(f => ({
        ...f,
        sessions: (f.sessions || []).sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        ),
      }))
    )
  }, [])

  useEffect(() => { refreshFolders() }, [refreshFolders])
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])
  // Auto-expand the folder you're currently viewing.
  useEffect(() => {
    if (activeFolderId) setExpanded(prev => new Set(prev).add(activeFolderId))
  }, [activeFolderId])

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
              const sessions = showAll.has(f.id) ? f.sessions : f.sessions.slice(0, PAGE)
              return (
                <div className="folder-block" key={f.id}>
                  <div
                    className={`folder-row ${activeFolderId === f.id ? 'active' : ''}`}
                    onClick={() => openFolder(f.id)}
                  >
                    <IconChevron
                      className={`folder-caret ${isOpen ? 'open' : ''}`}
                      width={14} height={14}
                      onClick={e => toggleExpand(f.id, e)}
                    />
                    <IconFolder width={16} height={16} />
                    <span className="folder-name">{f.name}</span>
                  </div>

                  {isOpen && (
                    <div className="folder-children">
                      {f.sessions.length === 0 ? (
                        <span className="session-item" style={{ opacity: 0.6 }}>Sem sessões</span>
                      ) : (
                        <>
                          {sessions.map(s => (
                            <button
                              key={s.id}
                              className="session-item"
                              onClick={() => navigate(`/folders/${f.id}`, { state: { openSession: s.id } })}
                            >
                              <span className="dot-mark" />
                              <span className="folder-name">{s.title}</span>
                            </button>
                          ))}
                          {f.sessions.length > PAGE && (
                            <button
                              className="show-more"
                              onClick={() => setShowAll(prev => {
                                const n = new Set(prev)
                                n.has(f.id) ? n.delete(f.id) : n.add(f.id)
                                return n
                              })}
                            >
                              {showAll.has(f.id) ? 'Mostrar menos' : `Mostrar mais (${f.sessions.length - PAGE})`}
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
        </div>

        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setShowNew(true)}>
            <IconPlus /> Nova pasta
          </button>
          <button className="nav-item" onClick={() => setShowFeedback(true)}>
            <IconMessage /> Enviar sugestão
          </button>
          <button className="nav-item" onClick={() => setShowSettings(true)}>
            <IconSettings /> Configurações
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
      {showFeedback && (
        <FeedbackModal
          onClose={() => setShowFeedback(false)}
          onSent={() => {
            setShowFeedback(false)
            setToast('Enviado, obrigado! 🙏')
          }}
        />
      )}

      <button
        className="feedback-fab"
        onClick={() => setShowFeedback(true)}
        aria-label="Enviar feedback"
        title="Como está sua experiência?"
      >
        <IconMessage />
      </button>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
