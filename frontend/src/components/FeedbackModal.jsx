import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { IconClose, IconCheck } from './Icons'

const CATEGORIES = ['Ideia', 'Problema', 'Outro']

// Categoria dos reports feitos pelo botão da conversa. As lojas (Microsoft
// Store 11.16, Google Play) exigem que o usuário consiga denunciar conteúdo
// impróprio gerado pela IA; o report cai na mesma tabela, filtrável por isto.
const CATEGORIA_IA = 'Conteúdo da IA'

// Lets users send improvement suggestions. Stored in the Supabase `feedback`
// table (see SQL in repo). Captures lightweight context automatically.
// Com `conversaId`, vira o report de conteúdo da IA daquela conversa. O texto
// da conversa não vai junto: ele é cifrado, e copiá-lo em claro para a tabela
// de feedback furaria essa proteção — o usuário descreve o problema.
export default function FeedbackModal({ onClose, conversaId = null }) {
  const { user } = useAuth()
  const reportIA = !!conversaId
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState(reportIA ? CATEGORIA_IA : 'Ideia')
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
      context: {
        route: window.location.hash || '/',
        ua: navigator.userAgent,
        ...(conversaId && { conversa: conversaId }),
      },
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
            <p className="text-muted">
              {reportIA
                ? 'Recebemos seu report. A equipe do Dito vai analisar esse conteúdo.'
                : 'Recebemos sua mensagem. Ela nos ajuda a melhorar o Dito.'}
            </p>
            <div className="modal-actions">
              <button className="btn-primary" onClick={onClose}>Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <h3>{reportIA ? 'Reportar conteúdo da IA' : 'Deixe um feedback para gente!'}</h3>
              <button className="btn-icon" onClick={onClose}><IconClose /></button>
            </div>
            <p className="text-muted text-sm" style={{ marginBottom: 14 }}>
              {reportIA
                ? 'Algo que a IA escreveu nesta conversa está errado, ofensivo ou inadequado? Conte o que foi — a gente analisa todos os reports.'
                : 'Sugestão, problema ou reclamação — escreva e envie. A gente lê tudo.'}
            </p>
            <form onSubmit={submit}>
              {!reportIA && (
                <div className="settings-group">
                  <div className="seg">
                    {CATEGORIES.map(c => (
                      <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>
                    ))}
                  </div>
                </div>
              )}
              <textarea
                className="feedback-textarea"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={reportIA
                  ? 'O que está errado ou inadequado, e onde apareceu (resumo, tópico, tarefa, resposta do chat...)'
                  : 'Escreva aqui sua sugestão, problema ou ideia...'}
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
