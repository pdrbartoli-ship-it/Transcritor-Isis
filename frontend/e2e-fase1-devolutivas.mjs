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

// ── Item 2: no Windows, um clique baixa e abre o guia de instalação ──────
// Desde 25/09/2026 o "Instalar grátis" no Windows não abre mais modal: o clique
// já baixa o instalador da Microsoft e cobre a landing com o guia de
// InstalarWindows.jsx. Quem vê o instalador da Microsoft falhar (computador de
// empresa ou de escola) baixa ali mesmo o instalador do Dito, e o guia mostra
// onde clicar nos avisos do Windows.
{
  const INSTALADOR_DITO = 'https://github.com/pdrbartoli-ship-it/Transcritor-Isis/releases/download/desktop-latest/Dito-setup.exe'
  const ctx = await navegador.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    acceptDownloads: true,
  })
  // Os instaladores de verdade não interessam: só que o clique peça o arquivo
  // certo, e que a resposta seja tratada como download.
  const baixar = nome => rota => rota.fulfill({
    status: 200,
    headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${nome}"` },
    body: 'MZ',
  })
  await ctx.route('https://get.microsoft.com/**', baixar('Dito. Installer.exe'))
  await ctx.route(`${INSTALADOR_DITO}*`, baixar('Dito-setup.exe'))
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // "Instalar grátis" do topo: baixa na hora, sem modal no meio.
  const abasAntes = ctx.pages().length
  const [baixou] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Instalar gr[áa]tis/i }).first().click(),
  ])
  checar(
    'Instalar grátis baixa o instalador da Microsoft no primeiro clique',
    baixou.url() === 'https://get.microsoft.com/installer/download/9PDVG213Q755?cid=landing',
    baixou.url(),
  )
  checar('O arquivo chega com o nome do instalador', baixou.suggestedFilename() === 'Dito. Installer.exe', baixou.suggestedFilename())
  checar('Nenhum modal no caminho', (await page.locator('.instalar-modal').count()) === 0)

  const guia = page.getByRole('dialog', { name: /Abra o arquivo para instalar o Dito/i })
  await guia.waitFor()
  const caixa = await guia.boundingBox()
  checar('O guia cobre a tela inteira', caixa.width === 1366 && caixa.height === 768, JSON.stringify(caixa))
  checar('A pessoa não sai da página nem ganha aba nova', page.url().startsWith(BASE) && ctx.pages().length === abasAntes, page.url())
  checar('O título ganha o foco', await page.evaluate(() => document.activeElement?.id === 'iw-titulo'))
  checar('A landing por trás fica inerte', await page.evaluate(() => document.getElementById('root').inert === true))

  const passosLoja = await guia.locator('.iw-passos li').allTextContents()
  checar('Três passos, a começar pelo arquivo baixado', passosLoja.length === 3 && /Dito\. Installer\.exe/.test(passosLoja[0]), `${passosLoja.length} passos`)
  const textoLoja = await guia.textContent()
  checar('O guia não fala de conta de trabalho ou de escola', !/conta de trabalho|conta corporativa|conta de escola|qualifica/i.test(textoLoja))
  checar('O plano B aparece logo de cara', /Deu erro ou abriu a Microsoft Store\?/.test(textoLoja))

  // O palco anda sozinho: a legenda narra o clique da vez e o cursor vai até o
  // "Abrir arquivo".
  await page.waitForTimeout(1900)
  checar('A legenda narra a cena', /Clique em Abrir arquivo/.test(await guia.locator('.iw-legenda').textContent()))
  const cursor = await guia.locator('.iw-cursor').boundingBox()
  const alvo = await guia.locator('[data-alvo="abrir"]').boundingBox()
  checar(
    'O cursor clica em cima do Abrir arquivo',
    cursor.x >= alvo.x - 4 && cursor.x <= alvo.x + alvo.width + 4 && cursor.y >= alvo.y - 4 && cursor.y <= alvo.y + alvo.height + 4,
    `cursor ${Math.round(cursor.x)},${Math.round(cursor.y)} alvo ${Math.round(alvo.x)},${Math.round(alvo.y)}`,
  )
  await page.screenshot({ path: `${OUT}fase1-instalar-loja.png` })

  // Plano B: o instalador do Dito, com o guia dos avisos do Windows.
  const [baixouDito] = await Promise.all([
    page.waitForEvent('download'),
    guia.getByRole('button', { name: /Baixar o instalador do Dito/i }).click(),
  ])
  checar('O plano B baixa o instalador do Dito', baixouDito.url() === INSTALADOR_DITO, baixouDito.url())
  const guiaDito = page.getByRole('dialog', { name: /O Windows vai pedir sua confirmação/i })
  await guiaDito.waitFor()
  const textoDito = await guiaDito.textContent()
  checar('Mostra onde clicar no aviso do navegador', /Manter assim mesmo/.test(textoDito))
  checar('Mostra onde clicar no aviso do Windows', /Mais informações/.test(textoDito) && /Executar assim mesmo/.test(textoDito))
  checar('Diz que o aviso não é vírus', /não quer dizer que o Windows encontrou vírus/.test(textoDito))
  checar(
    'Aponta a Microsoft Store como prova',
    /apps\.microsoft\.com\/detail\/9pdvg213q755/i.test(await guiaDito.getByRole('link', { name: /Ver na Microsoft Store/i }).getAttribute('href')),
  )
  checar('Todo texto do guia sem travessão', !/[—–]/.test(textoLoja + textoDito))

  // Escolher um passo mostra aquele passo no palco.
  await guiaDito.locator('.iw-passos li').nth(1).locator('button').click()
  await page.waitForTimeout(1800)
  checar('Escolher o passo 2 mostra a tela azul do Windows', (await guiaDito.locator('.iw-smart').count()) === 1)
  await page.screenshot({ path: `${OUT}fase1-instalar-dito.png` })

  await page.keyboard.press('Escape')
  checar('Esc fecha o guia e devolve a landing', (await page.locator('.iw').count()) === 0 && await page.evaluate(() => !document.getElementById('root').inert))

  // Pela seção "No Windows, grave os dois lados": o mesmo caminho.
  const botaoSecao = page.locator('.lp-split-btn')
  await botaoSecao.scrollIntoViewIfNeeded()
  const [baixouSecao] = await Promise.all([page.waitForEvent('download'), botaoSecao.click()])
  checar(
    'O botão da seção também baixa e abre o guia',
    baixouSecao.url().startsWith('https://get.microsoft.com/installer/download/9PDVG213Q755') && (await page.locator('.iw').count()) === 1,
  )
  await page.getByRole('button', { name: 'Fechar' }).click()
  checar('Fechar devolve a landing', (await page.locator('.iw').count()) === 0)
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
      (await pagCelular.locator('button.lp-split-btn').count()) === 0,
  )
  await pagCelular.getByRole('button', { name: /Instalar gr[áa]tis/i }).first().click()
  checar('Fora do Windows, Instalar grátis continua abrindo o modal', (await pagCelular.locator('.instalar-modal').count()) === 1)
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
