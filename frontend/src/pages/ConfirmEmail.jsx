import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { IconCheck, IconMail } from '../components/Icons'

const MIN_PASSWORD = 8

// Fim do fluxo de confirmação de e-mail. O link enviado por e-mail aponta para
// /confirm.html no nosso domínio (e não para o endpoint do Supabase), porque só
// assim o App Link do Android consegue abrir o app em vez do navegador. O que
// chega aqui é um token de uso único, que trocamos por uma sessão.
export default function ConfirmEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('verificando')
  const [error, setError] = useState(null)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  // StrictMode monta o componente duas vezes em desenvolvimento, e o token é de
  // uso único: sem esta trava a segunda tentativa falharia com "token inválido".
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const tokenHash = params.get('token_hash')
    const type = params.get('type') || 'signup'

    if (!tokenHash) {
      setStatus('erro')
      setError('Link inválido ou incompleto.')
      return
    }

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => {
        if (error) throw error
        if (type === 'recovery') {
          // Redefinição de senha: o token só provou que o e-mail é dela. Falta
          // a senha nova, e é aqui que ela entra — já com sessão válida.
          setStatus('nova-senha')
          return
        }
        setStatus('ok')
        // A sessão já existe; o ProtectedRoute leva para dentro do app.
        setTimeout(() => navigate('/', { replace: true }), 1500)
      })
      .catch(err => {
        setStatus('erro')
        setError(
          /expired|invalid/i.test(err.message)
            ? 'Este link expirou ou já foi usado. Peça um novo na tela de cadastro.'
            : err.message
        )
      })
  }, [params, navigate])

  async function submitNewPassword(e) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setStatus('ok')
      setTimeout(() => navigate('/', { replace: true }), 1500)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (status === 'nova-senha') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <span className="brand">Dito<span className="dot">.</span></span>
            <p>Escolha uma nova senha</p>
          </div>
          <form onSubmit={submitNewPassword}>
            <div className="form-group">
              <label>Nova senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={MIN_PASSWORD}
                autoFocus
              />
              <p className="field-hint">Mínimo de {MIN_PASSWORD} caracteres.</p>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <button
              type="submit"
              className="btn-primary btn-full"
              disabled={saving || password.length < MIN_PASSWORD}
            >
              {saving ? 'Salvando...' : 'Salvar e entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-created">
        {status === 'ok' ? (
          <>
            <div className="feedback-check"><IconCheck width={26} height={26} /></div>
            <h3>E-mail confirmado! 🎉</h3>
            <p className="text-muted">Estamos te levando para o Dito…</p>
          </>
        ) : status === 'erro' ? (
          <>
            <div className="feedback-check"><IconMail width={26} height={26} /></div>
            <h3>Não deu para confirmar</h3>
            <p className="text-muted">{error}</p>
            <button
              className="btn-primary btn-full"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/auth', { replace: true })}
            >
              Voltar
            </button>
          </>
        ) : (
          <>
            <h3>Confirmando seu e-mail…</h3>
            <div className="spinner" style={{ margin: '18px auto 0' }} />
          </>
        )}
      </div>
    </div>
  )
}
