import { useNavigate } from 'react-router-dom'
import { IconChevron } from '../../components/Icons'
import { formatCapturedAt, formatDurationLabel, displayTitle } from '../../lib/conversas'

// Cabeçalho comum. Nas telas de detalhe o voltar leva à visão geral da própria
// conversa, não à home: sair do zoom não deveria custar o contexto inteiro. Na
// visão geral não há voltar próprio — sair dela é sair da conversa, e para isso
// já existem as setas da barra lateral.
export default function ConversaHeader({ conversation, backTo, backLabel, title, subtitle, action }) {
  const navigate = useNavigate()
  const duration = formatDurationLabel(conversation.duration_s)

  return (
    <>
      <div className="conversa-topbar">
        {backTo ? (
          <button className="back-link" onClick={() => navigate(backTo)}>
            <IconChevron width={14} height={14} style={{ transform: 'rotate(180deg)' }} /> {backLabel}
          </button>
        ) : <span />}
        {action}
      </div>
      <header className="conversa-head">
        <h1>{title || displayTitle(conversation)}</h1>
        <p className="text-muted text-sm">
          {subtitle || (
            <>{formatCapturedAt(conversation.created_at)}{duration && <> · {duration}</>}</>
          )}
        </p>
      </header>
    </>
  )
}
