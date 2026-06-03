import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import NewFolderModal from './NewFolderModal'

function Brand({ onClick, style }) {
  return (
    <span className="brand" onClick={onClick} style={style}>
      Dito<span className="dot">.</span>
    </span>
  )
}

export default function Layout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [folders, setFolders] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light'
  )

  const refreshFolders = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('*, sessions(count)')
      .order('created_at', { ascending: false })
    setFolders(data || [])
  }, [])

  useEffect(() => { refreshFolders() }, [refreshFolders])
  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('dito-theme', next) } catch {}
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  return (
    <div className="app-shell">
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <Brand onClick={() => navigate('/')} />
          <button className="sidebar-new" onClick={() => setShowModal(true)}>+ Nova pasta</button>
        </div>

        <div className="sidebar-section-label">Pastas</div>
        <nav className="sidebar-folders">
          {folders.length === 0 ? (
            <p className="sidebar-empty">Nenhuma pasta ainda.</p>
          ) : (
            folders.map(f => (
              <NavLink
                key={f.id}
                to={`/folders/${f.id}`}
                className={({ isActive }) => `folder-link ${isActive ? 'active' : ''}`}
              >
                <span className="folder-ico">▤</span>
                <span className="folder-name">{f.name}</span>
                <span className="folder-count">{f.sessions?.[0]?.count ?? 0}</span>
              </NavLink>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'light' ? '🌙 Modo escuro' : '☀️ Modo claro'}
          </button>
          <div className="sidebar-user">
            <span className="email">{user?.email}</span>
            <button className="btn-ghost btn-sm" onClick={handleLogout}>Sair</button>
          </div>
        </div>
      </aside>

      <div className="content-wrap">
        <div className="topbar-mobile">
          <button className="hamburger" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu">☰</button>
          <Brand onClick={() => navigate('/')} />
        </div>
        <div className="content">
          <Outlet context={{ folders, refreshFolders }} />
        </div>
      </div>

      {showModal && (
        <NewFolderModal
          onClose={() => setShowModal(false)}
          onCreated={async folder => {
            setShowModal(false)
            await refreshFolders()
            navigate(`/folders/${folder.id}`)
          }}
        />
      )}
    </div>
  )
}
