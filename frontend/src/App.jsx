import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Auth from './pages/Auth'
import ConfirmEmail from './pages/ConfirmEmail'
import Landing from './pages/Landing'
import Layout from './components/Layout'
import useDeepLinks from './lib/useDeepLinks'
import Home from './pages/Home'
import FolderView from './pages/FolderView'
import { isStandalonePwa } from './lib/platform'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  return user ? children : <Navigate to="/auth" replace />
}

// Quem não está logado vê a landing (caixa de instalar/entrar) na raiz, em vez
// de ser jogado direto para o formulário de login.
function RootRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (user) return <Layout />
  // Dentro do app instalado não existe "instalar de novo" — vai direto pro login.
  if (isStandalonePwa()) return <Navigate to="/auth" replace />
  return <Landing />
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
          <Route path="/" element={<RootRoute />}>
            <Route index element={<Home />} />
          </Route>
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/folders/:folderId" element={<FolderView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
