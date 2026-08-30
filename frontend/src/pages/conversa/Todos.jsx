import { useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { IconChevron } from '../../components/Icons'
import { displayTitle } from '../../lib/conversas'
import ConversaHeader from './ConversaHeader'
import Trecho from './Trecho'

// Lista completa de ações. Cada item abre no lugar, mostrando o trecho em que
// foi combinada — é o que responde "quem decidiu isso, e quando?" sem obrigar a
// reler a conversa inteira.
export default function Todos() {
  const { conversation } = useOutletContext()
  const location = useLocation()
  const [open, setOpen] = useState(location.state?.focus ?? null)

  const todos = conversation.insights?.todos || []

  return (
    <div className="conversa">
      <ConversaHeader
        conversation={conversation}
        backTo=".."
        backLabel={displayTitle(conversation)}
        title="Lista de to do's"
        subtitle={todos.length === 1 ? '1 ação combinada' : `${todos.length} ações combinadas`}
      />

      {todos.length === 0 ? (
        <p className="text-muted">Nenhuma ação ficou combinada nesta conversa.</p>
      ) : (
        <ul className="todo-full">
          {todos.map((t, i) => (
            <li key={i}>
              <div
                className={`todo-row ${open === i ? 'open' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === i ? null : i) }
                }}
              >
                <span className="todo-check" aria-hidden="true">—</span>
                <span className="todo-main">
                  <span className="todo-task">{i + 1}. {t.task}</span>
                  {t.description && <span className="todo-desc">{t.description}</span>}
                  <span className="todo-meta">
                    <b>Responsáveis:</b> {t.owners?.length ? t.owners.join(', ') : 'não definido'}
                    {' · '}
                    <b>Prazo:</b> {t.due || 'não definido'}
                  </span>
                </span>
                <IconChevron className={`todo-caret ${open === i ? 'open' : ''}`} width={16} height={16} />
              </div>
              {open === i && (
                <div className="todo-detail">
                  <Trecho
                    conversation={conversation}
                    start={t.time_ref?.[0] ?? 0}
                    end={t.time_ref?.[1] ?? 0}
                    emptyLabel="Não localizamos o momento exato em que esta ação foi combinada."
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
