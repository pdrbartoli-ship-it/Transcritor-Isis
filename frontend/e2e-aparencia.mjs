// Capturas da aparência do Dito: landing, login, home, conversa, chat e planos,
// no claro e no escuro, desktop e celular. Só leitura: nada é gravado nem
// cobrado (a conta de teste só abre conversas que já existem).
//
// Uso: node e2e-aparencia.mjs [url] [pasta]
//   url   padrão: dev server local (http://localhost:5173/)
//   pasta padrão: .test-results/aparencia/<data-hora>
import { chromium } from 'playwright'
import fs from 'fs'

const creds = JSON.parse(fs.readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const URL_BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || `.test-results/aparencia/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const shot = (p, nome, opts = {}) => p.screenshot({ path: `${OUT}/${nome}.png`, ...opts })

async function rolarTudo(p) {
  // A demonstração e as imagens só aparecem quando a seção entra na tela.
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await p.waitForTimeout(800)
}

async function entrar(p) {
  await p.goto(URL_BASE + '#/auth', { waitUntil: 'networkidle' })
  await p.click('.auth-tabs button:has-text("Acessar")')
  await p.fill('input[type="email"]', creds.email)
  await p.fill('input[type="password"]', creds.password)
  await p.click('button[type="submit"]')
  await p.waitForSelector('.app-shell', { timeout: 25000 })
  await p.waitForTimeout(1500)
  await p.click('.welcome-modal button').catch(() => {})
}

async function tema(p, t) {
  await p.evaluate(t => {
    try { localStorage.setItem('dito-theme', t) } catch { /* sem storage */ }
    document.documentElement.setAttribute('data-theme', t)
  }, t)
  await p.waitForTimeout(300)
}

// 1. Landing (sem login), desktop e celular
for (const [nome, viewport] of [['desk', { width: 1366, height: 850 }], ['mob', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport })
  const p = await ctx.newPage()
  await p.goto(URL_BASE, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await shot(p, `landing-${nome}-topo`)
  await rolarTudo(p)
  await shot(p, `landing-${nome}-full`, { fullPage: true })
  await ctx.close()
}

// 2. App no desktop
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } })
const p = await ctx.newPage()
await p.goto(URL_BASE + '#/auth', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await shot(p, 'auth')
await entrar(p)
await tema(p, 'light')
await shot(p, 'home')
await p.locator('.sidebar-item').first().click()
await p.waitForTimeout(2500)
await shot(p, 'conversa')
await p.locator('.ask-bar textarea').click().catch(() => {})
const urlConversa = p.url()
await p.goto(urlConversa.replace(/\/?$/, '/chat'), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await shot(p, 'chat')
await p.goto(urlConversa, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.locator('.nav-item', { hasText: 'Meu plano' }).click()
await p.waitForTimeout(1200)
await shot(p, 'modal-plano')
await p.keyboard.press('Escape')
await p.locator('.modal-overlay').click({ position: { x: 5, y: 5 } }).catch(() => {})
await p.waitForTimeout(400)
await p.locator('.nav-item', { hasText: 'Configurações' }).click()
await p.waitForTimeout(800)
await shot(p, 'modal-config')
await p.locator('.modal-overlay').click({ position: { x: 5, y: 5 } }).catch(() => {})
await tema(p, 'dark')
await shot(p, 'conversa-escuro')
await p.goto(URL_BASE + '#/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await tema(p, 'dark')
await shot(p, 'home-escuro')
await tema(p, 'light')
await ctx.close()

// 3. App no celular
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const q = await m.newPage()
await entrar(q)
await tema(q, 'light')
await shot(q, 'mob-home')
await q.click('.hamburger')
await q.waitForTimeout(500)
await shot(q, 'mob-menu')
await q.locator('.sidebar-item').first().click()
await q.waitForTimeout(2500)
await shot(q, 'mob-conversa')
await browser.close()
console.log('capturas em', OUT)
