// A decisão que o Dito toma quando uma reunião começa: ler o saldo na hora,
// escolher a variante e calcular o teto da gravação.
//
// O detector em si é Rust e só roda no Windows. O que dá para provar aqui é
// tudo o que vem depois dele, que é onde moram as regras de negócio — e o
// saldo é interceptado, então NADA disto gasta os minutos reais da conta.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const SUPABASE = 'https://hgmwngasnltlrqlwimdj.supabase.co'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })

// Saldo de mentira: o plano e os minutos usados saem daqui, e não do banco.
let usados = 0
const limitePlano = 800 // Avançado, a régua que planoPorId devolve
await p.route(`${SUPABASE}/rest/v1/uso_mensal*`, route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  // Sem isto o Chromium serve a mesma resposta nas leituras seguintes, e o
  // teste passaria a medir o cache em vez da regra.
  headers: { 'cache-control': 'no-store' },
  body: JSON.stringify({
    minutos_usados: usados,
    perguntas_usadas: 0,
    periodo_fim: new Date(Date.now() + 864e5 * 10).toISOString(),
  }),
}))
await p.route(`${SUPABASE}/rest/v1/subscriptions*`, route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ plano: 'avancado' }),
}))

await p.goto(base + '#/auth')
await p.waitForSelector('input[type="email"]', { timeout: 20000 })
await p.click('text=Acessar')
await p.fill('input[type="email"]', creds.email)
await p.fill('input[type="password"]', creds.password)
await p.click('button[type="submit"]')
await p.waitForSelector('.home', { timeout: 25000 })
await p.waitForFunction(() => typeof window.__simularReuniao === 'function', { timeout: 10000 })

// A detecção só age com a preferência ligada — é o padrão desligado em ação.
const desligado = await p.evaluate(() => window.__simularReuniao({ id: 1, app: 'zoom' }))
console.log('com a preferência desligada:', desligado === null ? 'nada aparece' : 'ERRO: apareceu')
if (desligado !== null) throw new Error('o aviso apareceu com o recurso desligado')

await p.evaluate(() => localStorage.setItem('dito-avisar-reuniao', '1'))
await p.reload()
await p.waitForSelector('.home', { timeout: 25000 })
await p.waitForFunction(() => typeof window.__simularReuniao === 'function', { timeout: 10000 })

async function simular(id, app = 'zoom') {
  const mostrado = await p.evaluate(dados => window.__simularReuniao(dados), { id, app })
  // Um aviso na tela bloqueia o próximo, como no app: responder é o que
  // devolve o Dito ao repouso entre um cenário e outro.
  if (mostrado) await p.evaluate(() => window.__responderReuniao('nao'))
  return mostrado
}

// Saldo folgado: convite seco, sem falar de minutos.
usados = 300
const folgado = await simular(10)
console.log('saldo 500 min →', folgado.variante, '|', folgado.corpo, '| teto', folgado.pendente.tetoS, 's')
if (folgado.variante !== 'convite') throw new Error('esperava convite')
if (/min/.test(folgado.corpo)) throw new Error('o convite folgado não deve falar de saldo')
if (folgado.pendente.tetoS !== 500 * 60 - 30) throw new Error('teto errado para 500 min')

// Saldo médio: o número real aparece, e o teto para 30 s antes do fim.
usados = 788
const curto = await simular(11, 'teams')
console.log('saldo 12 min →', curto.variante, '|', curto.corpo, '| teto', curto.pendente.tetoS, 's')
if (curto.variante !== 'convite-saldo-curto') throw new Error('esperava convite-saldo-curto')
if (!curto.corpo.includes('12 min')) throw new Error('o corpo deveria dizer 12 min')
if (curto.pendente.tetoS !== 12 * 60 - 30) throw new Error('teto errado para 12 min')

// Saldo zerado: vira convite de assinatura, uma vez por dia.
usados = limitePlano
const semSaldo = await simular(12)
console.log('saldo 0 →', semSaldo.variante, '|', semSaldo.corpo)
if (semSaldo.variante !== 'sem-saldo') throw new Error('esperava sem-saldo')
const segundaVez = await simular(13)
console.log('segunda reunião do dia sem saldo:', segundaVez === null ? 'nada aparece' : 'ERRO: apareceu')
if (segundaVez !== null) throw new Error('o "sem saldo" apareceu duas vezes no mesmo dia')

// A mesma reunião não pergunta de novo.
usados = 300
const repetida = await simular(10)
console.log('mesma reunião de novo:', repetida === null ? 'nada aparece' : 'ERRO: apareceu')
if (repetida !== null) throw new Error('a mesma reunião perguntou duas vezes')

// Saldo ilegível: não prometemos o que não sabemos.
await p.route(`${SUPABASE}/rest/v1/uso_mensal*`, route => route.fulfill({ status: 500, body: '{}' }))
const semLeitura = await simular(20)
console.log('saldo ilegível:', semLeitura === null ? 'nada aparece' : 'ERRO: apareceu')
if (semLeitura !== null) throw new Error('sugeriu gravar sem saber o saldo')

await b.close()
console.log('decisão da detecção de reunião ok')
