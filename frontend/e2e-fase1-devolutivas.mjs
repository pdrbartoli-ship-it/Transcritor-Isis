// Verificação das correções da Fase 1 (devolutivas 1, 2 e 5).
//
// Os itens 3 e 9 (sessão/token) não entram aqui: dependem do backend em
// produção recusando ou aceitando um token, e não do que a tela desenha.
//
// Rodar com o dev server de pé:  cd frontend && node e2e-fase1-devolutivas.mjs

import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const creds = JSON.parse(readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const BASE = process.env.DITO_URL || creds.dev_url || 'http://localhost:5173'
const OUT = new URL('./.test-results/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const resultados = []
const checar = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok, detalhe })
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

const navegador = await chromium.launch()

// ── Item 1: a landing ignora o tema escuro salvo ──────────────────────────
{
  const ctx = await navegador.newContext()
  const page = await ctx.newPage()
  // Grava a preferência escura ANTES de a landing carregar, que é exatamente o
  // caso do usuário que já usou o app no escuro e voltou ao site.
  await page.addInitScript(() => localStorage.setItem('dito-theme', 'dark'))
  await page.goto(BASE, { waitUntil: 'networkidle' })

  const tema = await page.getAttribute('html', 'data-theme')
  checar('Landing fica clara mesmo com tema escuro salvo', tema === 'light', `data-theme="${tema}"`)

  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  checar('Fundo da landing é o claro (#faf9f5)', fundo === 'rgb(250, 249, 245)', fundo)

  // A preferência do usuário não pode ter sido apagada pela visita à landing.
  const salvo = await page.evaluate(() => localStorage.getItem('dito-theme'))
  checar('Preferência de tema do usuário continua salva', salvo === 'dark', `localStorage="${salvo}"`)

  await page.screenshot({ path: `${OUT}fase1-landing-clara.png`, fullPage: false })
  await ctx.close()
}

// ── Item 2: o modal de instalar não convida ao clique errado ──────────────
{
  const ctx = await navegador.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    acceptDownloads: true,
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Instalar gr[áa]tis/i }).first().click()
  await page.waitForSelector('.instalar-modal')
  await page.waitForTimeout(600)

  const textoBotoes = await page.$$eval('.instalar-modal button', bs => bs.map(b => b.textContent.trim()))
  const botaoPrimario = await page.$$eval(
    '.instalar-modal .btn-primary',
    bs => bs.map(b => b.textContent.trim()),
  )
  checar(
    'Nenhum botão primário escrito "Baixar de novo"',
    !botaoPrimario.some(t => /Baixar de novo/i.test(t)),
    `primários: ${JSON.stringify(botaoPrimario)}`,
  )
  checar(
    '"Baixar de novo" virou link discreto',
    textoBotoes.some(t => /O download não começou\? Baixar de novo/i.test(t)),
    `botões: ${JSON.stringify(textoBotoes)}`,
  )

  const passos = await page.$$eval('.instalar-passos li', ls => ls.map(l => l.textContent.trim()))
  checar('Passos explicam o aviso do Windows pelo nome', passos.some(p => /O Windows protegeu seu PC/i.test(p)), `${passos.length} passos`)
  checar('Passos dizem onde clicar', passos.some(p => /Mais informações/i.test(p) ) && passos.some(p => /Executar assim mesmo/i.test(p)))

  await page.screenshot({ path: `${OUT}fase1-instalar.png` })
  await ctx.close()
}

// ── Item 5: "Meu plano" não muda de tamanho nem troca de plano sozinho ────
{
  const ctx = await navegador.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/#/auth`, { waitUntil: 'networkidle' })

  // A tela abre na aba "Criar conta"; sem clicar em Acessar o submit cadastra.
  await page.getByRole('button', { name: 'Acessar', exact: true }).click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home, .layout, .sidebar', { timeout: 30000 })

  // Atrasa de propósito as leituras do Supabase: sem isso o dado chega junto
  // com a abertura e o teste não consegue separar o estado "ainda sem resposta"
  // do estado final — que é justamente o pulo que se quer flagrar.
  await page.route('**/rest/v1/**', async rota => {
    await new Promise(r => setTimeout(r, 2000))
    await rota.continue()
  })

  // Abre "Meu plano" e mede o card em dois instantes: com o modal já assentado
  // (o `modal-in` leva 0,2s indo de scale(0.98) a scale(1), e medir no meio da
  // animação acusaria um crescimento que é só a abertura) e depois que os dados
  // chegaram. Antes da correção o modal nascia menor e esticava, e a marca de
  // plano atual pulava do gratuito para o assinado.
  await page.getByRole('button', { name: /Meu plano/i }).first().click()
  await page.waitForSelector('.planos .plano')
  await page.waitForFunction(
    () => document.querySelector('.modal-wide')?.getAnimations().every(a => a.playState === 'finished'),
  )

  const alturaInicial = await page.$eval('.modal-wide', el => Math.round(el.getBoundingClientRect().height))
  const ativosInicial = await page.$$eval('.plano.on .plano-nome', ns => ns.map(n => n.textContent.trim()))

  await page.waitForTimeout(3500)

  const alturaFinal = await page.$eval('.modal-wide', el => Math.round(el.getBoundingClientRect().height))
  const ativosFinal = await page.$$eval('.plano.on .plano-nome', ns => ns.map(n => n.textContent.trim()))

  checar(
    'Modal "Meu plano" não muda de altura depois de carregar',
    alturaInicial === alturaFinal,
    `${alturaInicial}px → ${alturaFinal}px`,
  )
  checar(
    'Nenhum plano é marcado como atual antes dos dados chegarem',
    ativosInicial.length === 0,
    `no primeiro quadro: ${JSON.stringify(ativosInicial)}`,
  )
  checar(
    'O plano atual aparece uma vez só, no card certo',
    ativosFinal.length === 1,
    `ao final: ${JSON.stringify(ativosFinal)}`,
  )

  await page.screenshot({ path: `${OUT}fase1-meu-plano.png` })
  await ctx.close()
}

await navegador.close()

const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`)
console.log(`Capturas em ${OUT}`)
process.exit(falhas.length ? 1 : 0)
