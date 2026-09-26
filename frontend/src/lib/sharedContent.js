import { registerPlugin, Capacitor } from '@capacitor/core'
import { isNative } from './platform'
import { lerArquivoNativo } from './gravadorNativo'

const SharedContent = registerPlugin('SharedContent')

// O plugin existe no Android e, desde a montagem de 26/09/2026, no iPhone
// (que recebe pela extensão de compartilhar). Nas montagens antigas de
// iPhone ele não existe, e ouvir por ele gerava um erro de "plugin não
// implementado" a cada abertura do app.
const temPlugin = () => isNative() && Capacitor.isPluginAvailable('SharedContent')

// O Dito aparece no "Compartilhar" dos outros apps neste aparelho.
export const recebeCompartilhado = temPlugin

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
  if (!temPlugin()) return null
  try {
    return normalize(await SharedContent.consume())
  } catch {
    return null
  }
}

// Dispara quando um compartilhamento chega com o app já aberto.
export function onSharedContent(callback) {
  if (!temPlugin()) return () => {}
  const handle = SharedContent.addListener('sharedContent', shared => {
    const normalized = normalize(shared)
    if (normalized) callback(normalized)
  })
  return () => { handle.then(h => h.remove()).catch(() => {}) }
}

// O arquivo foi copiado para dentro do app pelo lado nativo, e daqui ele vira
// um File comum, o mesmo que o seletor de arquivos produz, para reusar todo o
// fluxo de captura.
export async function sharedFileToFile({ path, name }) {
  const blob = await lerArquivoNativo(path)
  return new File([blob], name, { type: blob.type || '' })
}
