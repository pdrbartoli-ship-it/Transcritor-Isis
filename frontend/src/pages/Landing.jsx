import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconDownload } from '../components/Icons'
import useInstallPrompt from '../lib/useInstallPrompt'

export default function Landing() {
  const navigate = useNavigate()
  const { canInstall, installed, promptInstall } = useInstallPrompt()
  // Só aparece se a pessoa clicar num navegador sem suporte a instalação por
  // clique (Safari, Firefox) — o resto do tempo a caixa fica só com o botão.
  const [unsupported, setUnsupported] = useState(false)

  function handleClick() {
    if (canInstall) { promptInstall(); return }
    setUnsupported(true)
  }

  return (
    <div className="auth-page">
      <div className="auth-card landing-card">
        <div className="auth-logo">
          <span className="brand">Dito<span className="dot">.</span></span>
          <p>Capture, transcreva e organize suas conversas</p>
        </div>

        <button className="btn-primary btn-full" onClick={handleClick} disabled={installed}>
          <IconDownload width={16} height={16} style={{ marginRight: 6, verticalAlign: -3 }} />
          {installed ? 'App já instalado' : 'Baixar o app'}
        </button>
        {unsupported && (
          <p className="landing-install-hint">
            Abra este site no Chrome ou Edge para instalar.
          </p>
        )}

        <button className="btn-ghost btn-full" style={{ marginTop: 10 }} onClick={() => navigate('/auth')}>
          Entrar ou criar conta
        </button>
      </div>
    </div>
  )
}
