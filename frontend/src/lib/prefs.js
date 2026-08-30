// Preferências locais. Tom, formato e profundidade saíram do produto: eram
// quatro ajustes que quase ninguém mexia e que faziam a mesma captura render
// resumos diferentes sem o usuário entender por quê. Hoje o resumo é sempre
// neutro e em bullets, e o que sobra aqui é o tema.

// Theme is stored separately so the boot script in index.html can read it
// before React mounts (avoids a flash of the wrong theme).
export function getTheme() {
  try { return localStorage.getItem('dito-theme') || 'light' } catch { return 'light' }
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('dito-theme', theme) } catch {}
}
