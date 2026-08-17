import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { IconCheck, IconMail } from '../components/Icons'

const MIN_PASSWORD = 8

// Quanto tempo a confirmação de "conta criada" fica na tela antes de entrar.
const CELEBRATION_MS = 1800

// O Supabase devolve as mensagens em inglês; traduzimos as mais comuns para
// não expor texto cru de API a quem está só tentando entrar.
const ERROR_PT = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar. Veja sua caixa de entrada.',
  'User already registered': 'Já existe uma conta com este e-mail. Use "Acessar".',
  'Unable to validate email address: invalid format': 'E-mail inválido.',
  'Password should be at least 6 characters': `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`,
  'Email rate limit exceeded': 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
}

function translateError(message) {
  if (ERROR_PT[message]) return ERROR_PT[message]
  if (/network|fetch/i.test(message)) return 'Sem conexão com o servidor. Verifique sua internet.'
  return message
}

export default function Auth() {
  const { setHoldRedirect } = useAuth()
  const [mode, setMode] = useState('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [created, setCreated] = useState(false)
  // Quando a confirmação de e-mail está ligada no Supabase, o signUp não abre
  // sessão: a pessoa fica nesta tela até clicar no link que chegou por e-mail.
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const [resent, setResent] = useState(false)
  const timerRef = useRef(null)

  // Se o componente sair de cena antes do timer, o redirecionamento não pode
  // ficar travado — liberamos sempre na desmontagem.
  useEffect(() => () => {
    clearTimeout(timerRef.current)
    setHoldRedirect(false)
  }, [setHoldRedirect])

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD
  const canSubmit = !loading && email.trim() && password &&
    (mode === 'login' || password.length >= MIN_PASSWORD)

  function switchMode(m) {
    setMode(m)
    setError(null)
    setMessage(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        // O hold precisa estar ativo antes da sessão nascer, senão o
        // PublicRoute redireciona no mesmo instante e a confirmação não aparece.
        setHoldRedirect(true)
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Sem isto o link do e-mail cai na Site URL padrão do Supabase, que
          // nem sempre é o domínio de onde a pessoa se cadastrou.
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) { setHoldRedirect(false); throw error }
        if (data.session) {
          // Confirmação de e-mail desligada: a conta já entra direto.
          setCreated(true)
          timerRef.current = setTimeout(() => setHoldRedirect(false), CELEBRATION_MS)
        } else {
          // Confirmação de e-mail ligada: não há sessão, a pessoa espera o link.
          setHoldRedirect(false)
          setAwaitingConfirm(true)
        }
      }
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setLoading(false)
    }
  }

  async function resendConfirmation() {
    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setResent(true)
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setLoading(false)
    }
  }

  if (awaitingConfirm) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-created">
          <div className="feedback-check"><IconMail width={26} height={26} /></div>
          <h3>Confirme seu e-mail</h3>
          <p className="text-muted">
            Enviamos um link para <strong>{email}</strong>. Abra o e-mail e clique
            no link para ativar sua conta.
          </p>
          <p className="field-hint" style={{ marginTop: 14 }}>
            Não chegou? Verifique a caixa de spam.
          </p>

          {error && <div className="alert alert-error">{error}</div>}
          {resent && <div className="alert alert-success">E-mail reenviado.</div>}

          <button
            className="btn-ghost btn-full"
            style={{ marginTop: 14 }}
            onClick={resendConfirmation}
            disabled={loading || resent}
          >
            {loading ? 'Enviando...' : 'Reenviar e-mail'}
          </button>
          <button
            className="btn-ghost btn-full"
            style={{ marginTop: 8 }}
            onClick={() => { setAwaitingConfirm(false); setResent(false); switchMode('login') }}
          >
            Voltar
          </button>
        </div>
      </div>
    )
  }

  if (created) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-created">
          <div className="feedback-check"><IconCheck width={26} height={26} /></div>
          <h3>Conta criada! 🎉</h3>
          <p className="text-muted">Tudo certo, {email}. Estamos te levando para o Dito…</p>
          <div className="spinner" style={{ margin: '18px auto 0' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="brand">Dito<span className="dot">.</span></span>
          <p>Capture, transcreva e organize suas conversas</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>
            Criar conta
          </button>
          <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
            Acessar
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
              aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
            />
            {mode === 'signup' && (
              <p id="password-hint" className={`field-hint ${passwordTooShort ? 'warn' : ''}`}>
                {passwordTooShort
                  ? `Faltam ${MIN_PASSWORD - password.length} caractere${MIN_PASSWORD - password.length > 1 ? 's' : ''}.`
                  : `Mínimo de ${MIN_PASSWORD} caracteres.`}
              </p>
            )}
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}

          <button type="submit" className="btn-primary btn-full" disabled={!canSubmit}>
            {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  )
}
