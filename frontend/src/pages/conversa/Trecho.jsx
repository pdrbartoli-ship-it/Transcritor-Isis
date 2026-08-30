import { formatTimestamp, sliceSegments, groupBySpeaker, formatRange } from './shared'

// Um pedaço da transcrição, agrupado por quem fala. Sem os segmentos com tempo
// (conversas antigas, ou legendas de vídeo sem marcação) não há o que recortar
// — melhor dizer isso do que mostrar um bloco vazio.
export default function Trecho({ conversation, start, end, emptyLabel, showRange = true }) {
  const segments = sliceSegments(conversation.segments, start, end)
  if (!segments.length) {
    return <p className="text-muted text-sm">{emptyLabel || 'Sem transcrição para este intervalo.'}</p>
  }

  const blocks = groupBySpeaker(segments, conversation.insights?.speaker_turns)

  return (
    <div className="trecho">
      {showRange && <div className="trecho-range">{formatRange(start, end)}</div>}
      {blocks.map((b, i) => (
        <p key={i} className="fala">
          <span className="fala-head">
            <span className="fala-time">{formatTimestamp(b.start)}</span>
            {b.speaker && <span className="fala-speaker">{b.speaker}</span>}
          </span>
          {b.text}
        </p>
      ))}
    </div>
  )
}
