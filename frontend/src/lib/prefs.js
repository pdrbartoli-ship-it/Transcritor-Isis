// User preferences for summarization, persisted in localStorage. These map to
// the backend's `detailed` flag and `preferences` ({ tone, style }) used by
// /transcribe and /process-url.
const KEY = 'dito-prefs'

const DEFAULTS = {
  detailed: false,        // false = resumo rápido, true = detalhado
  tone: 'Formal',         // Formal | Casual | Técnico
  style: 'Tópicos',       // Tópicos | Parágrafos
}

export function getPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
  return next
}

// Aviso de boas-vindas: mostrado uma única vez por conta. A chave leva o id do
// usuário porque duas contas no mesmo aparelho são comuns em teste — e assim
// quem já viu não vê de novo ao trocar de conta e voltar.
const WELCOME_KEY = id => `dito-welcome-${id}`

export function hasSeenWelcome(userId) {
  if (!userId) return true // sem usuário não há o que mostrar
  try { return localStorage.getItem(WELCOME_KEY(userId)) === '1' } catch { return true }
}

export function markWelcomeSeen(userId) {
  if (!userId) return
  try { localStorage.setItem(WELCOME_KEY(userId), '1') } catch {}
}

// Theme is stored separately so the boot script in index.html can read it
// before React mounts (avoids a flash of the wrong theme).
export function getTheme() {
  try { return localStorage.getItem('dito-theme') || 'light' } catch { return 'light' }
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('dito-theme', theme) } catch {}
}
