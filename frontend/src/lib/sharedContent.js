import { registerPlugin, Capacitor } from '@capacitor/core'
import { isNative } from './platform'

const SharedContent = registerPlugin('SharedContent')

// O YouTube compartilha título e link juntos ("Vídeo tal\nhttps://youtu.be/x"),
// e o WhatsApp às vezes acrescenta texto. Só a URL interessa ao /process-url.
function extractUrl(text) {
  const match = String(text || '').match(/https?:\/\/\S+/)
  return match ? match[0] : null
}

function normalize(shared) {
  if (!shared?.type) return null
  if (shared.type === 'text') {
    const url = extractUrl(shared.value)
    return url ? { kind: 'url', url } : null
  }
  if (shared.type === 'file' && shared.path) {
    return { kind: 'file', path: shared.path, name: shared.name || 'audio-compartilhado' }
  }
  return null
}

// No navegador não há compartilhamento nativo, mas dá para exercitar o mesmo
// caminho com ?compartilhado=<url> — é assim que o fluxo é testado sem
// depender de um aparelho Android.
function fromQueryString() {
  try {
    const url = new URLSearchParams(window.location.search).get('compartilhado')
    return url ? { kind: 'url', url } : null
  } catch {
    return null
  }
}

export async function consumeSharedContent() {
  if (!isNative()) return fromQueryString()
  try {
    return normalize(await SharedContent.consume())
  } catch {
    return null
  }
}

// Dispara quando um compartilhamento chega com o app já aberto.
export function onSharedContent(callback) {
  if (!isNative()) return () => {}
  const handle = SharedContent.addListener('sharedContent', shared => {
    const normalized = normalize(shared)
    if (normalized) callback(normalized)
  })
  return () => { handle.then(h => h.remove()).catch(() => {}) }
}

// O arquivo foi copiado para o cache do app pelo lado nativo; convertFileSrc dá
// uma URL que a WebView consegue ler, e daí ele vira um File comum — o mesmo
// que o seletor de arquivos produz, para reusar todo o fluxo de captura.
export async function sharedFileToFile({ path, name }) {
  const response = await fetch(Capacitor.convertFileSrc(path))
  if (!response.ok) throw new Error('Não foi possível ler o arquivo compartilhado.')
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type || '' })
}
