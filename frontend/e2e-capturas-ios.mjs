// Capturas de tela da App Store (iPhone 6,5": 1242 × 2688), feitas no app de
// verdade, com a conta de revisão da loja e o app se comportando como no
// iPhone (sem landing, sem "Meu plano").
//
// O conteúdo é uma reunião fictícia (~/dito-loja-ios/demo.json), gravada na
// conta de revisão pelo mesmo caminho que o app usa depois de uma captura.
// Nada pessoal aparece na loja. A pergunta do chat é respondida pela IA de
// verdade (gasta 1 pergunta da conta de revisão, só na primeira vez).
//
// Uso (com o `npm run dev` rodando): node e2e-capturas-ios.mjs
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'

const DEV = 'http://localhost:5173/'
const EMAIL = 'playstore.review@dito-app.com'
const SENHA = 'DitoReview#2026xk'
const OUT = `${homedir()}/dito-loja-ios`
mkdirSync(OUT, { recursive: true })
const demo = JSON.parse(readFileSync(`${OUT}/demo.json`, 'utf8'))

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
})
// O app decide "estou no iPhone" por aqui (Capacitor.getPlatform).
await ctx.addInitScript(() => { window.CapacitorCustomPlatform = { name: 'ios', plugins: {} } })
const page = await ctx.newPage()

async function limpar() {
  // Some com o que não é a tela em si: o aviso de boas-vindas e o de prêmio.
  await page.locator('.welcome-modal button').first().click({ timeout: 1500 }).catch(() => {})
  await page.locator('.premio-aviso-fechar').click({ timeout: 800 }).catch(() => {})
  await page.waitForTimeout(400)
}
const foto = async nome => { await limpar(); await page.screenshot({ path: `${OUT}/${nome}.png` }); console.log('ok', nome) }
// Cada tela nova começa do topo: sem isto, a rolagem da anterior ficava.
const topo = () => page.evaluate(() => document.querySelectorAll('.content, .chat-messages, .messages, main, *').forEach(el => { if (el.scrollTop) el.scrollTop = 0 }))

await page.goto(DEV)
await page.waitForSelector('input[type="email"]', { timeout: 30000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', EMAIL)
await page.fill('input[type="password"]', SENHA)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 60000 })
await page.waitForTimeout(2500)
await limpar()

// As três conversas de demonstração, uma vez só.
const criadas = await page.evaluate(async ({ demo }) => {
  const { createConversation, seedChatWithSummary, listConversations } = await import('/src/lib/conversas.js')
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { user } } = await supabase.auth.getUser()
  const existentes = (await listConversations(user.id)).map(c => c.title)
  const ids = {}
  for (const [chave, fonte, r] of [['entrevista', 'file', demo.entrevista], ['aula', 'url', demo.aula], ['reuniao', 'record', demo.reuniao]]) {
    if (existentes.includes(r.title)) continue
    const c = await createConversation(user.id, r, fonte, r.title)
    if (r.mode === 'simples') await seedChatWithSummary(user.id, c.id, r.summary)
    ids[chave] = c.id
  }
  const todas = await listConversations(user.id)
  return { novas: Object.keys(ids), reuniao: todas.find(c => c.title === demo.reuniao.title)?.id }
}, { demo })
console.log('conversas criadas agora:', criadas.novas.join(', ') || 'nenhuma')
await page.reload()
await page.waitForSelector('.home', { timeout: 60000 })
await page.waitForTimeout(2000)

// 1. A tela inicial
await foto('01-inicio')

// 2. A reunião: resumo, tópicos e tarefas
await page.goto(`${DEV}#/conversa/${criadas.reuniao}`)
await page.waitForTimeout(3500)
await foto('02-reuniao')
await page.evaluate(() => document.querySelector('.content')?.scrollBy(0, 700))
await page.waitForTimeout(600)
await foto('03-reuniao-tarefas')

// 3. Resumo minuto a minuto
await page.goto(`${DEV}#/conversa/${criadas.reuniao}/timeline`)
await page.waitForTimeout(3000)
await topo()
await foto('04-minuto-a-minuto')

// 4. Pergunta sobre a reunião, respondida pela IA
await page.goto(`${DEV}#/conversa/${criadas.reuniao}/chat`)
await page.waitForTimeout(3000)
if (!(await page.locator('.message.assistant').count())) {
  const campo = page.locator('textarea').last()
  await campo.fill('Quem ficou responsável por cada tarefa?')
  await campo.press('Enter').catch(() => {})
  await page.locator('button[aria-label*="Enviar"], button:has-text("Enviar")').last().click({ timeout: 1500 }).catch(() => {})
  await page.waitForSelector('.message.assistant', { timeout: 120000 })
  await page.waitForTimeout(6000)
}
await topo()
await foto('05-pergunta')

// 5. Lista de conversas
await page.goto(DEV)
await page.waitForSelector('.home', { timeout: 30000 })
await page.waitForTimeout(1500)
await page.click('.hamburger')
await page.waitForTimeout(800)
await foto('06-conversas')

await browser.close()
