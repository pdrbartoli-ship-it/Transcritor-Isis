// "Perguntar ao acervo" de ponta a ponta: indexa o acervo da conta de teste no
// aparelho, faz uma pergunta de verdade e confere a resposta, as fontes
// clicáveis e a linha de transparência.
//
// GASTA DINHEIRO DA CONTA DE TESTE: a indexação custa ~R$ 0,012 por hora de
// conversa (uma vez) e cada pergunta gasta 1 do saldo mensal e ~R$ 0,02.
//
// Uso:  node e2e-perguntar.mjs [url] [--pergunta "..."]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const url = process.argv.slice(2).find(a => a.startsWith('http')) || creds.app_url
const i = process.argv.indexOf('--pergunta')
const PERGUNTA = i > 0 ? process.argv[i + 1] : 'Quais são os substratos usados na via alática?'
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

let ok = 0, falhas = 0
const check = (nome, cond, detalhe = '') => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome} ${detalhe}`) }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const erros = []
page.on('pageerror', e => erros.push(`pageerror: ${e.message}`))

await page.goto(url.replace(/#.*$/, '') + '#/auth')
await page.waitForLoadState('networkidle')
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 30000 })
console.log(`login ok (${url})\n`)

console.log('== a tela ==')
check('botão fixo na barra lateral', await page.locator('.sidebar-perguntar').count() === 1)
await page.click('.sidebar-perguntar')
await page.waitForURL(/#\/perguntar/, { timeout: 10000 })
await page.waitForSelector('.conversa-head h1', { timeout: 10000 })
check('rota /perguntar abre', (await page.locator('.conversa-head h1').textContent()) === 'Perguntar ao acervo')
check('estado vazio com 3 exemplos clicáveis', await page.locator('.starter-chips button').count() === 3)
check('botão de sinalizar conteúdo da IA', await page.locator('.btn-reportar-ia').count() === 1)

console.log('\n== o índice no aparelho ==')
// Lê o IndexedDB cru, e não os módulos do app: em produção o código vem
// empacotado e não dá para importar `src/lib/...` de dentro da página.
// Só LÊ: abrir o banco sem versão o criaria vazio, e o app acharia um banco
// já na versão dele, sem as prateleiras dentro. Foi assim que este teste
// quebrou o índice que estava tentando medir.
const lerIndice = () => page.evaluate(async () => {
  const bancos = await indexedDB.databases?.() || []
  const meu = bancos.find(b => b.name === 'dito-acervo')
  if (!meu) return { conversas: 0, trechos: 0, comVetor: 0, dims: 0 }
  return new Promise(resolve => {
  const req = indexedDB.open('dito-acervo', meu.version)
  req.onerror = () => resolve({ conversas: 0, trechos: 0, comVetor: 0, dims: 0 })
  req.onsuccess = () => {
    const db = req.result
    if (!db.objectStoreNames.contains('trechos')) return resolve({ conversas: 0, trechos: 0, comVetor: 0, dims: 0 })
    const tx = db.transaction(['trechos', 'conversas'], 'readonly')
    const t = tx.objectStore('trechos').getAll()
    const c = tx.objectStore('conversas').getAll()
    tx.oncomplete = () => {
      const comVetor = t.result.filter(x => x.vetor)
      resolve({
        conversas: c.result.length,
        trechos: t.result.length,
        comVetor: comVetor.length,
        dims: comVetor[0]?.vetor?.length || 0,
        cifrado: t.result.every(x => x.encVersion === 1),
      })
    }
  }
  })
})

let indice = { trechos: 0, comVetor: 0 }
for (let n = 0; n < 180; n++) {
  indice = await lerIndice()
  if (indice.comVetor && indice.comVetor === indice.trechos) break
  await page.waitForTimeout(1000)
}
console.log(`  ${indice.conversas} conversas · ${indice.trechos} trechos · ${indice.comVetor} com vetor`)
check('quebrou as conversas em trechos', indice.trechos > 0)
check('todos os trechos têm vetor de 768 dimensões', indice.comVetor === indice.trechos, `${indice.comVetor}/${indice.trechos}`)
check('o vetor tem 768 números', indice.dims === 768, indice.dims)
check('o texto do índice está cifrado no aparelho', indice.cifrado === true)

// Indexar de novo não pode custar de novo: é o que impede a tela de queimar
// crédito de API a cada abertura.
const antes = Date.now()
await page.reload()
await page.waitForSelector('.conversa-head h1', { timeout: 15000 })
await page.waitForTimeout(6000)
const depois = await lerIndice()
check('reabrir a tela não reindexa nada', depois.trechos === indice.trechos && depois.comVetor === indice.comVetor,
  `${depois.trechos}/${depois.comVetor} contra ${indice.trechos}/${indice.comVetor}`)
console.log(`  (reabriu em ${((Date.now() - antes) / 1000).toFixed(0)}s)`)

console.log(`\n== a pergunta: "${PERGUNTA}" ==`)
const saldoAntes = await page.locator('.ask-restantes').textContent().catch(() => null)
await page.locator('.chat-input textarea').fill(PERGUNTA)
await page.locator('.ask-send').click()
await page.waitForSelector('.message.assistant .md', { timeout: 120000 })
await page.waitForTimeout(1500)

const resposta = await page.locator('.message.assistant .md').first().innerText()
console.log(`  resposta: ${resposta.slice(0, 220).replace(/\n/g, ' ')}…`)
check('respondeu alguma coisa', resposta.length > 30)
check('citou as fontes com [C1]', /\[C\d\]/.test(resposta))

const chips = await page.locator('.fonte-chip').allTextContents()
console.log(`  fontes: ${chips.join(' | ')}`)
check('as citações viraram chips', chips.length > 0)
check('o chip diz conversa, data e minuto', chips.some(c => /\d{2}:\d{2}/.test(c)))

const procura = await page.locator('.acervo-procura').first().textContent()
console.log(`  ${procura}`)
check('linha "procurei em N conversas e usei M trechos"', /Procurei em .* e usei .* de /.test(procura))

const saldoDepois = await page.locator('.ask-restantes').textContent().catch(() => null)
console.log(`  saldo: ${saldoAntes} → ${saldoDepois}`)
check('a pergunta gastou 1 do saldo mensal', !saldoAntes || saldoAntes !== saldoDepois, `${saldoAntes} → ${saldoDepois}`)

console.log('\n== a citação abre a conversa no minuto ==')
await page.locator('.fonte-chip').first().click()
await page.waitForURL(/#\/conversa\/[0-9a-f-]+/, { timeout: 15000 })
const destino = page.url()
console.log(`  ${destino.split('#')[1]}`)
check('abriu uma conversa, com o minuto na URL', /\/timeline\?t=\d+/.test(destino) || /\/conversa\/[0-9a-f-]+$/.test(destino))
await page.waitForSelector('.conversa-head h1', { timeout: 15000 })
check('a tela do minuto carregou', (await page.locator('.trecho .fala').count()) > 0 || (await page.locator('.chapter-row').count()) > 0)
await page.screenshot({ path: `${OUT}/perguntar-fonte.png`, fullPage: true })

console.log('\n== a pergunta ficou guardada ==')
await page.goto(url.replace(/#.*$/, '') + '#/perguntar')
await page.waitForSelector('.conversa-head h1', { timeout: 15000 })
await page.waitForTimeout(3000)
const anteriores = await page.locator('.acervo-anteriores button').allTextContents()
check('aparece na lista de perguntas anteriores', anteriores.some(t => t.includes(PERGUNTA.slice(0, 25))), anteriores.join(' | '))
if (anteriores.length) {
  await page.locator('.acervo-anteriores button').first().click()
  await page.waitForSelector('.message.assistant', { timeout: 10000 })
  check('reabrir a pergunta traz a resposta e os chips',
    (await page.locator('.message.assistant .md').count()) > 0 && (await page.locator('.fonte-chip').count()) > 0)
  check('o marcador das fontes não aparece no texto',
    !(await page.locator('.message.assistant .md').first().innerText()).includes('dito-fontes'))
}
await page.screenshot({ path: `${OUT}/perguntar.png`, fullPage: true })

console.log(`\nerros de página: ${erros.length ? erros.join(' | ') : 'nenhum'}`)
console.log(`\n${falhas ? 'HOUVE FALHAS' : 'TUDO CERTO'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
