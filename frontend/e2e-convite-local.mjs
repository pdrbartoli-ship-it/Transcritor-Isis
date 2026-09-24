// Convite premiado e Avançado ilimitado, na tela, ANTES do deploy: o servidor
// novo é simulado (rotas /convite/*, /planos e as linhas de uso_mensal e
// subscriptions), então dá para ver cada estado sem gastar nada nem depender
// de amigo de verdade. O login é o real.
// Uso: node e2e-convite-local.mjs <planos.json>
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const url = creds.dev_url
const planos = readFileSync(process.argv[2], 'utf8')
const OUT = '.test-results/convite'
mkdirSync(OUT, { recursive: true })

let ok = 0, falhas = 0
const check = (nome, cond, detalhe = '') => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome} ${detalhe}`) }
}

const futuro = new Date(Date.now() + 20 * 86400e3).toISOString()
const REGRAS = { capturas: 3, minutos: 25, perguntas: 2, apoiador: 5 }
const base = { codigo: 'k7m2pq9', link: 'https://dito.albiecloud.com/?c=k7m2pq9', regras: REGRAS }
const CENARIOS = {
  gratis: {
    plano: 'gratuito',
    uso: { minutos_usados: 30, perguntas_usadas: 1, periodo_fim: futuro, minutos_extra: 25, perguntas_extra: 2, extra_ate: futuro },
    convite: { ...base, plano: 'gratuito', ilimitado: false, validos: 1, pendentes: 1, apoiador: false, novidade: { amigos: 1, minutos: 25, perguntas: 2 } },
  },
  avancado: {
    plano: 'avancado',
    uso: { minutos_usados: 900, perguntas_usadas: 40, periodo_fim: futuro, minutos_extra: 0, perguntas_extra: 0, extra_ate: null },
    convite: { ...base, plano: 'avancado', ilimitado: true, validos: 2, pendentes: 0, apoiador: false, novidade: { amigos: 1, minutos: 0, perguntas: 0 } },
  },
  apoiador: {
    plano: 'avancado',
    uso: { minutos_usados: 900, perguntas_usadas: 40, periodo_fim: futuro, minutos_extra: 0, perguntas_extra: 0, extra_ate: null },
    convite: { ...base, plano: 'avancado', ilimitado: true, validos: 5, pendentes: 0, apoiador: true, novidade: { amigos: 1, minutos: 0, perguntas: 0 } },
  },
}

const browser = await chromium.launch()
const erros = []

async function simular(page, cenario) {
  const c = CENARIOS[cenario]
  let visto = false
  await page.route('**/transcritor-backend.onrender.com/planos', r => r.fulfill({ contentType: 'application/json', body: planos }))
  await page.route('**/transcritor-backend.onrender.com/convite/estado', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(visto ? { ...c.convite, novidade: null } : c.convite),
  }))
  await page.route('**/transcritor-backend.onrender.com/convite/visto', r => { visto = true; return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }) })
  await page.route('**/transcritor-backend.onrender.com/convite/aceitar', r => r.fulfill({ contentType: 'application/json', body: '{"aceito":true}' }))
  await page.route('**/rest/v1/uso_mensal**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(c.uso) }))
  await page.route('**/rest/v1/subscriptions**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ plano: c.plano }) }))
}

async function entrar(page) {
  await page.goto(url.replace(/#.*$/, '') + '#/auth')
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.click('text=Acessar')
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home', { timeout: 30000 })
}

// ── 1. Landing: faixa de convite, seção do convite e planos ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => erros.push(e.message))
  await page.route('**/transcritor-backend.onrender.com/planos', r => r.fulfill({ contentType: 'application/json', body: planos }))
  await page.goto(url.replace(/#.*$/, '').replace(/\/$/, '') + '/?c=k7m2pq9')
  await page.waitForSelector('.lp', { timeout: 20000 })
  check('landing: faixa de quem chegou por convite', await page.locator('.lp-convite-faixa').count() === 1)
  check('landing: ?c= sai do endereço', !page.url().includes('c=k7m2pq9'), page.url())
  check('landing: código guardado', (await page.evaluate(() => localStorage.getItem('dito-convite')) || '').includes('k7m2pq9'))
  await page.screenshot({ path: `${OUT}/landing-topo.png` })
  await page.locator('#precos').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const destaque = await page.locator('.lp-plano.destaque h3').innerText()
  check('landing: recomendado é o Avançado', destaque === 'Avançado', destaque)
  check('landing: Avançado com minutos ilimitados', await page.locator('.lp-plano.destaque li:has-text("Minutos ilimitados")').count() === 1)
  await page.locator('#precos').screenshot({ path: `${OUT}/landing-planos.png` })
  await page.locator('#convite').screenshot({ path: `${OUT}/landing-convite.png` })
  await page.setViewportSize({ width: 380, height: 800 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${OUT}/landing-celular-topo.png` })
  await page.locator('#convite').screenshot({ path: `${OUT}/landing-celular-convite.png` })
  await page.locator('.lp-convite-faixa button').click()
  await page.waitForSelector('.auth-card', { timeout: 5000 })
  check('landing: faixa leva ao cadastro', await page.locator('.auth-tabs button.active:has-text("Criar conta")').count() === 1)
  await page.close()
}

// ── 2. Grátis com prêmio: +25 no relógio, aviso, modal ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  page.on('pageerror', e => erros.push(e.message))
  await simular(page, 'gratis')
  await entrar(page)
  await page.waitForSelector('.premio-aviso', { timeout: 10000 })
  const aviso = await page.locator('.premio-aviso strong').innerText()
  check('grátis: aviso de prêmio', aviso === 'Você ganhou 25 minutos e 2 perguntas', aviso)
  const relogio = await page.locator('.contador-minutos').innerText()
  check('grátis: relógio com o limite novo e o +25', relogio.includes('30/125') && relogio.includes('+25'), relogio)
  check('grátis: item Convidar amigos na barra', await page.locator('.nav-item:has-text("Convidar amigos")').count() === 1)
  await page.screenshot({ path: `${OUT}/app-gratis-premio.png` })
  await page.locator('.premio-aviso').screenshot({ path: `${OUT}/app-gratis-aviso.png` })
  await page.locator('.premio-aviso-fechar').click()
  await page.waitForTimeout(300)
  check('grátis: aviso fecha', await page.locator('.premio-aviso').count() === 0)
  await page.locator('.nav-item:has-text("Convidar amigos")').click()
  await page.waitForSelector('.convite-modal .convite-link input', { timeout: 10000 })
  check('grátis: modal com +25 e +2', (await page.locator('.convite-ganhos').innerText()).replace(/\s+/g, ' ').includes('+25 minutos +2 perguntas'))
  check('grátis: link curto na caixa', await page.locator('.convite-link input').inputValue() === 'dito.albiecloud.com/?c=k7m2pq9')
  check('grátis: contagem', (await page.locator('.convite-contagem').innerText()) === '1 amigo já usa o Dito · 1 a caminho')
  await page.locator('.convite-modal').screenshot({ path: `${OUT}/app-gratis-modal.png` })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(200)
  await page.locator('.convite-modal').screenshot({ path: `${OUT}/app-gratis-modal-escuro.png` })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.close()
}

// ── 3. Avançado: ilimitado, progresso até o selo ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  page.on('pageerror', e => erros.push(e.message))
  await simular(page, 'avancado')
  await entrar(page)
  await page.waitForSelector('.premio-aviso', { timeout: 10000 })
  const relogio = await page.locator('.contador-minutos').innerText()
  check('avançado: relógio diz ilimitado', relogio.trim() === 'Minutos ilimitados', relogio)
  const aviso = await page.locator('.premio-aviso').innerText()
  check('avançado: aviso de progresso', aviso.includes('Um amigo entrou pelo seu convite') && aviso.includes('Faltam 3 para o selo'), aviso)
  await page.click('.capture-nav a:has-text("Vídeo")')
  await page.fill('.url-form input', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.waitForTimeout(600)
  check('avançado: sem linha de saldo no link', await page.locator('.linha-consumo').count() === 0)
  await page.screenshot({ path: `${OUT}/app-avancado.png` })
  await page.locator('.premio-aviso-link').click()
  await page.waitForSelector('.convite-modal .convite-passos', { timeout: 10000 })
  check('avançado: 2 de 5 pontos acesos', await page.locator('.convite-passos span.on').count() === 2)
  await page.locator('.convite-modal').screenshot({ path: `${OUT}/app-avancado-modal.png` })
  await page.close()
}

// ── 4. Apoiador: selo na barra e o aviso do selo, também no celular ──
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  page.on('pageerror', e => erros.push(e.message))
  await simular(page, 'apoiador')
  await entrar(page)
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dito-selo-visto-')).forEach(k => localStorage.removeItem(k)))
  await page.reload()
  await page.waitForSelector('.premio-aviso', { timeout: 15000 })
  const aviso = await page.locator('.premio-aviso strong').innerText()
  check('apoiador: aviso do selo', aviso === 'Você ganhou o selo de apoiador', aviso)
  check('apoiador: selo ao lado do e-mail', await page.locator('.foot-user .selo-apoiador').count() === 1)
  await page.locator('.sidebar-foot').screenshot({ path: `${OUT}/app-apoiador-barra.png` })
  await page.locator('.premio-aviso-fechar').click()
  await page.waitForTimeout(300)
  check('apoiador: fechar dá os dois por vistos', await page.locator('.premio-aviso').count() === 0)
  await page.locator('.nav-item:has-text("Convidar amigos")').click()
  await page.waitForSelector('.convite-modal .convite-selo', { timeout: 10000 })
  await page.locator('.convite-modal').screenshot({ path: `${OUT}/app-apoiador-modal.png` })
  await page.keyboard.press('Escape')
  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dito-selo-visto-')).forEach(k => localStorage.removeItem(k)))
  await page.setViewportSize({ width: 380, height: 800 })
  await page.reload()
  await page.waitForSelector('.premio-aviso', { timeout: 15000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/app-celular-aviso.png` })
  const relogio = await page.locator('.contador-minutos').boundingBox()
  const cartao = await page.locator('.premio-aviso').boundingBox()
  check('celular: o aviso não cobre o relógio', cartao.y > relogio.y + relogio.height)
  await page.click('.hamburger')
  await page.waitForTimeout(400)
  const naFrente = await page.evaluate(() => {
    const r = document.querySelector('.premio-aviso').getBoundingClientRect()
    const el = document.elementFromPoint(r.left + 10, r.top + 10)
    return !!el?.closest('.sidebar, .sidebar-overlay')
  })
  check('celular: menu aberto fica na frente do aviso', naFrente)
  await page.screenshot({ path: `${OUT}/app-celular-menu.png` })
  await page.close()
}

check('sem erro de página', erros.length === 0, erros.join(' | '))
console.log(`\n${ok} ok, ${falhas} falha(s)`)
await browser.close()
process.exit(falhas ? 1 : 0)
