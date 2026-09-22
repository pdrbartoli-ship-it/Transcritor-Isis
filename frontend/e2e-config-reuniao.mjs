// O interruptor "Avisar quando uma reunião começar" nas Configurações.
//
// Ele só aparece no app de Windows, e só quando o executável já tem o
// detector — o site novo chega ao app antes do instalador novo. A marca
// `dito-simular-detector` faz a tela aparecer aqui, para o desenho e o texto
// poderem ser conferidos sem Windows.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
await p.goto(base + '#/auth')
await p.waitForSelector('input[type="email"]', { timeout: 20000 })
await p.click('text=Acessar')
await p.fill('input[type="email"]', creds.email)
await p.fill('input[type="password"]', creds.password)
await p.click('button[type="submit"]')
await p.waitForSelector('.home', { timeout: 25000 })

// Sem a marca, nada de interruptor: é o caso de quem abre o site no navegador.
await p.click('.nav-item:has-text("Configurações")')
await p.waitForSelector('.modal')
console.log('no navegador, interruptor visível:', await p.locator('.settings-switch').count() > 0)
if (await p.locator('.settings-switch').count()) throw new Error('o interruptor apareceu fora do app nativo')
await p.click('.modal .btn-primary')

await p.evaluate(() => localStorage.setItem('dito-simular-detector', '1'))
await p.reload()
await p.waitForSelector('.home', { timeout: 25000 })

for (const tema of ['light', 'dark']) {
  await p.evaluate(t => { localStorage.setItem('dito-theme', t); document.documentElement.setAttribute('data-theme', t) }, tema)
  await p.click('.nav-item:has-text("Configurações")')
  await p.waitForSelector('.settings-switch')
  const ligadoAntes = await p.locator('.settings-switch').getAttribute('aria-checked')
  await p.click('.settings-switch')
  const ligadoDepois = await p.locator('.settings-switch').getAttribute('aria-checked')
  const salvo = await p.evaluate(() => localStorage.getItem('dito-avisar-reuniao'))
  if (tema === 'light') {
    console.log('padrão:', ligadoAntes, '→ depois do clique:', ligadoDepois, '| guardado:', salvo)
    // Desde 22/09/2026 nasce LIGADO: o recurso só pergunta, nunca grava
    // sozinho, e desligado ele era descoberto tarde demais (ver prefs.js).
    if (ligadoAntes !== 'true') throw new Error('o recurso tem de nascer ligado')
    if (ligadoDepois !== 'false' || salvo !== '0') throw new Error('o interruptor não guardou a escolha')
    console.log('dica:', (await p.locator('.settings-switch + .hint').textContent()).replace(/\s+/g, ' ').trim())
  }
  await p.screenshot({ path: `.test-results/config-reuniao-${tema}.png` })
  // Volta ao padrão (ligado), para o teste não deixar o recurso desligado na
  // conta de quem rodou.
  await p.click('.settings-switch')
  await p.click('.modal .btn-primary')
}
await p.evaluate(() => localStorage.removeItem('dito-simular-detector'))
await b.close()
console.log('configuração da detecção ok')
