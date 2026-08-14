// Estimativa de quanto uma captura vai demorar. Fica fora do componente porque
// não depende de plataforma: web e app usam exatamente os mesmos números.
//
// Coeficientes calibráveis conforme o backend mudar de máquina/modelo. O
// backend só devolve a duração real depois de processar, então a estimativa é
// calculada aqui, antes do envio.
const BASE_OVERHEAD_S = 8      // rede + cold start do Render
const AUDIO_RATIO = 0.12       // fração da duração gasta transcrevendo áudio
const VIDEO_RATIO = 0.20       // vídeo custa a mais a extração da faixa de áudio
const PER_MB_S = 1.5           // fallback quando não dá para ler a duração
const LINK_ESTIMATE_S = 60     // links não expõem a duração antes do download
const MIN_ESTIMATE_S = 15
const MAX_ESTIMATE_S = 900

// O ffmpeg do backend converte qualquer coisa com faixa de áudio, então o
// filtro do seletor é deliberadamente amplo. As extensões vão junto dos tipos
// MIME porque o Android costuma esconder arquivos (áudio do WhatsApp em .opus,
// .ogg ou até .mp4) quando o accept é restritivo demais.
export const ACCEPTED_FILES = [
  'audio/*', 'video/*',
  '.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg', '.oga', '.opus', '.amr', '.wma',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.m4v',
].join(',')

// Lê a duração de um arquivo de mídia sem enviá-lo. Resolve null se o browser
// não conseguir decodificar os metadados.
export function readMediaDuration(file) {
  return new Promise(resolve => {
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    const url = URL.createObjectURL(file)
    let done = false
    const finish = value => {
      if (done) return
      done = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(value) && value > 0 ? value : null)
    }
    // Ler só os metadados é rápido; o teto evita travar a UI num arquivo que o
    // browser não decodifica (a estimativa então cai no tamanho em MB).
    const timer = setTimeout(() => finish(null), 2500)
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(el.duration)
    el.onerror = () => finish(null)
    el.src = url
  })
}

export function estimateSeconds({ kind, durationSec = null, bytes = 0 }) {
  if (kind === 'link') return LINK_ESTIMATE_S
  let seconds = BASE_OVERHEAD_S
  if (durationSec) seconds += durationSec * (kind === 'video' ? VIDEO_RATIO : AUDIO_RATIO)
  else seconds += (bytes / 1_000_000) * PER_MB_S
  return Math.round(Math.min(MAX_ESTIMATE_S, Math.max(MIN_ESTIMATE_S, seconds)))
}

export function formatTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${m}:${sec}`
}
