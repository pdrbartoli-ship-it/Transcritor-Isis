import { chromium } from 'playwright'
import fs from 'fs'

// Credentials live in the gitignored ../e2e/credentials.json (never committed).
const creds = JSON.parse(fs.readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const APP_URL = creds.dev_url
const EMAIL = creds.email
const PASSWORD = creds.password
const OUT = '.test-results'
fs.mkdirSync(OUT, { recursive: true })

const report = []
const consoleErrors = []
const pageErrors = []
let shot = 0
const snap = async (page, name) => {
  const file = `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: false })
  return file
}
const step = async (name, fn) => {
  try { const r = await fn(); report.push({ step: name, ok: true, info: r || '' }); console.log(`✓ ${name} ${r ? '— ' + r : ''}`) }
  catch (e) { report.push({ step: name, ok: false, error: e.message }); console.log(`✗ ${name} — ${e.message}`) }
}

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  permissions: ['microphone'],
})
const page = await context.newPage()
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', e => pageErrors.push(e.message))

await step('carregar app', async () => { await page.goto(APP_URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500) })
await snap(page, 'auth')

await step('login', async () => {
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]') // submit, not the "Entrar" tab
  // wait for either the app sidebar (success) or an error alert
  await page.waitForTimeout(2000)
  const err = await page.locator('.alert-error').textContent().catch(() => null)
  if (err) throw new Error('erro de login: ' + err)
  await page.waitForSelector('.sidebar .brand', { timeout: 15000 })
  const greeting = await page.locator('h1').first().textContent().catch(() => null)
  return `home: "${greeting}"`
})
await snap(page, 'home-light')

await step('abrir configurações + tema escuro', async () => {
  await page.click('button:has-text("Configurações")')
  await page.waitForTimeout(500)
  await page.click('.seg button:has-text("Escuro")')
  await page.waitForTimeout(600)
})
await snap(page, 'settings-dark')

await step('fechar settings (Concluído)', async () => {
  await page.click('button:has-text("Concluído")')
  await page.waitForTimeout(400)
})
await snap(page, 'home-dark')

await step('voltar tema claro', async () => {
  await page.click('button:has-text("Configurações")')
  await page.waitForTimeout(300)
  await page.click('.seg button:has-text("Claro")')
  await page.click('button:has-text("Concluído")')
  await page.waitForTimeout(400)
})

await step('recolher sidebar', async () => {
  await page.click('[aria-label="Recolher barra lateral"]')
  await page.waitForTimeout(500)
})
await snap(page, 'sidebar-collapsed')
await step('reabrir sidebar', async () => {
  await page.click('[aria-label="Abrir barra lateral"]')
  await page.waitForTimeout(500)
})

const folderName = 'Teste E2E ' + Date.now().toString().slice(-5)
await step('criar pasta', async () => {
  await page.click('button:has-text("Nova pasta")')
  await page.waitForTimeout(400)
  await page.fill('input[placeholder*="João"]', folderName)
  await page.click('.modal button:has-text("Criar")')
  await page.waitForTimeout(2500)
  const h2 = await page.locator('.folder-header h2').textContent().catch(() => null)
  return `entrou na pasta: "${h2}"`
})
await snap(page, 'folder-view')

await step('gravar áudio (mic fake) 3s e transcrever', async () => {
  // O painel de captura vive na aba "Fontes" da pasta.
  await page.click('.folder-tabs button:has-text("Fontes")')
  await page.waitForTimeout(500)
  await page.click('[aria-label="Iniciar gravação"]')
  await page.waitForTimeout(3000)
  await page.click('[aria-label="Parar gravação"]')
  await page.waitForTimeout(800)
  await snap(page, 'recorded-review')
  await page.click('button:has-text("Transcrever")')
  // transcription via backend can take a while
  await page.waitForTimeout(25000)
}).catch(() => {})
await snap(page, 'after-transcribe')

await step('chat: enviar pergunta', async () => {
  // A captura acima deixou a pasta na aba "Fontes"; o chat vive em "Conversas".
  await page.click('.folder-tabs button:has-text("Conversas")')
  await page.waitForTimeout(400)
  await page.fill('.chat-input textarea', 'Sobre o que é esta pasta?')
  await page.click('.chat-input button[aria-label="Enviar"]')
  await page.waitForTimeout(15000)
  const msgs = await page.locator('.message.assistant .bubble').count()
  return `mensagens do assistente: ${msgs}`
})
await snap(page, 'chat-response')

// Regressão do feedback #5: uma conversa sem fonte precisa aparecer no dropdown
// da pasta na barra lateral, não só na lista dentro da pasta.
await step('sidebar lista a conversa criada', async () => {
  // A pasta ativa já abre expandida; só clicamos no caret se estiver fechada,
  // senão o clique a fecharia.
  const block = page.locator(`.folder-block:has-text("${folderName}")`).first()
  if (await block.locator('.folder-caret.open').count() === 0) {
    await block.locator('.folder-caret').click()
  }
  await page.waitForTimeout(800)
  const rows = await page.locator(`.folder-block:has-text("${folderName}") .folder-children .session-item`).allTextContents()
  if (rows.length === 0) throw new Error('nenhum item no dropdown da pasta')
  return `itens no dropdown: ${rows.map(r => r.trim()).join(' | ')}`
})
await snap(page, 'sidebar-chats')

// mobile
await step('viewport mobile', async () => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
})
await snap(page, 'mobile-home')

// A captura tem telas diferentes por plataforma: no celular não há arrastar
// arquivo, e o vocabulário é "toque".
await step('mobile usa a captura de celular', async () => {
  const label = await page.locator('.record-label').first().textContent()
  const pick = await page.locator('.pick-file').count()
  const drop = await page.locator('.drop-zone').count()
  if (!label.includes('Toque')) throw new Error(`esperava "Toque para gravar", veio "${label}"`)
  if (pick === 0) throw new Error('botão de escolher arquivo ausente')
  if (drop > 0) throw new Error('área de arrastar apareceu no celular')
  return `"${label.trim()}" + botão de arquivo, sem drop-zone`
})

await step('desktop volta a usar a captura de mouse', async () => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.waitForTimeout(600)
  const drop = await page.locator('.drop-zone').count()
  const label = await page.locator('.record-label').first().textContent()
  if (drop === 0) throw new Error('área de arrastar ausente no desktop')
  if (!label.includes('Clique')) throw new Error(`esperava "Clique para gravar", veio "${label}"`)
  return `"${label.trim()}" + drop-zone`
})
await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(400)
await step('abrir drawer mobile', async () => {
  await page.click('[aria-label="Abrir menu"]')
  await page.waitForTimeout(600)
})
await snap(page, 'mobile-drawer')

await browser.close()

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, consoleErrors, pageErrors }, null, 2))
console.log('\n=== CONSOLE ERRORS ===')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(nenhum)')
console.log('\n=== PAGE ERRORS ===')
console.log(pageErrors.length ? pageErrors.join('\n') : '(nenhum)')
console.log(`\nScreenshots em ${OUT}/`)
