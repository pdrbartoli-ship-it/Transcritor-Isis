import { useEffect, useState } from 'react'

// Instalador do app nativo Windows, publicado pelo CI numa GitHub Release a
// cada push na main (ver .github/workflows/build-desktop.yml). Tag fixa
// "desktop-latest" e nome de arquivo fixo "Dito-setup.exe": antes o nome
// carregava a versão do app, então subir a versão quebrava este botão em
// silêncio. Não dá para usar /releases/latest/ porque a release é prerelease.
export const INSTALLER_URL = 'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito-setup.exe'

// Em que aparelho a pessoa está lendo a landing. É só para escolher o que
// oferecer no "Instalar grátis": no Windows existe instalador de verdade, no
// resto o Dito se instala como app pelo próprio navegador.
export function aparelhoDoVisitante() {
  const ua = navigator.userAgent || ''
  if (/Android/i.test(ua)) return 'android'
  // O iPad moderno se anuncia como Mac; o toque é o que o denuncia.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Windows/i.test(ua)) return 'windows'
  return 'outro'
}

export function baixarInstaladorWindows() {
  // Um <a download> em vez de window.location: trocar a URL da página inteira
  // por um .exe faz alguns navegadores mostrarem uma tela em branco no meio do
  // caminho, e a landing sumia enquanto o arquivo baixava.
  const link = document.createElement('a')
  link.href = INSTALLER_URL
  link.download = 'Dito-setup.exe'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// O convite de instalação do PWA. O navegador só o oferece quando quer (site
// com manifesto, service worker e uma visita anterior), e só dá para chamá-lo
// dentro de um clique — por isso o evento fica guardado desde o carregamento.
export function usePwaPrompt() {
  const [evento, setEvento] = useState(null)

  useEffect(() => {
    const guardar = e => { e.preventDefault(); setEvento(e) }
    window.addEventListener('beforeinstallprompt', guardar)
    // Depois de instalado o convite não vale mais nada.
    const instalado = () => setEvento(null)
    window.addEventListener('appinstalled', instalado)
    return () => {
      window.removeEventListener('beforeinstallprompt', guardar)
      window.removeEventListener('appinstalled', instalado)
    }
  }, [])

  async function instalarPwa() {
    if (!evento) return false
    evento.prompt()
    const { outcome } = await evento.userChoice
    // O evento é de uso único: depois de respondido, o navegador não deixa
    // chamá-lo de novo.
    setEvento(null)
    return outcome === 'accepted'
  }

  return { podeInstalarPwa: !!evento, instalarPwa }
}
