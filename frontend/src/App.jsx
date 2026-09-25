import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
import Perguntar from './pages/Perguntar'
import Transcrevendo from './pages/Transcrevendo'
import Mini from './pages/Mini'
import Aviso from './pages/Aviso'
import AssinaturaSucesso from './pages/AssinaturaSucesso'
import AssinaturaCancelada from './pages/AssinaturaCancelada'
import { GravacaoProvider } from './contexts/GravacaoContext'
import { TranscricoesProvider } from './contexts/TranscricoesContext'
import { ReuniaoProvider } from './contexts/ReuniaoContext'
import { isStandalonePwa, isTauriApp, isNative } from './lib/platform'
import { useReguaDePlanos } from './lib/planos'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  return user ? children : <Navigate to="/auth" replace />
}

// A casca do app logado. É UMA só para a home, as abas de captura, o
// Perguntar e as conversas: antes a home tinha o seu <Layout> e as conversas
// outro, e ir de uma para a outra remontava a casca inteira. A lateral voltava
// a "Carregando…", buscava e decifrava a lista de novo e perdia a rolagem: era
// a tela piscando a cada conversa aberta.
//
// Quem não está logado vê a landing (caixa de instalar/entrar) na raiz, em vez
// de ser jogado direto para o formulário de login.
//
// A landing e o app moram no mesmo endereço, então entrar como convidado não
// deixava rastro no histórico e o voltar do navegador saía do Dito. A landing
// que o convidado deixou para trás fica numa entrada própria, marcada com
// `vitrine` (ver Landing.usarSemConta): é ela que o voltar encontra. Sem a
// marca, o convidado cai no app, como quem tem conta.
const ROTAS_DA_VITRINE = ['/', '/audio', '/video']

function AppShell() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (user && !(user.is_anonymous && location.state?.vitrine)) return <Layout />
  // Conversa e Perguntar pedem conta: sem sessão, vão ao login.
  if (!ROTAS_DA_VITRINE.includes(location.pathname)) return <Navigate to="/auth" replace />
  // Dentro do app instalado (PWA, nativo Windows ou o app das lojas) não
  // existe "instalar de novo" — vai direto pro login. No iPhone isso é também
  // exigência de loja: a landing traz a tabela de preços, e preço de
  // assinatura que não passa pela Apple não pode aparecer dentro do app.
  if (isStandalonePwa() || isTauriApp() || isNative()) return <Navigate to="/auth" replace />
  return <Landing />
}

function PublicRoute({ children }) {
  const { user, loading, holdRedirect } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  // holdRedirect: a tela de cadastro está exibindo a confirmação de conta criada.
  // O convidado passa: é pelo "Entrar" da barra lateral que ele chega aqui, e
  // mandá-lo de volta para o app faria o botão não fazer nada.
  return user && !user.is_anonymous && !holdRedirect ? <Navigate to="/" replace /> : children
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
  // A janelinha de aviso ("uma reunião começou, quer gravar?") sai daqui pelo
  // mesmo motivo: ela não tem rota, sessão nem banco — só desenha o que a
  // janela principal manda e devolve o clique.
  if (window.location.hash.startsWith('#/aviso')) return <Aviso />

  return <AppPrincipal />
}

// Separado do App só para o hook não ficar depois do return da janelinha —
// hook em caminho condicional é erro de React.
function AppPrincipal() {
  useReguaDePlanos()

  return (
    <AuthProvider>
      <HashRouter>
        <DeepLinks />
        {/* A gravação, o detector de reunião e as transcrições em andamento
            ficam acima das rotas de propósito: a casca do app desmonta ao ir
            para o login ou para a volta do pagamento, e nenhum dos três pode
            depender da tela aberta. Uma gravação de uma hora, ou uma
            transcrição de dez minutos, não pode morrer numa navegação. */}
        <GravacaoProvider>
        <TranscricoesProvider>
        <ReuniaoProvider>
        <Routes>
          <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
          {/* Fora do PublicRoute: quem chega aqui ainda não tem sessão, e
              depois de confirmar precisa continuar nesta tela até o redirect. */}
          <Route path="/confirm" element={<ConfirmEmail />} />
          {/* Uma rota por origem de captura: a home é a de gravar, e as outras
              duas são a mesma página com o painel trocado. */}
          <Route path="/" element={<AppShell />}>
            <Route index element={<Home mode="record" />} />
            <Route path="audio" element={<Home mode="file" />} />
            <Route path="video" element={<Home mode="url" />} />
            {/* O chat geral: uma pergunta, todas as conversas. Fora do
                /conversa/:id de propósito — ele não fala de uma captura, fala
                do acervo inteiro. */}
            <Route path="perguntar" element={<Perguntar />} />
            {/* Uma transcrição ainda em andamento, aberta pela lateral: quem
                espera nela é levado à conversa quando ela fica pronta. */}
            <Route path="transcrevendo/:id" element={<Transcrevendo />} />
            {/* Rota própria por conversa: dá deep-link e faz o voltar do
                navegador funcionar. As telas compartilham o dado carregado
                pelo ConversaLayout, e cada uma tem endereço próprio. */}
            <Route path="conversa/:id" element={<ConversaLayout />}>
              <Route index element={<Conversa />} />
              <Route path="topico/:i" element={<Topico />} />
              <Route path="todos" element={<Todos />} />
              <Route path="timeline" element={<Timeline />} />
              <Route path="chat" element={<Chat />} />
            </Route>
          </Route>
          <Route path="/assinatura/sucesso" element={<ProtectedRoute><AssinaturaSucesso /></ProtectedRoute>} />
          <Route path="/assinatura/cancelada" element={<ProtectedRoute><AssinaturaCancelada /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ReuniaoProvider>
        </TranscricoesProvider>
        </GravacaoProvider>
      </HashRouter>
    </AuthProvider>
  )
}
