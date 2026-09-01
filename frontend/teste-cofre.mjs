import { chromium } from 'playwright'
import fs from 'fs'
const creds = JSON.parse(fs.readFileSync('../e2e/credentials.json', 'utf-8'))
let ok = 0, falhas = 0
const check = (n, c, extra='') => { if (c) { ok++; console.log(`  OK    ${n}`) } else { falhas++; console.log(`  FALHA ${n} ${extra}`) } }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('  [erro]', e.message))

// Login (cria/abre a chave). Guardamos a chave de recuperação que aparecer.
await page.goto(creds.dev_url + '#/auth'); await page.waitForTimeout(900)
const a = page.getByText('Acessar', { exact: true })
if (await a.isVisible().catch(() => false)) await a.click()
await page.fill('input[type="email"]', creds.email)
await page.fill('input[type="password"]', creds.password)
await page.click('button[type="submit"]'); await page.waitForTimeout(4000)

if (await page.locator('.chave-modal').count()) {
  const ultimo = (await page.locator('.chave-valor').textContent()).trim().split('-').pop()
  await page.locator('.chave-confirma-input').fill(ultimo)
  await page.getByRole('button', { name: 'Guardei minha chave, continuar' }).click()
  await page.waitForTimeout(2000)
}
check('entrou no app com chave pronta', (await page.locator('.app-shell').count()) === 1)

console.log('\n== gravar uma conversa nova: nasce cifrada ==')
const r = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { createConversation, getConversation, listConversations } = await import('/src/lib/conversas.js')
  const { data: { user } } = await supabase.auth.getUser()

  const SEGREDO = 'ACORDO CONFIDENCIAL SOBRE O CONTRATO DA ACME'
  const conv = await createConversation(user.id, {
    transcript: `Reunião de teste. ${SEGREDO}. Fim.`,
    summary: 'Resumo secreto de teste',
    segments: [{ text: SEGREDO, start: 0 }],
    insights: { todos: ['ligar para a Acme'] },
    title: 'Conversa de teste cripto',
    duration_s: 60,
  }, 'record', 'teste')

  // Lê a linha CRUA, sem passar pela camada que decifra — é o que um invasor
  // com acesso ao banco veria.
  const { data: crua } = await supabase.from('sessions')
    .select('title, transcript, summary, segments, insights, enc_version')
    .eq('id', conv.id).single()

  const aberta = await getConversation(conv.id)
  const lista = await listConversations(user.id)

  return {
    id: conv.id,
    encVersion: crua.enc_version,
    cruaTemSegredo: JSON.stringify(crua).includes(SEGREDO),
    cruaTemTitulo: String(crua.title).includes('Conversa de teste'),
    amostraCrua: String(crua.transcript).slice(0, 46),
    abertaCerta: aberta.transcript.includes(SEGREDO),
    tituloAberto: aberta.title,
    segmentsAbertos: aberta.segments?.[0]?.text === SEGREDO,
    insightsAbertos: aberta.insights?.todos?.[0] === 'ligar para a Acme',
    naListaCerto: lista.find(c => c.id === conv.id)?.title,
  }
})

console.log(`  o que o banco guarda: "${r.amostraCrua}…"`)
check('marcada como cifrada (enc_version 1)', r.encVersion === 1)
check('o SEGREDO não aparece na linha crua', !r.cruaTemSegredo)
check('nem o título aparece em claro', !r.cruaTemTitulo)
check('o app lê a transcrição certa', r.abertaCerta)
check('título decifrado certo', r.tituloAberto === 'Conversa de teste cripto')
check('segments decifrados', r.segmentsAbertos)
check('insights decifrados', r.insightsAbertos)
check('aparece certo na lista lateral', r.naListaCerto === 'Conversa de teste cripto')

console.log('\n== busca continua achando dentro do texto cifrado ==')
const b = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { searchConversations, invalidarBuscaLocal } = await import('/src/lib/conversas.js')
  const { data: { user } } = await supabase.auth.getUser()
  invalidarBuscaLocal()
  const porTitulo = await searchConversations(user.id, 'teste cripto')
  const porTexto = await searchConversations(user.id, 'ACME')
  const antiga = await searchConversations(user.id, 'incas')
  return {
    achouTitulo: porTitulo.titles.length > 0,
    achouNoTexto: porTexto.transcripts.length > 0 || porTexto.titles.length > 0,
    trecho: porTexto.transcripts[0]?.excerpt || '',
    achouAntigaEmTextoPuro: antiga.titles.length + antiga.transcripts.length > 0,
  }
})
check('acha pelo título (cifrado)', b.achouTitulo)
check('acha por palavra dentro da transcrição cifrada', b.achouNoTexto)
check('conversas ANTIGAS em texto puro continuam achando', b.achouAntigaEmTextoPuro)
if (b.trecho) console.log(`  trecho: "${b.trecho.slice(0, 70)}…"`)

console.log('\n== chat: pergunta e resposta cifradas ==')
const c = await page.evaluate(async ({ id }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { cifrarMensagem, decifrarMensagens } = await import('/src/lib/cofre.js')
  const { data: { user } } = await supabase.auth.getUser()
  const { data: chat } = await supabase.from('chats').insert({ session_id: id, user_id: user.id }).select('id').single()
  const PERGUNTA = 'quanto ficou o contrato da Acme?'
  const m = await cifrarMensagem(PERGUNTA)
  await supabase.from('chat_messages').insert({ chat_id: chat.id, user_id: user.id, role: 'user', ...m })
  const { data: crua } = await supabase.from('chat_messages').select('content, enc_version').eq('chat_id', chat.id).single()
  const [aberta] = await decifrarMensagens([crua])
  return { cruaTemPergunta: String(crua.content).includes('Acme'), abertaCerta: aberta.content === PERGUNTA }
}, { id: r.id })
check('a pergunta não aparece em claro no banco', !c.cruaTemPergunta)
check('o app lê a pergunta certa', c.abertaCerta)

console.log('\n== export sai LEGÍVEL mesmo com o banco cifrado ==')
const e = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { fetchEverything, toMarkdown } = await import('/src/lib/meusDados.js')
  const { data: { user } } = await supabase.auth.getUser()
  const md = toMarkdown(await fetchEverything(user.id))
  return { temSegredo: md.includes('ACORDO CONFIDENCIAL'), temAntiga: md.includes('incas'), tamanho: md.length }
})
check('o backup contém o texto decifrado', e.temSegredo)
check('e também as conversas antigas', e.temAntiga)

console.log('\n== sem chave no aparelho, o conteúdo NÃO vaza em claro ==')
const s = await page.evaluate(async ({ id }) => {
  const { esquecerDoAparelho } = await import('/src/lib/chaves.js')
  const { decifrarLinha, decifrarLista } = await import('/src/lib/cofre.js')
  const { supabase } = await import('/src/lib/supabase.js')
  await esquecerDoAparelho()
  const { data: crua } = await supabase.from('sessions').select('id, title, transcript, enc_version').eq('id', id).single()
  let bloqueou = false
  try { await decifrarLinha(crua) } catch { bloqueou = true }
  const lista = await decifrarLista([crua])
  return { bloqueou, tituloNaLista: lista[0].title, marcada: !!lista[0]._bloqueada }
}, { id: r.id })
check('decifrar sem chave FALHA (não devolve lixo em claro)', s.bloqueou)
check('na lista, a linha vira "(conteúdo bloqueado)"', s.tituloNaLista === '(conteúdo bloqueado)' && s.marcada)

console.log('\n== limpeza ==')
await page.evaluate(async ({ id }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  await supabase.from('sessions').delete().eq('id', id)
}, { id: r.id })
check('conversa de teste removida', true)

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
