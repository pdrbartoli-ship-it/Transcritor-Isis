// Nomear quem fala (25/09/2026).
//
// 1. O nome de um locutor vira um botão dentro da transcrição: clicar abre um
//    campo, e o nome escrito ali vale para a conversa inteira (transcrição,
//    responsáveis das tarefas e arquivo baixado).
// 2. "Seu nome" nas Configurações viaja junto de cada captura, para a IA saber
//    de quem é a voz de quem gravou em vez de chamá-la de "Locutor 1".
//
// O teste renomeia e DESFAZ a mudança no fim, para não deixar a conversa do
// usuário alterada.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
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

await page.goto(base + '#/auth')
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })

// ── 1. "Seu nome" nas Configurações ───────────────────────
await page.click('.nav-item:has-text("Configurações")')
await page.waitForSelector('.modal')
const campoNome = page.locator('#settings-nome')
check('Configurações tem o campo "Seu nome"', await campoNome.count() > 0)
if (await campoNome.count()) {
  await campoNome.fill('Pedro')
  await page.waitForTimeout(300)
  const salvo = await page.evaluate(() => localStorage.getItem('dito-nome'))
  check('o nome é guardado no aparelho', salvo === 'Pedro', `(${salvo})`)
  const dica = (await page.locator('#settings-nome').locator('xpath=../p[@class="hint"]').textContent().catch(() => '')) || ''
  if (dica) console.log('  dica:', dica.replace(/\s+/g, ' ').trim())
  await page.screenshot({ path: `${OUT}/locutores-config.png` })
}
await page.click('.modal-header .btn-icon')

// ── 2. Renomear um locutor na transcrição ─────────────────
// Procura uma conversa cuja transcrição mostre nomes de locutor.
await page.waitForSelector('.sidebar-item', { timeout: 20000 })
const quantas = await page.locator('.sidebar-item').count()
let renomeou = false

for (let i = 0; i < Math.min(quantas, 12) && !renomeou; i++) {
  await page.goto(base)
  await page.waitForSelector('.sidebar-item', { timeout: 15000 })
  await page.locator('.sidebar-item').nth(i).click()
  await page.waitForSelector('.conversa', { timeout: 15000 })
  await page.waitForTimeout(600)
  // A transcrição com locutores vive no minuto a minuto e nos tópicos.
  const temTimeline = await page.locator('.timeline-slot').count() > 0
  if (!temTimeline) continue
  await page.locator('.timeline-slot').first().click()
  await page.waitForTimeout(400)
  await page.locator('.chapter-preview').click().catch(() => {})
  await page.waitForTimeout(900)

  const botoes = page.locator('.fala-speaker-botao')
  if (!await botoes.count()) continue

  const original = (await botoes.first().textContent()).trim()
  const quantosAntes = await page.locator('.fala-speaker-botao', { hasText: original }).count()
  console.log(`  conversa ${i}: locutor "${original}" em ${quantosAntes} bloco(s)`)
  await page.screenshot({ path: `${OUT}/locutores-antes.png` })

  await botoes.first().click()
  const campo = page.locator('.fala-speaker-campo')
  check('clicar no nome abre um campo', await campo.count() > 0)
  const NOVO = 'Teste Dito'
  await campo.fill(NOVO)
  await campo.press('Enter')
  await page.waitForTimeout(1500)

  const depois = await page.locator('.fala-speaker-botao', { hasText: NOVO }).count()
  check('o nome novo vale em todos os blocos daquela pessoa', depois === quantosAntes, `(${depois}/${quantosAntes})`)
  check('o nome antigo sumiu', await page.locator('.fala-speaker-botao', { hasText: original }).count() === 0)
  await page.screenshot({ path: `${OUT}/locutores-depois.png` })

  // Sobrevive a recarregar: foi gravado, não só trocado na tela.
  await page.reload()
  await page.waitForSelector('.fala-speaker-botao', { timeout: 20000 })
  const aposRecarregar = await page.locator('.fala-speaker-botao', { hasText: NOVO }).count()
  check('o nome novo sobrevive a recarregar', aposRecarregar > 0, `(${aposRecarregar})`)

  // Desfaz, para não deixar a conversa do usuário mexida.
  await page.locator('.fala-speaker-botao', { hasText: NOVO }).first().click()
  await page.locator('.fala-speaker-campo').fill(original)
  await page.locator('.fala-speaker-campo').press('Enter')
  await page.waitForTimeout(1500)
  const voltou = await page.locator('.fala-speaker-botao', { hasText: original }).count()
  check('desfazer volta ao nome de antes', voltou === quantosAntes, `(${voltou}/${quantosAntes})`)
  renomeou = true
}

if (!renomeou) console.log('  nenhuma conversa com locutores nomeados entre as 12 primeiras: renomear não conferido')

// Limpa o nome de teste das Configurações.
await page.evaluate(() => localStorage.removeItem('dito-nome'))

check('sem erro de página', erros.length === 0, erros[0] || '')
await b.close()
console.log(`\n${falhas === 0 ? 'locutores ok' : `${falhas} falha(s)`}`)
process.exitCode = falhas ? 1 : 0
