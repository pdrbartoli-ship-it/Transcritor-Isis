// Convite e régua nova EM PRODUÇÃO, sem nada simulado. Não gasta minuto nem
// pergunta: só lê o saldo, abre o convite (o que cria o código da conta de
// teste, se ainda não existir) e confere a landing com esse código.
// Uso: node e2e-convite-prod.mjs [url]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const url = (process.argv.slice(2).find(a => a.startsWith('http')) || 'https://dito.albiecloud.com/').replace(/#.*$/, '')
const OUT = '.test-results/convite-prod'
mkdirSync(OUT, { recursive: true })

let ok = 0, falhas = 0
const check = (nome, cond, detalhe = '') => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome} ${detalhe}`) }
}

const browser = await chromium.launch()
const erros = []
const respostas = {}

// ── App: saldo com as colunas novas, convite com o link real ──
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
page.on('pageerror', e => erros.push(e.message))
page.on('response', r => {
  const u = r.url()
  if (u.includes('/convite/') || u.includes('/rest/v1/uso_mensal')) respostas[u.split('?')[0]] = r.status()
})
await page.goto(url + '#/auth')
await page.waitForSelector('input[type="email"]', { timeout: 30000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 60000 })
await page.waitForSelector('.contador-minutos', { timeout: 30000 })
const relogio = (await page.locator('.contador-minutos').innerText()).trim()
check('saldo lido com as colunas novas (relógio aparece)', /minutos/.test(relogio), relogio)
const usoStatus = Object.entries(respostas).find(([u]) => u.includes('uso_mensal'))?.[1]
check('uso_mensal responde 200', usoStatus === 200, String(usoStatus))

await page.locator('.nav-item:has-text("Convidar amigos")').click()
await page.waitForSelector('.convite-modal .convite-link input', { timeout: 90000 })
const link = await page.locator('.convite-link input').inputValue()
check('link real de convite', /^dito\.albiecloud\.com\/\?c=[a-z0-9]{7}$/.test(link), link)
const topo = (await page.locator('.convite-topo').innerText()).replace(/\s+/g, ' ')
console.log(`        (topo do convite: ${topo})`)
await page.locator('.convite-modal').screenshot({ path: `${OUT}/modal.png` })
await page.screenshot({ path: `${OUT}/app.png` })
const codigo = link.split('c=')[1]

await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } })
await page.locator('.nav-item:has-text("Convidar amigos")').click()
await page.waitForSelector('.convite-modal .convite-link input', { timeout: 30000 })
check('o mesmo código na segunda vez', (await page.locator('.convite-link input').inputValue()) === link)
check('rotas do convite respondem 200',
  Object.entries(respostas).filter(([u]) => u.includes('/convite/')).every(([, s]) => s === 200),
  JSON.stringify(respostas))
await page.close()

// ── Landing: faixa com o código real e os planos novos ──
const lp = await browser.newPage({ viewport: { width: 1280, height: 900 } })
lp.on('pageerror', e => erros.push(e.message))
await lp.goto(url + `?c=${codigo}`)
await lp.waitForSelector('.lp', { timeout: 30000 })
check('landing: faixa do convite', await lp.locator('.lp-convite-faixa').count() === 1)
check('landing: ?c= sai do endereço', !lp.url().includes('c='), lp.url())
await lp.locator('#precos').scrollIntoViewIfNeeded()
await lp.waitForFunction(() => document.querySelector('.lp-plano.destaque h3')?.textContent === 'Avançado', null, { timeout: 30000 }).catch(() => {})
check('landing: Avançado recomendado', (await lp.locator('.lp-plano.destaque h3').innerText()) === 'Avançado')
check('landing: Avançado com minutos ilimitados', await lp.locator('.lp-plano.destaque li:has-text("Minutos ilimitados")').count() === 1)
check('landing: seção Convide amigos', await lp.locator('#convite h2:has-text("Convide amigos")').count() === 1)
await lp.screenshot({ path: `${OUT}/landing.png` })
await lp.locator('.lp-convite-faixa button').click()
await lp.waitForSelector('.auth-card', { timeout: 10000 })
check('landing: faixa leva ao cadastro', await lp.locator('.auth-tabs button.active:has-text("Criar conta")').count() === 1)
check('código guardado para o cadastro', (await lp.evaluate(() => localStorage.getItem('dito-convite')) || '').includes(codigo))

check('sem erro de página', erros.length === 0, erros.join(' | '))
console.log(`\n${ok} ok, ${falhas} falha(s)`)
await browser.close()
process.exit(falhas ? 1 : 0)
