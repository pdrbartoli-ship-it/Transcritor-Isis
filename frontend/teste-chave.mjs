import { chromium } from 'playwright'
import fs from 'fs'

const creds = JSON.parse(fs.readFileSync('../e2e/credentials.json', 'utf-8'))
const outDir = '.test-results'
let ok = 0, falhas = 0
const check = (nome, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome} ${extra}`) }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  ERRO DE PÁGINA:', e.message))

async function logar() {
  await page.goto(creds.dev_url + '#/auth')
  await page.waitForTimeout(900)
  const a = page.getByText('Acessar', { exact: true })
  if (await a.isVisible().catch(() => false)) await a.click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3500)
}

const semChave = async () => page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('user_keys').delete().eq('user_id', user.id)
  const idb = indexedDB.deleteDatabase('dito-chaves')
  await new Promise(r => { idb.onsuccess = r; idb.onerror = r; idb.onblocked = r })
  return true
})

console.log('\n== primeiro login: a chave nasce ==')
await logar()
await semChave()          // garante estado de "conta sem chave"
await page.reload(); await page.waitForTimeout(1200)
await page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.js'); await supabase.auth.signOut() })
await logar()

const modal = page.locator('.chave-modal')
check('a tela da chave aparece no primeiro login', await modal.count() === 1)
const chave = (await page.locator('.chave-valor').textContent() || '').trim()
console.log(`  chave mostrada: ${chave}`)
check('formato XXXX-XXXX-…', /^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/.test(chave))
check('travou na tela de login (não entrou no app)', !(await page.locator('.app-shell').count()))
await page.screenshot({ path: `${outDir}/chave-modal.png` })

console.log('\n== a trava da confirmação ==')
const botao = page.getByRole('button', { name: 'Guardei minha chave, continuar' })
check('bloqueado sem digitar nada', await botao.isDisabled())
await page.locator('.chave-confirma-input').fill('XXXX')
await page.waitForTimeout(200)
check('bloqueado com grupo errado', await botao.isDisabled())

const ultimo = chave.split('-').pop()
await page.locator('.chave-confirma-input').fill(ultimo.toLowerCase())
await page.waitForTimeout(200)
check('aceita o grupo certo em minúsculas', !(await botao.isDisabled()))

console.log('\n== baixar o arquivo da chave ==')
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
await page.getByRole('button', { name: 'Baixar arquivo' }).click()
const arquivo = await dl
if (arquivo) {
  const caminho = `${outDir}/${arquivo.suggestedFilename()}`
  await arquivo.saveAs(caminho)
  const txt = fs.readFileSync(caminho, 'utf-8')
  check('o arquivo contém a chave', txt.includes(chave))
  check('o arquivo explica o risco', txt.includes('perdidas para sempre'))
  fs.unlinkSync(caminho)
} else check('baixou o arquivo da chave', false)

console.log('\n== confirmar entra no app ==')
await botao.click()
await page.waitForTimeout(2000)
check('entrou no app depois de confirmar', (await page.locator('.app-shell').count()) === 1)

const estado = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('user_keys').select('*').eq('user_id', user.id).maybeSingle()
  const db = await new Promise(r => { const q = indexedDB.open('dito-chaves', 1); q.onsuccess = () => r(q.result); q.onerror = () => r(null) })
  const dek = db ? await new Promise(r => { const t = db.transaction('chaves', 'readonly').objectStore('chaves').get('dek'); t.onsuccess = () => r(t.result); t.onerror = () => r(null) }) : null
  return {
    temLinha: !!data,
    cofres: data ? Object.keys(data).filter(k => k.includes('cofre')) : [],
    cofreSenhaTamanho: data?.senha_cofre?.length || 0,
    dekNoAparelho: !!dek,
    dekExtraivel: dek ? dek.extractable : null,
    dekTipo: dek ? dek.algorithm?.name : null,
  }
})
check('linha de cofres criada no banco', estado.temLinha)
check('os DOIS cofres existem', estado.cofres.length === 2, JSON.stringify(estado.cofres))
check('DEK guardada no aparelho', estado.dekNoAparelho)
check('DEK do aparelho é NÃO extraível', estado.dekExtraivel === false)
check('DEK é AES-GCM', estado.dekTipo === 'AES-GCM')

console.log('\n== segundo login: abre o cofre, sem mostrar a chave de novo ==')
await page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.js'); await supabase.auth.signOut() })
await logar()
check('NÃO mostra a tela da chave de novo', (await page.locator('.chave-modal').count()) === 0)
check('entrou direto no app', (await page.locator('.app-shell').count()) === 1)

console.log('\n== recuperação: a chave devolve o acesso ==')
const rec = await page.evaluate(async ({ chave }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { recuperarComChave } = await import('/src/lib/chaves.js')
  const { unwrapDEK, encryptText, decryptText } = await import('/src/lib/crypto.js')
  const { data: { user } } = await supabase.auth.getUser()

  const antes = (await supabase.from('user_keys').select('*').eq('user_id', user.id).single()).data
  // Cifra algo com a DEK ATUAL, para provar que continua legível depois.
  const dekAtual = await unwrapDEK(antes.senha_cofre, antes.senha_salt, 'SENHA-DE-TESTE-NAO-USADA').catch(() => null)
  return { cofreAntes: antes.senha_cofre, dekAtual: !!dekAtual }
}, { chave })
check('senha errada não abre o cofre (checagem de sanidade)', rec.dekAtual === false)

// Simula "esqueci a senha": reembrulha o cofre com uma senha nova usando a
// chave de recuperação, prova que o conteúdo antigo continua abrindo, e depois
// devolve tudo ao normal.
const recuperacao = await page.evaluate(async ({ chave, senhaReal }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { recuperarComChave } = await import('/src/lib/chaves.js')
  const { unwrapDEK, encryptText, decryptText } = await import('/src/lib/crypto.js')
  const { data: { user } } = await supabase.auth.getUser()

  const antes = (await supabase.from('user_keys').select('*').eq('user_id', user.id).single()).data
  const dekOriginal = await unwrapDEK(antes.senha_cofre, antes.senha_salt, senhaReal)
  const segredo = await encryptText(dekOriginal, 'ata secreta da reunião')

  // "Esqueci a senha" → chave de recuperação + senha nova
  await recuperarComChave(user.id, chave, 'senha-nova-ficticia-999')

  const depois = (await supabase.from('user_keys').select('*').eq('user_id', user.id).single()).data
  const dekNova = await unwrapDEK(depois.senha_cofre, depois.senha_salt, 'senha-nova-ficticia-999')
  const legivel = await decryptText(dekNova, segredo)

  return {
    cofreMudou: antes.senha_cofre !== depois.senha_cofre,
    recuperacaoIntacta: antes.recuperacao_cofre === depois.recuperacao_cofre,
    conteudoAntigoLegivel: legivel === 'ata secreta da reunião',
  }
}, { chave, senhaReal: creds.password })

check('o cofre da senha foi refeito', recuperacao.cofreMudou)
check('o cofre da recuperação seguiu intacto', recuperacao.recuperacaoIntacta)
check('CONTEÚDO CIFRADO ANTES CONTINUA LEGÍVEL', recuperacao.conteudoAntigoLegivel)

console.log('\n== limpeza: devolvendo a conta ao estado anterior ==')
await semChave()
const limpo = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('user_keys').select('user_id').eq('user_id', user.id).maybeSingle()
  return !data
})
check('linha de chave removida (você verá a tela e guardará a SUA chave)', limpo)

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
