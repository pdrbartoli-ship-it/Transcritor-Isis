import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { consumeSharedContent, onSharedContent } from '../lib/sharedContent'
import SettingsModal from './SettingsModal'
import FeedbackModal from './FeedbackModal'
import PlanModal from './PlanModal'
import { listConversations, searchConversations, formatCapturedAt } from '../lib/conversas'
import { trackAppOpen } from '../lib/analytics'
import {
  IconSidebar, IconSettings, IconLogout, IconMic, IconMessage,
  IconSearch, IconClose, IconCard,
} from './Icons'

// Espera depois da última tecla antes de consultar o banco. Buscar a cada
// caractere dispara uma consulta por letra e faz respostas antigas chegarem
// depois das novas.
const SEARCH_DEBOUNCE_MS = 250

export default function Layout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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
    setTerm('')
    navigate(`/conversa/${id}`)
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

        <button className="sidebar-cta" onClick={() => navigate('/')}>
          <IconMic width={16} height={16} /> Nova gravação
        </button>

        <div className="sidebar-search">
          <IconSearch width={15} height={15} />
          <input
            type="search"
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="Buscar conversas"
            aria-label="Buscar conversas por título ou palavra-chave"
          />
          {term && (
            <button className="btn-icon" onClick={() => setTerm('')} aria-label="Limpar busca">
              <IconClose width={14} height={14} />
            </button>
          )}
        </div>

        <div className="sidebar-list">
          {results ? (
            <SearchResults results={results} searching={searching} onOpen={openConversation} />
          ) : (
            <>
              <div className="sidebar-section-label">Conversas</div>
              {loadingConversations ? (
                <p className="sidebar-empty">Carregando…</p>
              ) : listError ? (
                <p className="sidebar-empty">Não foi possível carregar suas conversas.</p>
              ) : conversations.length === 0 ? (
                <p className="sidebar-empty">Nenhuma conversa ainda.</p>
              ) : (
                conversations.map(c => (
                  <button
                    key={c.id}
                    className={`sidebar-item ${location.pathname.startsWith(`/conversa/${c.id}`) ? 'active' : ''}`}
                    onClick={() => openConversation(c.id)}
                    title={c.title}
                  >
                    <span className="dot-mark" />
                    <span className="sidebar-item-text">{c.title}</span>
                  </button>
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
            <IconMessage /> Deixe um feedback para gente!
          </button>
          <button className="nav-item" onClick={() => setShowPlan(true)}>
            <IconCard /> Meu plano
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
          <Outlet context={{ conversations, refreshConversations, loadingConversations }} />
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
            <button key={c.id} className="sidebar-item" onClick={() => onOpen(c.id)} title={c.title}>
              <span className="dot-mark" />
              <span className="sidebar-item-text">{c.title}</span>
            </button>
          ))}
        </>
      )}
      {transcripts.length > 0 && (
        <>
          <div className="sidebar-section-label">Nas transcrições</div>
          {transcripts.map(c => (
            <button key={c.id} className="sidebar-item tall" onClick={() => onOpen(c.id)} title={c.title}>
              <span className="sidebar-item-text">{c.title}</span>
              <span className="sidebar-item-sub">{c.excerpt}</span>
              <span className="sidebar-item-sub muted">{formatCapturedAt(c.created_at)}</span>
            </button>
          ))}
        </>
      )}
    </>
  )
}
