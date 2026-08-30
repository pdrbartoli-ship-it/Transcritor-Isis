import { useNavigate } from 'react-router-dom'
import { IconChevron } from '../../components/Icons'
import { formatCapturedAt, formatDurationLabel } from '../../lib/conversas'

// Cabeçalho comum. Nas telas de detalhe o voltar leva à visão geral da própria
// conversa, não à home: sair do zoom não deveria custar o contexto inteiro.
export default function ConversaHeader({ conversation, backTo, backLabel, title, subtitle }) {
  const navigate = useNavigate()
  const duration = formatDurationLabel(conversation.duration_s)

  return (
    <>
      <button className="back-link" onClick={() => navigate(backTo)}>
        <IconChevron width={14} height={14} style={{ transform: 'rotate(180deg)' }} /> {backLabel}
      </button>
      <header className="conversa-head">
        <h1>{title || conversation.title}</h1>
        <p className="text-muted text-sm">
          {subtitle || (
            <>{formatCapturedAt(conversation.created_at)}{duration && <> · {duration}</>}</>
          )}
        </p>
      </header>
    </>
  )
}
