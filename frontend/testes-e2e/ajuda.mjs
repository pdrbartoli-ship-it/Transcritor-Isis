// Peças compartilhadas por todas as suítes E2E do Dito.
//
// Duas decisões que valem para o conjunto todo:
//
// 1. O backend é DUBLADO (page.route). Deixar os testes chamarem o Render de
//    verdade tornaria cada rodada lenta, dependente de rede, cara em crédito de
//    IA e — pior — não determinística: a mesma tela passaria ou falharia
//    conforme o que o Whisper entendesse do tom do microfone falso. O que se
//    verifica aqui é o APP; o backend tem os testes dele (teste-audio-grande.py).
//
// 2. O login é real, contra o Supabase de verdade. Não há como dublá-lo sem
//    dublar junto a criptografia (a chave nasce no login), e é justamente a
//    corrente inteira — sessão → chave → gravar cifrado → ler decifrado — que
//    precisa ser exercitada de ponta a ponta.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

export const creds = JSON.parse(readFileSync(new URL('../../e2e/credentials.json', import.meta.url)))
export const BASE = 'http://localhost:5173/'
export const API = 'https://transcritor-backend.onrender.com'

// Marca das conversas criadas pelos testes, para a faxina do fim saber o que
// é lixo de teste e o que é dado de verdade do usuário.
export const MARCA = '[E2E]'

export async function abrirNavegador() {
  return chromium.launch({
    args: [
      // Microfone falso: sem isto getUserMedia falha em headless e nenhum
      // teste de gravação sai do lugar.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
}

export async function novaPagina(browser, { viewport = { width: 1400, height: 950 }, permissions = ['microphone'] } = {}) {
  const ctx = await browser.newContext({ viewport, permissions, acceptDownloads: true })
  const page = await ctx.newPage()
  page.erros = []
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    // Ruído conhecido que não é defeito do app.
    if (/favicon|ERR_INTERNET_DISCONNECTED|Download the React DevTools/.test(t)) return
    page.erros.push(t.slice(0, 200))
  })
  page.on('pageerror', e => page.erros.push('pageerror: ' + e.message.slice(0, 200)))
  return page
}

// ── Dublê do backend ─────────────────────────────────────────

export const TRANSCRICAO = [
  'Bom dia a todos, obrigado por virem. Hoje temos três assuntos.',
  'Primeiro o orçamento do trimestre, que fechou dez por cento acima do previsto.',
  'Segundo, a data do lançamento: fica para o dia quinze do mês que vem.',
  'Terceiro, a contratação da pessoa de suporte. A Ana fica de abrir a vaga.',
  'O Bruno revisa o orçamento até sexta e manda o resumo para todo mundo.',
].join(' ')

export function resultadoFalso(titulo = `${MARCA} Reunião de teste`) {
  const insights = {
    title: titulo,
    topics: [
      { label: 'Orçamento do trimestre', detail: '- Fechou 10% acima do previsto\n- Revisão até sexta', time_refs: [[0, 30]] },
      { label: 'Data do lançamento', detail: '- Definida para o dia 15', time_refs: [[30, 60]] },
      { label: 'Contratação de suporte', detail: '- Vaga a ser aberta pela Ana', time_refs: [[60, 90]] },
      { label: 'Próximos passos', detail: '- Resumo enviado a todos', time_refs: [[90, 120]] },
    ],
    todos: [
      { task: 'Abrir a vaga de suporte', description: 'Publicar no site e no LinkedIn', owners: ['Ana'], due: 'esta semana', time_ref: [60, 90] },
      { task: 'Revisar o orçamento', description: 'Conferir o estouro de 10%', owners: ['Bruno'], due: 'sexta', time_ref: [0, 30] },
      { task: 'Enviar o resumo', description: '', owners: ['Bruno'], due: 'sexta', time_ref: [90, 120] },
      { task: 'Confirmar a data com o marketing', description: '', owners: [], due: '', time_ref: [30, 60] },
      { task: 'Marcar a próxima reunião', description: '', owners: [], due: '', time_ref: [110, 120] },
    ],
    chapters: [
      { start: 0, end: 40, title: 'Abertura e orçamento', bullets: ['Três assuntos na pauta', 'Orçamento 10% acima'] },
      { start: 40, end: 80, title: 'Data do lançamento', bullets: ['Dia 15 do mês que vem'] },
      { start: 80, end: 120, title: 'Contratação e fechamento', bullets: ['Ana abre a vaga', 'Bruno manda o resumo'] },
    ],
    duration_s: 120,
  }
  return {
    transcript: TRANSCRICAO,
    summary: '- Orçamento 10% acima do previsto\n- Lançamento no dia 15\n- Ana abre a vaga de suporte',
    chunks_used: 1,
    duration_estimate: '2 min',
    title: titulo,
    segments: [
      { start: 0, end: 30, text: 'Bom dia a todos, obrigado por virem. Hoje temos três assuntos.' },
      { start: 30, end: 60, text: 'Primeiro o orçamento do trimestre, que fechou dez por cento acima do previsto.' },
      { start: 60, end: 90, text: 'Segundo, a data do lançamento: fica para o dia quinze do mês que vem.' },
      { start: 90, end: 120, text: 'Terceiro, a contratação da pessoa de suporte. A Ana fica de abrir a vaga.' },
    ],
    insights,
    duration_s: 120,
    usage: { input_tokens: 100, output_tokens: 200, audio_seconds: 120 },
  }
}

// `espiao` recebe cada requisição interceptada — é assim que um teste confere
// o QUE foi enviado (tamanho do áudio, nome do arquivo), e não só a tela.
export async function dublarBackend(page, { espiao = null, transcribe = null, chat = null } = {}) {
  await page.route(`${API}/**`, async route => {
    const req = route.request()
    const url = new URL(req.url())
    espiao?.({ metodo: req.method(), rota: url.pathname, corpo: req.postDataBuffer?.() || null })

    if (url.pathname === '/' ) return route.fulfill({ status: 200, json: { status: 'ok' } })

    if (url.pathname === '/transcribe' || url.pathname === '/process-url') {
      if (transcribe) return transcribe(route, req)
      return route.fulfill({ status: 200, json: resultadoFalso() })
    }
    if (url.pathname === '/insights') {
      const r = resultadoFalso()
      return route.fulfill({ status: 200, json: { insights: r.insights, summary: r.summary } })
    }
    if (url.pathname === '/chat') {
      if (chat) return chat(route, req)
      return route.fulfill({ status: 200, json: { answer: 'O orçamento fechou 10% acima do previsto.', usage: {} } })
    }
    return route.fulfill({ status: 200, json: {} })
  })
}

// ── Login ────────────────────────────────────────────────────

export async function entrar(page, { rota = '' } = {}) {
  await page.goto(BASE + rota)
  await page.waitForLoadState('networkidle')
  // Já logado (contexto reaproveitado): a landing nem aparece.
  if (await page.locator('.sidebar').count()) return
  const entrarBtn = page.getByRole('button', { name: 'Entrar', exact: true }).first()
  if (await entrarBtn.count()) await entrarBtn.click()
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  // A tela abre na aba "Criar conta": sem este clique o submit tenta cadastrar.
  await page.getByRole('button', { name: 'Acessar', exact: true }).click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.sidebar', { timeout: 40000 })
}

// ── Faxina ───────────────────────────────────────────────────

// Apaga as conversas criadas pelos testes usando a sessão do próprio navegador.
// Sem isto cada rodada deixa lixo permanente na conta.
export async function limparConversasDeTeste(page, desdeISO) {
  return page.evaluate(async ({ desde }) => {
    const chave = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!chave) return { apagadas: 0, erro: 'sem sessão' }
    const sessao = JSON.parse(localStorage.getItem(chave))
    const token = sessao?.access_token
    const url = 'https://hgmwngasnltlrqlwimdj.supabase.co'
    const anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXduZ2Fzbmx0bHJxbHdpbWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTU0NTcsImV4cCI6MjA5NTk5MTQ1N30.d936pnaq2YLJ54NvNNKddUP62TPJhtbUMz2PdbSi6Sc'
    const h = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    // O título pode estar cifrado; a marca então não casa por SQL. O critério
    // seguro é a janela de tempo desta rodada, medida pelo runner.
    const r = await fetch(`${url}/rest/v1/sessions?created_at=gte.${desde}&select=id`, { headers: h })
    const linhas = await r.json()
    let apagadas = 0
    for (const l of linhas || []) {
      const d = await fetch(`${url}/rest/v1/sessions?id=eq.${l.id}`, { method: 'DELETE', headers: h })
      if (d.ok) apagadas++
    }
    return { apagadas }
  }, { desde: desdeISO })
}

// ── Relator ──────────────────────────────────────────────────

export function criarRelator(suite) {
  const itens = []
  const t = async (nome, fn) => {
    const inicio = Date.now()
    try {
      await fn()
      itens.push({ suite, nome, ok: true, ms: Date.now() - inicio })
      console.log(`  ok    ${nome}`)
    } catch (e) {
      itens.push({ suite, nome, ok: false, ms: Date.now() - inicio, erro: e.message.split('\n').slice(0, 3).join(' | ').slice(0, 300) })
      console.log(`  FALHA ${nome}\n        ${e.message.split('\n').slice(0, 3).join(' | ').slice(0, 300)}`)
    }
  }
  t.itens = itens
  return t
}

export function certo(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem)
}
