// Modo convidado: tema claro ao entrar (mesmo com o escuro guardado no
// navegador), contador em gravações (0/1) e não em minutos, convite "Entrar"
// no rodapé da barra lateral e o botão levando ao login sem jogar o convidado
// de volta para o app.
//
// Uso: node e2e-convidado.mjs [url]   (padrão: dev server local)
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const URL_BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = '.test-results/convidado'
mkdirSync(OUT, { recursive: true })

const falhas = []
const confere = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) falhas.push(msg) }

const browser = await chromium.launch()
for (const [nome, viewport] of [['desktop', { width: 1280, height: 800 }], ['celular', { width: 380, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  // Quem já usou o Dito com conta neste navegador e escolheu o escuro.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('semeado')) {
      localStorage.setItem('dito-theme', 'dark')
      sessionStorage.setItem('semeado', '1')
    }
  })
  await page.goto(URL_BASE)
  await page.click('.lp-nav-login')
  await page.waitForSelector('.app-shell', { timeout: 20000 })
  await page.waitForTimeout(800)

  const tema = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  confere(tema === 'light', `[${nome}] convidado entra no tema claro (veio: ${tema})`)

  const contador = (await page.locator('.contador-minutos').innerText()).trim()
  confere(contador === '0/1 gravação', `[${nome}] contador mostra a gravação do convidado (veio: ${contador})`)

  if (nome === 'celular') {
    await page.click('.hamburger')
    await page.waitForTimeout(400)
  }
  const convite = page.locator('.foot-convite')
  confere(await convite.isVisible(), `[${nome}] convite aparece no rodapé da barra lateral`)
  confere(await page.locator('.foot-user').count() === 0, `[${nome}] linha de e-mail vazia e "Sair" somem`)
  console.log(`   texto: ${(await convite.innerText()).replace(/\n+/g, ' | ')}`)
  await page.screenshot({ path: `${OUT}/${nome}-barra.png` })

  await convite.locator('button').click()
  await page.waitForTimeout(800)
  confere(page.url().includes('#/auth'), `[${nome}] "Entrar" leva ao login (url: ${page.url()})`)
  confere(await page.locator('.auth-card').isVisible(), `[${nome}] tela de login visível`)
  await page.screenshot({ path: `${OUT}/${nome}-login.png` })

  // Voltar pelo navegador devolve o convidado ao app, com a sessão intacta.
  await page.goBack()
  await page.waitForSelector('.app-shell', { timeout: 10000 })
  confere(true, `[${nome}] voltar do login devolve o convidado ao app`)

  // Recarregar mantém o claro — ele foi gravado, não só aplicado.
  await page.reload()
  await page.waitForSelector('.app-shell', { timeout: 20000 })
  const temaDepois = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  confere(temaDepois === 'light', `[${nome}] continua claro depois de recarregar (veio: ${temaDepois})`)
  await ctx.close()
}
await browser.close()

console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo')
process.exit(falhas.length ? 1 : 0)
