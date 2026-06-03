import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { IconClose } from './Icons'

// Creates a folder (stored in the `clients` table). `initialName` lets the
// folder-suggestion flow pre-fill a proposed name.
export default function NewFolderModal({ onClose, onCreated, initialName = '' }) {
  const { user } = useAuth()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)

    const { data, error } = await supabase.from('clients').insert({
      user_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
    }).select().single()

    if (error) { setError(error.message); setLoading(false); return }
    onCreated(data)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Nova pasta</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nome *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: João Silva, Processo 0421, Pesquisa..."
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label>Descrição (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex: paciente, sessões semanais"
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading || !name.trim()}>
              {loading ? 'Criando...' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
