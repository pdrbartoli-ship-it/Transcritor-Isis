// Fluxo completo da transcricao simples, com o backend fingido: envia, cai no
// chat com o resumo ja como primeira mensagem, volta a visao geral e apaga a
// conversa de teste no fim (nao deixa lixo na conta).
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'

const creds = JSON.parse(readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const BASE = creds.dev_url || 'http://localhost:5173'
const OUT = new URL('./.test-results/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}simples-${n}.png` }); console.log('  [foto]', n) }

const TITULO = 'ZZ teste modo simples'
const RESUMO = [
  '- A equipe fechou o escopo da primeira entrega para a semana que vem.',
  '- O orcamento de midia sobe 15% em outubro.',
  '- Falta decidir quem apresenta o resultado na reuniao de diretoria.',
].join('\n')

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
const page = await ctx.newPage()
const erros = []
page.on('pageerror', e => erros.push(String(e)))
page.on('console', m => { if (m.type() === 'error') erros.push(m.text()) })

let modoEnviado = null
await page.route('**/transcribe', async route => {
  modoEnviado = route.request().postData()?.match(/name="mode"\r?\n\r?\n(\w+)/)?.[1] || null
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      transcript: 'Isto e uma transcricao de teste sobre escopo, orcamento e apresentacao.',
      summary: RESUMO,
      chunks_used: 1,
      duration_estimate: '0 min',
      title: TITULO,
      segments: [{ start: 0, end: 12, text: 'Isto e uma transcricao de teste.' }],
      insights: null,
      duration_s: 12,
      mode: 'simples',
      usage: { input_tokens: 500, output_tokens: 80, audio_seconds: 12 },
    }),
  })
})

console.log('login')
await page.goto(`${BASE}/#/auth`)
await page.getByText('Acessar', { exact: true }).first().click()
await page.locator('input[type="email"]').fill(creds.email)
await page.locator('input[type="password"]').fill(creds.password)
await page.locator('button[type="submit"]').click()
await page.waitForSelector('.home-capture', { timeout: 20000 })

console.log('envia um arquivo em modo simples')
await page.goto(`${BASE}/#/audio`)
await page.waitForSelector('.drop-zone, .pick-file')
const wav = `${OUT}simples-teste.wav`
writeFileSync(wav, wavDeSilencio(60))
await page.locator('input[type="file"]').setInputFiles(wav)
await page.waitForSelector('.file-review')
console.log('  recomendado:', await page.locator('.split-main').innerText())
await page.locator('.split-main').click()

await page.waitForURL(/\/conversa\/[^/]+\/chat/, { timeout: 30000 })
console.log('  rota final:', new URL(page.url()).hash)
console.log('  mode enviado:', modoEnviado)
await page.waitForSelector('.message.assistant', { timeout: 15000 })
await shot(page, '01-chat')
console.log('  1a mensagem:', JSON.stringify(await page.locator('.message.assistant .bubble').first().innerText()))
console.log('  campo de perguntar:', await page.locator('.chat-input textarea').count())

console.log('visao geral da mesma conversa')
const idConversa = page.url().match(/conversa\/([^/]+)/)[1]
await page.goto(`${BASE}/#/conversa/${idConversa}`)
await page.waitForSelector('.empty-insights', { timeout: 15000 })
await shot(page, '02-visao-geral')
console.log('  oferta:', JSON.stringify(await page.locator('.empty-insights').innerText()))
await page.waitForTimeout(2000)

// Limpeza: apagar de verdade, pelo mesmo menu que o usuario usa (botao
// direito na barra lateral). Sem isto cada rodada deixa uma conversa de teste
// na conta.
console.log('limpeza: apaga a conversa de teste')
for (let i = 0; i < 6; i++) {
  const alvo = page.locator('.sidebar').getByText(TITULO, { exact: false }).first()
  if (await alvo.count() === 0) break
  await alvo.click({ button: 'right' })
  await page.waitForSelector('.ctx-menu', { timeout: 5000 })
  await page.locator('.ctx-item.danger').click()
  await page.locator('.btn-danger').click()
  await page.waitForTimeout(2500)
}
const sobrou = await page.locator('.sidebar').getByText(TITULO).count()
console.log(sobrou === 0 ? '  conversa de teste apagada' : `  ATENCAO: ainda aparece ${sobrou}x - apague a mao`)

console.log(erros.length ? `\nerros de console:\n${erros.join('\n')}` : '\nsem erros de console')
await browser.close()

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
