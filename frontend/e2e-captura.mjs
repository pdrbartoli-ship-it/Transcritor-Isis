// As três origens de captura como rotas irmãs, e "Últimas conversas" idêntica
// nas três.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
await p.goto(base); await p.waitForLoadState('networkidle')
await p.click('text=Entrar ou criar conta').catch(()=>{})
await p.waitForSelector('input[type="email"]'); await p.click('text=Acessar')
await p.fill('input[type="email"]', creds.email); await p.fill('input[type="password"]', creds.password)
await p.click('button[type="submit"]'); await p.waitForSelector('.home', { timeout: 25000 })
await p.waitForFunction(() => document.querySelectorAll('.conversation-card').length > 0, { timeout: 20000 })

const alturas = []
const recentes = []
for (const [aba, hash, espera] of [
  ['Gravar', '#/', '.record-btn.hero'],
  ['Arquivo', '#/arquivo', '.drop-zone'],
  ['YouTube', '#/youtube', '.url-form'],
]) {
  await p.click(`.capture-tabs a:has-text("${aba}")`)
  await p.waitForSelector(espera, { timeout: 5000 })
  if (!p.url().endsWith(hash)) throw new Error(`${aba} não foi para ${hash} (${p.url()})`)
  const ativa = await p.locator('.capture-tabs a.on').textContent()
  const painel = await p.locator('.capture-panel').boundingBox()
  const titulo = await p.locator('.capture-mode-title').count()
    ? await p.locator('.capture-mode-title').textContent() : '(sem título)'
  alturas.push(Math.round(painel.height))
  recentes.push(await p.locator('.recent').boundingBox().then(r => Math.round(r.y)))
  console.log(`${aba.padEnd(8)} rota ${hash.padEnd(10)} aba ativa "${ativa.trim()}"  painel ${Math.round(painel.height)}px  ${titulo}`)
  await p.screenshot({ path: `.test-results/cap-${aba.toLowerCase()}.png` })
}
console.log('altura do painel igual nas três:', new Set(alturas).size === 1, alturas)
console.log('"Últimas conversas" no mesmo y nas três:', new Set(recentes).size === 1, recentes)

// cada rota abre direto, sem passar pela home
await p.goto(base + '#/youtube'); await p.waitForSelector('.url-form')
console.log('deep-link /youtube abre no painel certo:', await p.locator('.capture-tabs a.on').textContent())
console.log('cards de conversa presentes:', await p.locator('.conversation-card').count())

// voltar do navegador percorre as abas
await p.goBack(); await p.waitForTimeout(400)
console.log('voltar sai de /youtube ->', await p.evaluate(() => location.hash))

await p.goto(base + '#/arquivo'); await p.waitForSelector('.drop-zone')
await p.click('.nav-item:has-text("Tema")'); await p.click('.modal .seg button:has-text("Escuro")'); await p.click('.modal .btn-primary')
await p.waitForTimeout(300)
await p.screenshot({ path: '.test-results/cap-dark.png' })
await p.evaluate(() => localStorage.setItem('dito-theme', 'light'))
await b.close(); console.log('captura ok')
