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
  checar('Fundo da landing é o claro (#f6f8f7)', fundo === 'rgb(246, 248, 247)', fundo)

  // A preferência do usuário não pode ter sido apagada pela visita à landing.
  const salvo = await page.evaluate(() => localStorage.getItem('dito-theme'))
  checar('Preferência de tema do usuário continua salva', salvo === 'dark', `localStorage="${salvo}"`)

  await page.screenshot({ path: `${OUT}fase1-landing-clara.png`, fullPage: false })
  await ctx.close()
}

// ── Item 2: no Windows, o botão baixa o instalador da Microsoft ──────────
// Até 24/09/2026 o botão abria a página da Store numa aba nova e o .exe era o
// plano B. O .exe foi barrado pelo Defender como vírus e saiu da tela. O que
// precisa valer agora: um clique baixa o instalador da Microsoft sem tirar a
// pessoa da página, e quem usa conta de trabalho ou de escola (onde esse
// instalador não funciona) encontra o comando do winget.
{
  const COMANDO = 'winget install --id 9PDVG213Q755 --source msstore --accept-package-agreements --accept-source-agreements'
  const ctx = await navegador.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  // O instalador de verdade não interessa: só que o clique peça o arquivo
  // certo, e que a resposta seja tratada como download.
  await ctx.route('https://get.microsoft.com/**', rota => rota.fulfill({
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="Dito. Installer.exe"',
    },
    body: 'MZ',
  }))
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // Pela seção "No Windows, grave os dois lados", sem abrir o modal.
  const botaoSecao = page.locator('.lp-split-btn')
  await botaoSecao.scrollIntoViewIfNeeded()
  checar('Seção do Windows tem o botão de baixar', /Baixar para Windows/i.test(await botaoSecao.textContent()))
  checar(
    'Seção do Windows não leva mais à página da Store nem ao .exe',
    (await page.locator('a[href*="apps.microsoft.com"], a[href$=".exe"]').count()) === 0,
  )
  const abasAntes = ctx.pages().length
  const [baixouSecao] = await Promise.all([
    page.waitForEvent('download'),
    botaoSecao.click(),
  ])
  checar(
    'Um clique na seção baixa o instalador da Microsoft',
    baixouSecao.url() === 'https://get.microsoft.com/installer/download/9PDVG213Q755?cid=landing',
    baixouSecao.url(),
  )
  checar('O arquivo chega com o nome do instalador', baixouSecao.suggestedFilename() === 'Dito. Installer.exe', baixouSecao.suggestedFilename())
  checar('A pessoa não sai da página nem ganha aba nova', page.url().startsWith(BASE) && ctx.pages().length === abasAntes, page.url())
  const avisoSecao = await page.locator('.lp-split .instalar-ok').textContent()
  checar('A seção diz o que fazer com o arquivo', /download começou/i.test(avisoSecao) && /abre sozinho/i.test(avisoSecao), avisoSecao)
  await page.screenshot({ path: `${OUT}fase1-instalar-secao.png` })

  // Pelo modal de "Instalar grátis".
  await page.getByRole('button', { name: /Instalar gr[áa]tis/i }).first().click()
  await page.waitForSelector('.instalar-modal')
  await page.waitForTimeout(600)

  const botaoPrimario = await page.$$eval('.instalar-modal .btn-primary', bs => bs.map(b => b.textContent.trim()))
  checar('Botão principal do modal é baixar para Windows', botaoPrimario.some(t => /Baixar para Windows/i.test(t)), `primários: ${JSON.stringify(botaoPrimario)}`)

  const passos = await page.$$eval('.instalar-passos li', ls => ls.map(l => l.textContent.trim()))
  checar('Passos falam do arquivo baixado', passos.some(p => /arquivo baixado/i.test(p)), `${passos.length} passos`)
  checar('Passos não assustam com o aviso do Windows', !passos.some(p => /O Windows protegeu seu PC/i.test(p)))

  const htmlModal = await page.$eval('.instalar-modal', el => el.innerHTML)
  checar('O modal não oferece mais o .exe do GitHub', !/github\.com|Baixar o instalador/i.test(htmlModal))

  const [baixouModal] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.instalar-modal .btn-primary').click(),
  ])
  checar(
    'Um clique no modal baixa o instalador da Microsoft',
    baixouModal.url() === 'https://get.microsoft.com/installer/download/9PDVG213Q755?cid=modal',
    baixouModal.url(),
  )
  const avisoModal = await page.locator('.instalar-modal .instalar-ok').textContent()
  checar('O modal diz o que fazer com o arquivo', /download começou/i.test(avisoModal), avisoModal)

  // A saída de quem usa conta de trabalho ou de escola.
  const detalhes = page.locator('.instalar-modal .instalar-trabalho')
  checar('A saída de conta de trabalho começa fechada', !(await detalhes.evaluate(el => el.open)))
  await detalhes.locator('summary').click()
  checar('Ao abrir, mostra o comando do winget com o id do Dito', (await detalhes.locator('.instalar-comando').textContent()) === COMANDO)
  await detalhes.getByRole('button', { name: /Copiar comando/i }).click()
  const copiado = await page.evaluate(() => navigator.clipboard.readText())
  checar('Copiar comando põe o comando na área de transferência', copiado === COMANDO, copiado)
  checar('O botão confirma que copiou', /Copiado/i.test(await detalhes.locator('.instalar-copiar').textContent()))

  await page.screenshot({ path: `${OUT}fase1-instalar.png` })
  await ctx.close()

  // Fora do Windows o instalador seria um .exe inútil: a seção continua só
  // com o link da página da Store, para instalar depois no PC.
  const celular = await navegador.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
  })
  const pagCelular = await celular.newPage()
  await pagCelular.goto(BASE, { waitUntil: 'networkidle' })
  const linkStore = pagCelular.locator('a.lp-split-btn')
  checar(
    'Fora do Windows a seção só leva à página da Store',
    (await linkStore.count()) === 1 &&
      /apps\.microsoft\.com\/detail\/9pdvg213q755/i.test(await linkStore.getAttribute('href')) &&
      (await pagCelular.locator('.instalar-trabalho, button.lp-split-btn').count()) === 0,
  )
  await celular.close()
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
