import { useEffect, useState } from 'react'
import { IconDownload, IconClose, IconCheck, IconArrowRight } from './Icons'
import { aparelhoDoVisitante, abrirLojaWindows, baixarInstaladorWindows, usePwaPrompt } from '../lib/instalar'

// "Instalar grátis" levava direto para o login — quem clicava querendo o app
// acabava na versão do navegador sem nunca ver que existe um instalador.
// Aqui o botão faz o que promete: entrega o app do aparelho de quem clicou, e
// deixa "usar no navegador" como a saída secundária que ele sempre foi.
export default function InstalarModal({ onClose, onUsarNavegador }) {
  const aparelho = aparelhoDoVisitante()
  const { podeInstalarPwa, instalarPwa } = usePwaPrompt()
  const [abriuLoja, setAbriuLoja] = useState(false)

  useEffect(() => {
    const porTecla = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', porTecla)
    return () => window.removeEventListener('keydown', porTecla)
  }, [onClose])

  // Antes o .exe começava a baixar sozinho ao abrir esta tela. Com a Store não
  // dá — abrir uma aba fora de um clique é exatamente o que o bloqueador de
  // pop-up existe para impedir, e a pessoa ficaria olhando para uma tela que
  // diz que algo aconteceu sem nada ter acontecido. Um clique, então.
  function irParaLoja() {
    abrirLojaWindows()
    setAbriuLoja(true)
  }

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
            {abriuLoja && (
              <p className="instalar-ok">
                <IconCheck width={15} height={15} /> A Microsoft Store abriu numa aba nova.
              </p>
            )}
            <p className="instalar-lead">
              É o app de Windows, o único que grava <strong>as duas vozes</strong> da chamada,
              com uma janela flutuante por cima da reunião.
            </p>
            {/* A instalação agora é pela Microsoft Store. O que se ganha com
                isso é o passo que mais fazia gente desistir: o pacote da Store
                é assinado pela Microsoft, então a tela azul "O Windows
                protegeu seu PC" — que os passos antigos precisavam explicar —
                simplesmente não aparece mais. */}
            <ol className="instalar-passos">
              <li>Clique em <strong>Abrir na Microsoft Store</strong> aqui embaixo.</li>
              <li>Na loja, clique em <strong>Obter</strong>. O Dito é gratuito.</li>
              <li>Abra o Dito, entre com seu e-mail e comece a gravar.</li>
            </ol>
            <button className="btn-primary instalar-btn" onClick={irParaLoja}>
              <IconDownload width={16} height={16} /> Abrir na Microsoft Store
            </button>
            {/* O .exe continua aqui embaixo, como link: computador de empresa
                com a Store bloqueada é caso real, e sem esta saída essa pessoa
                fica sem app nenhum. Discreto de propósito — é o caminho que
                mostra o aviso do Windows. */}
            <button type="button" className="instalar-refazer" onClick={baixarInstaladorWindows}>
              Não consegue usar a Store? Baixar o instalador
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
            <button className="btn-ghost instalar-btn" onClick={irParaLoja}>
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
