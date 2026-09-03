// Prova, no app de verdade rodando no navegador, que toda chamada ao backend
// sai com o login do usuário junto.
//
// O teste anterior (teste-api-auth.mjs) roda o api.js no Node com dublês. Este
// aqui roda o app inteiro: login real na tela, sessão real do Supabase, e o
// api.js exatamente como ele vai para produção. É o que pega o caso de a
// sessão existir mas o token não chegar no fetch.
//
// Nenhuma chamada chega ao backend de verdade: elas são interceptadas e
// respondidas com um dublê, então o teste não gasta crédito de IA.
//
// Pré-requisito: servidor de dev no ar (cd frontend && npm run dev)
// Rodar:  cd frontend && node teste-login-backend.mjs

import { chromium } from 'playwright'
import fs from 'fs'

const creds = JSON.parse(fs.readFileSync('../e2e/credentials.json', 'utf-8'))
let ok = 0, falhas = 0
const check = (n, c, extra = '') => {
  if (c) { ok++; console.log(`  OK    ${n}`) } else { falhas++; console.log(`  FALHA ${n} ${extra}`) }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('  [erro]', e.message))

// Segura toda chamada ao backend antes de sair da máquina, guarda o que ela
// levava, e responde no lugar dele.
const capturadas = []
await page.route('**/transcritor-backend.onrender.com/**', async route => {
  const req = route.request()
  capturadas.push({
    url: req.url(),
    autorizacao: (await req.allHeaders()).authorization || null,
  })
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      insights: {}, summary: '', answer: 'resposta de teste', usage: {},
      transcript: '', chunks_used: 1, duration_estimate: '1 min', segments: [], duration_s: 1,
    }),
  })
})

console.log('\n== login de verdade na tela ==')
await page.goto(creds.dev_url + '#/auth')
await page.waitForTimeout(900)
const acessar = page.getByText('Acessar', { exact: true })
if (await acessar.isVisible().catch(() => false)) await acessar.click()
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForTimeout(4000)
check('entrou no app', (await page.locator('.app-shell').count()) === 1)

const tokenDaSessao = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
})
check('a sessão tem um token', !!tokenDaSessao)

console.log('\n== cada rota do backend leva o login junto ==')
for (const [nome, chamada] of [
  ['/insights', `const api = await import('/src/lib/api.js'); await api.generateInsights('uma transcrição')`],
  ['/chat', `const api = await import('/src/lib/api.js'); await api.askConversation('e aí?', { title:'t', created_at: Date.now(), transcript:'oi', summary:null })`],
  ['/process-url', `const api = await import('/src/lib/api.js'); await api.processUrl('https://exemplo.com/artigo')`],
]) {
  capturadas.length = 0
  await page.evaluate(`(async () => { ${chamada} })()`).catch(() => {})
  await page.waitForTimeout(500)

  const c = capturadas.find(x => x.url.includes(nome))
  check(`${nome} chegou ao backend`, !!c)
  check(`${nome} levou o cabeçalho de login`, c?.autorizacao === `Bearer ${tokenDaSessao}`,
    `(recebido: ${c?.autorizacao ? c.autorizacao.slice(0, 20) + '…' : 'nenhum'})`)
}

console.log('\n== depois de sair da conta, não vai token nenhum ==')
await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  await supabase.auth.signOut()
})
await page.waitForTimeout(800)
capturadas.length = 0
await page.evaluate(async () => {
  const api = await import('/src/lib/api.js')
  await api.generateInsights('texto')
}).catch(() => {})
await page.waitForTimeout(500)
check('a chamada ainda é feita', capturadas.length > 0)
check('mas sem cabeçalho de login (o backend é quem recusa)', capturadas[0]?.autorizacao == null)

await browser.close()
console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
process.exit(falhas ? 1 : 0)
