import { useState } from 'react'
import { formatCapturedAt, formatDurationLabel, displayTitle } from '../../lib/conversas'
import { IconFlag } from '../../components/Icons'
import FeedbackModal from '../../components/FeedbackModal'

// Cabeçalho comum das telas de conversa. Sem link de voltar próprio: a
// navegação entre elas já é coberta pelas setas de histórico da barra
// lateral, e repeti-lo aqui era o mesmo controle duas vezes.
// Todas as telas com texto da IA (visão geral, tópico, tarefas, timeline,
// chat) passam por aqui, então é o único lugar que precisa do botão de
// reportar conteúdo impróprio exigido pelas lojas.
export default function ConversaHeader({ conversation, title, subtitle, action }) {
  const duration = formatDurationLabel(conversation.duration_s)
  const [reportando, setReportando] = useState(false)

  return (
    <>
      <div className="conversa-topbar">
        <button className="btn-ghost btn-sm btn-reportar-ia" onClick={() => setReportando(true)}>
          <IconFlag width={14} height={14} /> <span>Sinalizar<span className="reportar-ia-extra"> conteúdo da IA</span></span>
        </button>
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
      {reportando && <FeedbackModal conversaId={conversation.id} onClose={() => setReportando(false)} />}
    </>
  )
}
