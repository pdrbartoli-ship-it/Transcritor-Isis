// Tela do Perguntar sem o "Nova pergunta" e com a bandeira de sinalizar embaixo
// de cada resposta. Não gasta pergunta: abre uma pergunta anterior, que só lê o
// que já foi respondido. Uso: node e2e-perguntar-rodape.mjs [url]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const url = process.argv.slice(2).find(a => a.startsWith('http')) || creds.dev_url
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

let ok = 0, falhas = 0
const check = (nome, cond, detalhe = '') => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome} ${detalhe}`) }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const erros = []
page.on('pageerror', e => erros.push(e.message))

await page.goto(url.replace(/#.*$/, '') + '#/auth')
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 30000 })

await page.click('.sidebar-perguntar')
await page.waitForSelector('.ask-hero', { timeout: 10000 })
check('tela vazia sem "Nova pergunta"', await page.locator('text=Nova pergunta').count() === 0)
check('tela vazia sem bandeira no topo', await page.locator('.btn-reportar-ia, .conversa-topbar').count() === 0)
await page.screenshot({ path: `${OUT}/perguntar-vazia.png` })

await page.waitForSelector('.ask-anteriores button', { timeout: 15000 }).catch(() => {})
const anterior = page.locator('.ask-anteriores button').first()
if (!await anterior.count()) {
  console.log('  sem pergunta anterior na conta: não dá para testar sem gastar pergunta')
} else {
  const alturaAntes = await page.evaluate(() => history.length)
  await anterior.click()
  await page.waitForSelector('.message.assistant', { timeout: 10000 })
  check('resposta aberta sem "Nova pergunta"', await page.locator('text=Nova pergunta').count() === 0)
  const bandeiras = await page.locator('.message.assistant .btn-sinalizar-resposta').count()
  check('uma bandeira por resposta', bandeiras === await page.locator('.message.assistant').count(), `(${bandeiras})`)
  const opacidade = await page.locator('.btn-sinalizar-resposta').first().evaluate(e => getComputedStyle(e).opacity)
  check('bandeira discreta em repouso', Number(opacidade) < 0.6, `(opacity ${opacidade})`)
  await page.screenshot({ path: `${OUT}/perguntar-resposta.png` })
  await page.locator('.btn-sinalizar-resposta').last().hover()
  await page.waitForTimeout(250)
  await page.locator('.message.assistant').last().screenshot({ path: `${OUT}/perguntar-bandeira-hover.png` })

  await page.locator('.btn-sinalizar-resposta').last().click()
  await page.waitForSelector('.modal h3:has-text("Sinalizar conteúdo da IA")', { timeout: 3000 })
  check('bandeira abre o modal de sinalizar', true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (await page.locator('.modal').count()) await page.locator('.modal button:has-text("Cancelar")').click().catch(() => {})
  await page.waitForSelector('.modal', { state: 'detached', timeout: 3000 }).catch(() => {})

  await page.click('.sidebar-perguntar')
  await page.waitForSelector('.ask-hero', { timeout: 5000 }).catch(() => {})
  check('clicar em Perguntar de novo volta à tela inicial', await page.locator('.ask-hero').count() === 1)
  check('sem entrada nova no histórico', await page.evaluate(() => history.length) === alturaAntes)
}

await page.setViewportSize({ width: 380, height: 800 })
await page.locator('.ask-anteriores button').first().click().catch(() => {})
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/perguntar-celular.png` })

check('sem erro de página', erros.length === 0, erros.join(' | '))
console.log(`\n${ok} ok, ${falhas} falha(s)`)
await browser.close()
process.exit(falhas ? 1 : 0)
