import { IconDownload } from '../../components/Icons'
import { track } from '../../lib/analytics'
import { showToast } from '../../lib/toast'
import { buildTranscriptFile, downloadOrShareText, safeFilename } from './shared'

// O botão de levar a transcrição embora. Mora aqui, e não dentro da visão
// geral, porque toda conversa tem transcrição — inclusive a simples, que abre
// direto no chat e nunca passa pela visão geral. Quem transcreveu em modo
// simples também quer o arquivo.
export default function BaixarTranscricao({ conversation }) {
  async function baixar() {
    track('download_transcricao')
    const filename = safeFilename(conversation.title)
    const result = await downloadOrShareText(filename, buildTranscriptFile(conversation))
    if (result === 'shared') {
      showToast('Transcrição compartilhada')
    } else if (result === 'downloaded') {
      showToast(`Transcrição baixada · ${filename}`)
    }
  }

  return (
    <button className="btn-ghost btn-sm btn-download" onClick={baixar}>
      <IconDownload width={15} height={15} /> Baixar a transcrição
    </button>
  )
}
