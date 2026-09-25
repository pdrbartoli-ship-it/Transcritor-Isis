// As perguntas do usuário, nos dois lugares onde ele as procura (25/09/2026):
//
// 1. No Perguntar, a lista de "anteriores" passa a trazer TODA pergunta que
//    ele escreveu, inclusive as feitas dentro de uma conversa. Antes só
//    apareciam as feitas na própria tela, e só a primeira de cada thread.
// 2. Na conversa, o resumo aparece no topo (na completa ele existia e a tela
//    não mostrava) e as perguntas já feitas ali ficam logo abaixo dele, sem
//    precisar entrar no chat.
//
// Nada aqui gasta pergunta do saldo: o teste só LÊ o que já foi perguntado.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

let falhas = 0
function check(nome, ok, extra = '') {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'}  ${nome} ${extra}`)
  if (!ok) falhas++
}

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
const erros = []
page.on('pageerror', e => erros.push(e.message))

await page.goto(base + '#/auth')
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })

// ── 1. Perguntar: as duas origens na mesma lista ──────────
await page.click('.sidebar-perguntar')
await page.waitForSelector('.ask-hero', { timeout: 10000 })
await page.waitForSelector('.ask-anteriores button', { timeout: 15000 }).catch(() => {})
// O nome da conversa de onde a pergunta veio sai da lista do acervo, que esta
// tela busca em paralelo: até ela chegar, a linha aparece sem o nome.
await page.waitForSelector('.ask-anterior-conversa', { timeout: 15000 }).catch(() => {})

const itens = await page.evaluate(() => [...document.querySelectorAll('.ask-anteriores button')]
  .filter(el => !el.classList.contains('ask-anteriores-mais'))
  .map(el => ({
    conversa: el.querySelector('.ask-anterior-conversa')?.textContent?.trim() || null,
  })))

console.log(`  ${itens.length} perguntas na lista, ${itens.filter(i => i.conversa).length} vindas de conversas`)
check('a lista traz perguntas feitas dentro de conversas', itens.some(i => i.conversa))
check('a linha diz de que conversa veio', itens.filter(i => i.conversa).every(i => i.conversa.length > 0))
await page.screenshot({ path: `${OUT}/perguntas-lista.png` })

// "Ver mais" abre o resto, em vez de esconder o que já foi perguntado.
const temVerMais = await page.locator('.ask-anteriores-mais').count() > 0
if (temVerMais) {
  const antes = await page.locator('.ask-anteriores button').count()
  await page.click('.ask-anteriores-mais')
  await page.waitForTimeout(300)
  const depois = await page.locator('.ask-anteriores button').count()
  check('"Ver mais" mostra mais perguntas', depois > antes, `(${antes} → ${depois})`)
} else {
  console.log('  conta com poucas perguntas: "Ver mais" não aparece')
}

// Clicar numa pergunta de conversa abre o chat DAQUELA conversa, já naquela
// pergunta. A lista guardada no aparelho (de antes desta versão) não sabe qual
// pergunta é, então o teste espera a lista da rede chegar.
await page.waitForTimeout(2500)
let idComPerguntas = null
const deConversa = page.locator('.ask-anteriores button:has(.ask-anterior-conversa)').first()
if (await deConversa.count()) {
  await deConversa.click()
  await page.waitForURL(/#\/conversa\/[^/]+\/chat/, { timeout: 10000 }).catch(() => {})
  check('pergunta de conversa abre o chat dela', /\/conversa\/.+\/chat/.test(page.url()), page.url().split('#')[1] || '')
  idComPerguntas = (page.url().match(/conversa\/([^/]+)\/chat/) || [])[1] || null
  // O destaque é curto de propósito (ver DESTAQUE_MS): serve para os olhos
  // acharem a linha, não para ficar marcado nela.
  const destacou = await page.waitForSelector('.message-focada', { timeout: 6000 }).then(() => true).catch(() => false)
  check('a pergunta escolhida fica destacada', destacou)
  await page.screenshot({ path: `${OUT}/perguntas-chat-destacado.png` })
}

// ── 2. A conversa: resumo no topo e as perguntas dali ─────
// A conversa que a lista apontou é a que certamente tem pergunta feita.
const candidatas = []
if (idComPerguntas) candidatas.push(idComPerguntas)

let achouBloco = false
let achouResumo = false
for (const id of candidatas) {
  await page.goto(`${base}#/conversa/${id}`)
  await page.waitForSelector('.conversa', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const temResumo = await page.locator('.conversa-block h2:text-is("Resumo")').count() > 0
  const temPerguntas = await page.locator('.conversa-block h2:text-is("Suas perguntas")').count() > 0
  if (temResumo) achouResumo = true
  if (temPerguntas && !achouBloco) {
    achouBloco = true
    // O bloco vem logo depois do resumo, e antes dos 4 tópicos.
    const ordem = await page.evaluate(() =>
      [...document.querySelectorAll('.conversa-block h2')].map(h => h.textContent.trim()))
    console.log('  blocos da conversa:', ordem.join(' · '))
    const iResumo = ordem.indexOf('Resumo')
    const iPerguntas = ordem.indexOf('Suas perguntas')
    check('o resumo vem antes das perguntas', iResumo >= 0 && iResumo < iPerguntas)
    check('as perguntas vêm antes dos tópicos',
      ordem.indexOf('4 tópicos mais importantes') === -1 || iPerguntas < ordem.indexOf('4 tópicos mais importantes'))
    await page.screenshot({ path: `${OUT}/conversa-resumo-perguntas.png`, fullPage: false })
    // Clicar numa pergunta leva ao chat, nela.
    await page.locator('.perguntas-feitas button').first().click()
    await page.waitForSelector('.message', { timeout: 10000 })
    check('a pergunta da conversa abre o chat', /\/chat/.test(page.url()))
  }
}
check('a conversa mostra o resumo no topo', achouResumo)
check('a conversa mostra as perguntas já feitas nela', achouBloco)

// ── 3. A conversa COMPLETA: o resumo vinha existindo e não aparecia ──
// Era o caso que motivou a mudança: quem abria uma reunião de uma hora caía
// direto nos quatro tópicos, sem nunca ver o apanhado do que foi dito.
await page.goto(base)
await page.waitForSelector('.sidebar-item', { timeout: 20000 })
const quantas = await page.locator('.sidebar-item').count()
let achouCompleta = false
for (let i = 0; i < Math.min(quantas, 10) && !achouCompleta; i++) {
  await page.goto(base)
  await page.waitForSelector('.sidebar-item', { timeout: 15000 })
  await page.locator('.sidebar-item').nth(i).click()
  await page.waitForSelector('.conversa', { timeout: 15000 })
  await page.waitForTimeout(900)
  const ordem = await page.evaluate(() =>
    [...document.querySelectorAll('.conversa-block h2')].map(h => h.textContent.trim()))
  if (!ordem.includes('4 tópicos mais importantes')) continue
  achouCompleta = true
  console.log('  conversa completa, blocos:', ordem.join(' · '))
  check('na completa, o resumo vem primeiro',
    ordem.indexOf('Resumo') === 0, `(${ordem[0]})`)
  await page.screenshot({ path: `${OUT}/conversa-completa-resumo.png` })
}
if (!achouCompleta) console.log('  nenhuma conversa completa entre as 10 primeiras: caso não conferido')

check('sem erro de página', erros.length === 0, erros[0] || '')
await b.close()
console.log(`\n${falhas === 0 ? 'histórico de perguntas ok' : `${falhas} falha(s)`}`)
process.exitCode = falhas ? 1 : 0
