// Verificação da Fase 4 (devolutiva 6): checkout no desenho do Notion.
//
// O plano Grátis é simulado interceptando a leitura de `subscriptions`, para os
// botões de upgrade estarem ativos. O pedido de checkout também é interceptado:
// confere-se o plano e o ciclo que iriam para o Stripe, sem abrir pagamento.
//
// Rodar com o dev server de pé:  cd frontend && node e2e-fase4-devolutivas.mjs

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

// toLocaleString separa "R$" do número com espaço inseparável.
const limpo = t => (t || '').replace(/\s+/g, ' ').trim()
const texto = async (loc) => limpo(await loc.first().textContent({ timeout: 15000 }).catch(() => ''))

function responder(rota, registro) {
  const objeto = (rota.request().headers()['accept'] || '').includes('vnd.pgrst.object')
  return rota.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(objeto ? registro : [registro]),
  })
}

async function preencherLogin(page) {
  await page.getByRole('button', { name: 'Acessar', exact: true }).click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home, .layout, .sidebar', { timeout: 30000 })
}

const navegador = await chromium.launch()

// ── Landing: manchete anual por mês ────────────────────────────────────────
{
  const ctx = await navegador.newContext()
  const page = await ctx.newPage()
  await page.goto(`${RAIZ}/`, { waitUntil: 'networkidle' })
  const card = nome => page.locator('.lp-plano', { has: page.locator('h3', { hasText: nome }) })
  checar('Landing · Iniciante com o anual por mês na frente', (await texto(card('Iniciante').locator('.lp-plano-preco'))) === 'R$ 11,25por mês', await texto(card('Iniciante').locator('.lp-plano-preco')))
  checar('Landing · Iniciante com o mensal embaixo', (await texto(card('Iniciante').locator('p.text-sm'))) === 'com cobrança anual · R$ 14,99 cobrado mensalmente')
  checar('Landing · Avançado com o anual por mês na frente', (await texto(card('Avançado').locator('.lp-plano-preco strong'))) === 'R$ 15,00')
  await ctx.close()
}

// ── Meu plano: tabela, faturamento e checkout ──────────────────────────────
{
  const ctx = await navegador.newContext()
  await ctx.route('**/rest/v1/subscriptions**', r => responder(r, { plano: 'gratuito' }))
  let pedido = null
  await ctx.route('**/billing/create-checkout-session', async rota => {
    pedido = JSON.parse(rota.request().postData() || '{}')
    await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'about:blank' }) })
  })
  const page = await ctx.newPage()
  await page.goto(`${RAIZ}/#/auth`, { waitUntil: 'networkidle' })
  await preencherLogin(page)

  await page.getByRole('button', { name: /Meu plano/i }).first().click()
  await page.waitForSelector('.planos .plano')
  checar('Meu plano · sem o seletor mensal/anual', await page.locator('.planos-ciclo').count() === 0)

  const iniciante = page.locator('.plano', { has: page.locator('.plano-nome', { hasText: 'Iniciante' }) })
  checar('Meu plano · manchete é o anual por mês', (await texto(iniciante.locator('.plano-preco'))) === 'R$ 11,25 por mês')
  const notas = (await iniciante.locator('.plano-preco-nota').allTextContents()).map(limpo)
  checar('Meu plano · notas de cobrança anual e mensal', JSON.stringify(notas) === JSON.stringify(['com cobrança anual', 'R$ 14,99 cobrado mensalmente']), JSON.stringify(notas))

  const listas = await page.$$eval('.plano ul', uls => uls.map(u => Math.round(u.getBoundingClientRect().top)))
  checar('Meu plano · listas de benefícios alinhadas nos três cards', new Set(listas).size === 1, JSON.stringify(listas))
  await page.waitForSelector('.plano.on', { timeout: 10000 }).catch(() => {})
  await page.locator('.modal-wide').screenshot({ path: `${OUT}fase4-tabela.png` })

  await iniciante.getByRole('button', { name: 'Fazer upgrade' }).click()
  await page.waitForSelector('.faturamento')
  checar('Faturamento · título diz o plano', (await texto(page.locator('.modal-header h3'))) === 'Assinar o plano Iniciante')
  checar('Faturamento · anual já marcado', await page.locator('#ciclo-anual').isChecked())
  checar('Faturamento · selo de economia', (await texto(page.locator('.faturamento-selo'))) === 'Economize 25%')
  checar('Faturamento · total anual', (await texto(page.locator('.faturamento-valor'))) === 'R$ 135,00 / ano', await texto(page.locator('.faturamento-valor')))
  await page.locator('.modal-wide').screenshot({ path: `${OUT}fase4-faturamento-anual.png` })

  await page.locator('label', { has: page.locator('#ciclo-mensal') }).click()
  checar('Faturamento · trocar para mensal troca o total', (await texto(page.locator('.faturamento-valor'))) === 'R$ 14,99 / mês', await texto(page.locator('.faturamento-valor')))

  await page.getByRole('button', { name: 'Continuar para o pagamento' }).click()
  await page.waitForTimeout(1500)
  checar('Faturamento · checkout recebe plano e ciclo escolhidos', pedido?.plano === 'iniciante' && pedido?.ciclo === 'mensal', JSON.stringify(pedido))
  await ctx.close()
}

// ── Voltar para a tabela ───────────────────────────────────────────────────
{
  const ctx = await navegador.newContext()
  await ctx.route('**/rest/v1/subscriptions**', r => responder(r, { plano: 'gratuito' }))
  const page = await ctx.newPage()
  await page.goto(`${RAIZ}/#/auth`, { waitUntil: 'networkidle' })
  await preencherLogin(page)
  await page.getByRole('button', { name: /Meu plano/i }).first().click()
  await page.locator('.plano', { has: page.locator('.plano-nome', { hasText: 'Avançado' }) }).getByRole('button', { name: 'Fazer upgrade' }).click()
  await page.getByRole('button', { name: 'Ver todos os planos' }).click()
  checar('Voltar · "Ver todos os planos" devolve a tabela', await page.locator('.planos .plano').count() === 3 && await page.locator('.faturamento').count() === 0)
  await ctx.close()
}

// ── Plano escolhido na landing abre direto no faturamento ─────────────────
{
  const ctx = await navegador.newContext()
  await ctx.route('**/rest/v1/subscriptions**', r => responder(r, { plano: 'gratuito' }))
  const page = await ctx.newPage()
  await page.goto(`${RAIZ}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Assinar Avançado' }).click()
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await preencherLogin(page)
  const abriu = await page.waitForSelector('.faturamento', { timeout: 15000 }).then(() => true).catch(() => false)
  checar('Landing → login · abre direto nas opções do plano escolhido', abriu)
  if (abriu) checar('Landing → login · é o plano que foi escolhido', (await texto(page.locator('.modal-header h3'))) === 'Assinar o plano Avançado')
  await ctx.close()
}

await navegador.close()
const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`)
process.exit(falhas.length ? 1 : 0)
