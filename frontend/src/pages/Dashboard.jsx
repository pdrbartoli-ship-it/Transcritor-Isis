import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Layout from '../components/Layout'
import NewClientModal from '../components/NewClientModal'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    fetchClients()
  }, [])

  async function fetchClients() {
    const { data } = await supabase
      .from('clients')
      .select('*, sessions(count)')
      .order('created_at', { ascending: false })
    setClients(data || [])
    setLoading(false)
  }

  async function deleteClient(id, e) {
    e.stopPropagation()
    if (!confirm('Excluir este cliente e todas as suas sessões?')) return
    await supabase.from('clients').delete().eq('id', id)
    setClients(prev => prev.filter(c => c.id !== id))
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h2>Meus Clientes</h2>
          <p className="text-muted">Organize as sessões por cliente</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Novo Cliente
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <p>Nenhum cliente ainda</p>
          <p className="text-muted">Crie seu primeiro cliente para organizar as sessões.</p>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            Criar primeiro cliente
          </button>
        </div>
      ) : (
        <div className="clients-grid">
          {clients.map(client => (
            <div key={client.id} className="client-card" onClick={() => navigate(`/clients/${client.id}`)}>
              <div className="client-card-top">
                <div className="avatar">{client.name.charAt(0).toUpperCase()}</div>
                <button className="btn-icon danger" onClick={e => deleteClient(client.id, e)} title="Excluir">✕</button>
              </div>
              <h3>{client.name}</h3>
              {client.description && <p className="text-muted text-sm">{client.description}</p>}
              <div className="client-meta">
                <span>{client.sessions?.[0]?.count ?? 0} sessões</span>
                <span>{new Date(client.created_at).toLocaleDateString('pt-BR')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <NewClientModal
          onClose={() => setShowModal(false)}
          onCreated={client => { setClients(prev => [{ ...client, sessions: [{ count: 0 }] }, ...prev]); setShowModal(false) }}
        />
      )}
    </Layout>
  )
}
