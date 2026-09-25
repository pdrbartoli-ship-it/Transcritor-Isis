import { useEffect, useState } from 'react'

// A Microsoft Store é a porta de entrada do Windows desde 22/09/2026. O pacote
// dela é assinado pela Microsoft, então não aparece a tela azul "O Windows
// protegeu seu PC" nem o bloqueio do Defender que o .exe sem assinatura tomou
// em 24/09/2026. O id 9pdvg213q755 é o do produto no Partner Center e não
// muda; este link abre a página do Dito na loja em qualquer navegador.
export const STORE_URL = 'https://apps.microsoft.com/detail/9pdvg213q755'

// Instalador pequeno gerado pela Microsoft: baixa o Dito da Store, instala e
// abre, sem a pessoa passar pela loja e sem aviso nenhum do Windows. É o
// caminho de todo mundo. Não funciona com conta de trabalho ou de escola: ele
// avisa que não conseguiu verificar a qualificação e abre a Store, que também
// não aceita essas contas. O `cid` só diz de onde veio o clique.
const INSTALADOR_STORE_URL = 'https://get.microsoft.com/installer/download/9PDVG213Q755'

// O plano B, para quando o de cima falha: o instalador do próprio Dito, gerado
// pelo CI (.github/workflows/build-desktop.yml). Não passa pela Store, então
// funciona em qualquer conta, mas não tem assinatura digital e o Windows avisa
// antes de abrir. O guia de InstalarWindows.jsx mostra onde clicar. A tag e o
// nome do arquivo são fixos de propósito: o CI sobrescreve o arquivo e o link
// continua o mesmo.
export const INSTALADOR_DITO_URL =
  'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito-setup.exe'

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

export function baixarInstaladorWindows(origem) {
  baixar(`${INSTALADOR_STORE_URL}?cid=${origem}`)
}

export function baixarInstaladorDito() {
  baixar(INSTALADOR_DITO_URL)
}

function baixar(url) {
  // Um <a download> em vez de window.location: trocar a URL da página inteira
  // por um .exe faz alguns navegadores mostrarem uma tela em branco no meio do
  // caminho, e a landing sumia enquanto o arquivo baixava.
  const link = document.createElement('a')
  link.href = url
  link.download = ''
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
