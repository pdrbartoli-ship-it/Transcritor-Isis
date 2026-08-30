import { useParams, useOutletContext } from 'react-router-dom'
import { displayTitle } from '../../lib/conversas'
import ConversaHeader from './ConversaHeader'
import Trecho from './Trecho'
import { formatRange, sliceSegments } from './shared'

// Zoom-in de um tópico. O texto do `detail` já veio pronto da captura e os
// trechos saem de fatiar os segmentos pelos tempos que o próprio modelo
// apontou — nenhuma chamada de IA acontece aqui.
export default function Topico() {
  const { i } = useParams()
  const { conversation } = useOutletContext()

  const topic = conversation.insights?.topics?.[Number(i)]
  if (!topic) {
    return (
      <div className="conversa">
        <ConversaHeader conversation={conversation} backTo=".." backLabel="Voltar à conversa" />
        <p className="text-muted">Este tópico não existe mais nesta conversa.</p>
      </div>
    )
  }

  const bullets = topic.detail
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)

  return (
    <div className="conversa">
      <ConversaHeader
        conversation={conversation}
        backTo=".."
        backLabel={displayTitle(conversation)}
        title={topic.label}
        subtitle={(topic.time_refs || []).map(([a, b]) => formatRange(a, b)).join('  ·  ')}
      />

      <section className="conversa-block">
        <ul className="bullet-list">{bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
      </section>

      <section className="conversa-block">
        <h2>O que foi dito</h2>
        {(topic.time_refs || []).map(([start, end], k) => (
          <Trecho
            key={k}
            conversation={conversation}
            start={start}
            end={end}
            emptyLabel="Não localizamos este trecho na transcrição."
          />
        ))}
        {!topic.time_refs?.length && (
          <p className="text-muted text-sm">Este tópico não ficou preso a um momento específico da conversa.</p>
        )}
      </section>
    </div>
  )
}
