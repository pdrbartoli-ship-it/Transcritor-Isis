// Ajudas de mídia que não dependem de plataforma: o que o seletor de arquivos
// aceita, quanto tempo tem o arquivo escolhido e como escrever uma duração.
//
// Aqui morava também a estimativa de quanto uma captura ia demorar, que
// alimentava um contador regressivo na tela de processamento. A tela deixou de
// mostrar tempo: a estimativa era um palpite sobre uma fila que não medimos, e
// um relógio errado corrói mais confiança do que relógio nenhum compra.

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
    // browser não decodifica (aí a recomendação de modo cai na origem).
    const timer = setTimeout(() => finish(null), 2500)
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(el.duration)
    el.onerror = () => finish(null)
    el.src = url
  })
}

export function formatTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${m}:${sec}`
}
