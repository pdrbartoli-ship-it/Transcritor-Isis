import { chromium } from 'playwright'
import fs from 'fs'
const creds = JSON.parse(fs.readFileSync('../e2e/credentials.json', 'utf-8'))
let ok = 0, falhas = 0
const check = (n, c, x='') => { if (c) { ok++; console.log(`  OK    ${n}`) } else { falhas++; console.log(`  FALHA ${n} ${x}`) } }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('  [erro]', e.message))

async function logar() {
  await page.goto(creds.dev_url + '#/auth'); await page.waitForTimeout(900)
  const a = page.getByText('Acessar', { exact: true })
  if (await a.isVisible().catch(() => false)) await a.click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]'); await page.waitForTimeout(4000)
}

console.log('\n== login não pede mais nada (chave de recuperação virou opcional) ==')
await logar()
check('NÃO aparece tela obrigatória de chave', (await page.locator('.chave-modal').count()) === 0)
check('entra direto no app', (await page.locator('.app-shell').count()) === 1)

console.log('\n== cenário 1: troquei a senha NO MEU APARELHO ==')
const c1 = await page.evaluate(async ({ senhaReal }) => {
 try {
  const { supabase } = await import('/src/lib/supabase.js')
  const { refecharCofreComChaveLocal, abrirComSenha } = await import('/src/lib/chaves.js')
  const { encryptText, decryptText } = await import('/src/lib/crypto.js')
  const { lerDoAparelho } = await import('/src/lib/chaves.js')
  const { data: { user } } = await supabase.auth.getUser()

  // Cifra algo com a chave atual
  const dek = await lerDoAparelho()
  const segredo = await encryptText(dek, 'ata da reunião de ontem')

  // Simula o reset: refecha o cofre com uma senha NOVA usando a chave local
  await refecharCofreComChaveLocal(user.id, 'senha-nova-123456')

  // A senha nova agora abre o cofre, e o conteúdo antigo continua legível
  const dekNova = await abrirComSenha(user.id, 'senha-nova-123456')
  const legivel = await decryptText(dekNova, segredo)

  // Devolve tudo ao normal
  await refecharCofreComChaveLocal(user.id, senhaReal)
  return { legivel, voltou: !!(await abrirComSenha(user.id, senhaReal)) }
 } catch (e) { return { erro: String(e?.message || e?.name || JSON.stringify(e)) } }
}, { senhaReal: creds.password })
if (c1.erro) console.log('  ERRO:', c1.erro)
check('senha nova passa a abrir o cofre', c1.legivel === 'ata da reunião de ontem')
check('NADA foi perdido — sem chave de recuperação nenhuma', c1.legivel === 'ata da reunião de ontem')
check('estado restaurado com a senha real', c1.voltou)

console.log('\n== cenário 2: aparelho novo, senha resetada, sem chave de recuperação ==')
// Estado idêntico ao pós-reset longe de casa: existe cofre, a senha não o abre,
// e o aparelho não tem chave.
const preso = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { createConversation } = await import('/src/lib/conversas.js')
  const { data: { user } } = await supabase.auth.getUser()
  // Contagem relativa: o acervo do Pedro cresce entre execuções, e fixar um
  // número faria o teste acusar falha só porque ele gravou uma conversa.
  const antes = (await supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id)).count
  const c = await createConversation(user.id, {
    transcript: 'conteudo que vai ficar preso', summary: 's', segments: [], insights: {}, title: 'Presa', duration_s: 1,
  }, 'record', 'x')
  const { esquecerDoAparelho } = await import('/src/lib/chaves.js')
  await esquecerDoAparelho()
  return { id: c.id, antes }
})
await page.reload(); await page.waitForTimeout(2500)
check('a tela de desbloqueio aparece', (await page.locator('.chave-modal').count()) === 1)

await page.locator('.chave-senha-input').fill('senha-que-nao-abre-o-cofre')
await page.getByRole('button', { name: 'Desbloquear' }).click()
await page.waitForTimeout(2500)
check('avisa que a senha não abre', (await page.locator('.alert-error').textContent().catch(()=>'')) === 'Senha incorreta.')

const saida = page.getByRole('button', { name: /recomeçar/i })
check('OFERECE saída (antes prendia aqui para sempre)', await saida.count() > 0)
await page.screenshot({ path: '.test-results/recomeco.png' })

// Agora com a senha certa, o recomeço
await page.locator('.chave-senha-input').fill(creds.password)
await page.waitForTimeout(200)
await saida.click()
await page.waitForTimeout(4000)
check('entrou no app depois de recomeçar', (await page.locator('.app-shell').count()) === 1)
check('avisou o que aconteceu', (await page.locator('.toast').count()) > 0)
if (await page.locator('.toast').count()) console.log('   aviso:', (await page.locator('.toast-msg').textContent()).trim())

const depois = await page.evaluate(async ({ idPreso }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { user } } = await supabase.auth.getUser()
  const presa = await supabase.from('sessions').select('id').eq('id', idPreso).maybeSingle()
  const total = await supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  const cif = await supabase.from('sessions').select('id').eq('user_id', user.id).eq('enc_version', 1)
  return { presaSumiu: !presa.data, total: total.count, aindaCifradas: cif.data?.length ?? 0 }
}, { idPreso: preso.id })
check('a conversa ilegível foi removida', depois.presaSumiu)
check('as conversas em texto puro seguem intactas', depois.total === preso.antes,
      `(esperava ${preso.antes}, veio ${depois.total})`)
check('não sobrou nada cifrado órfão', depois.aindaCifradas === 0)

console.log('\n== gravar volta a funcionar com o cofre novo ==')
const novo = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { createConversation, getConversation } = await import('/src/lib/conversas.js')
  const { data: { user } } = await supabase.auth.getUser()
  const c = await createConversation(user.id, {
    transcript: 'nova depois do recomeço', summary: 's', segments: [], insights: {}, title: 'Nova', duration_s: 1,
  }, 'record', 'x')
  const lida = await getConversation(c.id)
  await supabase.from('sessions').delete().eq('id', c.id)
  return lida.transcript
})
check('grava e lê normalmente depois do recomeço', novo === 'nova depois do recomeço')

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
