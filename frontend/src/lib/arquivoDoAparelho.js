import { Capacitor } from '@capacitor/core'
import { platformName } from './platform'

// Lê um arquivo que mora no aparelho (a gravação do gravador nativo, o áudio
// que chegou compartilhado de outro app) e devolve o Blob que o resto do app
// já sabe enviar.
//
// No iPhone o pedido leva "Range: bytes=0-" de propósito. Sem ele, o
// Capacitor responde áudio e vídeo (.aac, .m4a, .mp3, .mp4...) com uma
// resposta sem código HTTP, que o fetch entrega com status 0 e `ok` falso: era
// o "Não foi possível abrir a gravação" de toda gravação feita no iPhone. Com
// o Range, a resposta é um 206 de verdade com o arquivo inteiro. No Android o
// Range fica de fora: lá a leitura sempre funcionou, e o atendimento de Range
// do Capacitor é mais frágil.
export async function lerArquivoDoAparelho(caminho, tipo) {
  const opcoes = platformName() === 'ios' ? { headers: { Range: 'bytes=0-' } } : undefined
  const resposta = await fetch(Capacitor.convertFileSrc(caminho), opcoes)
  // O status 0 passa: é a resposta sem código HTTP descrita acima, e o que
  // decide se deu certo é ter vindo arquivo.
  if (!resposta.ok && resposta.status !== 0) throw new Error(`Leitura recusada (${resposta.status}).`)
  const dados = await resposta.arrayBuffer()
  if (!dados.byteLength) throw new Error('O arquivo veio vazio.')
  return new Blob([dados], { type: tipo || resposta.headers.get('content-type') || '' })
}
