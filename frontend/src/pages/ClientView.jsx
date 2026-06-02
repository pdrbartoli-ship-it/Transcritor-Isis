import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Layout from '../components/Layout'
import TranscribeInput from '../components/TranscribeInput'

export default function ClientView() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [client, setClient] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [clientId])

  async function fetchData() {
    const [{ data: clientData }, { data: sessionsData }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('sessions').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    ])
    setClient(clientData)
    setSessions(sessionsData || [])
    setLoading(false)
  }

  async function handleNewSession(result, sourceType, sourceName) {
    const title = sourceName || `Sessão ${new Date().toLocaleDateString('pt-BR')}`
    const { data, error } = await supabase.from('sessions').insert({
      client_id: clientId,
      user_id: user.id,
      title,
      source_type: sourceType,
      transcript: result.transcript,
      summary: result.summary,
    }).select().single()

    if (!error && data) {
      navigate(`/clients/${clientId}/sessions/${data.id}`)
    }
  }

  async function deleteSession(id, e) {
    e.stopPropagation()
    if (!confirm('Excluir esta sessão?')) return
    await supabase.from('sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  if (loading) return <Layout><div className="empty-state"><div className="spinner" /></div></Layout>

  return (
    <Layout>
      <div className="page-header">
        <div className="page-header-left">
          <button className="btn-back" onClick={() => navigate('/')}>← Voltar</button>
          <div className="avatar">{client?.name?.charAt(0).toUpperCase()}</div>
          <h2>{client?.name}</h2>
        </div>
      </div>

      <TranscribeInput onResult={handleNewSession} />

      <div className="sessions-section">
        <h3>Sessões ({sessions.length})</h3>

        {sessions.length === 0 ? (
          <div className="empty-state small">
            <p className="text-muted">Nenhuma sessão ainda. Envie um arquivo ou link acima para começar.</p>
          </div>
        ) : (
          <div className="sessions-list">
            {sessions.map(session => (
              <div
                key={session.id}
                className="session-card"
                onClick={() => navigate(`/clients/${clientId}/sessions/${session.id}`)}
              >
                <div className="session-card-header">
                  <div>
                    <h4>{session.title}</h4>
                    <span className="text-muted text-sm">
                      {new Date(session.created_at).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: 'long', year: 'numeric',
                      })}
                    </span>
                  </div>
                  <button className="btn-icon danger" onClick={e => deleteSession(session.id, e)}>✕</button>
                </div>
                {session.summary && (
                  <p className="session-preview text-muted text-sm">
                    {session.summary.replace(/[#*_]/g, '').slice(0, 140)}...
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
