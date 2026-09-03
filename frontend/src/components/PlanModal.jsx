import { useState } from 'react'
import { IconClose, IconCheck } from './Icons'

// A mesma tabela da landing, dentro do app. Ela existe em dois lugares porque
// as duas decisões de compra acontecem em momentos diferentes: quem nunca usou
// escolhe na landing, quem já usa escolhe aqui, quando bate o limite. Mudou um
// preço ou um limite? Trocar nos dois — Landing.jsx tem a lista gêmea.
const PLANOS = [
  {
    id: 'gratuito',
    nome: 'Gratuito',
    preco: 'R$ 0',
    periodo: 'para sempre',
    itens: ['2 horas por mês', 'Resumo automático', 'Cifrado no seu aparelho'],
  },
  {
    id: 'plus',
    nome: 'Plus',
    preco: 'R$ 39',
    periodo: 'por mês',
    destaque: true,
    itens: ['20 horas por mês', 'Documento pronto para baixar', 'App de Windows'],
  },
  {
    id: 'ultra',
    nome: 'Ultra',
    preco: 'R$ 89',
    periodo: 'por mês',
    itens: ['Sem limite de horas', 'Resumos mais profundos', 'Prioridade na fila'],
  },
]

export default function PlanModal({ onClose }) {
  // O plano clicado na landing chega até aqui: quem escolheu Plus antes de
  // criar a conta reencontra o Plus marcado, sem ter que decidir de novo.
  const [escolhido, setEscolhido] = useState(() => {
    try { return localStorage.getItem('dito-plano-escolhido') || 'gratuito' } catch { return 'gratuito' }
  })

  // Ainda não há cobrança: o clique só registra a intenção, para sabermos
  // quantos escolheriam cada plano antes de existir checkout de verdade.
  function escolher(id) {
    setEscolhido(id)
    try { localStorage.setItem('dito-plano-escolhido', id) } catch { /* modo anônimo */ }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Meu plano</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>

        <p className="text-muted">
          Enquanto o Dito está em construção, tudo que você grava e transcreve é gratuito e
          sem limite. Escolha o plano que faria sentido para você — é assim que decidimos os
          limites antes de cobrar qualquer coisa.
        </p>

        <div className="planos">
          {PLANOS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`plano${escolhido === p.id ? ' on' : ''}${p.destaque ? ' destaque' : ''}`}
              onClick={() => escolher(p.id)}
              aria-pressed={escolhido === p.id}
            >
              <span className="plano-nome">{p.nome}</span>
              <span className="plano-preco">{p.preco} <i>{p.periodo}</i></span>
              <ul>
                {p.itens.map(i => <li key={i}><IconCheck width={12} height={12} /> {i}</li>)}
              </ul>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>Entendi</button>
        </div>
      </div>
    </div>
  )
}
