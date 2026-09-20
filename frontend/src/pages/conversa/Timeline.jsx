import { useState, useEffect, useRef } from 'react'
import { useLocation, useOutletContext, useSearchParams } from 'react-router-dom'
import { IconChevron } from '../../components/Icons'
import ConversaHeader from './ConversaHeader'
import Trecho from './Trecho'
import { formatRange, formatTimestamp } from './shared'

// A conversa seção por seção. Abrir uma mostra a transcrição daquele intervalo
// com os tempos e quem falou — o "resumo minuto a minuto" da tela anterior,
// sem o resumo pelo meio.
//
// `?t=932` abre direto no minuto. É o endereço que as citações do "Perguntar
// ao acervo" usam, e por isso ele mora na URL e não no state do roteador: um
// chip que some ao recarregar a página não é uma fonte, é uma dica.
export default function Timeline() {
  const { conversation } = useOutletContext()
  const location = useLocation()
  const [params] = useSearchParams()

  const chapters = conversation.insights?.chapters || []
  const segundo = params.has('t') ? Number(params.get('t')) : null
  const valido = segundo !== null && Number.isFinite(segundo) && segundo >= 0

  const doMinuto = valido ? chapters.findIndex(c => c.end > segundo) : -1
  const [open, setOpen] = useState(doMinuto >= 0 ? doMinuto : (location.state?.focus ?? 0))
  const alvoRef = useRef(null)

  // Chegar por uma citação e ter de procurar o intervalo na tela seria perder
  // o que o chip prometeu.
  useEffect(() => {
    if (doMinuto >= 0) alvoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [doMinuto])

  // Conversa sem capítulos (legenda de vídeo sem marcação, captura antiga):
  // a citação continua sabendo o minuto, então mostramos a transcrição em
  // volta dele em vez de dizer que não há nada aqui.
  if (!chapters.length && valido) {
    return (
      <div className="conversa">
        <ConversaHeader
          conversation={conversation}
          title="Trecho citado"
          subtitle={`A partir de ${formatTimestamp(segundo)}`}
        />
        <Trecho conversation={conversation} start={Math.max(0, segundo - 30)} end={segundo + 150} />
      </div>
    )
  }

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
            <li key={i} ref={i === doMinuto ? alvoRef : null}>
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
