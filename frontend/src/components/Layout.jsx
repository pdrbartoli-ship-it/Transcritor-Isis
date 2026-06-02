import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function Layout({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <span>✍</span>
          <strong>Escreve</strong>
        </div>
        <div className="header-user">
          <span className="text-muted text-sm">{user?.email}</span>
          <button className="btn-ghost btn-sm" onClick={handleLogout}>Sair</button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
