import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { IconCheck } from '../components/Icons'

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
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [created, setCreated] = useState(false)
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
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) { setHoldRedirect(false); throw error }
        if (data.session) {
          // Confirmação de e-mail desligada: a conta já entra direto.
          setCreated(true)
          timerRef.current = setTimeout(() => setHoldRedirect(false), CELEBRATION_MS)
        } else {
          // Confirmação de e-mail ligada: não há sessão, é só avisar.
          setHoldRedirect(false)
          setMessage('Conta criada! Verifique seu e-mail para confirmar e depois acesse.')
        }
      }
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setLoading(false)
    }
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
          <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
            Acessar
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>
            Criar conta
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
