import { useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { IconChevron } from '../../components/Icons'
import ConversaHeader from './ConversaHeader'
import Trecho from './Trecho'
import { formatRange } from './shared'

// A conversa seção por seção. Abrir uma mostra a transcrição daquele intervalo
// com os tempos e quem falou — o "resumo minuto a minuto" da tela anterior,
// sem o resumo pelo meio.
export default function Timeline() {
  const { conversation } = useOutletContext()
  const location = useLocation()
  const [open, setOpen] = useState(location.state?.focus ?? 0)

  const chapters = conversation.insights?.chapters || []

  return (
    <div className="conversa">
      <ConversaHeader
        conversation={conversation}
        title="Resumo minuto a minuto"
        subtitle={chapters.length === 1 ? '1 intervalo' : `${chapters.length} intervalos`}
      />

      {chapters.length === 0 ? (
        <p className="text-muted">Esta conversa não foi dividida em intervalos.</p>
      ) : (
        <ul className="chapter-full">
          {chapters.map((c, i) => (
            <li key={i}>
              <div
                className={`chapter-row ${open === i ? 'open' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === i ? null : i) }
                }}
              >
                <span className="chapter-main">
                  <span className="chapter-time">{formatRange(c.start, c.end)}</span>
                  <span className="chapter-title">{c.title}</span>
                </span>
                <IconChevron className={`todo-caret ${open === i ? 'open' : ''}`} width={16} height={16} />
              </div>
              {open === i && (
                <div className="chapter-detail">
                  <ul className="bullet-list">
                    {(c.bullets || []).map((b, k) => <li key={k}>{b}</li>)}
                  </ul>
                  <div className="detail-sep">Transcrição do intervalo</div>
                  <Trecho conversation={conversation} start={c.start} end={c.end} showRange={false} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
