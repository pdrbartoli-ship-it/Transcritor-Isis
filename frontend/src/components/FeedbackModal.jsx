import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { IconClose, IconCheck } from './Icons'

const CATEGORIES = ['Ideia', 'Problema', 'Outro']

// Lets users send improvement suggestions. Stored in the Supabase `feedback`
// table (see SQL in repo). Captures lightweight context automatically.
export default function FeedbackModal({ onClose }) {
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('Ideia')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setLoading(true)
    setError(null)
    const { error } = await supabase.from('feedback').insert({
      user_id: user?.id,
      email: user?.email,
      message: message.trim(),
      category,
      context: { route: window.location.hash || '/', ua: navigator.userAgent },
    })
    setLoading(false)
    if (error) {
      setError('Não foi possível enviar agora. Tente novamente em instantes.')
      return
    }
    setDone(true)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="feedback-done">
            <div className="feedback-check"><IconCheck width={26} height={26} /></div>
            <h3>Obrigado! 🙏</h3>
            <p className="text-muted">Recebemos sua mensagem. Ela nos ajuda a melhorar o Dito.</p>
            <div className="modal-actions">
              <button className="btn-primary" onClick={onClose}>Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <h3>Fale com a gente</h3>
              <button className="btn-icon" onClick={onClose}><IconClose /></button>
            </div>
            <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
              Sugestão, problema ou reclamação — escreva e envie. A gente lê tudo.
            </p>
            <form onSubmit={submit}>
              <div className="settings-group">
                <div className="seg">
                  {CATEGORIES.map(c => (
                    <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>
                  ))}
                </div>
              </div>
              <textarea
                className="feedback-textarea"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Escreva aqui sua sugestão, problema ou ideia..."
                rows={5}
                autoFocus
              />
              {error && <div className="alert alert-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={loading || !message.trim()}>
                  {loading ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
