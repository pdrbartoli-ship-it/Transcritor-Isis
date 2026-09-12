// Preferências locais. Tom, formato e profundidade saíram do produto: eram
// quatro ajustes que quase ninguém mexia e que faziam a mesma captura render
// resumos diferentes sem o usuário entender por quê. Hoje o resumo é sempre
// neutro e em bullets, e o que sobra aqui é tema e idioma.

import { isTauriApp, isStandalonePwa } from './platform'

// Theme is stored separately so the boot script in index.html can read it
// before React mounts (avoids a flash of the wrong theme).
export function getTheme() {
  try { return localStorage.getItem('dito-theme') || 'light' } catch { return 'light' }
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('dito-theme', theme) } catch {}
  syncBrowserChrome(theme)
  syncNativeChrome(theme)
}

// Cor da barra do PWA instalado. O Chrome pinta a barra de título da janela
// com o `theme-color` da página, e ele estava fixo em branco: no tema escuro
// sobrava uma faixa de cor estranha em cima do app. Tem de ser o mesmo --bg do
// CSS, senão a barra fica perto mas não igual.
const THEME_BG = { light: '#faf9f5', dark: '#262624' }

export function syncBrowserChrome(theme) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_BG[theme] || THEME_BG.light)
}

// No app de Windows a barra de título é desenhada pelo sistema, não pela
// página: no tema escuro sobrava uma faixa clara em cima de um app escuro.
// setTheme() da janela é o que faz o Windows repintar a barra junto.
export function syncNativeChrome(theme) {
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

function aplicarTema(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  syncBrowserChrome(theme)
  syncNativeChrome(theme)
}

export function aplicarTemaDaVitrine() {
  if (!ehVitrine()) return
  aplicarTema('light')
}

// Chamada ao entrar no app, e não ao sair da vitrine: amarrar isto ao desmonte
// de uma tela fazia a página piscar entre os dois temas sempre que ela
// remontava. Vale em qualquer plataforma — dentro do app empacotado é o mesmo
// tema que o script do index.html já tinha aplicado.
export function aplicarTemaDoUsuario() {
  aplicarTema(getTheme())
}


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

// A ordem é a da lista na tela. O rótulo de cada idioma vem escrito NELE
// mesmo: quem procura "English" numa tela em português acha pelo nome que
// conhece, não por "Inglês". E o padrão se chama "Do áudio", não "Automático",
// porque "automático" não diz automático em relação a quê.
export const IDIOMAS = [
  { code: IDIOMA_AUTO, label: 'Do áudio' },
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
]

const CODIGOS = IDIOMAS.map(i => i.code)

export function getIdioma() {
  try {
    const salvo = localStorage.getItem('dito-idioma')
    return CODIGOS.includes(salvo) ? salvo : IDIOMA_AUTO
  } catch {
    return IDIOMA_AUTO
  }
}

export function setIdioma(idioma) {
  try { localStorage.setItem('dito-idioma', idioma) } catch {}
}
