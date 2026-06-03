import { chromium } from 'playwright'
import fs from 'fs'
const creds = JSON.parse(fs.readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const APP_URL = creds.dev_url
const OUT = '.test-results'
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, permissions: ['microphone'] })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))

const log = []
try {
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.sidebar .brand', { timeout: 15000 })
  await page.waitForTimeout(800)
  log.push('login ok')

  // Record on HOME (not inside a folder) → should trigger suggestion modal
  await page.click('[aria-label="Iniciar gravação"]')
  await page.waitForTimeout(2500)
  await page.click('[aria-label="Parar gravação"]')
  await page.waitForTimeout(600)
  await page.click('button:has-text("Transcrever")')
  log.push('aguardando transcrição + sugestão...')

  // wait for the suggestion modal ("Onde salvar?")
  await page.waitForSelector('text=Onde salvar?', { timeout: 40000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/sug-01-modal.png` })
  log.push('modal de sugestão apareceu ✓')

  // read suggestion content
  const reason = await page.locator('.suggestion-reason').textContent().catch(() => '(sem reason)')
  log.push('reason: ' + reason)
  const opts = await page.locator('.suggestion-option').allTextContents()
  log.push('opções: ' + JSON.stringify(opts))

  // confirm default selection
  await page.click('.modal button:has-text("Confirmar")')
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${OUT}/sug-02-after-confirm.png` })
  const h2 = await page.locator('.folder-header h2').textContent().catch(() => '(sem header)')
  log.push('após confirmar, pasta: ' + h2)
} catch (e) {
  log.push('ERRO: ' + e.message)
  await page.screenshot({ path: `${OUT}/sug-ERROR.png` }).catch(() => {})
}
await browser.close()
fs.writeFileSync(`${OUT}/suggest-report.json`, JSON.stringify({ log, errs }, null, 2))
console.log(log.join('\n'))
console.log('pageErrors:', errs.length ? errs.join(' | ') : '(nenhum)')
