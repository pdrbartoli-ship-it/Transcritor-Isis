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
            <ol className="instalar-passos">
              <li>Abra o <strong>Dito-setup.exe</strong> na sua pasta de downloads.</li>
              <li>O Windows pode avisar que o programa é de fora da loja — clique em <strong>Mais informações → Executar assim mesmo</strong>.</li>
              <li>Entre com seu e-mail e comece a gravar.</li>
            </ol>
            <button className="btn-primary instalar-btn" onClick={baixarInstaladorWindows}>
              <IconDownload width={16} height={16} />
              {baixou ? 'Baixar de novo' : 'Baixar para Windows'}
            </button>
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
