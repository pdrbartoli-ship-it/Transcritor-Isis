import { IconClose, IconMessage } from './Icons'

// Aviso único, no primeiro acesso: deixa claro que o Dito ainda está em teste e
// convida a pessoa a mandar críticas e ideias. O objetivo é aumentar o volume
// de feedback enquanto o app está em teste fechado, então o caminho para o
// "Fale com a gente" está aqui dentro, e não só no menu.
export default function WelcomeModal({ onClose, onOpenFeedback }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal welcome-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Que bom ter você aqui 👋</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>

        <p className="welcome-lead">
          O Dito está em fase de testes. Isso quer dizer que algumas coisas ainda vão mudar de
          lugar, e uma ou outra pode falhar — se acontecer, não é você.
        </p>

        <p className="welcome-lead">
          É justamente por isso que a sua opinião pesa tanto agora: o que você achar confuso,
          lento ou faltando tem chance real de mudar o produto. Achou algo estranho? Sentiu falta
          de alguma coisa? Não gostou de como ficou? Queremos ouvir — inclusive as críticas duras.
        </p>

        <p className="welcome-lead">
          É só usar o <strong>Fale com a gente</strong>, no menu lateral. Leva alguns segundos e
          a gente lê tudo.
        </p>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onOpenFeedback}>
            <IconMessage width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Mandar um comentário
          </button>
          <button className="btn-primary" onClick={onClose}>Começar a usar</button>
        </div>
      </div>
    </div>
  )
}
