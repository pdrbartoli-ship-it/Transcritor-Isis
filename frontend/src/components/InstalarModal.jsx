import { useEffect } from 'react'
import { IconDownload, IconClose, IconArrowRight } from './Icons'
import { aparelhoDoVisitante, abrirLojaWindows, usePwaPrompt } from '../lib/instalar'

// "Instalar grátis" levava direto para o login — quem clicava querendo o app
// acabava na versão do navegador sem nunca ver que existe um instalador.
// Aqui o botão faz o que promete: entrega o app do aparelho de quem clicou, e
// deixa "usar no navegador" como a saída secundária que ele sempre foi.
//
// No Windows este modal não abre: lá o "Instalar grátis" já baixa o instalador
// e mostra o guia de tela cheia (InstalarWindows). Aqui ficam os aparelhos em
// que o Dito se instala pelo navegador.
export default function InstalarModal({ onClose, onUsarNavegador }) {
  const aparelho = aparelhoDoVisitante()
  const { podeInstalarPwa, instalarPwa } = usePwaPrompt()

  useEffect(() => {
    const porTecla = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', porTecla)
    return () => window.removeEventListener('keydown', porTecla)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal instalar-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Instalar o Dito">
        <div className="modal-header">
          <h3>Instalar o Dito</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
            <IconClose width={16} height={16} />
          </button>
        </div>

        {podeInstalarPwa && (
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
            <button className="btn-ghost instalar-btn" onClick={abrirLojaWindows}>
              <IconDownload width={16} height={16} /> Ver o app de Windows na Store
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
