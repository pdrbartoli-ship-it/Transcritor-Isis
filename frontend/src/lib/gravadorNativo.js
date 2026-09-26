import { registerPlugin, Capacitor } from '@capacitor/core'
import { isNative } from './platform'
import { lerArquivoDoAparelho } from './arquivoDoAparelho'

// O gravador nativo do celular (frontend/plugins/gravador): continua gravando
// com a tela travada ou em outro app, coisa que o microfone da página não faz.
//
// Existe só nas montagens de loja feitas depois dele. O site novo chega por
// atualização automática também aos apps antigos, e neles isto dá falso: a
// gravação volta ao microfone da página, como antes.
export const GravadorNativo = registerPlugin('GravadorNativo')

export const temGravadorNativo = () => isNative() && Capacitor.isPluginAvailable('GravadorNativo')

// O arquivo mora no aparelho; dele sai o mesmo Blob que o gravador da página
// entregaria.
export const lerGravacaoNativa = ({ caminho, mime }) => lerArquivoNativo(caminho, mime || 'audio/aac')

// Lê um arquivo do aparelho pelo endereço dele no WebView e, se isso falhar,
// pelo próprio plugin, aos pedaços. A reserva só existe no iPhone montado a
// partir de 26/09/2026; nos outros o pedido é recusado e vale o erro da
// primeira tentativa.
export async function lerArquivoNativo(caminho, tipo) {
  try {
    return await lerArquivoDoAparelho(caminho, tipo)
  } catch (erro) {
    try {
      return await lerPelaPonte(caminho, tipo)
    } catch {
      throw erro
    }
  }
}

const PEDACO = 512 * 1024

async function lerPelaPonte(caminho, tipo) {
  const partes = []
  let inicio = 0
  let total = Infinity
  while (inicio < total) {
    const r = await GravadorNativo.ler({ caminho, inicio, tamanho: PEDACO })
    total = r.total
    const bin = atob(r.dados || '')
    if (!bin.length) break
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    partes.push(bytes)
    inicio += bytes.length
  }
  if (!inicio) throw new Error('O arquivo veio vazio.')
  return new Blob(partes, { type: tipo || '' })
}
