// Tema escuro e largura de celular nas telas novas.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const b = await chromium.launch()

async function login(page) {
  await page.goto(creds.dev_url || 'http://localhost:5173/')
  await page.waitForLoadState('networkidle')
  await page.click('text=Entrar ou criar conta').catch(()=>{})
  await page.waitForSelector('input[type="email"]')
  await page.click('text=Acessar')
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home', { timeout: 25000 })
  await page.waitForFunction(() => document.querySelectorAll('.conversation-card').length > 0, { timeout: 15000 })
}

// escuro, desktop
const dark = await b.newPage({ viewport: { width: 1280, height: 900 } })
await login(dark)
await dark.click('.nav-item:has-text("Tema")')
await dark.click('.modal .seg button:has-text("Escuro")')
await dark.click('.modal .btn-primary')
await dark.click('.capture-option:has-text("Arquivos")')
await dark.screenshot({ path: '.test-results/fase1-dark.png', fullPage: false })
await dark.locator('.conversation-card').first().click()
await dark.waitForSelector('.conversa-head h1')
await dark.screenshot({ path: '.test-results/fase1-dark-conversa.png', fullPage: false })
// volta pro claro pra não deixar a conta trocada
await dark.goto((creds.dev_url || 'http://localhost:5173/'))
await dark.evaluate(() => localStorage.setItem('dito-theme', 'light'))

// celular
const m = await b.newPage({ viewport: { width: 380, height: 780 } })
await login(m)
await m.screenshot({ path: '.test-results/fase1-mobile.png', fullPage: false })
await m.click('.hamburger')
await m.waitForSelector('.sidebar.open')
await m.screenshot({ path: '.test-results/fase1-mobile-drawer.png', fullPage: false })
await m.click('.sidebar-overlay')
await m.locator('.conversation-card').first().click()
await m.waitForSelector('.conversa-head h1')
await m.screenshot({ path: '.test-results/fase1-mobile-conversa.png', fullPage: false })

await b.close()
console.log('visual ok')
