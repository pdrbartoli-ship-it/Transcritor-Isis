import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Auth from './pages/Auth'
import ConfirmEmail from './pages/ConfirmEmail'
import Layout from './components/Layout'
import useDeepLinks from './lib/useDeepLinks'
import Home from './pages/Home'
import FolderView from './pages/FolderView'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  return user ? children : <Navigate to="/auth" replace />
}

function PublicRoute({ children }) {
  const { user, loading, holdRedirect } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  // holdRedirect: a tela de cadastro está exibindo a confirmação de conta criada.
  return user && !holdRedirect ? <Navigate to="/" replace /> : children
}

// Precisa ficar dentro do HashRouter para poder navegar; por isso é um
// componente próprio em vez de um hook chamado no App.
function DeepLinks() {
  useDeepLinks()
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <DeepLinks />
        <Routes>
          <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
          {/* Fora do PublicRoute: quem chega aqui ainda não tem sessão, e
              depois de confirmar precisa continuar nesta tela até o redirect. */}
          <Route path="/confirm" element={<ConfirmEmail />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Home />} />
            <Route path="/folders/:folderId" element={<FolderView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
