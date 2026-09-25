// Preferências locais. Tom, formato e profundidade saíram do produto: eram
// quatro ajustes que quase ninguém mexia e que faziam a mesma captura render
// resumos diferentes sem o usuário entender por quê. Hoje o resumo é sempre
// neutro e em bullets, e o que sobra aqui é tema e idioma.

import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import { isTauriApp, isStandalonePwa, isNative } from './platform'

// Três escolhas: claro, escuro, ou seguir o aparelho. Quem nunca escolheu
// segue o aparelho: no iPhone e no Android o modo escuro é do sistema, e um
// app que abre claro às onze da noite no meio de tudo escuro é o que parece
// app feito às pressas.
export const TEMA_AUTO = 'auto'
const TEMAS = [TEMA_AUTO, 'light', 'dark']

// Theme is stored separately so the boot script in index.html can read it
// before React mounts (avoids a flash of the wrong theme).
export function getTheme() {
  try {
    const salvo = localStorage.getItem('dito-theme')
    return TEMAS.includes(salvo) ? salvo : TEMA_AUTO
  } catch {
    return TEMA_AUTO
  }
}

function escuroNoAparelho() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

// O que vai de fato para a tela: "auto" vira claro ou escuro na hora.
export function temaEfetivo(theme = getTheme()) {
  if (theme === 'light' || theme === 'dark') return theme
  return escuroNoAparelho() ? 'dark' : 'light'
}

export function setTheme(theme) {
  try { localStorage.setItem('dito-theme', theme) } catch {}
  dentroDoApp = true
  aplicarTema(temaEfetivo(theme))
}

// Cor da barra do PWA instalado. O Chrome pinta a barra de título da janela
// com o `theme-color` da página, e ele estava fixo em branco: no tema escuro
// sobrava uma faixa de cor estranha em cima do app. Tem de ser o mesmo --bg do
// CSS, senão a barra fica perto mas não igual.
const THEME_BG = { light: '#f6f8f7', dark: '#151a18' }

export function syncBrowserChrome(theme) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_BG[theme] || THEME_BG.light)
}

// No app de Windows a barra de título é desenhada pelo sistema, não pela
// página: no tema escuro sobrava uma faixa clara em cima de um app escuro.
// setTheme() da janela é o que faz o Windows repintar a barra junto.
//
// No celular é a barra de status: o app desenha por baixo dela, e as letras
// dela (relógio, bateria) seguem o aparelho, não o Dito. Com o Dito no escuro
// e o iPhone no claro, o relógio saía preto sobre o fundo escuro. O controle
// já vem no Capacitor 8, sem plugin a instalar.
export function syncNativeChrome(theme) {
  if (isNative()) {
    SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
      .catch(() => { /* versão nativa antiga: a barra fica como o aparelho quiser */ })
    return
  }
  if (!isTauriApp()) return
  import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
    .catch(() => {
      // Versão antiga do runtime ou permissão ausente: a barra fica como
      // estava, o que é chato mas não quebra nada.
    })
}


// ── Tema da vitrine ───────────────────────────────────────
//
// A landing e as telas de entrada são a primeira imagem do Dito para quem
// chega, e o tema é um atributo do documento inteiro: quem já usava o app no
// escuro voltava à landing e a via escura, então a mesma página tinha duas
// caras conforme quem abrisse. Na vitrine o tom é sempre claro.
//
// Aplica sem gravar no localStorage: a preferência de quem já é usuário
// continua intacta para quando ele entrar no app.
//
// Dentro do app empacotado (Windows ou PWA instalado) isto não vale — ali não
// existe vitrine, e a tela de login é do app, que respeita o tema escolhido.
function ehVitrine() {
  return !isTauriApp() && !isStandalonePwa()
}

// Se a tela aberta é a do app (e não a vitrine): é o que decide se a troca de
// claro para escuro no aparelho, com o Dito aberto, deve repintar a tela.
let dentroDoApp = false

function aplicarTema(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  syncBrowserChrome(theme)
  syncNativeChrome(theme)
}

export function aplicarTemaDaVitrine() {
  if (!ehVitrine()) return
  dentroDoApp = false
  aplicarTema('light')
}

// Chamada ao entrar no app, e não ao sair da vitrine: amarrar isto ao desmonte
// de uma tela fazia a página piscar entre os dois temas sempre que ela
// remontava. Vale em qualquer plataforma — dentro do app empacotado é o mesmo
// tema que o script do index.html já tinha aplicado.
export function aplicarTemaDoUsuario() {
  dentroDoApp = true
  aplicarTema(temaEfetivo())
}

// O aparelho trocou de claro para escuro (o iPhone faz isso sozinho ao
// anoitecer) com o Dito aberto: quem está no automático acompanha na hora.
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (dentroDoApp && getTheme() === TEMA_AUTO) aplicarTema(temaEfetivo())
  })
} catch { /* navegador sem matchMedia: fica o tema da abertura */ }


// ── Idioma ────────────────────────────────────────────────
//
// Idioma de SAÍDA: em que língua o Dito escreve título, resumo, tópicos,
// tarefas e o resumo minuto a minuto. Não tem relação com o idioma do áudio,
// que é detectado sozinho na transcrição — quem quiser ler em inglês uma
// reunião em português muda só isto.
//
// Fica no localStorage e não no perfil do Supabase de propósito: é a mesma
// natureza do tema (preferência de leitura, sem valor entre dispositivos) e
// assim funciona antes mesmo de a sessão carregar.
export const IDIOMA_AUTO = 'auto'

// Quem não escolheu nada lê em português: é a língua de quase todo mundo que
// usa o Dito, e "Do áudio" fazia uma reunião em inglês voltar em inglês para
// quem só queria entender o que foi dito. Quem prefere outra coisa muda nas
// configurações, e aí a escolha é que vale.
export const IDIOMA_PADRAO = 'pt'

// A ordem é a da lista na tela, com o padrão na frente. O rótulo de cada
// idioma vem escrito NELE mesmo: quem procura "English" numa tela em português
// acha pelo nome que conhece, não por "Inglês". E "Do áudio" não se chama
// "Automático" porque "automático" não diz automático em relação a quê.
export const IDIOMAS = [
  { code: 'pt', label: 'Português' },
  { code: IDIOMA_AUTO, label: 'Do áudio' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
]

const CODIGOS = IDIOMAS.map(i => i.code)

export function getIdioma() {
  try {
    const salvo = localStorage.getItem('dito-idioma')
    return CODIGOS.includes(salvo) ? salvo : IDIOMA_PADRAO
  } catch {
    return IDIOMA_PADRAO
  }
}

export function setIdioma(idioma) {
  try { localStorage.setItem('dito-idioma', idioma) } catch {}
}


// ── Avisar quando uma reunião começar ─────────────────────
//
// Só existe no app de Windows. Nasce LIGADO desde 22/09/2026, e a decisão é de
// produto: nascia desligado por medo de gravar sem querer, mas o recurso não
// grava nada — ele pergunta, e só grava se a pessoa clicar em "Gravar". O que
// o padrão desligado produzia, na prática, era a pessoa perder a reunião que
// queria ter gravado e descobrir o recurso depois, vasculhando as
// Configurações. Quem não quiser ser perguntado desliga no mesmo interruptor.
//
// Ligado, o Dito também fica na bandeja ao fechar a janela: sem isso o detector
// só funcionaria com o app aberto na tela.
//
// O `!== '0'` (e não `=== '1'`) é o que faz o padrão valer para quem nunca
// mexeu no interruptor, sem apagar a escolha de quem já desligou.
export function getAvisarReuniao() {
  try { return localStorage.getItem('dito-avisar-reuniao') !== '0' } catch { return true }
}

export function setAvisarReuniao(ligado) {
  try { localStorage.setItem('dito-avisar-reuniao', ligado ? '1' : '0') } catch {}
}
