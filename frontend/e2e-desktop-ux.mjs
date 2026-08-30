// Confere as mudanças de identidade e UX na versão desktop: cabeçalho da
// barra lateral (lupa + ir/voltar), lista agrupada, cards sem seta fixa,
// estado vazio do chat e o tema escuro.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const b = await chromium.launch()

async function login(page) {
  await page.goto(base)
  await page.waitForLoadState('networkidle')
  await page.click('text=Entrar ou criar conta').catch(() => {})
  await page.waitForSelector('input[type="email"]')
  await page.click('text=Acessar')
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home', { timeout: 25000 })
  await page.waitForFunction(() => document.querySelectorAll('.conversation-card').length > 0, { timeout: 15000 })
}

const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
await login(p)

const grupos = await p.locator('.sidebar-group-label').allTextContents()
console.log('grupos:', grupos)
const urlsCruas = await p.locator('.sidebar-item-text').evaluateAll(
  els => els.filter(e => e.textContent.startsWith('http')).length)
console.log('titulos ainda com URL crua (legado no banco):', urlsCruas)
console.log('icones de origem:', await p.locator('.sidebar-item .kind-icon').count())
await p.screenshot({ path: '.test-results/ux-01-home.png' })

// busca pela lupa
await p.click('.tool-btn[aria-label="Buscar conversas"]')
await p.waitForSelector('.sidebar-search input:focus')
await p.fill('.sidebar-search input', 'odisseia')
await p.waitForTimeout(900)
await p.screenshot({ path: '.test-results/ux-02-busca.png' })
await p.keyboard.press('Escape')
await p.waitForSelector('.sidebar-search', { state: 'detached' })
console.log('busca abre na lupa e fecha no Esc: ok')

// conversa: cards sem seta fixa nem "ver detalhes"
await p.locator('.conversation-card').first().click()
await p.waitForSelector('.conversa-head h1')
console.log('rotulos "ver detalhes" restantes:', await p.locator('.card-cue').count())
const setaEscondida = await p.locator('.topic-card .card-arrow').first()
  .evaluate(el => getComputedStyle(el).opacity)
console.log('opacidade da seta em repouso:', setaEscondida)
await p.screenshot({ path: '.test-results/ux-03-conversa.png' })
await p.locator('.topic-card').first().hover()
await p.waitForTimeout(300)
await p.screenshot({ path: '.test-results/ux-04-card-hover.png', clip: { x: 400, y: 150, width: 500, height: 260 } })

// voltar pela setinha da barra lateral
await p.locator('.topic-card').first().click()
await p.waitForSelector('.conversa-head h1')
await p.click('.tool-btn[aria-label="Voltar"]')
await p.waitForTimeout(500)
console.log('voltar pela setinha ->', await p.evaluate(() => location.hash))

// chat vazio com sugestões
await p.click('.conversa-actions .btn-primary')
await p.waitForSelector('.chat-starter')
console.log('chips de sugestao:', await p.locator('.starter-chips button').count())
const fonteBolha = await p.evaluate(() => {
  const d = document.createElement('div'); d.className = 'bubble'
  document.body.appendChild(d)
  const f = getComputedStyle(d).fontFamily; d.remove(); return f
})
console.log('fonte da bolha:', fonteBolha)
await p.screenshot({ path: '.test-results/ux-05-chat-vazio.png' })

// tema escuro
await p.goto(base)
await p.waitForSelector('.home')
await p.click('.nav-item:has-text("Tema")')
await p.click('.modal .seg button:has-text("Escuro")')
await p.click('.modal .btn-primary')
await p.waitForTimeout(300)
await p.screenshot({ path: '.test-results/ux-06-dark.png' })
await p.locator('.conversation-card').first().click()
await p.waitForSelector('.conversa-head h1')
await p.screenshot({ path: '.test-results/ux-07-dark-conversa.png' })
await p.evaluate(() => localStorage.setItem('dito-theme', 'light'))

await b.close()
console.log('desktop ux ok')
