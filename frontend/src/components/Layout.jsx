import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation, useNavigationType, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { esquecerDoAparelho } from '../lib/chaves'
import { esquecerChaveAberta } from '../lib/chaveTranscricao'
import { apagarTudo as apagarIndiceDoAcervo } from '../lib/acervo/indice'
import { useAuth, rastroAuth } from '../contexts/AuthContext'
import { useTranscricoes } from '../contexts/TranscricoesContext'
import { consumeSharedContent, onSharedContent } from '../lib/sharedContent'
import SettingsModal from './SettingsModal'
import FeedbackModal from './FeedbackModal'
import PlanModal from './PlanModal'
import ConviteModal from './ConviteModal'
import PremioAviso, { avisoDoConvite } from './PremioAviso'
import SemSaldo from './SemSaldo'
import ConversaMenu, { useConversaMenu } from './ConversaMenu'
import ContadorMinutos from './ContadorMinutos'
import { LinhasEmAndamento } from './EmAndamento'
import Toast from './Toast'
import { listConversations, searchConversations, formatCapturedAt, groupConversations, displayTitle } from '../lib/conversas'
import { lerSaldoAtual } from '../lib/api'
import { trackAppOpen, track } from '../lib/analytics'
import { aplicarTemaDoUsuario } from '../lib/prefs'
import { planoPorId } from '../lib/planos'
import { useReuniao } from '../contexts/ReuniaoContext'
import { aoPedirPlano } from '../lib/planoModal'
import { aoPedirConvite } from '../lib/conviteModal'
import { podeVender, usePlatform } from '../lib/platform'
import { useConvite, useSeloNovo } from '../lib/convite'
import { iniciarNotificacoes, esquecerAparelho } from '../lib/notificacoes'
import { pedirAcoesDaConversa } from '../lib/acoesDaConversa'
import {
  IconSidebar, IconSettings, IconLogout, IconMic, IconMegafone,
  IconSearch, IconClose, IconCard, IconArrowRight, IconWhatsapp, IconYoutube, IconPlus, IconPin, IconMenu,
  IconChat, IconGift, IconSelo, IconCaretDown,
} from './Icons'

// De onde veio a captura. São os mesmos três ícones das abas da home
// (Gravação, Áudio, Vídeo): quem escolheu a aba reconhece na lista o que
// aquela conversa era, em vez de aprender um segundo conjunto de símbolos.
// As conversas antigas foram todas gravadas como 'file' — daí o ícone de
// áudio ser o padrão, e não o microfone: ele seria mentira na metade delas.
const KIND_ICON = { url: IconYoutube, record: IconMic, file: IconWhatsapp }
function KindIcon({ sourceType }) {
  const Icon = KIND_ICON[sourceType] || IconWhatsapp
  return <Icon className="kind-icon" width={14} height={14} />
}

// Espera depois da última tecla antes de consultar o banco. Buscar a cada
// caractere dispara uma consulta por letra e faz respostas antigas chegarem
// depois das novas.
const SEARCH_DEBOUNCE_MS = 250

// Abaixo disto não vale interromper ninguém; acima, quem avisa é o próprio
// erro da captura.
const AVISO_A_PARTIR_DE = 0.8

// O aviso só faz sentido onde se captura — nas telas de leitura de conversa
// ele seria barulho.
const ROTAS_DE_CAPTURA = ['/', '/audio', '/video']

// A lateral do celular abre arrastando da borda esquerda, como no Claude.
// Borda: onde o dedo precisa começar. Distância: quanto ele precisa andar.
const BORDA_DO_GESTO_PX = 28
const DISTANCIA_DO_GESTO_PX = 56

// O nome da tela, no topo do celular. Na home fica vazio: o título grande da
// página já diz o que se faz ali.
function tituloDaTela(pathname, conversations) {
  const conversaId = pathname.match(/^\/conversa\/([^/]+)/)?.[1]
  if (conversaId) {
    const c = conversations.find(x => x.id === conversaId)
    return c ? displayTitle(c) : ''
  }
  if (pathname === '/perguntar') return 'Perguntar'
  if (pathname.startsWith('/transcrevendo/')) return 'Transcrevendo'
  return ''
}

// A gravação, o detector de reunião e as transcrições em andamento NÃO moram
// aqui: esta casca desmonta ao ir para o login ou para a volta do pagamento, e
// os três precisam sobreviver a isso. Ver App.jsx.
export default function Layout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const { isMobile } = usePlatform()
  // Quem entrou pelo "Usar o Dito" da landing, sem conta (signInAnonymously).
  const convidado = !!user?.is_anonymous
  const { itens: emAndamento, naoLidas, versaoLista, minutosEmAndamento } = useTranscricoes()

  // A vitrine (landing, entrar, confirmar) é sempre clara, e o tema é um
  // atributo do documento inteiro. É aqui, ao entrar no app, que a preferência
  // de quem escolheu o escuro volta a valer — deixar isso a cargo da vitrine,
  // ao desmontar, fazia a página piscar toda vez que ela remontava.
  useEffect(() => { aplicarTemaDoUsuario() }, [])

  // O roteador guarda a posição no histórico em history.state.idx — é o que
  // diz se existe para onde voltar sem sair do app.
  const canGoBack = (window.history.state?.idx ?? 0) > 0

  const [conversations, setConversations] = useState([])
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [listError, setListError] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [showConta, setShowConta] = useState(false)
  // No iPhone o app não vende (ver `podeVender`): sem "Meu plano", sem "Ver
  // planos" e sem o modal. `abrirPlano` vai nulo para as telas, e cada uma
  // delas já sabe não desenhar o convite quando ele não existe — assim nenhum
  // botão fica na tela sem fazer nada.
  const vendeAqui = podeVender()
  const [saldo, setSaldo] = useState(null)
  // Sobe quando o saldo muda por fora de uma captura: o bônus de um convite
  // chega com a pessoa parada na tela, e o relógio precisa mostrar o limite novo.
  const [saldoVersao, setSaldoVersao] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerOpenRef = useRef(false)
  drawerOpenRef.current = drawerOpen
  const [showConvite, setShowConvite] = useState(false)
  // O convite premiado: o link, os amigos e o prêmio que ainda não foi
  // mostrado. Quem entrou sem conta não tem convite (o hook devolve null).
  const { convite, atualizar: atualizarConvite, marcarVisto: marcarConviteVisto } = useConvite(user)
  const [seloNovo, dispensarSelo] = useSeloNovo(convite, user?.id)
  // Quem não tem conta não tem link de convite: ali o caminho continua sendo
  // criar a conta, e um botão "Convidar amigos" não teria o que abrir.
  const abrirConvite = convite ? () => setShowConvite(true) : null
  const avisoPremio = avisoDoConvite(convite, seloNovo)

  // No celular, o aviso do prêmio também chega como notificação. Quando ela
  // chega com o app aberto (ou é tocada), o convite é relido e o aviso do
  // próprio app aparece.
  useEffect(() => {
    if (user?.id && !convidado) iniciarNotificacoes(atualizarConvite)
  }, [user?.id, convidado, atualizarConvite])
  // O interruptor de "Avisar quando uma reunião começar". O estado mora no
  // provedor, com o detector; aqui só se desenha.
  const {
    disponivel: deteccaoDisponivel, avisar: avisarReuniao, definirAvisar,
    iniciarComWindows, definirIniciarComWindows,
  } = useReuniao()

  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null)   // null = não está buscando
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef(null)

  // Menu do botão direito das conversas (fixar / renomear / apagar).
  const { menu, gestos, fecharMenu } = useConversaMenu()

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('dito-sidebar-collapsed') === '1' } catch { return false }
  })

  const refreshConversations = useCallback(async () => {
    if (!user?.id) return
    try {
      setConversations(await listConversations(user.id))
      setListError(null)
    } catch (err) {
      // Uma falha aqui deixava a lista vazia sem explicação nenhuma — parecia
      // que as conversas do usuário tinham sumido.
      setListError(err.message)
    } finally {
      setLoadingConversations(false)
    }
  }, [user?.id])

  useEffect(() => { refreshConversations() }, [refreshConversations])

  // Uma transcrição virou conversa (aqui ou em outro aparelho desta conta).
  const primeiraVersao = useRef(versaoLista)
  useEffect(() => {
    if (versaoLista !== primeiraVersao.current) refreshConversations()
  }, [versaoLista, refreshConversations])

  useEffect(() => {
    if (!user?.id) return
    // Uma abertura por carregamento do app, contada só depois de haver usuário
    // — sem ele não há a quem atribuir.
    trackAppOpen()
  }, [user?.id])

  // O saldo do mês, relido a cada captura nova (a lista muda quando uma
  // termina), para o aviso não continuar dizendo "faltam 20 min" depois de a
  // pessoa ter gasto os últimos.
  useEffect(() => {
    if (!user?.id) return
    let ativo = true
    // O plano vai junto do saldo porque as telas de dentro precisam dele para
    // desenhar o que está liberado — o cadeado da transcrição completa. A
    // junção mora em lerSaldoAtual, que o teto da gravação e o convite de
    // reunião também usam.
    lerSaldoAtual(user.id)
      .then(atual => { if (ativo) setSaldo(atual) })
      .catch(() => { /* o aviso é um extra: sem saldo lido, não aparece */ })
    return () => { ativo = false }
  }, [user?.id, conversations.length, saldoVersao])

  // Prêmio em minutos chegou: relê o saldo para o relógio já mostrar o limite
  // com o bônus, junto do aviso.
  const minutosGanhos = convite?.novidade?.minutos || 0
  useEffect(() => {
    if (minutosGanhos > 0) setSaldoVersao(v => v + 1)
  }, [minutosGanhos])

  // O que as telas enxergam do saldo já desconta as transcrições que ainda
  // estão em andamento: sem isso a segunda captura passaria na conferência da
  // tela e só falharia no fim, por falta de saldo, com o áudio já enviado.
  const saldoEfetivo = saldo && saldo.limite != null && minutosEmAndamento > 0
    ? { ...saldo, usados: saldo.usados + minutosEmAndamento }
    : saldo

  function fecharAvisoPremio() {
    if (avisoPremio?.tipo === 'selo') dispensarSelo()
    // O selo costuma vir junto do quinto amigo: fechar o aviso dele dá os
    // dois por vistos. Já o prêmio em minutos, fechado, deixa o selo (se
    // houver) aparecer em seguida.
    if (convite?.novidade) marcarConviteVisto()
  }

  // Perguntas que ainda cabem no mês, para o chat de qualquer conversa. null =
  // plano sem limite, ou dado ainda não lido: nos dois casos a tela não mostra
  // contagem nenhuma. O bônus dos convites entra na conta.
  const perguntasDoPlano = saldo ? planoPorId(saldo.plano).perguntas : null
  const limitePerguntas = perguntasDoPlano == null ? null : perguntasDoPlano + (saldo.perguntasExtra || 0)
  const perguntasRestantes = limitePerguntas == null || saldo?.perguntasUsadas == null
    ? null
    : Math.max(0, limitePerguntas - saldo.perguntasUsadas)

  // O servidor é quem conta; a tela só acompanha o número que ele devolve a
  // cada resposta, em vez de somar por conta própria e divergir dele.
  const atualizarPerguntasRestantes = useCallback(restantes => {
    if (limitePerguntas == null || restantes == null) return
    setSaldo(s => (s ? { ...s, perguntasUsadas: limitePerguntas - restantes } : s))
  }, [limitePerguntas])

  // Quem escolheu um plano pago na landing antes de logar chega aqui direto
  // no "Meu plano", já pronto para clicar em Assinar — sem isso a escolha
  // feita na landing se perderia no meio do caminho até o checkout.
  useEffect(() => {
    if (!user?.id) return
    let escolhido = null
    // A leitura e a limpeza andam juntas: o "Começar grátis" da landing também
    // grava aqui, e limpar só no ramo dos planos pagos deixava esse valor no
    // navegador para sempre.
    try {
      escolhido = localStorage.getItem('dito-plano-escolhido')
      localStorage.removeItem('dito-plano-escolhido')
    } catch { /* modo anônimo */ }
    // O id do plano no lugar do `true`: o modal abre direto nas opções de
    // faturamento dele, sem fazer escolher de novo na tabela.
    if (escolhido === 'iniciante' || escolhido === 'avancado') setShowPlan(escolhido)
  }, [user?.id])

  // Busca com atraso. O contador de execução descarta a resposta de uma busca
  // já superada: sem ele, uma consulta lenta por "a" podia sobrescrever o
  // resultado de "ata" digitado depois.
  const runRef = useRef(0)
  useEffect(() => {
    const query = term.trim()
    if (!query || !user?.id) { setResults(null); setSearching(false); return }

    const run = ++runRef.current
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const found = await searchConversations(user.id, query)
        if (runRef.current === run) setResults(found)
      } finally {
        if (runRef.current === run) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, user?.id])

  // Conteúdo compartilhado de outro app (áudio do WhatsApp, link do YouTube).
  // Fica aqui porque o Layout está sempre montado: o compartilhamento pode
  // chegar com o usuário em qualquer tela, e daqui levamos para a inicial, que
  // é onde a captura acontece.
  useEffect(() => {
    let active = true
    const receive = shared => {
      if (active && shared) navigate('/', { state: { shared } })
    }
    consumeSharedContent().then(receive)
    const unsubscribe = onSharedContent(receive)
    return () => { active = false; unsubscribe() }
  }, [navigate])

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  // "Ver planos" clicado na janelinha de aviso de reunião. Ela vive fora do
  // Layout, e este é o ponto onde o modal existe.
  useEffect(() => aoPedirPlano(plano => setShowPlan(plano || true)), [])
  // O "Convidar amigos" do aviso de reunião sem saldo: a janelinha vive fora
  // do Layout e não alcança este estado por conta própria.
  useEffect(() => aoPedirConvite(() => setShowConvite(true)), [])

  // Cada tela nova entra com um deslize curto, e voltar desliza para o outro
  // lado: sem isso a troca de tela no celular era um corte seco, com a tela
  // anterior sumindo de uma vez. Só a troca de endereço anima; a mesma tela
  // mudando de estado não.
  const conteudoRef = useRef(null)
  const primeiraTela = useRef(true)
  useEffect(() => {
    if (primeiraTela.current) { primeiraTela.current = false; return }
    const el = conteudoRef.current
    if (!el) return
    el.classList.remove('entrando', 'volta')
    // Ler a largura força o navegador a esquecer a animação anterior; sem
    // isso, duas trocas seguidas não animariam a segunda.
    void el.offsetWidth
    el.classList.add('entrando')
    if (navigationType === 'POP') el.classList.add('volta')
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Arrastar da borda esquerda abre a lateral no celular; arrastar para a
  // esquerda, com ela aberta, fecha.
  const cascaRef = useRef(null)
  useEffect(() => {
    if (!isMobile) return
    const el = cascaRef.current
    if (!el) return
    let inicio = null
    const aoTocar = e => {
      const t = e.touches[0]
      if (!drawerOpenRef.current && t.clientX > BORDA_DO_GESTO_PX) { inicio = null; return }
      inicio = { x: t.clientX, y: t.clientY }
    }
    const aoMover = e => {
      if (!inicio) return
      const t = e.touches[0]
      const dx = t.clientX - inicio.x
      const dy = t.clientY - inicio.y
      // Mais vertical que horizontal é rolagem, não gesto.
      if (Math.abs(dy) > Math.abs(dx)) { inicio = null; return }
      if (!drawerOpenRef.current && dx > DISTANCIA_DO_GESTO_PX) { setDrawerOpen(true); inicio = null }
      else if (drawerOpenRef.current && dx < -DISTANCIA_DO_GESTO_PX) { setDrawerOpen(false); inicio = null }
    }
    const aoSoltar = () => { inicio = null }
    el.addEventListener('touchstart', aoTocar, { passive: true })
    el.addEventListener('touchmove', aoMover, { passive: true })
    el.addEventListener('touchend', aoSoltar, { passive: true })
    return () => {
      el.removeEventListener('touchstart', aoTocar)
      el.removeEventListener('touchmove', aoMover)
      el.removeEventListener('touchend', aoSoltar)
    }
  }, [isMobile])

  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem('dito-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

  // Abrir uma janela (configurações, convite, feedback) fecha a lateral antes:
  // no celular ela ficava aberta por trás, desfocada, e fechar a janela
  // devolvia a pessoa a um menu que ela já tinha deixado.
  function abrirJanela(abrir) {
    setDrawerOpen(false)
    setShowConta(false)
    abrir()
  }

  async function handleLogout() {
    // Antes de tudo, com a sessão ainda valendo: este celular deixa de
    // receber os avisos desta conta.
    await esquecerAparelho()
    // Invisível para o usuário: só limpa a chave local, sem tela nenhuma.
    // Deixá-la num computador compartilhado seria deixar o cofre destrancado
    // para o próximo que logar ali.
    await esquecerDoAparelho()
    esquecerChaveAberta()
    // Junto com a chave vai o índice do acervo: ele guarda trechos das
    // conversas neste aparelho, e sem a chave eles nem seriam legíveis — mas
    // deixar o arquivo lá seria deixar o rastro do que foi dito.
    await apagarIndiceDoAcervo()
    await supabase.auth.signOut()
    navigate('/auth')
  }

  function openConversation(id) {
    closeSearch()
    navigate(`/conversa/${id}`)
  }

  function toggleSearch() {
    if (searchOpen) return closeSearch()
    setSearchOpen(true)
    // O foco é o ponto da lupa: abrir o campo e ainda exigir um clique nele
    // seria trocar um controle sempre visível por dois cliques.
    requestAnimationFrame(() => searchRef.current?.focus())
  }

  function closeSearch() {
    setSearchOpen(false)
    setTerm('')
  }

  const naHome = ROTAS_DE_CAPTURA.includes(location.pathname)
  const titulo = tituloDaTela(location.pathname, conversations)
  const naConversa = location.pathname.startsWith('/conversa/')
  const conversaAberta = location.pathname.match(/^\/conversa\/([^/]+)/)?.[1] || null
  const transcricaoAberta = location.pathname.match(/^\/transcrevendo\/([^/]+)/)?.[1] || null
  // A bolinha no ☰: com a lateral fechada, é o único jeito de saber que há
  // uma conversa nova lá dentro, ou uma transcrição a caminho.
  const novidadeNaLateral = naoLidas.size > 0 || emAndamento.length > 0

  const busca = searchOpen && (
    <div className="sidebar-search">
      <IconSearch width={15} height={15} />
      <input
        ref={searchRef}
        type="search"
        value={term}
        onChange={e => setTerm(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') closeSearch() }}
        placeholder="Buscar conversas"
        aria-label="Buscar conversas por título ou palavra-chave"
      />
      <button className="btn-icon" onClick={closeSearch} aria-label="Fechar busca">
        <IconClose width={14} height={14} />
      </button>
    </div>
  )

  const lista = (
    <div className="sidebar-list">
      {results ? (
        <SearchResults results={results} searching={searching} onOpen={openConversation} />
      ) : (
        <>
          <LinhasEmAndamento ativa={transcricaoAberta} onAbrir={id => navigate(`/transcrevendo/${id}`)} />
          {loadingConversations ? (
            // A forma da lista antes do conteúdo: a lateral não troca um
            // "Carregando…" solto por vinte linhas de uma vez.
            <div className="esqueleto-lista" aria-label="Carregando conversas">
              {[70, 52, 84, 61, 45, 76].map((largura, i) => (
                <span key={i} className="esqueleto-linha" style={{ width: `${largura}%` }} />
              ))}
            </div>
          ) : listError ? (
            <p className="sidebar-empty">Não foi possível carregar suas conversas.</p>
          ) : conversations.length === 0 ? (
            emAndamento.length === 0 && <p className="sidebar-empty">Nenhuma conversa ainda.</p>
          ) : (
            groupConversations(conversations).map(grupo => (
              <div key={grupo.label}>
                <div className="sidebar-group-label">{grupo.label}</div>
                {grupo.items.map(c => (
                  <button
                    key={c.id}
                    className={`sidebar-item ${conversaAberta === c.id ? 'active' : ''}`}
                    onClick={() => openConversation(c.id)}
                    {...gestos(c)}
                    title={displayTitle(c)}
                  >
                    <KindIcon sourceType={c.source_type} />
                    <span className="sidebar-item-text">{displayTitle(c)}</span>
                    {/* O alfinete é o que distingue uma conversa fixada de
                        uma recente quando o grupo sai do campo de visão. */}
                    {c.pinned && <IconPin width={13} height={13} className="pin-mark" />}
                    {/* Transcrita e ainda não aberta: a bolinha some quando a
                        conversa é aberta, em qualquer tela. */}
                    {naoLidas.has(c.id) && <span className="ponto-nao-lida" aria-label="Nova" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </>
      )}
    </div>
  )

  return (
    <div ref={cascaRef} className={`app-shell ${collapsed ? 'collapsed' : ''} ${drawerOpen ? 'drawer-open' : ''}`}>
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}
      {collapsed && (
        <button className="desktop-reopen" onClick={toggleCollapsed} aria-label="Abrir barra lateral">
          <IconSidebar />
        </button>
      )}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`} aria-hidden={isMobile && !drawerOpen ? true : undefined}>
        {isMobile ? (
          // No celular, o desenho da lateral do Claude: a marca à esquerda e
          // dois botões redondos (buscar e convidar). Voltar, avançar e
          // recolher eram peças de computador: no celular voltar é gesto, e
          // fechar é tocar fora.
          <div className="gaveta-topo">
            <span className="brand" onClick={() => navigate('/')}>Dito<span className="dot">.</span></span>
            <div className="gaveta-botoes">
              <button className={`botao-redondo ${searchOpen ? 'on' : ''}`} onClick={toggleSearch} aria-label="Buscar conversas" aria-expanded={searchOpen}>
                <IconSearch width={19} height={19} />
              </button>
              {!convidado && (
                <button className="botao-redondo" onClick={() => abrirJanela(() => setShowConvite(true))} aria-label="Convidar amigos">
                  <IconGift width={19} height={19} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="sidebar-head">
            <span className="brand" onClick={() => navigate('/')}>Dito<span className="dot">.</span></span>
            <div className="sidebar-tools">
              <button
                className={`tool-btn ${searchOpen ? 'on' : ''}`}
                onClick={toggleSearch}
                aria-label="Buscar conversas"
                aria-expanded={searchOpen}
              >
                <IconSearch width={16} height={16} />
              </button>
              {/* No app empacotado não existe barra do navegador: sem estes dois
                  não há como voltar de um tópico para a conversa sem passar pela
                  home. O índice vem do próprio histórico do roteador. */}
              <button className="tool-btn" onClick={() => navigate(-1)} disabled={!canGoBack} aria-label="Voltar">
                <IconArrowRight width={16} height={16} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button className="tool-btn" onClick={() => navigate(1)} aria-label="Avançar">
                <IconArrowRight width={16} height={16} />
              </button>
              <span className="sep" />
              <button className="sidebar-toggle" onClick={toggleCollapsed} aria-label="Recolher barra lateral">
                <IconSidebar />
              </button>
            </div>
          </div>
        )}

        {isMobile && busca}

        {/* Entrada permanente para começar algo, como no Claude. No celular o
            "Transcrever" desce para o botão flutuante do rodapé, como o "New
            session" do Claude, e aqui fica só o "Perguntar". */}
        {!isMobile && (
          <button className="sidebar-novo" onClick={() => navigate('/')}>
            <IconPlus width={16} height={16} /> Transcrever
          </button>
        )}

        {/* Logo abaixo do "Transcrever", e não no rodapé com as configurações:
            o "Perguntar" é a segunda coisa que se faz no app, não um
            ajuste. Sem lugar fixo, o recurso só existiria para quem soubesse
            da URL. */}
        <button
          className={`sidebar-novo sidebar-perguntar ${location.pathname === '/perguntar' ? 'active' : ''}`}
          onClick={() => navigate('/perguntar', { replace: location.pathname === '/perguntar' })}
        >
          <IconChat width={isMobile ? 20 : 16} height={isMobile ? 20 : 16} /> Perguntar
        </button>

        {!isMobile && busca}

        {lista}

        {isMobile ? (
          <div className="gaveta-rodape">
            {convidado ? (
              <div className="foot-convite gaveta-convite">
                <p className="foot-convite-titulo">Guarde suas conversas</p>
                <p className="foot-convite-texto">
                  Entre para ter {planoPorId('gratuito').minutos} minutos grátis por mês e ver suas conversas em qualquer aparelho.
                </p>
                <button className="btn-secondary" onClick={() => navigate('/auth')}>Entrar</button>
              </div>
            ) : (
              // A conta vira um botão redondo com a inicial, como no Claude: o
              // e-mail, as configurações, o feedback e o sair moram atrás dele.
              <button className="gaveta-avatar" onClick={() => setShowConta(true)} aria-label="Conta e configurações">
                {user?.email?.charAt(0).toUpperCase()}
              </button>
            )}
            <button className="gaveta-novo" onClick={() => navigate('/')}>
              <IconPlus width={18} height={18} /> Transcrever
            </button>
          </div>
        ) : (
          <div className="sidebar-foot">
            {/* Primeiro do rodapé: é o único dos quatro que dá algo à pessoa. */}
            {!convidado && (
              <button className="nav-item" onClick={() => setShowConvite(true)}>
                <IconGift /> Convidar amigos
              </button>
            )}
            <button className="nav-item" onClick={() => setShowSettings(true)}>
              <IconSettings /> Configurações
            </button>
            <button className="nav-item nav-feedback" onClick={() => setShowFeedback(true)}>
              <IconMegafone /> Enviar feedback
            </button>
            {vendeAqui && (
              <button className="nav-item" onClick={() => setShowPlan(true)}>
                <IconCard /> Meu plano
              </button>
            )}
            {convidado ? (
              // O convidado não tem e-mail para mostrar, e "Sair" seria perder a
              // única captura dele sem aviso. No lugar, o convite para entrar —
              // é o ponto em que ele decide criar a conta.
              <div className="foot-convite">
                <p className="foot-convite-titulo">Guarde suas conversas</p>
                <p className="foot-convite-texto">
                  Entre para ter {planoPorId('gratuito').minutos} minutos grátis por mês e ver suas conversas em qualquer aparelho.
                </p>
                <button className="btn-secondary" onClick={() => navigate('/auth')}>Entrar</button>
                {/* Mesma entrada marcada que o voltar do navegador encontra (ver
                    AppShell): a sessão de convidado continua, e o "Usar o Dito"
                    da landing traz de volta para ela. */}
                <button className="foot-convite-site" onClick={() => navigate('/', { state: { vitrine: true } })}>
                  Voltar para o site
                </button>
              </div>
            ) : (
              <div className="foot-user">
                <span className="foot-avatar">{user?.email?.charAt(0).toUpperCase()}</span>
                <span className="email">{user?.email}</span>
                {convite?.apoiador && (
                  <span className="selo-apoiador" title="Selo de apoiador: você usa as novidades do Dito antes de todo mundo">
                    <IconSelo width={12} height={12} /> Apoiador
                  </span>
                )}
                <button className="btn-icon" onClick={handleLogout} title="Sair" aria-label="Sair"><IconLogout width={16} height={16} /></button>
              </div>
            )}
            {/* Qual build está rodando. O instalador do Windows tem nome e URL
                fixos, então uma cópia velha no cache do navegador se instala sem
                nenhum aviso — sem isto, "atualizou?" não tinha resposta. */}
            <span
              className="foot-version"
              title={`Versão ${__APP_VERSION__}, commit ${__BUILD_SHA__}\nÚltimos eventos de login: ${rastroAuth() || 'nenhum'}`}
            >
              v{__APP_VERSION__} · {__BUILD_SHA__}
            </span>
          </div>
        )}
      </aside>

      <div className="content-wrap">
        {/* O topo do celular, como o do Claude: o botão da lateral à esquerda,
            o nome da tela no meio e, à direita, o "+" para transcrever algo
            novo de qualquer lugar (ou, na home, o relógio de minutos). Ele
            começa abaixo da barra de status do aparelho, onde o toque chega. */}
        <div className="topbar-mobile">
          <button
            className="botao-redondo hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label={novidadeNaLateral ? 'Abrir menu: há novidades' : 'Abrir menu'}
          >
            <IconMenu width={20} height={20} />
            {novidadeNaLateral && <span className="ponto-nao-lida no-botao" aria-hidden="true" />}
          </button>
          {naConversa && titulo ? (
            // Tocar no título abre as opções da conversa, como no Claude.
            <button className="topbar-titulo como-botao" onClick={pedirAcoesDaConversa}>
              <span>{titulo}</span>
              <IconCaretDown width={14} height={14} />
            </button>
          ) : (
            <span className="topbar-titulo">{titulo}</span>
          )}
          {naHome ? (
            <div className="topbar-contador">
              {saldoEfetivo && (
                <ContadorMinutos
                  usados={saldoEfetivo.usados}
                  limite={saldoEfetivo.limite}
                  extra={saldoEfetivo.minutosExtra}
                  convidado={convidado}
                  compacto
                />
              )}
            </div>
          ) : (
            <button className="botao-redondo" onClick={() => navigate('/')} aria-label="Transcrever algo novo">
              <IconPlus width={20} height={20} />
            </button>
          )}
        </div>
        <div className="content" ref={conteudoRef}>
          {/* Acabou: a faixa some da tela e a pessoa ficava sem nenhum caminho
              à vista. Agora ela continua, com o convite na frente (ver
              SemSaldo). Entre 80% e 100% segue a faixa fina de sempre, com o
              convite como link ao lado. */}
          {saldoEfetivo?.limite != null && naHome && saldoEfetivo.usados >= saldoEfetivo.limite && (
            <SemSaldo
              texto="Seus minutos deste mês acabaram."
              onConvidar={abrirConvite}
              onVerPlanos={vendeAqui ? () => setShowPlan(true) : null}
              premio={convite?.regras}
              origem="sem-minutos"
            />
          )}
          {saldoEfetivo?.limite != null && naHome &&
            saldoEfetivo.usados >= saldoEfetivo.limite * AVISO_A_PARTIR_DE && saldoEfetivo.usados < saldoEfetivo.limite && (
            <div className="aviso-saldo">
              <span>
                Faltam {Math.max(0, Math.round(saldoEfetivo.limite - saldoEfetivo.usados))} minutos do seu mês.
              </span>
              {abrirConvite && (
                <button type="button" onClick={() => { track('convite_aberto', { origem: 'saldo-baixo' }); abrirConvite() }}>
                  Convidar amigos
                </button>
              )}
              {vendeAqui && <button type="button" onClick={() => setShowPlan(true)}>Ver planos</button>}
            </div>
          )}
          {/* `apoiador` é a chave do acesso antecipado: função nova em teste
              aparece para quem tem o selo antes de ir para todo mundo. */}
          <Outlet context={{ conversations, refreshConversations, loadingConversations, saldo: saldoEfetivo, plano: saldo?.plano ?? null, perguntasRestantes, atualizarPerguntasRestantes, convidado, apoiador: !!convite?.apoiador, abrirPlano: vendeAqui ? () => setShowPlan(true) : null, abrirConvite, premioConvite: convite?.regras ?? null }} />
        </div>
      </div>

      <ConversaMenu
        menu={menu}
        onClose={fecharMenu}
        onChanged={refreshConversations}
        onDeleted={id => {
          refreshConversations()
          // Apagar a conversa aberta deixaria a tela mostrando algo que não
          // existe mais; a home é o único destino que sempre existe.
          if (location.pathname.startsWith(`/conversa/${id}`)) navigate('/')
        }}
      />

      {showConta && (
        <ContaSheet
          email={user?.email}
          apoiador={!!convite?.apoiador}
          vendeAqui={vendeAqui}
          onClose={() => setShowConta(false)}
          onSettings={() => abrirJanela(() => setShowSettings(true))}
          onFeedback={() => abrirJanela(() => setShowFeedback(true))}
          onPlano={() => abrirJanela(() => setShowPlan(true))}
          onSair={handleLogout}
        />
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          deteccaoDisponivel={deteccaoDisponivel}
          avisarReuniao={avisarReuniao}
          onAvisarReuniao={definirAvisar}
          iniciarComWindows={iniciarComWindows}
          onIniciarComWindows={definirIniciarComWindows}
        />
      )}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showConvite && (
        <ConviteModal convite={convite} onAtualizar={atualizarConvite} onClose={() => setShowConvite(false)} />
      )}
      {!showConvite && (
        <PremioAviso
          aviso={avisoPremio}
          onFechar={fecharAvisoPremio}
          onAbrir={() => { fecharAvisoPremio(); setShowConvite(true) }}
        />
      )}
      {showPlan && vendeAqui && (
        <PlanModal
          inicial={typeof showPlan === 'string' ? showPlan : null}
          onClose={() => setShowPlan(false)}
        />
      )}
      <Toast />
    </div>
  )
}

// A conta, no celular: o que no computador fica no rodapé da lateral. Abre por
// cima, de baixo para cima, como as folhas do iPhone.
function ContaSheet({ email, apoiador, vendeAqui, onClose, onSettings, onFeedback, onPlano, onSair }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal conta-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Conta">
        <div className="conta-topo">
          <span className="foot-avatar grande">{email?.charAt(0).toUpperCase()}</span>
          <span className="conta-email">{email}</span>
          {apoiador && (
            <span className="selo-apoiador">
              <IconSelo width={12} height={12} /> Apoiador
            </span>
          )}
        </div>
        <div className="conta-lista">
          <button className="conta-item" onClick={onSettings}><IconSettings /> Configurações</button>
          <button className="conta-item" onClick={onFeedback}><IconMegafone /> Enviar feedback</button>
          {vendeAqui && <button className="conta-item" onClick={onPlano}><IconCard /> Meu plano</button>}
          <button className="conta-item" onClick={onSair}><IconLogout /> Sair</button>
        </div>
      </div>
    </div>
  )
}

// Duas seções, na ordem em que o usuário pensa: o que ele lembra do título
// primeiro, o que só foi dito em algum ponto depois — com o trecho em volta,
// para ele ver por que aquela conversa apareceu.
function SearchResults({ results, searching, onOpen }) {
  const { titles, transcripts } = results
  if (searching && !titles.length && !transcripts.length) {
    return <p className="sidebar-empty">Buscando…</p>
  }
  if (!titles.length && !transcripts.length) {
    return <p className="sidebar-empty">Nada encontrado.</p>
  }
  return (
    <>
      {titles.length > 0 && (
        <>
          <div className="sidebar-section-label">Nos títulos</div>
          {titles.map(c => (
            <button key={c.id} className="sidebar-item" onClick={() => onOpen(c.id)} title={displayTitle(c)}>
              <KindIcon sourceType={c.source_type} />
              <span className="sidebar-item-text">{displayTitle(c)}</span>
            </button>
          ))}
        </>
      )}
      {transcripts.length > 0 && (
        <>
          <div className="sidebar-section-label">Nas transcrições</div>
          {transcripts.map(c => (
            <button key={c.id} className="sidebar-item tall" onClick={() => onOpen(c.id)} title={displayTitle(c)}>
              <span className="sidebar-item-text">{displayTitle(c)}</span>
              <span className="sidebar-item-sub">{c.excerpt}</span>
              <span className="sidebar-item-sub muted">{formatCapturedAt(c.created_at)}</span>
            </button>
          ))}
        </>
      )}
    </>
  )
}
