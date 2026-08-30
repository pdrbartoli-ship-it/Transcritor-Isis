// Fase 1: login, home nova (gravar + Arquivos/Link recolhidos + últimas
// conversas), busca na sidebar, tema e abertura de uma conversa.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

const step = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`) }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1 }
}

await page.goto(creds.dev_url || 'http://localhost:5173/')
await page.waitForLoadState('networkidle')

// login
await page.click('text=Entrar ou criar conta').catch(() => {})
await page.waitForSelector('input[type="email"]', { timeout: 15000 })
// A tela abre na aba "Criar conta"; o login está na outra.
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })
console.log('login ok\n')

await step('botão de gravar visível', async () => {
  await page.waitForSelector('.record-btn.hero', { timeout: 5000 })
})

await step('as três origens são abas, e Gravar é a padrão', async () => {
  const abas = (await page.locator('.capture-tabs a').allTextContents()).map(t => t.trim())
  if (abas.join('|') !== 'Gravar|Arquivo|YouTube') throw new Error(`abas: ${abas}`)
  const ativa = (await page.textContent('.capture-tabs a.on')).trim()
  if (ativa !== 'Gravar') throw new Error(`aba ativa: "${ativa}"`)
})

await step('Arquivo abre em rota própria, com o título do WhatsApp', async () => {
  await page.click('.capture-tabs a:has-text("Arquivo")')
  await page.waitForSelector('.drop-zone', { timeout: 3000 })
  if (!page.url().endsWith('#/arquivo')) throw new Error(`rota: ${page.url()}`)
  const t = await page.textContent('.capture-mode-title')
  if (t.trim() !== 'Transcreva áudios do WhatsApp') throw new Error(`título: "${t}"`)
})

await step('YouTube abre em rota própria, com o título certo', async () => {
  await page.click('.capture-tabs a:has-text("YouTube")')
  await page.waitForSelector('.url-form', { timeout: 3000 })
  if (!page.url().endsWith('#/youtube')) throw new Error(`rota: ${page.url()}`)
  const t = await page.textContent('.capture-mode-title')
  if (t.trim() !== 'Transcreva vídeos do YouTube') throw new Error(`título: "${t}"`)
  // "Últimas conversas" é a mesma nas três — por isso continua aqui. A espera
  // é porque neste ponto do roteiro a lista ainda pode estar chegando: o
  // login acima só aguarda a home aparecer, não os dados.
  await page.waitForFunction(
    () => document.querySelectorAll('.conversation-card').length > 0,
    { timeout: 20000 },
  ).catch(() => { throw new Error('a lista de conversas sumiu fora da home') })
  await page.click('.capture-tabs a:has-text("Gravar")')
  await page.waitForSelector('.record-btn.hero', { timeout: 3000 })
})

await step('seção Últimas conversas existe', async () => {
  await page.waitForSelector('.recent-title', { timeout: 3000 })
})

let firstId = null
await step('sidebar lista conversas', async () => {
  await page.waitForSelector('.sidebar-list', { timeout: 5000 })
  // A lista chega por rede; esperar o "Carregando…" sair evita contar cedo.
  await page.waitForFunction(
    () => !document.querySelector('.sidebar-empty')?.textContent.includes('Carregando'),
    { timeout: 15000 },
  )
  const n = await page.locator('.sidebar-item').count()
  const cards = await page.locator('.conversation-card').count()
  console.log(`       (${n} na sidebar, ${cards} cards na home)`)
  if (n !== cards) throw new Error('sidebar e home discordam')
})

await step('abrir uma conversa navega para /conversa/:id', async () => {
  const cards = page.locator('.conversation-card')
  if (await cards.count() === 0) { console.log('       (sem conversas — pulado)'); return }
  await cards.first().click()
  await page.waitForURL(/#\/conversa\/[0-9a-f-]+/, { timeout: 10000 })
  await page.waitForSelector('.conversa-head h1', { timeout: 10000 })
  firstId = page.url()
  await page.screenshot({ path: `${OUT}/fase1-conversa.png`, fullPage: true })
})

await step('voltar do navegador retorna à home', async () => {
  if (!firstId) return
  await page.goBack()
  await page.waitForSelector('.home', { timeout: 10000 })
})

await step('busca abre pela lupa e responde', async () => {
  // A busca deixou de ocupar uma faixa fixa: agora sai da lupa no cabeçalho.
  await page.click('.tool-btn[aria-label="Buscar conversas"]')
  await page.waitForSelector('.sidebar-search input')
  await page.fill('.sidebar-search input', 'a')
  await page.waitForTimeout(1200)
  const labels = await page.locator('.sidebar-section-label').allTextContents()
  const empty = await page.locator('.sidebar-empty').count()
  if (!labels.length && !empty) throw new Error('busca não renderizou nem resultado nem vazio')
  console.log(`       (seções: ${labels.join(', ') || 'nenhuma'})`)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.sidebar-search', { state: 'detached' })
})

await step('lista da sidebar vem agrupada por recência', async () => {
  const grupos = await page.locator('.sidebar-group-label').allTextContents()
  if (!grupos.length) throw new Error('nenhum grupo de data na sidebar')
  const crus = await page.locator('.sidebar-item-text').evaluateAll(
    els => els.filter(e => e.textContent.trim().startsWith('http')).length)
  if (crus) throw new Error(`${crus} títulos ainda são URLs cruas`)
  console.log(`       (grupos: ${grupos.join(', ')})`)
})

await step('Tema abre com só claro/escuro', async () => {
  await page.click('.nav-item:has-text("Tema")')
  await page.waitForSelector('.modal', { timeout: 3000 })
  const groups = await page.locator('.modal .settings-group').count()
  if (groups !== 1) throw new Error(`esperava 1 grupo, achei ${groups}`)
  const body = await page.textContent('.modal')
  for (const gone of ['Profundidade', 'Formato', 'Tom']) {
    if (body.includes(gone)) throw new Error(`"${gone}" ainda aparece`)
  }
  await page.click('.modal .btn-primary')
})

await step('rótulo do feedback mudou', async () => {
  await page.click('.nav-feedback')
  await page.waitForSelector('.modal h3', { timeout: 3000 })
  const t = await page.textContent('.modal h3')
  if (t.trim() !== 'Deixe um feedback para gente!') throw new Error(`título: "${t}"`)
  await page.click('.modal .btn-icon')
})

await step('Meu plano existe', async () => {
  await page.click('.nav-item:has-text("Meu plano")')
  await page.waitForSelector('.modal h3', { timeout: 3000 })
  await page.click('.modal .btn-primary')
})

await step('sem Configurações/Pastas na sidebar', async () => {
  const side = await page.textContent('.sidebar')
  for (const gone of ['Nova pasta', 'Pastas', 'Configurações', 'Fale com a gente']) {
    if (side.includes(gone)) throw new Error(`"${gone}" ainda na sidebar`)
  }
})

await page.screenshot({ path: `${OUT}/fase1-home.png`, fullPage: true })
await browser.close()

console.log(`\nerros de console: ${errors.length}`)
errors.slice(0, 10).forEach(e => console.log('  ' + e))
if (errors.length) process.exitCode = 1
