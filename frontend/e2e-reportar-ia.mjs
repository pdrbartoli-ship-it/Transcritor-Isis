// Botão "Reportar conteúdo da IA" (Microsoft Store 11.16): aparece nas telas
// da conversa, abre o modal próprio e, com --enviar, grava o report na tabela
// `feedback`. Uso: node e2e-reportar-ia.mjs [url] [--enviar]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const url = process.argv.slice(2).find(a => a.startsWith('http')) || creds.dev_url
const enviar = process.argv.includes('--enviar')
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

const step = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`) }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1 }
}

// Direto na tela de login: a landing muda de texto com frequência.
await page.goto(url.replace(/#.*$/, '') + '#/auth')
await page.waitForLoadState('networkidle')
await page.waitForSelector('input[type="email"]', { timeout: 15000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })
console.log(`login ok (${url})\n`)

await page.waitForSelector('.sidebar-item', { timeout: 15000 })
await page.locator('.sidebar-item').first().click()
await page.waitForURL(/#\/conversa\/[0-9a-f-]+/, { timeout: 10000 })
await page.waitForSelector('.conversa-head h1', { timeout: 10000 })
const base = page.url().replace(/#.*$/, '')
const conversaId = page.url().match(/conversa\/([0-9a-f-]+)/)[1]

for (const [nome, sufixo] of [['visão geral', ''], ['tarefas', '/todos'], ['tópico', '/topico/0'], ['timeline', '/timeline'], ['chat', '/chat']]) {
  await step(`botão aparece em ${nome}`, async () => {
    await page.goto(`${base}#/conversa/${conversaId}${sufixo}`)
    await page.waitForSelector('.conversa-head h1', { timeout: 10000 })
    await page.waitForSelector('.btn-reportar-ia', { timeout: 5000 })
  })
}

await page.goto(`${base}#/conversa/${conversaId}`)
await page.waitForSelector('.btn-reportar-ia', { timeout: 10000 })
await page.screenshot({ path: `${OUT}/reportar-ia-desktop.png` })

await step('abre o modal de report, sem as categorias do feedback', async () => {
  await page.click('.btn-reportar-ia')
  await page.waitForSelector('.modal h3:has-text("Reportar conteúdo da IA")', { timeout: 3000 })
  if (await page.locator('.modal .seg').count()) throw new Error('categorias apareceram')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/reportar-ia-modal.png` })
})

if (enviar) {
  await step('envia e o banco aceita o report', async () => {
    await page.fill('.feedback-textarea', 'TESTE AUTOMÁTICO do botão Reportar conteúdo da IA — pode ignorar.')
    const resposta = page.waitForResponse(r => r.url().includes('/rest/v1/feedback') && r.request().method() === 'POST')
    await page.click('.modal button[type="submit"]')
    const r = await resposta
    const corpo = JSON.parse(r.request().postData())
    if (r.status() !== 201) throw new Error(`status ${r.status()}: ${await r.text()}`)
    if (corpo.category !== 'Conteúdo da IA' || corpo.context.conversa !== conversaId) {
      throw new Error(`payload: ${JSON.stringify(corpo)}`)
    }
    await page.waitForSelector('.feedback-done', { timeout: 5000 })
    await page.screenshot({ path: `${OUT}/reportar-ia-enviado.png` })
  })
} else {
  await page.click('.modal button:has-text("Cancelar")')
}

await step('cabe no celular (380px) sem rolagem lateral', async () => {
  // Página nova no mesmo contexto: herda a sessão, mas já nasce estreita, sem
  // a gaveta da barra lateral animando por causa do redimensionamento.
  const cel = await ctx.newPage()
  await cel.setViewportSize({ width: 380, height: 780 })
  await cel.goto(`${base}#/conversa/${conversaId}`)
  await cel.waitForSelector('.btn-reportar-ia', { timeout: 10000 })
  await cel.waitForTimeout(600)
  await cel.screenshot({ path: `${OUT}/reportar-ia-celular.png` })
  const larga = await cel.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  if (larga) throw new Error('página mais larga que a tela')
})

if (errors.length) { console.log('\nerros:', errors); process.exitCode = 1 }
await browser.close()
