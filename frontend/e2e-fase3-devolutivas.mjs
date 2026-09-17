// Verificação da Fase 3 (devolutiva 10): o limite visível.
//
// Nada aqui gasta pergunta nem minuto: o saldo, o plano e o contador de
// perguntas são simulados interceptando as leituras do Supabase, e o arquivo
// de áudio é gerado na hora — só a duração dele importa.
//
// A duração de LINK depende do endpoint /duracao-link, que só existe no backend
// publicado: rode com DITO_URL apontando para produção para ver essa parte.
//
// Rodar com o dev server de pé:  cd frontend && node e2e-fase3-devolutivas.mjs

import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const creds = JSON.parse(readFileSync(new URL('../e2e/credentials.json', import.meta.url)))
const RAIZ = (process.env.DITO_URL || creds.dev_url || 'http://localhost:5173').replace(/\/+$/, '')
const PRODUCAO = !RAIZ.includes('localhost')
const OUT = new URL('./.test-results/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const SUPA = 'https://hgmwngasnltlrqlwimdj.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXduZ2Fzbmx0bHJxbHdpbWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTU0NTcsImV4cCI6MjA5NTk5MTQ1N30.d936pnaq2YLJ54NvNNKddUP62TPJhtbUMz2PdbSi6Sc'

const resultados = []
const checar = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok })
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

// WAV mudo de 8 bits: o navegador lê a duração dos metadados sem decodificar.
function wavMudo(segundos, taxa = 8000) {
  const amostras = segundos * taxa
  const buf = Buffer.alloc(44 + amostras)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + amostras, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(taxa, 24); buf.writeUInt32LE(taxa, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34)
  buf.write('data', 36); buf.writeUInt32LE(amostras, 40)
  buf.fill(128, 44)
  return buf
}

// Uma conversa real da conta, só para abrir a tela — nenhuma pergunta é feita.
async function idDeUmaConversa() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  }).then(r => r.json())
  const linhas = await fetch(`${SUPA}/rest/v1/sessions?select=id&order=created_at.desc&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${auth.access_token}` },
  }).then(r => r.json())
  return linhas[0]?.id
}

// Responde uma leitura do Supabase nos dois formatos do PostgREST.
function responder(rota, registro) {
  const objeto = (rota.request().headers()['accept'] || '').includes('vnd.pgrst.object')
  return rota.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(objeto ? registro : [registro]),
  })
}

async function entrar(page) {
  await page.goto(`${RAIZ}/#/auth`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Acessar', exact: true }).click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home, .layout, .sidebar', { timeout: 30000 })
}

async function contexto(navegador, { plano, minutosUsados, perguntasUsadas } = {}) {
  const ctx = await navegador.newContext()
  if (plano) await ctx.route('**/rest/v1/subscriptions**', r => responder(r, { plano }))
  if (minutosUsados != null) {
    const fim = new Date(Date.now() + 20 * 86400e3).toISOString()
    await ctx.route('**/rest/v1/uso_mensal**', r => responder(r, { minutos_usados: minutosUsados, periodo_fim: fim }))
  }
  if (perguntasUsadas != null) {
    await ctx.route('**/rest/v1/perguntas_transcricao**', r => responder(r, { perguntas_usadas: perguntasUsadas }))
  }
  const page = await ctx.newPage()
  await entrar(page)
  return { ctx, page }
}

const texto = async (page, seletor) => (await page.locator(seletor).first().textContent({ timeout: 15000 }).catch(() => null))?.trim()

const conversaId = await idDeUmaConversa()
const navegador = await chromium.launch()

// ── Contador na home ───────────────────────────────────────────────────────
{
  const { ctx, page } = await contexto(navegador, { plano: 'gratuito', minutosUsados: 37 })
  await page.goto(`${RAIZ}/#/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.contador-minutos', { timeout: 15000 }).catch(() => {})
  checar('Home · contador mostra consumo do mês', (await texto(page, '.contador-minutos')) === '37/100 minutos usados', await texto(page, '.contador-minutos'))
  const arco = await page.locator('.contador-arco').getAttribute('stroke-dasharray').catch(() => null)
  const preenchido = arco ? Number(arco.split(' ')[0]) / Number(arco.split(' ')[1]) : 0
  checar('Home · anel preenchido na proporção do consumo', Math.abs(preenchido - 0.37) < 0.01, `${(preenchido * 100).toFixed(1)}%`)
  const cor = await page.locator('.contador-minutos span').evaluate(el => getComputedStyle(el).color)
  checar('Home · texto em tom apagado', cor === 'rgb(115, 113, 106)', cor)
  await page.locator('.home-topo').screenshot({ path: `${OUT}fase3-contador.png` })
  await page.screenshot({ path: `${OUT}fase3-home.png` })
  await ctx.close()
}

// ── Minutos do arquivo no botão e linha de consumo ─────────────────────────
{
  const { ctx, page } = await contexto(navegador, { plano: 'iniciante', minutosUsados: 100 })
  await page.goto(`${RAIZ}/#/audio`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type="file"]', { name: 'reuniao.wav', mimeType: 'audio/wav', buffer: wavMudo(90) })
  await page.waitForSelector('.split-minutos', { timeout: 15000 }).catch(() => {})
  checar('Arquivo · botão diz quanto consome', (await texto(page, '.split-main')) === 'Transcrição simples · 2 min', await texto(page, '.split-main'))
  checar('Arquivo · linha diz quanto sobra depois', (await texto(page, '.linha-consumo')) === 'Restam 898 dos seus 1000 minutos', await texto(page, '.linha-consumo'))
  await page.screenshot({ path: `${OUT}fase3-arquivo.png` })
  await ctx.close()
}

// ── Captura que não cabe no que resta ──────────────────────────────────────
{
  const { ctx, page } = await contexto(navegador, { plano: 'gratuito', minutosUsados: 99.6 })
  await page.goto(`${RAIZ}/#/audio`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type="file"]', { name: 'reuniao.wav', mimeType: 'audio/wav', buffer: wavMudo(150) })
  await page.waitForSelector('.linha-consumo.excede', { timeout: 15000 }).catch(() => {})
  checar('Não cabe · aviso antes de enviar', /Esta captura tem 3 min e restam 0 no seu mês/.test((await texto(page, '.linha-consumo')) || ''), await texto(page, '.linha-consumo'))
  const verPlanos = page.locator('.linha-consumo button', { hasText: 'Ver planos' })
  checar('Não cabe · atalho para os planos', await verPlanos.count() === 1)
  if (await verPlanos.count()) {
    await verPlanos.click()
    checar('Não cabe · atalho abre os planos', await page.waitForSelector('.modal-wide', { timeout: 5000 }).then(() => true).catch(() => false))
  }
  await ctx.close()
}

// ── Duração de link (só com o backend publicado) ───────────────────────────
if (PRODUCAO) {
  const { ctx, page } = await contexto(navegador, { plano: 'iniciante', minutosUsados: 0 })
  await page.goto(`${RAIZ}/#/video`, { waitUntil: 'networkidle' })
  // "Me at the zoo": 19 s, o primeiro vídeo do YouTube — duração que não muda.
  await page.fill('.url-form input[type="url"]', 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.waitForSelector('.split-minutos', { timeout: 60000 }).catch(() => {})
  checar('Link · botão diz quanto o vídeo consome', (await texto(page, '.split-main')) === 'Transcrição completa · 1 min', await texto(page, '.split-main'))
  checar('Link · linha diz quanto sobra depois', (await texto(page, '.linha-consumo')) === 'Restam 999 dos seus 1000 minutos', await texto(page, '.linha-consumo'))
  await ctx.close()
} else {
  console.log('· Link · pulado (o /duracao-link só existe no backend publicado)')
}

// ── Perguntas restantes nas abas da conversa ───────────────────────────────
{
  const { ctx, page } = await contexto(navegador, { plano: 'gratuito', perguntasUsadas: 1 })
  await page.goto(`${RAIZ}/#/conversa/${conversaId}`, { waitUntil: 'networkidle' })
  checar('Conversa · barra mostra perguntas restantes', (await texto(page, '.ask-dock .ask-restantes')) === 'Resta 1 pergunta nesta transcrição', await texto(page, '.ask-dock .ask-restantes'))
  await page.goto(`${RAIZ}/#/conversa/${conversaId}/chat`, { waitUntil: 'networkidle' })
  checar('Chat · mesmo número no campo do chat', (await texto(page, '.chat-input-area .ask-restantes')) === 'Resta 1 pergunta nesta transcrição', await texto(page, '.chat-input-area .ask-restantes'))
  await page.screenshot({ path: `${OUT}fase3-chat-restantes.png` })
  await ctx.close()
}
{
  const { ctx, page } = await contexto(navegador, { plano: 'gratuito', perguntasUsadas: 2 })
  await page.goto(`${RAIZ}/#/conversa/${conversaId}`, { waitUntil: 'networkidle' })
  // A contagem só existe depois que o plano chega do Layout; count() não espera.
  checar('Esgotado · barra vira convite', await page.waitForSelector('.ask-dock .ask-esgotado', { timeout: 15000 }).then(() => true).catch(() => false))
  await page.locator('.ask-dock').screenshot({ path: `${OUT}fase3-barra-esgotada.png` })
  await page.goto(`${RAIZ}/#/conversa/${conversaId}/chat`, { waitUntil: 'networkidle' })
  checar('Esgotado · chat sem campo de digitar', await page.locator('.chat-page textarea').count() === 0)
  checar('Esgotado · chat sem sugestões clicáveis', await page.locator('.starter-chips').count() === 0)
  await page.locator('.ask-esgotado button', { hasText: 'Ver planos' }).click()
  checar('Esgotado · convite abre os planos', await page.waitForSelector('.modal-wide', { timeout: 5000 }).then(() => true).catch(() => false))
  await page.screenshot({ path: `${OUT}fase3-chat-esgotado.png` })
  await ctx.close()
}
{
  const { ctx, page } = await contexto(navegador, { plano: 'avancado', perguntasUsadas: 50 })
  await page.goto(`${RAIZ}/#/conversa/${conversaId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  checar('Avançado · sem contagem (não tem limite)', await page.locator('.ask-restantes, .ask-esgotado').count() === 0)
  await ctx.close()
}

await navegador.close()
const falhas = resultados.filter(r => !r.ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`)
process.exit(falhas.length ? 1 : 0)
