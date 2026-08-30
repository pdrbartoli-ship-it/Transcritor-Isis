// Peças comuns das quatro telas da conversa. Tudo aqui é derivado do que a
// captura já gravou (`segments` + `insights`): nenhuma tela de detalhe chama a
// IA de novo, então abrir um tópico, uma tarefa ou um intervalo é instantâneo
// e não custa nada.

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatRange(start, end) {
  return `${formatTimestamp(start)} – ${formatTimestamp(end)}`
}

// Trechos que tocam o intervalo. Uma fala que começa antes do corte e termina
// dentro dele conta: recortar exatamente pelo relógio cortaria frases no meio.
export function sliceSegments(segments, start, end) {
  return (segments || []).filter(s => s.end > start && s.start < end)
}

// Quem estava falando num dado instante. As marcas de troca são esparsas — uma
// por mudança de voz — então o dono de uma fala é a última marca antes dela.
export function speakerAt(turns, seconds) {
  if (!turns?.length) return null
  let current = null
  for (const t of turns) {
    if (t.start > seconds + 0.5) break
    current = t.speaker
  }
  return current
}

// Falas agrupadas por quem fala, para a transcrição não virar uma lista de
// linhas soltas de dois segundos cada.
export function groupBySpeaker(segments, turns) {
  const blocks = []
  for (const seg of segments) {
    const speaker = speakerAt(turns, seg.start)
    const last = blocks[blocks.length - 1]
    if (last && last.speaker === speaker) {
      last.text += ` ${seg.text}`
      last.end = seg.end
    } else {
      blocks.push({ speaker, start: seg.start, end: seg.end, text: seg.text })
    }
  }
  return blocks
}

// Nomes de locutor são inferidos do que foi dito, não de diarização de áudio —
// o aviso só aparece quando há um nome que pode estar errado.
export function speakersAreUncertain(insights) {
  return (insights?.speakers || []).some(s => s.name && s.confidence !== 'alta')
}

// .txt montado no cliente a partir dos segmentos. Não precisa de servidor e sai
// com os tempos e os nomes que a tela mostra.
export function buildTranscriptFile(conversation) {
  const { title, created_at, segments, insights, transcript } = conversation
  const header = [title, new Date(created_at).toLocaleString('pt-BR'), '']

  if (!segments?.length) {
    return [...header, transcript || ''].join('\n')
  }

  const blocks = groupBySpeaker(segments, insights?.speaker_turns)
  const body = blocks.map(b =>
    `[${formatTimestamp(b.start)}] ${b.speaker ? `${b.speaker}: ` : ''}${b.text}`
  )
  return [...header, ...body, ''].join('\n')
}

export function downloadText(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Nome de arquivo seguro nos três sistemas, sem depender do título ser curto
// ou limpo.
export function safeFilename(title) {
  const base = (title || 'conversa').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60)
  return `${base || 'conversa'}.txt`
}
