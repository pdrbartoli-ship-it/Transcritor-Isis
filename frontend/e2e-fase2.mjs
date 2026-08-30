// Fase 2: tela de conversa (4 tópicos, to-do's, timeline), os zoom-ins com
// rota própria, o voltar do navegador e o download da transcrição.
import { chromium } from 'playwright'
import { readFileSync, existsSync, readdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const OUT = '.test-results'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1320, height: 950 }, acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('status of 400')) errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

let fails = 0
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`) }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fails++ }
}

await page.goto(creds.dev_url || 'http://localhost:5173/')
await page.waitForLoadState('networkidle')
await page.click('text=Entrar ou criar conta').catch(() => {})
await page.waitForSelector('input[type="email"]')
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })
await page.waitForFunction(() => document.querySelectorAll('.conversation-card').length > 0, { timeout: 20000 })
console.log('login ok\n')

// Abre uma conversa que tenha transcrição de verdade (as de teste com áudio real).
await page.locator('.conversation-card', { hasText: '[TESTE FASE 2]' }).first().click()
await page.waitForSelector('.conversa-head h1', { timeout: 15000 })
const convUrl = page.url()
console.log('conversa:', decodeURIComponent(convUrl.split('#')[1]))

// Se ainda não tem insights, gera agora (chamada real ao backend).
if (await page.locator('.empty-insights').count() > 0) {
  console.log('gerando insights (chamada real, ~40s)…')
  await page.click('.empty-insights .btn-primary')
  await page.waitForSelector('.topic-grid', { timeout: 180000 })
  console.log('insights gerados\n')
}

await step('4 tópicos exatamente', async () => {
  const n = await page.locator('.topic-card').count()
  if (n !== 4) throw new Error(`achei ${n}`)
  console.log('       ' + (await page.locator('.topic-label').allTextContents()).join(' | '))
})

await step('cards indicam clicabilidade (seta + role + foco)', async () => {
  const card = page.locator('.topic-card').first()
  if (await card.getAttribute('role') !== 'button') throw new Error('sem role=button')
  if (await card.getAttribute('tabindex') !== '0') throw new Error('não alcançável por teclado')
  if (!(await card.locator('.card-arrow').isVisible())) throw new Error('seta não visível sem hover')
})

await step('timeline tem blocos proporcionais', async () => {
  const slots = page.locator('.timeline-slot')
  const n = await slots.count()
  if (n < 2) throw new Error(`só ${n} intervalo(s)`)
  const grows = await slots.evaluateAll(els => els.map(e => e.style.flexGrow))
  if (new Set(grows).size < 2) throw new Error('todos os blocos com a mesma largura')
  console.log(`       ${n} intervalos`)
})

await step('clicar num intervalo troca a prévia', async () => {
  const before = await page.textContent('.chapter-title')
  await page.locator('.timeline-slot').nth(1).click()
  await page.waitForTimeout(250)
  const after = await page.textContent('.chapter-title')
  if (before === after) throw new Error('prévia não mudou')
})

await page.screenshot({ path: `${OUT}/fase2-conversa.png`, fullPage: true })

await step('tópico abre em rota própria', async () => {
  await page.locator('.topic-card').first().click()
  await page.waitForURL(/\/topico\/0$/, { timeout: 8000 })
  await page.waitForSelector('.bullet-list li', { timeout: 5000 })
  if (await page.locator('.fala').count() === 0) throw new Error('sem trechos da transcrição')
  const t = await page.locator('.fala-time').first().textContent()
  if (!/^\d+:\d\d/.test(t.trim())) throw new Error(`timestamp estranho: "${t}"`)
  await page.screenshot({ path: `${OUT}/fase2-topico.png`, fullPage: true })
})

await step('voltar do navegador retorna à conversa', async () => {
  await page.goBack()
  await page.waitForSelector('.topic-grid', { timeout: 8000 })
})

await step('to-do abre a lista completa', async () => {
  if (await page.locator('.todo-card').count() === 0) { console.log('       (sem to-dos — pulado)'); return }
  await page.locator('.todo-card').first().click()
  await page.waitForURL(/\/todos$/, { timeout: 8000 })
  await page.waitForSelector('.todo-row', { timeout: 5000 })
  if (await page.locator('.todo-detail').count() === 0) throw new Error('item focado não abriu o trecho')
  await page.screenshot({ path: `${OUT}/fase2-todos.png`, fullPage: true })
  await page.goBack()
  await page.waitForSelector('.topic-grid', { timeout: 8000 })
})

await step('timeline abre em rota própria', async () => {
  await page.locator('.chapter-preview').click()
  await page.waitForURL(/\/timeline$/, { timeout: 8000 })
  await page.waitForSelector('.chapter-row', { timeout: 5000 })
  if (await page.locator('.chapter-detail .fala').count() === 0) throw new Error('intervalo aberto sem transcrição')
  await page.screenshot({ path: `${OUT}/fase2-timeline.png`, fullPage: true })
  await page.goBack()
  await page.waitForSelector('.topic-grid', { timeout: 8000 })
})

await step('deep-link direto funciona', async () => {
  await page.goto(convUrl.replace(/\/?$/, '/') + 'timeline')
  await page.waitForSelector('.chapter-row', { timeout: 15000 })
})

await step('falas trazem quem falou', async () => {
  await page.goto(convUrl.replace(/\/?$/, '/') + 'timeline')
  await page.waitForSelector('.chapter-detail .fala', { timeout: 15000 })
  const nomes = await page.locator('.chapter-detail .fala-speaker').allTextContents()
  if (!nomes.length) throw new Error('nenhuma fala atribuída')
  console.log('       ' + [...new Set(nomes)].join(', '))
  await page.screenshot({ path: `${OUT}/fase2-timeline-nomes.png`, fullPage: true })
})

await step('baixar a transcrição entrega .txt com tempos', async () => {
  await page.goto(convUrl)
  await page.waitForSelector('.btn-download', { timeout: 15000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.btn-download')])
  const path = `${OUT}/baixado-fase2.txt`
  await dl.saveAs(path)
  const txt = readFileSync(path, 'utf8')
  if (!/\[\d+:\d\d/.test(txt)) throw new Error('sem marcadores de tempo')
  console.log('       ' + txt.split('\n').slice(0, 4).join(' / ').slice(0, 150))
})

await browser.close()
console.log(`\nfalhas: ${fails} | erros de console: ${errors.length}`)
errors.slice(0, 8).forEach(e => console.log('  ' + e))
if (fails || errors.length) process.exitCode = 1
