import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { IconClose } from './Icons'

// Número de WhatsApp para contato direto (só dígitos, com DDI, ex.: '5511999999999').
// Vazio = botão de WhatsApp fica oculto.
const WHATSAPP_NUMBER = ''

const MOODS = [
  { key: 'bad', emoji: '😞', label: 'Insatisfeito' },
  { key: 'meh', emoji: '😐', label: 'Neutro' },
  { key: 'good', emoji: '😀', label: 'Satisfeito' },
]

// Feedback relâmpago: uma carinha (1 toque) e/ou um texto opcional.
// Carinha sozinha já pode ser enviada. Salva na tabela Supabase `feedback`.
export default function FeedbackModal({ onClose, onSent }) {
  const { user } = useAuth()
  const [mood, setMood] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const canSend = !!mood || !!message.trim()

  async function submit(e) {
    e.preventDefault()
    if (!canSend || loading) return
    setLoading(true)
    setError(null)
    const { error } = await supabase.from('feedback').insert({
      user_id: user?.id,
      email: user?.email,
      message: message.trim() || null,
      mood,
      context: { route: window.location.hash || '/', ua: navigator.userAgent },
    })
    setLoading(false)
    if (error) {
      setError('Não foi possível enviar agora. Tente de novo em instantes.')
      return
    }
    onSent?.() // Layout mostra o toast e fecha a folha
  }

  function openWhatsApp() {
    const text = encodeURIComponent(
      `Oi! Sou usuário do Dito${user?.email ? ` (${user.email})` : ''}. Queria falar sobre: `
    )
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, '_blank')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal feedback-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Como está sua experiência?</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>

        <form onSubmit={submit}>
          <div className="mood-row">
            {MOODS.map(m => (
              <button
                type="button"
                key={m.key}
                className={`mood-btn ${mood === m.key ? 'on' : ''}`}
                onClick={() => setMood(m.key)}
                aria-label={m.label}
                title={m.label}
              >
                <span className="mood-emoji">{m.emoji}</span>
              </button>
            ))}
          </div>

          <textarea
            className="feedback-textarea"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Quer contar mais? (opcional)"
            rows={3}
          />

          {error && <div className="alert alert-error">{error}</div>}

          <button type="submit" className="btn-primary btn-block" disabled={!canSend || loading}>
            {loading ? 'Enviando...' : 'Enviar'}
          </button>
        </form>

        {WHATSAPP_NUMBER && (
          <button type="button" className="wa-link" onClick={openWhatsApp}>
            Prefiro falar no WhatsApp
          </button>
        )}
      </div>
    </div>
  )
}
