import { useNavigate } from 'react-router-dom'
import { IconDownload } from '../components/Icons'

// Instalador do app nativo Windows, publicado pelo CI numa GitHub Release
// (ver .github/workflows/build-desktop.yml). A tag "desktop-latest" é fixa,
// mas o nome do arquivo tem a versão do app (definida em
// src-tauri/tauri.conf.json) — se a versão mudar, atualizar aqui também.
const INSTALLER_URL = 'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito_0.1.0_x64-setup.exe'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="auth-page">
      <div className="auth-card landing-card">
        <div className="auth-logo">
          <span className="brand">Dito<span className="dot">.</span></span>
          <p>Capture, transcreva e organize suas conversas</p>
        </div>

        <a className="btn-primary btn-full" href={INSTALLER_URL}>
          <IconDownload width={16} height={16} style={{ marginRight: 6, verticalAlign: -3 }} />
          Baixar o app
        </a>

        <button className="btn-ghost btn-full" style={{ marginTop: 10 }} onClick={() => navigate('/auth')}>
          Entrar ou criar conta
        </button>
      </div>
    </div>
  )
}
