import { useState, useEffect, useRef } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { formatCapturedAt, formatDurationLabel, displayTitle, deleteConversation } from '../../lib/conversas'
import { IconFlag, IconMore, IconDownload, IconEdit, IconTrash } from '../../components/Icons'
import FeedbackModal from '../../components/FeedbackModal'
import { RenameModal, DeleteModal } from '../../components/ConversaMenu'
import { aoPedirAcoesDaConversa } from '../../lib/acoesDaConversa'
import { showToast } from '../../lib/toast'
import { usePlatform } from '../../lib/platform'
import { baixarTranscricao } from './BaixarTranscricao'

// Cabeçalho comum das telas de conversa. Sem link de voltar próprio: a
// navegação entre elas já é coberta pelas setas de histórico da barra
// lateral (e, no celular, pelo gesto de voltar).
//
// As ações da conversa moram num menu só: baixar, renomear, sinalizar e
// apagar. Antes "Sinalizar" e "Baixar a transcrição" eram duas pílulas no topo
// de cada tela, disputando atenção com o título. Todas as telas com texto da IA
// (visão geral, tópico, tarefas, timeline, chat) passam por aqui, então é o
// único lugar que precisa do "Sinalizar" exigido pelas lojas.
//
// No celular o menu abre pelo título no topo da tela, como no Claude, e a
// página não repete o título que o topo já mostra. `soNoComputador` esconde o
// cabeçalho inteiro no celular (o chat, onde a pergunta é o assunto).
export default function ConversaHeader({ conversation, title, subtitle, soNoComputador = false }) {
  const duration = formatDurationLabel(conversation.duration_s)
  const { refreshConversations, reloadConversation } = useOutletContext() || {}
  const navigate = useNavigate()
  const { isMobile } = usePlatform()

  const [menuAberto, setMenuAberto] = useState(false)
  const [reportando, setReportando] = useState(false)
  const [renomeando, setRenomeando] = useState(false)
  const [apagando, setApagando] = useState(false)

  // O título do topo (Layout) pede as opções por aqui.
  useEffect(() => aoPedirAcoesDaConversa(() => setMenuAberto(true)), [])

  async function confirmarApagar() {
    setApagando(false)
    try {
      await deleteConversation(conversation.id)
      showToast('Conversa apagada.')
      await refreshConversations?.()
      navigate('/', { replace: true })
    } catch (err) {
      showToast(err.message || 'Não foi possível apagar a conversa.')
    }
  }

  const acoes = [
    { id: 'baixar', Icone: IconDownload, rotulo: 'Baixar a transcrição', fazer: () => baixarTranscricao(conversation) },
    { id: 'renomear', Icone: IconEdit, rotulo: 'Mudar o nome', fazer: () => setRenomeando(true) },
    { id: 'sinalizar', Icone: IconFlag, rotulo: 'Sinalizar conteúdo da IA', fazer: () => setReportando(true) },
    { id: 'apagar', Icone: IconTrash, rotulo: 'Apagar', perigo: true, fazer: () => setApagando(true) },
  ]

  // O título da própria conversa já está no topo do celular; um título
  // diferente (o tópico, "Tarefas") continua na página.
  const tituloDaConversa = !title

  return (
    <>
      <div className="conversa-topbar">
        <MenuDeAcoes
          aberto={menuAberto}
          onAbrir={() => setMenuAberto(v => !v)}
          onFechar={() => setMenuAberto(false)}
          acoes={acoes}
          folha={isMobile}
        />
      </div>
      {!(soNoComputador && isMobile) && (
        <header className="conversa-head">
          <h1 className={tituloDaConversa ? 'titulo-da-conversa' : ''}>{title || displayTitle(conversation)}</h1>
          <p className="text-muted text-sm">
            {subtitle || (
              <>{formatCapturedAt(conversation.created_at)}{duration && <> · {duration}</>}</>
            )}
          </p>
        </header>
      )}
      {reportando && <FeedbackModal conversaId={conversation.id} onClose={() => setReportando(false)} />}
      {renomeando && (
        <RenameModal
          conversation={conversation}
          onClose={() => setRenomeando(false)}
          onSaved={() => { setRenomeando(false); refreshConversations?.(); reloadConversation?.() }}
        />
      )}
      {apagando && (
        <DeleteModal
          conversation={conversation}
          onClose={() => setApagando(false)}
          onConfirm={confirmarApagar}
        />
      )}
    </>
  )
}

// No computador, uma lista pendurada no botão "⋯"; no celular, uma folha que
// sobe de baixo, com alvos do tamanho do dedo.
function MenuDeAcoes({ aberto, onAbrir, onFechar, acoes, folha }) {
  const caixaRef = useRef(null)

  useEffect(() => {
    if (!aberto || folha) return
    const fora = e => { if (!caixaRef.current?.contains(e.target)) onFechar() }
    const tecla = e => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('keydown', tecla)
    }
  }, [aberto, folha, onFechar])

  function escolher(acao) {
    onFechar()
    acao.fazer()
  }

  const itens = acoes.map(acao => (
    <button
      key={acao.id}
      type="button"
      role="menuitem"
      className={`${folha ? 'conta-item' : 'ctx-item'} ${acao.perigo ? 'danger' : ''}`}
      onClick={() => escolher(acao)}
    >
      <acao.Icone width={folha ? 20 : 15} height={folha ? 20 : 15} /> {acao.rotulo}
    </button>
  ))

  return (
    <div className="acoes-conversa" ref={caixaRef}>
      <button
        type="button"
        className="btn-icon acoes-botao"
        onClick={onAbrir}
        aria-label="Opções da conversa"
        aria-haspopup="menu"
        aria-expanded={aberto}
      >
        <IconMore />
      </button>
      {aberto && !folha && <div className="ctx-menu acoes-lista" role="menu">{itens}</div>}
      {aberto && folha && (
        <div className="modal-overlay" onClick={onFechar}>
          <div className="modal conta-sheet" onClick={e => e.stopPropagation()} role="menu" aria-label="Opções da conversa">
            <div className="conta-lista">{itens}</div>
          </div>
        </div>
      )}
    </div>
  )
}
