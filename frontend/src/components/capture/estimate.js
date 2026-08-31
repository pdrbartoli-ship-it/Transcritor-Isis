// Estimativa de quanto uma captura vai demorar. Fica fora do componente porque
// não depende de plataforma: web e app usam exatamente os mesmos números.
//
// A conta antiga (8s + 12% da duração) tratava a transcrição como um processo
// sequencial — 1h de áudio "custava" 4x mais que 15min. Não é assim que o
// backend funciona: ele fatia em blocos de 15min e manda todos ao Whisper EM
// PARALELO (asyncio.gather), então uma gravação de 1h não demora ~4x mais que
// uma de 15min, demora quase o mesmo — só troca um bloco por cinco rodando
// juntos. Uma hora de áudio real estava estimando 7 minutos; o trabalho local
// medido (ffmpeg convertendo e fatiando 1h de áudio) leva ~38s.
//
// O modelo agora é: um piso quase fixo (upload + acordar o Render + 1 chamada
// ao Whisper + 1 chamada de análise ao Claude, que corre em passe único até
// ~3-4h de fala) + um termo pequeno e linear só para o que É sequencial no
// backend (o ffmpeg local) + um acréscimo leve por bloco de 15min além do
// primeiro, porque blocos extras ainda competem por rede/fila mesmo rodando
// em paralelo.
//
// Coeficientes calibráveis conforme o backend mudar de máquina/modelo — sem
// telemetria de tempo real ainda, então são estimativas informadas pelo
// código (ver backend/main.py: CHUNK_SECONDS, MAX_SINGLE_PASS_CHARS,
// INSIGHTS_EFFORT), não medidas em produção.
const CHUNK_SECONDS = 900         // mesmo tamanho de bloco do backend (main.py: CHUNK_SECONDS)
const BASE_OVERHEAD_S = 10        // upload + acordar o Render, se estiver hibernando
const FFMPEG_RATIO_AUDIO = 0.012  // conversão+fatiamento local — medido: ~38s para 1h de áudio
const FFMPEG_RATIO_VIDEO = 0.02   // vídeo soma a extração da faixa de áudio antes de converter
const TRANSCRIBE_BASE_S = 18      // o 1º bloco no Whisper — os demais rodam em paralelo, não somam
const PER_EXTRA_CHUNK_S = 5       // blocos além do 1º ainda disputam rede/fila entre si
const ANALYSIS_BASE_S = 25        // 1 chamada ao Claude, esforço baixo, passe único
const PER_MB_S = 1.5              // fallback quando não dá para ler a duração
const LINK_ESTIMATE_S = 60        // links não expõem a duração antes do download
const MIN_ESTIMATE_S = 15
const MAX_ESTIMATE_S = 420        // o paralelismo tira o sentido de um teto alto

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

  let seconds = BASE_OVERHEAD_S + TRANSCRIBE_BASE_S + ANALYSIS_BASE_S
  if (durationSec) {
    const ffmpegRatio = kind === 'video' ? FFMPEG_RATIO_VIDEO : FFMPEG_RATIO_AUDIO
    seconds += durationSec * ffmpegRatio
    const extraChunks = Math.max(0, Math.ceil(durationSec / CHUNK_SECONDS) - 1)
    seconds += extraChunks * PER_EXTRA_CHUNK_S
  } else {
    seconds += (bytes / 1_000_000) * PER_MB_S
  }
  return Math.round(Math.min(MAX_ESTIMATE_S, Math.max(MIN_ESTIMATE_S, seconds)))
}

export function formatTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${m}:${sec}`
}
