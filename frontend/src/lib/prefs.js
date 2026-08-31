// Preferências locais. Tom, formato e profundidade saíram do produto: eram
// quatro ajustes que quase ninguém mexia e que faziam a mesma captura render
// resumos diferentes sem o usuário entender por quê. Hoje o resumo é sempre
// neutro e em bullets, e o que sobra aqui é o tema.

import { isTauriApp } from './platform'

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
