// Lê o acervo da conta de teste já DECIFRADO pelo próprio código do app e grava em
// ~/teste-recall/acervo.json (fora do repositório, permissão 600). Só leitura.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { homedir } from 'os'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(creds.dev_url + '#/auth')
await page.waitForLoadState('networkidle')
await page.waitForSelector('input[type="email"]', { timeout: 15000 })
await page.click('text=Acessar')
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]')
await page.waitForSelector('.home', { timeout: 25000 })

const acervo = await page.evaluate(async () => {
  const base = '/src/lib/'
  const { supabase } = await import(base + 'supabase.js')
  const conv = await import(base + 'conversas.js')
  const { data: { user } } = await supabase.auth.getUser()
  const lista = await conv.listConversations(user.id, { limit: 500 })
  const out = []
  for (const c of lista) {
    try {
      const full = await conv.getConversation(c.id)
      out.push({ id: full.id, title: full.title, created_at: full.created_at, source_type: full.source_type,
        duration_s: full.duration_s, transcript: full.transcript, summary: full.summary,
        segments: full.segments, insights: full.insights, enc_version: full.enc_version })
    } catch (e) { out.push({ id: c.id, title: c.title, erro: String(e.message || e) }) }
  }
  return out
})

const dir = homedir() + '/teste-recall'
mkdirSync(dir, { recursive: true })
const arq = dir + '/acervo.json'
writeFileSync(arq, JSON.stringify(acervo))
chmodSync(arq, 0o600)

// Só estatísticas no console.
const ok = acervo.filter(c => !c.erro)
console.log(`conversas: ${acervo.length} (lidas ${ok.length}, com erro ${acervo.length - ok.length})`)
console.log(`cifradas: ${ok.filter(c => c.enc_version === 1).length} | texto puro: ${ok.filter(c => !c.enc_version).length}`)
console.log(`com segments: ${ok.filter(c => (c.segments || []).length).length} | com insights: ${ok.filter(c => c.insights).length}`)
const chars = ok.reduce((n, c) => n + (c.transcript || '').length, 0)
console.log(`texto total: ${(chars / 1000).toFixed(0)} mil caracteres ≈ ${(chars / 1400).toFixed(0)} trechos de 1,5 min`)
const min = ok.reduce((n, c) => n + (c.duration_s || 0), 0) / 60
console.log(`duração total: ${min.toFixed(0)} min (${(min / 60).toFixed(1)} h)`)
const porTipo = {}; ok.forEach(c => { porTipo[c.source_type] = (porTipo[c.source_type] || 0) + 1 })
console.log('por origem:', JSON.stringify(porTipo))
console.log('erros:', acervo.filter(c => c.erro).map(c => c.erro).slice(0, 3))
await browser.close()
