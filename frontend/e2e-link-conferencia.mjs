// Verificação do link do YouTube: duração rápida e clique que não deixa gastar
// à toa.
//
// Nada aqui gasta minuto: o saldo e o plano são simulados interceptando o
// Supabase, e /process-url é interceptado e recusado antes de sair do
// navegador. O /duracao-link é real no primeiro caso (mede a velocidade de
// verdade) e simulado nos outros (para controlar o atraso).
//
// Rodar contra produção:  cd frontend && DITO_URL=https://pdrbartoli-ship-it.github.io/Transcritor-Isis node e2e-link-conferencia.mjs

import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const creds = JSON.parse(readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const RAIZ = (process.env.DITO_URL || creds.dev_url || 'http://localhost:5173').replace(/\/+$/, '')
const OUT = new URL('./.test-results/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const resultados = []
const checar = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok })
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
const dormir = ms => new Promise(r => setTimeout(r, ms))

function responder(rota, registro) {
  const objeto = (rota.request().headers()['accept'] || '').includes('vnd.pgrst.object')
  return rota.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(objeto ? registro : [registro]),
  })
}

async function entrar(page) {
  await page.goto(`${RAIZ}/#/auth`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Acessar', exact: true }).click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home, .layout, .sidebar', { timeout: 30000 })
}

// `duracao`: undefined = deixa o /duracao-link real passar; { s, atrasoMs } = simula.
async function contexto(navegador, { plano, minutosUsados, duracao }) {
  const ctx = await navegador.newContext()
  await ctx.route('**/rest/v1/subscriptions**', r => responder(r, { plano }))
  const fim = new Date(Date.now() + 20 * 86400e3).toISOString()
  await ctx.route('**/rest/v1/uso_mensal**', r => responder(r, { minutos_usados: minutosUsados, periodo_fim: fim }))

  const visto = { processUrl: [], duracaoLink: 0 }
  await ctx.route('**/process-url', async rota => {
    visto.processUrl.push(Date.now())
    await rota.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'interceptado pelo teste' }) })
  })
  await ctx.route('**/duracao-link', async rota => {
    visto.duracaoLink++
    if (!duracao) return rota.continue()
    await dormir(duracao.atrasoMs)
    await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ duracao_s: duracao.s }) })
  })
  const page = await ctx.newPage()
  await entrar(page)
  await page.goto(`${RAIZ}/#/video`, { waitUntil: 'networkidle' })
  return { ctx, page, visto }
}

// Cola de verdade: o evento de colar liga o atalho que pula o debounce.
async function colar(page, url) {
  const campo = page.locator('.url-form input[type="url"]')
  await campo.focus()
  await campo.evaluate(el => el.dispatchEvent(new Event('paste', { bubbles: true })))
  await campo.fill(url)
}

const texto = async (page, seletor) => (await page.locator(seletor).first().textContent({ timeout: 15000 }).catch(() => null))?.trim()
const LINK = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const navegador = await chromium.launch()

// ── 1. Velocidade real: colar e ver os minutos no botão ────────────────────
{
  const { ctx, page } = await contexto(navegador, { plano: 'iniciante', minutosUsados: 0 })
  await page.waitForSelector('.url-form input[type="url"]')
  const t0 = Date.now()
  await colar(page, LINK)
  await page.waitForSelector('.split-minutos', { timeout: 30000 }).catch(() => {})
  const dt = Date.now() - t0
  checar('Colar · botão diz os minutos', /· 1 min$/.test((await texto(page, '.split-main')) || ''), await texto(page, '.split-main'))
  checar('Colar · duração em menos de 2 s', dt < 2000, `${dt} ms`)
  await ctx.close()
}

// ── 2. Mês esgotado: "Ver planos" na hora, sem consultar duração ──────────
{
  const { ctx, page, visto } = await contexto(navegador, { plano: 'gratuito', minutosUsados: 100 })
  await page.waitForSelector('.url-form .btn-primary', { timeout: 15000 }).catch(() => {})
  await colar(page, LINK)
  await dormir(1500)
  checar('Esgotado · botão vira "Ver planos"', (await texto(page, '.url-form .btn-primary')) === 'Ver planos')
  checar('Esgotado · sem botão de transcrever', await page.locator('.split-btn').count() === 0)
  checar('Esgotado · linha explica o motivo', /Você usou os 100 minutos do seu mês/.test((await texto(page, '.linha-consumo')) || ''), await texto(page, '.linha-consumo'))
  checar('Esgotado · não consultou a duração', visto.duracaoLink === 0, `${visto.duracaoLink} chamadas`)
  await page.screenshot({ path: `${OUT}link-esgotado.png` })
  await page.locator('.url-form .btn-primary').click()
  checar('Esgotado · clique abre os planos', await page.waitForSelector('.modal-wide', { timeout: 5000 }).then(() => true).catch(() => false))
  await ctx.close()
}

// ── 3. Clique antes da duração, e cabe: envia sozinho ao chegar ────────────
{
  const { ctx, page, visto } = await contexto(navegador, { plano: 'gratuito', minutosUsados: 0, duracao: { s: 600, atrasoMs: 1500 } })
  await colar(page, LINK)
  const t0 = Date.now()
  await page.locator('.split-main').click()
  checar('Cabe · botão mostra que está conferindo', (await texto(page, '.split-main')) === 'Conferindo o saldo…', await texto(page, '.split-main'))
  await page.screenshot({ path: `${OUT}link-conferindo.png` })
  await page.waitForFunction(() => true)
  for (let i = 0; i < 60 && !visto.processUrl.length; i++) await dormir(100)
  const dt = visto.processUrl.length ? visto.processUrl[0] - t0 : null
  checar('Cabe · enviou depois de a duração chegar', visto.processUrl.length === 1 && dt >= 1300, `${dt} ms`)
  await ctx.close()
}

// ── 4. Clique antes da duração, e NÃO cabe: não envia ─────────────────────
{
  const { ctx, page, visto } = await contexto(navegador, { plano: 'gratuito', minutosUsados: 95, duracao: { s: 1200, atrasoMs: 1500 } })
  await colar(page, LINK)
  await page.locator('.split-main').click()
  await page.waitForSelector('.linha-consumo.excede', { timeout: 10000 }).catch(() => {})
  await dormir(500)
  checar('Não cabe · linha diz 20 min e restam 5', /Esta captura tem 20 min e restam 5/.test((await texto(page, '.linha-consumo')) || ''), await texto(page, '.linha-consumo'))
  checar('Não cabe · nada foi enviado', visto.processUrl.length === 0)
  await page.screenshot({ path: `${OUT}link-nao-cabe.png` })
  await page.locator('.split-main').click()
  checar('Não cabe · novo clique abre os planos', await page.waitForSelector('.modal-wide', { timeout: 5000 }).then(() => true).catch(() => false))
  checar('Não cabe · e ainda nada enviado', visto.processUrl.length === 0)
  await ctx.close()
}

// ── 5. Duração que nunca chega: envia depois de 4 s ────────────────────────
{
  const { ctx, page, visto } = await contexto(navegador, { plano: 'gratuito', minutosUsados: 0, duracao: { s: 600, atrasoMs: 9000 } })
  await colar(page, LINK)
  const t0 = Date.now()
  await page.locator('.split-main').click()
  for (let i = 0; i < 80 && !visto.processUrl.length; i++) await dormir(100)
  const dt = visto.processUrl.length ? visto.processUrl[0] - t0 : null
  checar('Sem resposta · envia depois do teto de ~4 s', dt != null && dt >= 3800 && dt < 6000, `${dt} ms`)
  await ctx.close()
}

// ── 6. Saldo de sobra: nem espera ──────────────────────────────────────────
{
  const { ctx, page, visto } = await contexto(navegador, { plano: 'avancado', minutosUsados: 0, duracao: { s: 600, atrasoMs: 3000 } })
  await colar(page, LINK)
  const t0 = Date.now()
  await page.locator('.split-main').click()
  for (let i = 0; i < 40 && !visto.processUrl.length; i++) await dormir(100)
  const dt = visto.processUrl.length ? visto.processUrl[0] - t0 : null
  checar('Saldo de sobra · envia sem esperar a duração', dt != null && dt < 1500, `${dt} ms`)
  await ctx.close()
}

await navegador.close()
const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações ok`)
process.exit(falhas.length ? 1 : 0)
