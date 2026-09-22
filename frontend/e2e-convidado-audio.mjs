// Regressão do bug: convidado (sem conta) sobe um áudio e a conversa tem de
// salvar sem o erro "Não foi possível abrir seu conteúdo cifrado".
// Uso: node e2e-convidado-audio.mjs [url]
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import path from 'path'

const URL_BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = '.test-results/convidado-audio'
mkdirSync(OUT, { recursive: true })

const falhas = []
const confere = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) falhas.push(msg) }

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()

page.on('console', msg => { if (msg.type() === 'error') console.log('  [console]', msg.text()) })

await page.goto(URL_BASE)
await page.click('.lp-nav-login')
await page.waitForSelector('.app-shell', { timeout: 20000 })
confere(true, 'convidado entrou no app')

await page.click('text=Áudio')
await page.waitForTimeout(300)

const input = page.locator('input[type="file"]')
await input.setInputFiles(path.resolve('.test-results/teste-fala.wav'))
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/antes-de-enviar.png` })
await page.click('text=Transcrição simples')
console.log('  arquivo enviado, transcrição iniciada, aguardando processamento...')

// Processar (upload + transcrição + resumo) demora; espera terminar em ir para
// a tela da conversa OU em aparecer o erro.
const foiParaConversa = page.waitForURL(/#\/conversa\//, { timeout: 120000 }).then(() => 'ok').catch(() => null)
const deuErro = page.locator('text=Não foi possível salvar a conversa').waitFor({ timeout: 120000 }).then(() => 'erro').catch(() => null)
const resultado = await Promise.race([foiParaConversa, deuErro])

if (resultado === 'erro') {
  const texto = await page.locator('text=Não foi possível salvar a conversa').innerText()
  confere(false, `apareceu erro ao salvar: ${texto}`)
} else if (resultado === 'ok') {
  confere(true, `conversa salva e aberta (url: ${page.url()})`)
} else {
  confere(false, 'nem salvou nem deu erro dentro do tempo limite')
}
await page.screenshot({ path: `${OUT}/resultado.png`, fullPage: true })

await browser.close()
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo')
process.exit(falhas.length ? 1 : 0)
