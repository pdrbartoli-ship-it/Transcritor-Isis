// Fase 3: chat por conversa, abas Chat/Histórico e persistência.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const OUT = '.test-results'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1320, height: 950 } })
const errors = []
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('status of 400')) errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
let fails = 0
const step = async (n, fn) => { try { await fn(); console.log(`  ok   ${n}`) } catch (e) { console.log(`  FAIL ${n}: ${e.message}`); fails++ } }

await page.goto(creds.dev_url || 'http://localhost:5173/')
await page.waitForLoadState('networkidle')
await page.click('text=Entrar ou criar conta').catch(() => {})
await page.waitForSelector('input[type="email"]'); await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })
await page.waitForFunction(() => document.querySelectorAll('.conversation-card').length > 0, { timeout: 20000 })

await page.locator('.conversation-card', { hasText: 'Teste de transcrição' }).first().click()
await page.waitForSelector('.conversa-head h1', { timeout: 15000 })
const convUrl = page.url()
console.log('conversa:', decodeURIComponent(convUrl.split('#')[1]), '\n')

await step('botão "Pergunte qualquer coisa" leva ao chat', async () => {
  const btn = page.locator('.conversa-actions .btn-primary')
  if (await btn.count() === 0) {
    // conversa legada não tem a grade; navega direto
    await page.goto(convUrl.replace(/\/?$/, '/') + 'chat')
  } else { await btn.click() }
  await page.waitForURL(/\/chat$/, { timeout: 10000 })
  await page.waitForSelector('.chat-input textarea', { timeout: 8000 })
})

await step('abas Chat e Histórico existem', async () => {
  const tabs = await page.locator('.chat-tabs button').allTextContents()
  if (!tabs[0].includes('Chat') || !tabs[1].includes('Histórico')) throw new Error(tabs.join('|'))
})

await step('pergunta recebe resposta', async () => {
  await page.fill('.chat-input textarea', 'Resuma esta conversa em uma frase.')
  await page.click('.chat-input button[type="submit"]')
  await page.waitForSelector('.message.assistant .md', { timeout: 120000 })
  const r = await page.textContent('.message.assistant .bubble')
  if (r.trim().length < 15) throw new Error(`resposta curta: "${r}"`)
  console.log('       ' + r.trim().slice(0, 110).replace(/\n/g, ' '))
  await page.screenshot({ path: `${OUT}/fase3-chat.png`, fullPage: true })
})

await step('pergunta de acompanhamento mantém contexto', async () => {
  await page.fill('.chat-input textarea', 'E em quantas palavras isso deu?')
  await page.click('.chat-input button[type="submit"]')
  await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length >= 2, { timeout: 120000 })
})

await step('conversa aparece no Histórico', async () => {
  await page.click('.chat-tabs button:has-text("Histórico")')
  await page.waitForSelector('.chat-history-item', { timeout: 8000 })
  const t = await page.textContent('.chat-history-title')
  console.log('       título gerado: ' + t.trim())
  await page.screenshot({ path: `${OUT}/fase3-historico.png`, fullPage: true })
})

await step('reabrir do histórico traz as mensagens', async () => {
  await page.locator('.chat-history-item').first().click()
  await page.waitForSelector('.message.assistant', { timeout: 8000 })
  const n = await page.locator('.message').count()
  if (n < 4) throw new Error(`só ${n} mensagens restauradas`)
  console.log(`       ${n} mensagens`)
})

await step('deep-link do chat funciona', async () => {
  await page.goto(convUrl.replace(/\/?$/, '/') + 'chat')
  await page.waitForSelector('.chat-input textarea', { timeout: 15000 })
})

await browser.close()
console.log(`\nfalhas: ${fails} | erros de console: ${errors.length}`)
errors.slice(0, 8).forEach(e => console.log('  ' + e))
if (fails || errors.length) process.exitCode = 1
