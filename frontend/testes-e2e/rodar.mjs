// Roda todas as suítes E2E numa passada só e imprime o placar.
//
// Uso: cd frontend && node testes-e2e/rodar.mjs [nome-parcial-da-suíte...]
// Exige o dev server de pé (npm run dev).
import { writeFileSync, mkdirSync } from 'fs'
import { abrirNavegador, novaPagina, entrar, limparConversasDeTeste } from './ajuda.mjs'

const SUITES = [
  ['01-autenticacao', () => import('./01-autenticacao.mjs')],
  ['02-captura', () => import('./02-captura.mjs')],
  ['03-navegacao', () => import('./03-navegacao.mjs')],
  ['04-conversa', () => import('./04-conversa.mjs')],
  ['05-mobile', () => import('./05-mobile.mjs')],
  ['06-privacidade', () => import('./06-privacidade.mjs')],
]

const filtro = process.argv.slice(2)
const escolhidas = filtro.length ? SUITES.filter(([n]) => filtro.some(f => n.includes(f))) : SUITES

mkdirSync('.test-results', { recursive: true })
const INICIO = new Date().toISOString()
const browser = await abrirNavegador()
const todos = []

for (const [nome, carregar] of escolhidas) {
  console.log(`\n── ${nome} ──`)
  const inicio = Date.now()
  try {
    const mod = await carregar()
    todos.push(...(await mod.default(browser)))
  } catch (e) {
    console.log(`  ERRO NA SUÍTE: ${e.message.split('\n')[0]}`)
    todos.push({ suite: nome, nome: '(a suíte não terminou)', ok: false, erro: e.message.split('\n')[0].slice(0, 220) })
  }
  console.log(`  (${((Date.now() - inicio) / 1000).toFixed(0)}s)`)
}

// Faxina: as conversas criadas pelos testes não podem virar entulho na conta.
if (!filtro.length) {
  try {
    const p = await novaPagina(browser)
    await entrar(p)
    const r = await limparConversasDeTeste(p, INICIO)
    console.log(`\nfaxina: ${JSON.stringify(r)}`)
    await p.context().close()
  } catch (e) {
    console.log(`\nfaxina falhou: ${e.message.split('\n')[0]}`)
  }
}

await browser.close()

const falhas = todos.filter(i => !i.ok)
console.log(`\n${'='.repeat(60)}`)
console.log(`${todos.length - falhas.length}/${todos.length} passaram`)
if (falhas.length) {
  console.log(`\nFALHAS:`)
  for (const f of falhas) console.log(`  [${f.suite}] ${f.nome}\n      ${f.erro}`)
}
writeFileSync('.test-results/e2e.json', JSON.stringify(todos, null, 2))
process.exit(falhas.length ? 1 : 0)
