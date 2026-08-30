import { IconClose } from './Icons'

// Placeholder. O botão existe para o usuário saber que planos vão existir e
// para nós vermos quantos clicam antes de haver o que vender.
export default function PlanModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Meu plano</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>
        <p className="text-muted">
          Enquanto o Dito está em construção, tudo que você grava e transcreve é gratuito
          e sem limite. Em breve esta tela vai mostrar seu plano e seu consumo.
        </p>
        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>Entendi</button>
        </div>
      </div>
    </div>
  )
}
