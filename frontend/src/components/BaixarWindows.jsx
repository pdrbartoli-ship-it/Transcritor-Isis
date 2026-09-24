import { useState } from 'react'
import { IconDownload, IconCheck } from './Icons'
import { baixarInstaladorWindows, COMANDO_WINGET } from '../lib/instalar'

// O botão de Windows da landing e do modal de instalar: baixa o instalador da
// Microsoft sem tirar a pessoa da página, diz o que fazer com o arquivo, e
// guarda fechada a saída de quem usa conta de trabalho ou de escola.
export default function BaixarWindows({ origem, className }) {
  const [baixou, setBaixou] = useState(false)
  const [copiado, setCopiado] = useState(false)

  function baixar() {
    baixarInstaladorWindows(origem)
    setBaixou(true)
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(COMANDO_WINGET)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sem permissão para a área de transferência o comando continua na tela,
      // pronto para selecionar.
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={baixar}>
        <IconDownload width={16} height={16} /> Baixar para Windows
      </button>

      {baixou && (
        <div className="instalar-ok" role="status">
          <IconCheck width={15} height={15} />
          <span>O download começou. Abra o arquivo na barra de downloads do navegador: o Dito instala e abre sozinho.</span>
        </div>
      )}

      <details className="instalar-trabalho">
        <summary>Computador de trabalho ou de escola?</summary>
        <p>
          A Microsoft não deixa instalar por conta de trabalho ou de escola, e o
          arquivo baixado avisa que não conseguiu verificar a qualificação. Abra o
          PowerShell (menu Iniciar, digite PowerShell) e cole este comando:
        </p>
        <code className="instalar-comando">{COMANDO_WINGET}</code>
        <button type="button" className="instalar-copiar" onClick={copiar}>
          {copiado ? 'Copiado' : 'Copiar comando'}
        </button>
        <p>Se o computador não deixar instalar programas, use o Dito no navegador.</p>
      </details>
    </>
  )
}
