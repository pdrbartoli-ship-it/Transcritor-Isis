import { useEffect, useState } from 'react'
import { IconDownload, IconClose, IconCheck, IconArrowRight } from './Icons'
import { aparelhoDoVisitante, baixarInstaladorWindows, usePwaPrompt } from '../lib/instalar'

// "Instalar grátis" levava direto para o login — quem clicava querendo o app
// acabava na versão do navegador sem nunca ver que existe um instalador.
// Aqui o botão faz o que promete: entrega o app do aparelho de quem clicou, e
// deixa "usar no navegador" como a saída secundária que ele sempre foi.
export default function InstalarModal({ onClose, onUsarNavegador }) {
  const aparelho = aparelhoDoVisitante()
  const { podeInstalarPwa, instalarPwa } = usePwaPrompt()
  const [baixou, setBaixou] = useState(false)

  useEffect(() => {
    const porTecla = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', porTecla)
    return () => window.removeEventListener('keydown', porTecla)
  }, [onClose])

  // No Windows o download começa sozinho: a pessoa já disse que quer instalar,
  // e obrigá-la a um segundo clique só para confirmar o que pediu é atrito.
  useEffect(() => {
    if (aparelho !== 'windows') return
    baixarInstaladorWindows()
    setBaixou(true)
  }, [aparelho])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal instalar-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Instalar o Dito">
        <div className="modal-header">
          <h3>Instalar o Dito</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
            <IconClose width={16} height={16} />
          </button>
        </div>

        {aparelho === 'windows' && (
          <>
            {baixou && (
              <p className="instalar-ok">
                <IconCheck width={15} height={15} /> O download começou.
              </p>
            )}
            <p className="instalar-lead">
              É o app de Windows — o único que grava <strong>as duas vozes</strong> da chamada,
              com a janelinha flutuante por cima da reunião.
            </p>
            {/* Os passos são o conteúdo principal desta tela: o arquivo já está
                baixando, e o que falta a pessoa saber é o que fazer com ele. O
                aviso do Windows é o ponto onde se desiste da instalação, então
                ele vem descrito com as palavras exatas que vão aparecer — quem
                reconhece a tela não se assusta com ela. */}
            <ol className="instalar-passos">
              <li>Abra o <strong>Dito-setup.exe</strong> na sua pasta de downloads.</li>
              <li>
                Vai aparecer uma tela azul escrita <strong>“O Windows protegeu seu PC”</strong>.
                É o aviso padrão para todo programa novo, não é sinal de problema.
              </li>
              <li>
                Nela, clique em <strong>Mais informações</strong> e depois em{' '}
                <strong>Executar assim mesmo</strong>.
              </li>
              <li>Entre com seu e-mail e comece a gravar.</li>
            </ol>
            {/* Depois que o download já começou, um botão grande escrito
                "Baixar de novo" convida justamente ao clique errado: a pessoa
                acha que precisa baixar outra vez em vez de abrir o arquivo. Só
                quem percebeu que nada baixou procura por isto, e para esse caso
                um link basta. */}
            {baixou ? (
              <button type="button" className="instalar-refazer" onClick={baixarInstaladorWindows}>
                O download não começou? Baixar de novo
              </button>
            ) : (
              <button className="btn-primary instalar-btn" onClick={baixarInstaladorWindows}>
                <IconDownload width={16} height={16} /> Baixar para Windows
              </button>
            )}
          </>
        )}

        {aparelho !== 'windows' && podeInstalarPwa && (
          <>
            <p className="instalar-lead">
              O Dito se instala direto pelo navegador: vira um app com ícone próprio,
              sem passar por loja nenhuma.
            </p>
            <button className="btn-primary instalar-btn" onClick={instalarPwa}>
              <IconDownload width={16} height={16} /> Instalar o app
            </button>
          </>
        )}

        {aparelho === 'ios' && !podeInstalarPwa && (
          <>
            <p className="instalar-lead">
              No iPhone e no iPad o Dito se instala pelo próprio Safari, em dois toques:
            </p>
            <ol className="instalar-passos">
              <li>Toque no botão <strong>Compartilhar</strong> (o quadrado com a seta para cima).</li>
              <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
            </ol>
          </>
        )}

        {aparelho === 'android' && !podeInstalarPwa && (
          <>
            <p className="instalar-lead">
              No Android o Dito se instala pelo próprio navegador, sem loja:
            </p>
            <ol className="instalar-passos">
              <li>Toque no menu <strong>⋮</strong> do Chrome.</li>
              <li>Escolha <strong>Instalar app</strong> (ou "Adicionar à tela inicial").</li>
            </ol>
          </>
        )}

        {aparelho === 'outro' && !podeInstalarPwa && (
          <>
            <p className="instalar-lead">
              Neste computador o Dito se instala pelo próprio navegador: procure o ícone de
              instalar na barra de endereço, ou <strong>Menu → Instalar Dito</strong>.
            </p>
            {/* O instalador nativo só existe para Windows; oferecê-lo aqui é
                honesto porque muita gente lê a landing num aparelho e instala
                em outro. */}
            <button className="btn-ghost instalar-btn" onClick={baixarInstaladorWindows}>
              <IconDownload width={16} height={16} /> Baixar o app de Windows
            </button>
          </>
        )}

        <button className="instalar-web" onClick={onUsarNavegador}>
          Prefiro usar agora no navegador <IconArrowRight width={14} height={14} />
        </button>
      </div>
    </div>
  )
}
