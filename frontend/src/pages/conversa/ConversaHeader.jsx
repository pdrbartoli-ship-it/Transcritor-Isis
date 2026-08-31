import { formatCapturedAt, formatDurationLabel, displayTitle } from '../../lib/conversas'

// Cabeçalho comum das telas de conversa. Sem link de voltar próprio: a
// navegação entre elas já é coberta pelas setas de histórico da barra
// lateral, e repeti-lo aqui era o mesmo controle duas vezes.
export default function ConversaHeader({ conversation, title, subtitle, action }) {
  const duration = formatDurationLabel(conversation.duration_s)

  return (
    <>
      <div className="conversa-topbar">
        <span />
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
