import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation, Outlet, NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { consumeSharedContent, onSharedContent } from '../lib/sharedContent'
import SettingsModal from './SettingsModal'
import FeedbackModal from './FeedbackModal'
import PlanModal from './PlanModal'
import { listConversations, searchConversations, formatCapturedAt, groupConversations, displayTitle } from '../lib/conversas'
import { trackAppOpen } from '../lib/analytics'
import {
  IconSidebar, IconSettings, IconLogout, IconMic, IconMessage,
  IconSearch, IconClose, IconCard, IconArrowRight, IconLink, IconFile,
} from './Icons'

// As três origens de captura. Ficam na barra lateral, junto do resto da
// navegação — no centro elas roubavam o lugar da própria superfície de gravar.
// Cada uma é uma rota, então tem endereço e o voltar funciona.
const CAPTURE_MODES = [
  { to: '/', label: 'Gravação', Icon: IconMic },
  { to: '/audio', label: 'Áudio', Icon: IconFile },
  { to: '/video', label: 'Vídeo', Icon: IconLink },
]

// De onde veio a captura. A lista mostrava o mesmo ponto cinza para tudo, então
// gravação, arquivo e link eram indistinguíveis sem abrir.
// As conversas antigas foram todas gravadas como 'file' — daí o ícone de
// arquivo ser o padrão, e não o microfone: ele seria mentira na metade delas.
const KIND_ICON = { url: IconLink, record: IconMic, file: IconFile }
function KindIcon({ sourceType }) {
  const Icon = KIND_ICON[sourceType] || IconFile
  return <Icon className="kind-icon" width={14} height={14} />
}

// Espera depois da última tecla antes de consultar o banco. Buscar a cada
// caractere dispara uma consulta por letra e faz respostas antigas chegarem
// depois das novas.
const SEARCH_DEBOUNCE_MS = 250

export default function Layout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // O roteador guarda a posição no histórico em history.state.idx — é o que
  // diz se existe para onde voltar sem sair do app.
  const canGoBack = (window.history.state?.idx ?? 0) > 0

  const [conversations, setConversations] = useState([])
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [listError, setListError] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null)   // null = não está buscando
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef(null)

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

  useEffect(() => {
    if (!user?.id) return
    // Uma abertura por carregamento do app, contada só depois de haver usuário
    // — sem ele não há a quem atribuir.
    trackAppOpen()
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

  // "Ver todas" da home: o arquivo completo é a barra lateral, então o link
  // leva até ela em vez de abrir uma tela nova — no celular ela é gaveta, e no
  // desktop pode estar recolhida.
  function showAllConversations() {
    setCollapsed(false)
    try { localStorage.setItem('dito-sidebar-collapsed', '0') } catch {}
    setDrawerOpen(true)
  }

  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem('dito-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

  async function handleLogout() {
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

        <nav className="capture-nav" aria-label="O que você quer transcrever">
          {CAPTURE_MODES.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon width={13} height={13} /> {label}
            </NavLink>
          ))}
        </nav>

        {searchOpen && (
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
        )}

        <div className="sidebar-list">
          {results ? (
            <SearchResults results={results} searching={searching} onOpen={openConversation} />
          ) : (
            <>
              {loadingConversations ? (
                <p className="sidebar-empty">Carregando…</p>
              ) : listError ? (
                <p className="sidebar-empty">Não foi possível carregar suas conversas.</p>
              ) : conversations.length === 0 ? (
                <p className="sidebar-empty">Nenhuma conversa ainda.</p>
              ) : (
                groupConversations(conversations).map(grupo => (
                  <div key={grupo.label}>
                    <div className="sidebar-group-label">{grupo.label}</div>
                    {grupo.items.map(c => (
                      <button
                        key={c.id}
                        className={`sidebar-item ${location.pathname.startsWith(`/conversa/${c.id}`) ? 'active' : ''}`}
                        onClick={() => openConversation(c.id)}
                        title={displayTitle(c)}
                      >
                        <KindIcon sourceType={c.source_type} />
                        <span className="sidebar-item-text">{displayTitle(c)}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </>
          )}
        </div>

        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setShowSettings(true)}>
            <IconSettings /> Tema
          </button>
          <button className="nav-item nav-feedback" onClick={() => setShowFeedback(true)}>
            <IconMessage /> Enviar feedback
          </button>
          <button className="nav-item" onClick={() => setShowPlan(true)}>
            <IconCard /> Meu plano
          </button>
          <div className="foot-user">
            <span className="foot-avatar">{user?.email?.charAt(0).toUpperCase()}</span>
            <span className="email">{user?.email}</span>
            <button className="btn-icon" onClick={handleLogout} title="Sair" aria-label="Sair"><IconLogout width={16} height={16} /></button>
          </div>
          {/* Qual build está rodando. O instalador do Windows tem nome e URL
              fixos, então uma cópia velha no cache do navegador se instala sem
              nenhum aviso — sem isto, "atualizou?" não tinha resposta. */}
          <span className="foot-version" title={`Versão ${__APP_VERSION__}, commit ${__BUILD_SHA__}`}>
            v{__APP_VERSION__} · {__BUILD_SHA__}
          </span>
        </div>
      </aside>

      <div className="content-wrap">
        <div className="topbar-mobile">
          <button className="hamburger" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu">☰</button>
          <span className="brand" onClick={() => navigate('/')}>Dito<span className="dot">.</span></span>
        </div>
        <div className="content">
          <Outlet context={{ conversations, refreshConversations, loadingConversations, showAllConversations }} />
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showPlan && <PlanModal onClose={() => setShowPlan(false)} />}
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
