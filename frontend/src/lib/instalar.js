import { useEffect, useState } from 'react'

// Instalador do app nativo Windows, publicado pelo CI numa GitHub Release a
// cada push na main (ver .github/workflows/build-desktop.yml). Tag fixa
// "desktop-latest" e nome de arquivo fixo "Dito-setup.exe": antes o nome
// carregava a versão do app, então subir a versão quebrava este botão em
// silêncio. Não dá para usar /releases/latest/ porque a release é prerelease.
export const INSTALLER_URL = 'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito-setup.exe'

// A Microsoft Store é a porta de entrada do Windows desde 22/09/2026. É o
// mesmo app do instalador acima, com uma diferença que decidia desistências: o
// pacote da Store é assinado pela Microsoft, então some a tela azul "O Windows
// protegeu seu PC" que aparecia no .exe sem assinatura. O id 9pdvg213q755 é o
// do produto no Partner Center e não muda; o link https funciona em qualquer
// navegador e, no Windows, entrega a pessoa ao app da Store.
export const STORE_URL = 'https://apps.microsoft.com/detail/9pdvg213q755'

export function abrirLojaWindows() {
  // Aba nova, e não a página inteira: quem clica pode estar lendo a landing no
  // celular para instalar no PC depois, e trocar a página por uma loja que ali
  // não instala nada seria um beco sem saída.
  window.open(STORE_URL, '_blank', 'noopener')
}

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

// O caminho de fora da Store, que continua existindo: PC de empresa com a
// Store bloqueada, Windows sem a Store instalada, ou quem simplesmente prefere
// um arquivo. Não é mais o caminho principal, e por isso na tela ele aparece
// como link, não como botão.
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
