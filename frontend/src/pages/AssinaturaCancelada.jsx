import { useNavigate } from 'react-router-dom'

export default function AssinaturaCancelada() {
  const navigate = useNavigate()
  return (
    <div className="auth-page">
      <div className="auth-card auth-created">
        <h3>Pagamento não concluído</h3>
        <p className="text-muted">Nada foi cobrado. Você pode tentar assinar de novo quando quiser.</p>
        <button className="btn-primary btn-full" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
          Voltar para o Dito
        </button>
      </div>
    </div>
  )
}
