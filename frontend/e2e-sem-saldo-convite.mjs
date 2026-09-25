// Quando os minutos ou as perguntas do mês acabam, o Dito passa a mostrar o
// convite premiado ao lado de "Ver planos" (25/09/2026). Antes só havia "Ver
// planos": quem não ia assinar naquele momento ficava sem saída nenhuma, e o
// convite, que devolve minutos de graça, só existia num botão da barra lateral.
//
// O saldo é interceptado, então NADA aqui gasta minuto nem pergunta da conta.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const SUPABASE = 'https://hgmwngasnltlrqlwimdj.supabase.co'
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

let falhas = 0
function check(nome, ok, extra = '') {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'}  ${nome} ${extra}`)
  if (!ok) falhas++
}

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
const erros = []
page.on('pageerror', e => erros.push(e.message))

// Iniciante com tudo gasto: 250 minutos e 60 perguntas, todas usadas.
await page.route(`${SUPABASE}/rest/v1/uso_mensal*`, route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  headers: { 'cache-control': 'no-store' },
  body: JSON.stringify({
    minutos_usados: 250, perguntas_usadas: 60,
    periodo_fim: new Date(Date.now() + 864e5 * 10).toISOString(),
  }),
}))
await page.route(`${SUPABASE}/rest/v1/subscriptions*`, route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ plano: 'iniciante' }),
}))

await page.goto(base + '#/auth')
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })
await page.waitForTimeout(2000)

// ── 1. Home: minutos acabados ─────────────────────────────
const naHome = page.locator('.sem-saldo').first()
check('a home avisa que os minutos acabaram', await naHome.count() > 0)
if (await naHome.count()) {
  const texto = (await naHome.textContent()).replace(/\s+/g, ' ').trim()
  console.log('  faixa da home:', texto)
  check('oferece convidar amigos', /Convidar amigos/.test(texto))
  check('oferece ver planos', /Ver planos/.test(texto))
  check('diz quanto vale cada amigo', /\+\d+ min/.test(texto), texto.match(/\+\d+ min[^.]*/)?.[0] || '')
  // O convite vem primeiro: é o que resolve na hora e sem custo.
  const ordem = await naHome.evaluate(el =>
    [...el.querySelectorAll('button')].map(b => b.textContent.trim()))
  check('o convite vem antes dos planos', ordem[0]?.includes('Convidar'), ordem.join(' | '))
  await page.screenshot({ path: `${OUT}/sem-saldo-home.png` })

  // Clicar abre o modal do convite, não o de planos.
  await naHome.locator('button', { hasText: 'Convidar amigos' }).click()
  const abriu = await page.waitForSelector('.convite-link, .convite-regra', { timeout: 10000 })
    .then(() => true).catch(() => false)
  check('"Convidar amigos" abre o convite', abriu)
  await page.keyboard.press('Escape')
  await page.locator('.modal-overlay').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(500)
}

// ── 2. Perguntar: perguntas acabadas ──────────────────────
await page.click('.sidebar-perguntar')
await page.waitForSelector('.ask-esgotado', { timeout: 15000 })
const noPerguntar = (await page.locator('.ask-esgotado').first().textContent()).replace(/\s+/g, ' ').trim()
console.log('  barra do Perguntar:', noPerguntar)
check('o Perguntar diz que as perguntas acabaram', /perguntas deste mês/.test(noPerguntar))
check('o Perguntar oferece o convite', /Convidar amigos/.test(noPerguntar))
await page.screenshot({ path: `${OUT}/sem-saldo-perguntar.png` })

// ── 3. Conversa: o texto errado, corrigido ────────────────
await page.goto(base)
await page.waitForSelector('.sidebar-item', { timeout: 20000 })
await page.locator('.sidebar-item').first().click()
await page.waitForSelector('.conversa', { timeout: 15000 })
await page.waitForSelector('.ask-esgotado', { timeout: 15000 })
// Os números do prêmio vêm do servidor (/convite/estado), e o Render hiberna:
// a primeira chamada depois disso leva dezenas de segundos. Sem o convite
// carregado, a barra mostra só "Ver planos", como antes.
await page.locator('.ask-esgotado button', { hasText: 'Convidar amigos' })
  .waitFor({ timeout: 45000 }).catch(() => {})
const naConversa = (await page.locator('.ask-esgotado').first().textContent()).replace(/\s+/g, ' ').trim()
console.log('  barra da conversa:', naConversa)
// O limite virou mensal no commit 4290d7b e o texto continuava dizendo "desta
// transcrição", o que mandava a pessoa abrir outra conversa à toa.
check('não diz mais "desta transcrição"', !/desta transcrição/.test(naConversa))
check('diz "deste mês"', /deste mês/.test(naConversa))
check('a conversa também oferece o convite', /Convidar amigos/.test(naConversa))
await page.screenshot({ path: `${OUT}/sem-saldo-conversa.png` })

check('sem erro de página', erros.length === 0, erros[0] || '')
await b.close()
console.log(`\n${falhas === 0 ? 'convite no saldo esgotado ok' : `${falhas} falha(s)`}`)
process.exitCode = falhas ? 1 : 0
