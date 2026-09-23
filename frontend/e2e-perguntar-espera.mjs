// "Perguntar ao acervo": a lista de perguntas anteriores aparece sem esperar
// a rede (vem do aparelho), o progresso do índice não aparece na tela em
// repouso, e uma pergunta feita no meio da indexação espera os vetores.
//
// GASTA DINHEIRO DA CONTA DE TESTE: o navegador começa limpo, então o acervo
// inteiro é indexado de novo (~R$ 0,012 por hora de conversa), e a pergunta
// gasta 1 do saldo mensal.
//
// Uso:  node e2e-perguntar-espera.mjs [url] [--pergunta "..."]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const url = process.argv.slice(2).find(a => a.startsWith('http')) || creds.dev_url
const i = process.argv.indexOf('--pergunta')
const PERGUNTA = i > 0 ? process.argv[i + 1] : 'Quais são os substratos usados na via alática?'
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })
const base = url.replace(/#.*$/, '')

let ok = 0, falhas = 0
const check = (nome, cond, detalhe = '') => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome} ${detalhe}`) }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const erros = []
page.on('pageerror', e => erros.push(`pageerror: ${e.message}`))

await page.goto(base + '#/auth')
await page.waitForLoadState('networkidle')
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 30000 })
console.log(`login ok (${url})\n`)

// Só LÊ o IndexedDB, na versão que já existe (ver e2e-perguntar.mjs).
const lerIndice = () => page.evaluate(async () => {
  const bancos = await indexedDB.databases?.() || []
  const meu = bancos.find(b => b.name === 'dito-acervo')
  if (!meu) return { trechos: 0, comVetor: 0 }
  return new Promise(resolve => {
    const req = indexedDB.open('dito-acervo', meu.version)
    req.onerror = () => resolve({ trechos: 0, comVetor: 0 })
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('trechos')) return resolve({ trechos: 0, comVetor: 0 })
      const t = db.transaction('trechos', 'readonly').objectStore('trechos').getAll()
      t.onsuccess = () => resolve({ trechos: t.result.length, comVetor: t.result.filter(x => x.vetor).length })
    }
  })
})

// Guarda todo texto que passou pelo rodapé da tela em repouso e pela bolha de
// espera, amostrado a cada 100 ms, para saber o que a pessoa chegou a ver.
const vigiar = () => page.evaluate(() => {
  window.__vistos = new Set()
  window.__vigia = setInterval(() => {
    for (const el of document.querySelectorAll('.ask-hero-rodape, .conversa-head p, .message.assistant .bubble')) {
      const t = el.innerText.trim()
      if (t) window.__vistos.add(t)
    }
  }, 100)
})
const vistos = () => page.evaluate(() => [...window.__vistos])

console.log('== primeira visita: sem nada guardado no aparelho ==')
let t0 = Date.now()
await page.goto(base + '#/perguntar')
await vigiar()
await page.waitForSelector('.ask-anteriores button', { timeout: 20000 })
const semCache = Date.now() - t0
console.log(`  lista apareceu em ${semCache} ms (da rede)`)
check('a lista de perguntas anteriores aparece', await page.locator('.ask-anteriores button').count() > 0)

await page.waitForTimeout(1500)
const indiceAntes = await lerIndice()
console.log(`  índice ao perguntar: ${indiceAntes.comVetor}/${indiceAntes.trechos} trechos com vetor`)

console.log(`\n== pergunta no meio da indexação: "${PERGUNTA}" ==`)
await page.locator('.ask-bar textarea').fill(PERGUNTA)
await page.locator('.ask-send').click()
await page.waitForSelector('.message.assistant .md', { timeout: 180000 })
const indiceNaResposta = await lerIndice()
await page.waitForTimeout(1000)

const textos = await vistos()
console.log(`  textos vistos:\n    ${textos.join('\n    ')}`)
const naTela = textos.filter(t => !t.includes('…'))
check('o progresso do índice não apareceu na tela em repouso',
  !naTela.some(t => /Preparando a busca|Lendo suas conversas/.test(t)), naTela.join(' | '))
const esperou = textos.some(t => /Preparando a busca|Lendo suas conversas/.test(t) && t.includes('…'))
if (indiceAntes.comVetor < indiceAntes.trechos || !indiceAntes.trechos) {
  check('a pergunta mostrou que esperava a busca', esperou)
} else {
  console.log('  (o índice já estava pronto ao perguntar, então não havia espera para ver)')
}
console.log(`  índice quando a resposta chegou: ${indiceNaResposta.comVetor}/${indiceNaResposta.trechos}`)
check('a resposta saiu com todos os trechos já com vetor',
  indiceNaResposta.trechos > 0 && indiceNaResposta.comVetor === indiceNaResposta.trechos)

const resposta = await page.locator('.message.assistant .md').first().innerText()
console.log(`  resposta: ${resposta.slice(0, 200).replace(/\n/g, ' ')}…`)
check('respondeu citando as fontes', /\[C\d\]/.test(resposta) || (await page.locator('.fonte-chip').count()) > 0)
await page.screenshot({ path: `${OUT}/perguntar-espera-resposta.png`, fullPage: true })

console.log('\n== a lista guardada no aparelho ==')
await page.waitForTimeout(3000) // a gravação da pergunta e a releitura da lista
const guardado = await page.evaluate(() => {
  const chave = Object.keys(localStorage).find(k => k.startsWith('dito-perguntas-anteriores:'))
  return chave ? localStorage.getItem(chave) : null
})
check('a lista foi guardada', !!guardado)
check('está cifrada (a pergunta não aparece em claro)', guardado && !guardado.includes(PERGUNTA.slice(0, 20)) && JSON.parse(guardado).v === 1)

console.log('\n== segunda visita: a lista vem do aparelho ==')
t0 = Date.now()
await page.reload()
await vigiar()
await page.waitForSelector('.ask-anteriores button', { timeout: 20000 })
const comCache = Date.now() - t0
console.log(`  lista apareceu em ${comCache} ms (recarregando a página inteira)`)
const primeira = await page.locator('.ask-anteriores button').first().innerText()
check('a pergunta recém-feita está no topo', primeira.includes(PERGUNTA.slice(0, 25)), primeira)

// Navegar dentro do app mede só a tela, sem o carregamento do app inteiro.
await page.goto(base + '#/')
await page.waitForSelector('.home', { timeout: 15000 })
t0 = Date.now()
await page.goto(base + '#/perguntar')
await page.waitForSelector('.ask-anteriores button', { timeout: 20000 })
const dentroDoApp = Date.now() - t0
console.log(`  lista apareceu em ${dentroDoApp} ms (voltando à tela sem recarregar)`)
check('voltando à tela a lista aparece em menos de 300 ms', dentroDoApp < 300, `${dentroDoApp} ms`)

await page.waitForTimeout(3000)
const textos2 = await vistos()
check('nada de progresso do índice na segunda visita',
  !textos2.some(t => /Preparando a busca|Lendo suas conversas/.test(t)), textos2.join(' | '))
await page.screenshot({ path: `${OUT}/perguntar-espera-repouso.png`, fullPage: true })

console.log(`\nerros de página: ${erros.length ? erros.join(' | ') : 'nenhum'}`)
console.log(`\n${falhas ? 'HOUVE FALHAS' : 'TUDO CERTO'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
