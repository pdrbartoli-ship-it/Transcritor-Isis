import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Auth from './pages/Auth'
import ConfirmEmail from './pages/ConfirmEmail'
import Landing from './pages/Landing'
import Layout from './components/Layout'
import useDeepLinks from './lib/useDeepLinks'
import Home from './pages/Home'
import ConversaLayout from './pages/conversa/ConversaLayout'
import Conversa from './pages/conversa/Conversa'
import Topico from './pages/conversa/Topico'
import Todos from './pages/conversa/Todos'
import Timeline from './pages/conversa/Timeline'
import Chat from './pages/conversa/Chat'
import Mini from './pages/Mini'
import { isStandalonePwa, isTauriApp } from './lib/platform'

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
  // Dentro do app instalado (PWA ou nativo Windows) não existe "instalar de
  // novo" — vai direto pro login.
  if (isStandalonePwa() || isTauriApp()) return <Navigate to="/auth" replace />
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
  // A janelinha flutuante do app nativo sai antes de tudo: ela não tem rota,
  // barra lateral nem sessão, e só mostra a gravação que a janela principal
  // está fazendo. Montar o AuthProvider aqui colocaria uma SEGUNDA instância do
  // supabase-js na mesma origem, disputando a renovação do mesmo token com a
  // janela principal — risco gratuito numa janela que não lê nada do banco.
  if (window.location.hash.startsWith('#/mini')) return <Mini />

  return (
    <AuthProvider>
      <HashRouter>
        <DeepLinks />
        <Routes>
          <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
          {/* Fora do PublicRoute: quem chega aqui ainda não tem sessão, e
              depois de confirmar precisa continuar nesta tela até o redirect. */}
          <Route path="/confirm" element={<ConfirmEmail />} />
          {/* Uma rota por origem de captura: a home é a de gravar, e as outras
              duas são a mesma página com o painel trocado — a lista de
              retomada é idêntica nas três. */}
          <Route path="/" element={<RootRoute />}>
            <Route index element={<Home mode="record" />} />
            <Route path="audio" element={<Home mode="file" />} />
            <Route path="video" element={<Home mode="url" />} />
          </Route>
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            {/* Rota própria por conversa: dá deep-link e faz o voltar do
                navegador funcionar, o que o modelo antigo (tudo em state
                dentro de uma pasta) não permitia. */}
            {/* As quatro telas compartilham o dado carregado pelo
                ConversaLayout, e cada uma tem endereço próprio. */}
            <Route path="/conversa/:id" element={<ConversaLayout />}>
              <Route index element={<Conversa />} />
              <Route path="topico/:i" element={<Topico />} />
              <Route path="todos" element={<Todos />} />
              <Route path="timeline" element={<Timeline />} />
              <Route path="chat" element={<Chat />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
