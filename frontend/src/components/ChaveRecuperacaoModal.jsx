import { useState } from 'react'
import { downloadText } from '../pages/conversa/shared'
import { showToast } from '../lib/toast'
import { IconCheck, IconDownload, IconShield } from './Icons'

// Mostrada UMA vez, no primeiro login, e nunca mais. Não é teimosia de
// segurança: a chave não é guardada em lugar nenhum de onde possa ser lida de
// volta — só o cofre que ela abre. Se desse para mostrá-la de novo, nós
// conseguiríamos abrir o cofre, e a promessa inteira ("nem nós lemos") cairia.
//
// Sem botão de fechar e sem clicar fora para sair, de propósito: quem pular
// esta tela perde o acervo no primeiro reset de senha, e vai parecer culpa do
// Dito — porque, de certa forma, seria.
export default function ChaveRecuperacaoModal({ chave, onConfirmado }) {
  const [confirmacao, setConfirmacao] = useState('')
  const [copiou, setCopiou] = useState(false)

  // Digitar o último grupo de volta prova que a pessoa realmente olhou e
  // guardou. Uma caixinha de "li e concordo" seria clicada sem ler, e é
  // exatamente esse clique automático que custaria o acervo dela depois.
  const grupos = chave.split('-')
  const ultimo = grupos[grupos.length - 1]
  const confere = confirmacao.trim().toUpperCase() === ultimo

  async function copiar() {
    try {
      await navigator.clipboard.writeText(chave)
      setCopiou(true)
      showToast('Chave copiada')
    } catch {
      showToast('Não foi possível copiar — anote ou baixe o arquivo')
    }
  }

  function baixar() {
    downloadText('dito-chave-de-recuperacao.txt', [
      'CHAVE DE RECUPERAÇÃO DO DITO',
      '',
      chave,
      '',
      'Guarde este arquivo em lugar seguro.',
      '',
      'Para que serve: suas transcrições são guardadas cifradas, e nem o Dito',
      'consegue lê-las. Se você esquecer a senha, esta chave é a ÚNICA forma de',
      'recuperar o acesso ao seu conteúdo.',
      '',
      'Sem a senha e sem esta chave, suas conversas ficam perdidas para sempre —',
      'não existe suporte que consiga recuperá-las.',
      '',
      `Gerada em ${new Date().toLocaleString('pt-BR')}`,
    ].join('\n'))
    showToast('Arquivo da chave baixado')
  }

  return (
    <div className="modal-overlay chave-overlay">
      <div className="modal chave-modal">
        <div className="chave-cabeca">
          <span className="chave-escudo"><IconShield width={22} height={22} /></span>
          <h3>Guarde sua chave de recuperação</h3>
          <p className="text-muted text-sm">
            Suas conversas ficam cifradas — nem nós conseguimos lê-las. Se você esquecer
            a senha, <strong>esta chave é a única forma</strong> de recuperar seu conteúdo.
          </p>
        </div>

        <div className="chave-valor">{chave}</div>

        <div className="chave-acoes">
          <button className="btn-secondary" onClick={copiar}>
            {copiou ? <><IconCheck width={15} height={15} /> Copiada</> : 'Copiar'}
          </button>
          <button className="btn-secondary" onClick={baixar}>
            <IconDownload width={15} height={15} /> Baixar arquivo
          </button>
        </div>

        <div className="chave-aviso">
          Só mostramos esta chave agora. Perder a senha <strong>e</strong> a chave significa
          perder as conversas para sempre — não há suporte que resolva.
        </div>

        <label className="chave-confirma-label">
          Para confirmar que guardou, digite o último grupo (<strong>{ultimo}</strong>):
        </label>
        <input
          className="chave-confirma-input"
          value={confirmacao}
          onChange={e => setConfirmacao(e.target.value)}
          placeholder={ultimo}
          autoFocus
          maxLength={ultimo.length}
        />

        <button className="btn-primary btn-full" disabled={!confere} onClick={onConfirmado}>
          Guardei minha chave, continuar
        </button>
      </div>
    </div>
  )
}
