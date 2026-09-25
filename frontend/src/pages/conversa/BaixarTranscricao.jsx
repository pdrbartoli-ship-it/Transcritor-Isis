import { track } from '../../lib/analytics'
import { showToast } from '../../lib/toast'
import { buildTranscriptFile, downloadOrShareText, safeFilename } from './shared'

// Levar a transcrição embora. Mora aqui, e não dentro da visão geral, porque
// toda conversa tem transcrição — inclusive a simples, que abre direto no chat
// e nunca passa pela visão geral. Quem transcreveu em modo simples também quer
// o arquivo.
//
// Era um botão de pílula no topo de cada tela; agora é uma das opções da
// conversa (ConversaHeader), junto de renomear, sinalizar e apagar.
export async function baixarTranscricao(conversation) {
  track('download_transcricao')
  const filename = safeFilename(conversation.title)
  const result = await downloadOrShareText(filename, buildTranscriptFile(conversation))
  if (result === 'shared') {
    showToast('Transcrição compartilhada')
  } else if (result === 'downloaded') {
    showToast(`Transcrição baixada · ${filename}`)
  }
}
