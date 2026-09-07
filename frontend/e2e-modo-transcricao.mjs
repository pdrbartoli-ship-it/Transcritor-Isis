// Checagem visual do botão de transcrever (botão + lista) e da nova tela de
// carregamento. Não dispara transcrição de verdade: a rota /transcribe é
// interceptada e responde com um resultado falso, então nada de API paga.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'

const creds = JSON.parse(readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const BASE = creds.dev_url || 'http://localhost:5173'
const OUT = new URL('./.test-results/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const shot = async (page, nome) => {
  await page.screenshot({ path: `${OUT}modo-${nome}.png`, fullPage: false })
  console.log('  📸', nome)
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
const page = await ctx.newPage()

const erros = []
page.on('pageerror', e => erros.push(String(e)))
page.on('console', m => { if (m.type() === 'error') erros.push(m.text()) })

// Nada de captura real: qualquer chamada de transcrição volta pronta.
let modoEnviado = null
await page.route('**/transcribe', async route => {
  modoEnviado = route.request().postData()?.match(/name="mode"\r?\n\r?\n(\w+)/)?.[1] || null
  console.log('  → /transcribe mode =', modoEnviado)
  await new Promise(r => setTimeout(r, 4000)) // tempo de fotografar o carregamento
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'teste' }) })
})

console.log('▶ login')
await page.goto(`${BASE}/#/auth`)
await page.getByText('Acessar', { exact: true }).first().click()
await page.locator('input[type="email"]').fill(creds.email)
await page.locator('input[type="password"]').fill(creds.password)
await page.locator('button[type="submit"]').click()
await page.waitForSelector('.home-capture', { timeout: 20000 })

// ── 1. Gravação curta → recomendação "simples"
console.log('▶ gravação curta')
await page.locator('.record-btn').click()
await page.waitForTimeout(2500)
await page.locator('.record-btn').click()
await page.waitForSelector('.split-btn', { timeout: 10000 })
await shot(page, '01-gravacao-botao')
console.log('  botão principal:', await page.locator('.split-main').innerText())

await page.locator('.split-toggle').click()
await page.waitForSelector('.split-menu')
await shot(page, '02-gravacao-lista')
const itens = await page.locator('.split-menu li').allInnerTexts()
console.log('  lista:', JSON.stringify(itens))

// Escolher a completa e enviar → tela de carregamento
await page.locator('.split-menu button', { hasText: 'Transcrição completa' }).click()
console.log('  após escolher:', await page.locator('.split-main').innerText())
await page.locator('.split-main').click()
await page.waitForSelector('.processing-orb', { timeout: 10000 })
await shot(page, '03-carregando')
console.log('  carregando:', JSON.stringify(await page.locator('.hero-record').innerText()))
await page.waitForSelector('.alert-error', { timeout: 20000 })

// ── 2. Arquivo → escolhe, revisa, recomenda
console.log('▶ arquivo')
await page.goto(`${BASE}/#/audio`)
await page.waitForSelector('.drop-zone, .pick-file')
const wav = `${OUT}modo-teste.wav`
writeFileSync(wav, wavDeSilencio(30))
await page.locator('input[type="file"]').setInputFiles(wav)
await page.waitForSelector('.file-review', { timeout: 10000 })
await shot(page, '04-arquivo-revisao')
console.log('  botão principal:', await page.locator('.split-main').innerText())
await page.locator('.split-toggle').click()
await page.waitForSelector('.split-menu')
await shot(page, '05-arquivo-lista')

// ── 3. Link do YouTube → recomendação "completa"
console.log('▶ link')
await page.goto(`${BASE}/#/video`)
await page.waitForSelector('.url-form')
await page.locator('.url-form input').fill('https://www.youtube.com/watch?v=abc12345678')
await shot(page, '06-link')
console.log('  botão principal:', await page.locator('.split-main').innerText())
await page.locator('.split-toggle').click()
await page.waitForSelector('.split-menu')
await shot(page, '07-link-lista')

// ── 4. Celular, em aba própria: redimensionar a janela do desktop deixa a
// barra lateral no estado errado e a foto sai mentindo sobre o layout.
console.log('▶ celular (380px)')
const cel = await ctx.newPage()
await cel.setViewportSize({ width: 380, height: 780 })
await cel.goto(`${BASE}/#/video`)
await cel.waitForSelector('.url-form')
await cel.locator('.url-form input').fill('https://youtu.be/abc12345678')
await cel.locator('.split-toggle').click()
await cel.waitForSelector('.split-menu')
await shot(cel, '08-celular-lista')
await cel.goto(`${BASE}/#/audio`)
await cel.waitForSelector('.pick-file, .drop-zone')
await cel.locator('input[type="file"]').setInputFiles(wav)
await cel.waitForSelector('.file-review')
await shot(cel, '09-celular-arquivo')

console.log(erros.length ? `\n❌ erros de console:\n${erros.join('\n')}` : '\n✅ sem erros de console')
// Checagem extra: o mesmo carregamento em tema escuro, e mais um frame do
// anel respirando (para conferir que a animação não estoura o círculo).
console.log('▶ tema escuro')
const dark = await ctx.newPage()
await dark.route('**/transcribe', async route => {
  await new Promise(r => setTimeout(r, 3000))
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'teste' }) })
})
await dark.goto(`${BASE}/#/`)
await dark.waitForSelector('.home-capture', { timeout: 10000 }).catch(() => {})
await dark.evaluate(() => localStorage.setItem('dito-theme', 'dark'))
await dark.reload()
await dark.waitForSelector('.record-btn', { timeout: 10000 })
await dark.locator('.record-btn').click()
await dark.waitForTimeout(1500)
await dark.locator('.record-btn').click()
await dark.waitForSelector('.split-btn', { timeout: 10000 })
await dark.locator('.split-main').click()
await dark.waitForSelector('.processing-orb', { timeout: 10000 })
await shot(dark, '10-escuro-t0')
await dark.waitForTimeout(1000)
await shot(dark, '11-escuro-t1')

await browser.close()

// WAV mono 16 kHz de silêncio, só para o navegador conseguir ler a duração.
function wavDeSilencio(segundos) {
  const rate = 16000, dados = rate * segundos * 2
  const buf = Buffer.alloc(44 + dados)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dados, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dados, 40)
  return buf
}

