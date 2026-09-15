// Verificação da Fase 2 (devolutivas 4, 7 e 8) no que a tela desenha.
//
// O plano Grátis é simulado interceptando a leitura de `subscriptions`: a conta
// de teste é Iniciante, e é assim que dá para ver as duas réguas com uma conta
// só. O limite de perguntas e a completa barrada no servidor são do backend e
// só se provam em produção.
//
// Rodar com o dev server de pé:  cd frontend && node e2e-fase2-devolutivas.mjs

import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const creds = JSON.parse(readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const RAIZ = (process.env.DITO_URL || creds.dev_url || 'http://localhost:5173').replace(/\/+$/, '')
const OUT = new URL('./.test-results/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const TEXTOS = {
  'Grátis': ['100 minutos por mês', 'Transcrição simples', 'Limite de 2 perguntas por transcrição', 'Criptografia de ponta a ponta'],
  Iniciante: ['1000 minutos por mês', 'Transcrição simples e completa', 'Limite de 10 perguntas por transcrição', 'Criptografia de ponta a ponta'],
  'Avançado': ['2000 minutos por mês', 'Transcrição simples e completa', 'Criptografia de ponta a ponta'],
}

const resultados = []
const checar = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok })
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

async function entrar(page) {
  await page.goto(`${RAIZ}/#/auth`, { waitUntil: 'networkidle' })
  // A tela abre na aba "Criar conta"; sem clicar em Acessar o submit cadastra.
  await page.getByRole('button', { name: 'Acessar', exact: true }).click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home, .layout, .sidebar', { timeout: 30000 })
}

// Faz a conta de teste parecer Grátis para o frontend. Responde nos dois
// formatos do PostgREST: objeto (quando pedido como um registro só) ou lista.
async function simularGratis(ctx) {
  await ctx.route('**/rest/v1/subscriptions**', rota => {
    const objeto = (rota.request().headers()['accept'] || '').includes('vnd.pgrst.object')
    const corpo = objeto ? { plano: 'gratuito' } : [{ plano: 'gratuito' }]
    return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) })
  })
}

const botaoPrincipal = page => page.locator('.url-form .split-main')

const navegador = await chromium.launch()

// ── Landing: textos novos, sem o app de Windows como argumento de venda ────
{
  const ctx = await navegador.newContext()
  const page = await ctx.newPage()
  await page.goto(`${RAIZ}/`, { waitUntil: 'networkidle' })
  const cards = await page.$$eval('.lp-plano', els => els.map(el => ({
    nome: el.querySelector('h3')?.textContent.trim(),
    itens: [...el.querySelectorAll('li')].map(li => li.textContent.trim()),
  })))
  for (const [nome, itens] of Object.entries(TEXTOS)) {
    const card = cards.find(c => c.nome === nome)
    checar(`Landing · ${nome} com os textos novos`, JSON.stringify(card?.itens) === JSON.stringify(itens), JSON.stringify(card?.itens))
  }
  checar('Landing não vende "App de Windows" nos planos', !cards.some(c => c.itens.some(i => /Windows/i.test(i))))
  await ctx.close()
}

// ── Grátis: completa trancada, simples por padrão, cadeado leva aos planos ─
{
  const ctx = await navegador.newContext()
  await simularGratis(ctx)
  const page = await ctx.newPage()
  await entrar(page)
  await page.goto(`${RAIZ}/#/video`, { waitUntil: 'networkidle' })
  await page.fill('.url-form input[type="url"]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

  // O plano chega depois do primeiro desenho; é quando ele chega que o botão
  // troca de completa (a recomendação para link) para simples.
  await page.waitForFunction(
    () => document.querySelector('.url-form .split-main')?.textContent.trim() === 'Transcrição simples',
    null, { timeout: 15000 },
  ).catch(() => {})
  checar('Grátis · link do YouTube já vem em "Transcrição simples"', (await botaoPrincipal(page).textContent()).trim() === 'Transcrição simples')

  await page.click('.url-form .split-toggle')
  const completa = page.locator('.split-menu li button', { hasText: 'Transcrição completa' })
  checar('Grátis · completa aparece trancada no menu', (await completa.getAttribute('class'))?.includes('travada'))
  checar('Grátis · selo "Planos pagos" na completa', (await completa.textContent()).includes('Planos pagos'))
  await page.screenshot({ path: `${OUT}fase2-gratis-menu.png` })

  await completa.click()
  const abriuPlanos = await page.waitForSelector('.modal-wide', { timeout: 5000 }).then(() => true).catch(() => false)
  checar('Grátis · clicar na completa abre os planos', abriuPlanos)
  checar('Grátis · e o botão continua em simples', (await botaoPrincipal(page).textContent()).trim() === 'Transcrição simples')

  if (abriuPlanos) {
    await page.waitForSelector('.plano.on', { timeout: 10000 }).catch(() => {})
    const cards = await page.$$eval('.plano', els => els.map(el => ({
      nome: el.querySelector('.plano-nome')?.textContent.trim(),
      itens: [...el.querySelectorAll('li')].map(li => li.textContent.trim()),
      atual: el.classList.contains('on'),
    })))
    for (const [nome, itens] of Object.entries(TEXTOS)) {
      const card = cards.find(c => c.nome === nome)
      checar(`Meu plano · ${nome} com os textos novos`, JSON.stringify(card?.itens) === JSON.stringify(itens), JSON.stringify(card?.itens))
    }
    checar('Meu plano · Grátis marcado como atual', cards.find(c => c.atual)?.nome === 'Grátis')
    await page.screenshot({ path: `${OUT}fase2-gratis-planos.png` })
  }
  await ctx.close()
}

// ── Pago: nada muda para quem assina ───────────────────────────────────────
{
  const ctx = await navegador.newContext()
  const page = await ctx.newPage()
  await entrar(page)
  await page.goto(`${RAIZ}/#/video`, { waitUntil: 'networkidle' })
  await page.fill('.url-form input[type="url"]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.waitForTimeout(3000)
  checar('Iniciante · link do YouTube continua em "Transcrição completa"', (await botaoPrincipal(page).textContent()).trim() === 'Transcrição completa')
  await page.click('.url-form .split-toggle')
  const completa = page.locator('.split-menu li button', { hasText: 'Transcrição completa' })
  checar('Iniciante · completa sem cadeado', !(await completa.getAttribute('class'))?.includes('travada'))
  await ctx.close()
}

await navegador.close()
const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`)
process.exit(falhas.length ? 1 : 0)
