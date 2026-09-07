import { useEffect, useState } from 'react'
import { IconClose, IconCheck } from './Icons'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { criarCheckout } from '../lib/api'

// A mesma tabela da landing, dentro do app. Ela existe em dois lugares porque
// as duas decisões de compra acontecem em momentos diferentes: quem nunca usou
// escolhe na landing, quem já usa escolhe aqui, quando bate o limite. Mudou um
// preço ou um limite? Trocar nos dois — Landing.jsx tem a lista gêmea.
const PLANOS = [
  {
    id: 'gratuito',
    nome: 'Gratuito',
    precoMensal: 'R$ 0',
    itens: ['2 horas por mês', 'Resumo automático', 'Cifrado no seu aparelho'],
  },
  {
    id: 'iniciante',
    nome: 'Iniciante',
    precoMensal: 'R$ 14,99',
    precoAnual: 'R$ 135',
    destaque: true,
    itens: ['10 horas por mês', 'Documento pronto para baixar', 'App de Windows'],
  },
  {
    id: 'avancado',
    nome: 'Avançado',
    precoMensal: 'R$ 19,99',
    precoAnual: 'R$ 180',
    itens: ['33 horas por mês', 'Resumos mais profundos', 'Prioridade na fila'],
  },
]

export default function PlanModal({ onClose }) {
  const { user } = useAuth()
  const [ciclo, setCiclo] = useState('mensal')
  const [planoAtual, setPlanoAtual] = useState('gratuito')
  const [assinando, setAssinando] = useState(null) // id do plano em checkout
  const [erro, setErro] = useState('')

  // O plano ativo vem direto do Supabase — quem escreve ali é só o webhook do
  // Stripe, então esta leitura reflete a cobrança real, não uma intenção.
  useEffect(() => {
    if (!user) return
    supabase
      .from('subscriptions')
      .select('plano')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setPlanoAtual(data?.plano || 'gratuito'))
  }, [user])

  async function assinar(id) {
    setErro('')
    setAssinando(id)
    try {
      const { url } = await criarCheckout(id, ciclo)
      window.location.href = url
    } catch (err) {
      setErro(err.message || 'Não foi possível iniciar o pagamento. Tente de novo.')
      setAssinando(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Meu plano</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>

        <div className="planos-ciclo">
          <button type="button" className={ciclo === 'mensal' ? 'on' : ''} onClick={() => setCiclo('mensal')}>Mensal</button>
          <button type="button" className={ciclo === 'anual' ? 'on' : ''} onClick={() => setCiclo('anual')}>Anual</button>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}

        <div className="planos">
          {PLANOS.map(p => {
            const pago = p.id !== 'gratuito'
            const preco = pago && ciclo === 'anual' ? p.precoAnual : p.precoMensal
            const periodo = !pago ? 'para sempre' : ciclo === 'anual' ? 'por ano' : 'por mês'
            const ativo = planoAtual === p.id
            return (
              <div key={p.id} className={`plano${ativo ? ' on' : ''}${p.destaque ? ' destaque' : ''}`}>
                <span className="plano-nome">{p.nome}</span>
                <span className="plano-preco">{preco} <i>{periodo}</i></span>
                <ul>
                  {p.itens.map(i => <li key={i}><IconCheck width={12} height={12} /> {i}</li>)}
                </ul>
                {pago && (
                  <button
                    type="button"
                    className="btn-primary plano-btn"
                    disabled={ativo || assinando === p.id}
                    onClick={() => assinar(p.id)}
                  >
                    {ativo ? 'Plano atual' : assinando === p.id ? 'Abrindo pagamento…' : 'Assinar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
