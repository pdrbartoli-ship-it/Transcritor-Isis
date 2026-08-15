// Fluxo de conteúdo compartilhado (Fase 3): abrir o Dito já com um link e ver
// o app processar sozinho até o modal de sugestão de pasta.
//
// O compartilhamento de verdade é um intent do Android, que não existe no
// navegador — o gancho ?compartilhado=<url> exercita exatamente o mesmo caminho
// do lado JS (Layout → Home → CapturePanel → sugestão de pasta), que é a parte
// que dá para verificar sem um aparelho.
import { chromium } from 'playwright'
import fs from 'fs'

const creds = JSON.parse(fs.readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const OUT = '.test-results'
fs.mkdirSync(OUT, { recursive: true })

// Padrão neutro e estável. Passe um link do YouTube como argumento para
// exercitar o caminho de vídeo: `node e2e-share.mjs "https://youtu.be/..."`.
const SHARED_URL = process.argv[2] || 'https://pt.wikipedia.org/wiki/Filosofia'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 780 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))

const step = async (name, fn) => {
  try { const r = await fn(); console.log(`✓ ${name}${r ? ' — ' + r : ''}`); return true }
  catch (e) { console.log(`✗ ${name} — ${e.message}`); return false }
}

await step('login', async () => {
  await page.goto(creds.dev_url, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.sidebar .brand', { timeout: 20000 })
})

await step('abrir com conteúdo compartilhado', async () => {
  await page.goto(`${creds.dev_url}?compartilhado=${encodeURIComponent(SHARED_URL)}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  return SHARED_URL
})

await step('processa sozinho, sem o usuário tocar em nada', async () => {
  // Conteúdo curto pode terminar antes de olharmos, então aceitamos tanto o
  // processamento em curso quanto o resultado já pronto — o que importa é que
  // nada disso exigiu um clique.
  await page.waitForSelector('.processing-box, .modal', { timeout: 30000 })
  const processing = await page.locator('.processing-title').textContent().catch(() => null)
  await page.screenshot({ path: `${OUT}/share-01-processando.png` })
  return processing ? processing.trim() : 'já concluído (conteúdo curto)'
})

await step('chega ao modal de sugestão de pasta', async () => {
  await page.waitForSelector('.modal', { timeout: 180000 })
  const text = await page.locator('.modal').textContent()
  await page.screenshot({ path: `${OUT}/share-02-sugestao.png` })
  return text.replace(/\s+/g, ' ').slice(0, 90)
})

console.log('\nerros de página:', errors.length ? errors.join('\n') : '(nenhum)')
await browser.close()
