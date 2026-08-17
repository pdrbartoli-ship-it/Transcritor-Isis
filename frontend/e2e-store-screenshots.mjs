import { chromium } from 'playwright'
import fs from 'fs'

const creds = JSON.parse(fs.readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const APP_URL = creds.app_url
const EMAIL = 'playstore.review@dito-app.com'
const PASSWORD = 'DitoReview#2026xk'
const OUT = '.store-screenshots'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
// 1080x1920 = proporção 9:16, dentro do exigido pelo Google (16:9 a 9:16, 320-3840px por lado)
const context = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

await page.goto(APP_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.fill('input[type="email"]', EMAIL)
await page.fill('input[type="password"]', PASSWORD)
await page.click('button[type="submit"]')
await page.waitForTimeout(2500)
await page.waitForSelector('.sidebar .brand', { timeout: 15000 })
await page.click('.welcome-modal button:has-text("Começar a usar")').catch(() => {})
await page.waitForTimeout(500)

await page.screenshot({ path: `${OUT}/01-home.png` })
console.log('✓ 01-home.png')

// Configurações / tema escuro
await page.click('button:has-text("Configurações")').catch(() => {})
await page.waitForTimeout(400)
await page.click('.seg button:has-text("Escuro")').catch(() => {})
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/02-settings-dark.png` })
console.log('✓ 02-settings-dark.png')

await page.click('button:has-text("Concluído")').catch(() => {})
await page.waitForTimeout(300)
// volta pro claro pra manter consistência visual das próximas capturas
await page.click('button:has-text("Configurações")').catch(() => {})
await page.waitForTimeout(300)
await page.click('.seg button:has-text("Claro")').catch(() => {})
await page.click('button:has-text("Concluído")').catch(() => {})
await page.waitForTimeout(400)

await page.screenshot({ path: `${OUT}/03-home-light.png` })
console.log('✓ 03-home-light.png')

await browser.close()
console.log('pronto:', OUT)
