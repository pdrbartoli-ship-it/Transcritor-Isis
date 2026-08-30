import { useNavigate } from 'react-router-dom'
import { IconDownload } from '../components/Icons'

// Instalador do app nativo Windows, publicado pelo CI numa GitHub Release a
// cada push na main (ver .github/workflows/build-desktop.yml). Tag fixa
// "desktop-latest" e nome de arquivo fixo "Dito-setup.exe": antes o nome
// carregava a versão do app, então subir a versão quebrava este botão em
// silêncio. Não dá para usar /releases/latest/ porque a release é prerelease.
const INSTALLER_URL = 'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito-setup.exe'

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
