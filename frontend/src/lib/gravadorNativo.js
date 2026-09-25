import { registerPlugin, Capacitor } from '@capacitor/core'
import { isNative } from './platform'

// O gravador nativo do celular (frontend/plugins/gravador): continua gravando
// com a tela travada ou em outro app, coisa que o microfone da página não faz.
//
// Existe só nas montagens de loja feitas depois dele. O site novo chega por
// atualização automática também aos apps antigos, e neles isto dá falso: a
// gravação volta ao microfone da página, como antes.
export const GravadorNativo = registerPlugin('GravadorNativo')

export const temGravadorNativo = () => isNative() && Capacitor.isPluginAvailable('GravadorNativo')

// O arquivo mora no aparelho; convertFileSrc dá um endereço que o WebView
// consegue ler, e dele sai o mesmo Blob que o gravador da página entregaria.
export async function lerGravacaoNativa({ caminho, mime }) {
  const resposta = await fetch(Capacitor.convertFileSrc(caminho))
  if (!resposta.ok) throw new Error('Não foi possível ler a gravação.')
  return new Blob([await resposta.arrayBuffer()], { type: mime || 'audio/aac' })
}
