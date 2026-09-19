// Refaz os dois prints da landing (public/landing/registrar.png e
// perguntar.png) a partir do app de verdade, com a conta de teste.
//
// Mesmo enquadramento dos prints feitos à mão no Windows: janela de 1280x640
// em escala 1,5, o que dá 1920x960. O que é da conta (e-mail, versão, aviso e
// contador de saldo) sai da imagem: é vitrine, não a tela de alguém.
//
// Uso: node e2e-prints-landing.mjs [url]   (padrão: dev server local)
import { chromium } from 'playwright'
import fs from 'fs'

const creds = JSON.parse(fs.readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const URL_BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = 'public/landing'

const ESCONDER = `
  .foot-user, .foot-version, .aviso-saldo, .home-topo .contador-minutos { visibility: hidden !important; }
`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1.5 })
const p = await ctx.newPage()
await p.addInitScript(() => {
  try { localStorage.setItem('dito-theme', 'light') } catch { /* sem storage */ }
})
await p.goto(URL_BASE + '#/auth', { waitUntil: 'networkidle' })
await p.click('.auth-tabs button:has-text("Acessar")')
await p.fill('input[type="email"]', creds.email)
await p.fill('input[type="password"]', creds.password)
await p.click('button[type="submit"]')
await p.waitForSelector('.app-shell', { timeout: 25000 })
await p.waitForTimeout(1500)
await p.click('.welcome-modal button').catch(() => {})
await p.addStyleTag({ content: ESCONDER })
await p.waitForTimeout(400)
await p.screenshot({ path: `${OUT}/registrar.png` })

// A conversa com tópicos e tarefas: é a que mostra o que o Dito entrega.
await p.locator('.sidebar-item', { hasText: 'Sistemas de produção' }).first().click()
await p.waitForSelector('.topic-card', { timeout: 20000 })
await p.waitForTimeout(1200)
await p.addStyleTag({ content: ESCONDER })
await p.screenshot({ path: `${OUT}/perguntar.png` })

await browser.close()
console.log('prints salvos em', OUT)
