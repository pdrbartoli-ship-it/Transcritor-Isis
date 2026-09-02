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

console.log('\n== login não tem tela nenhuma de chave — nunca teve pra usuário comum ==')
await logar()
check('nenhuma tela de chave aparece', (await page.locator('.chave-modal').count()) === 0)
check('entra direto no app', (await page.locator('.app-shell').count()) === 1)

console.log('\n== o caso comum: troquei a senha NO MEU APARELHO ==')
// É o único caminho de recuperação que existe hoje: sem chave de recuperação,
// sem tela de desbloqueio, o que resta é o refechamento automático que o
// ConfirmEmail dispara depois de um reset de senha bem-sucedido.
const c1 = await page.evaluate(async ({ senhaReal }) => {
  try {
    const { supabase } = await import('/src/lib/supabase.js')
    const { refecharCofreComChaveLocal, abrirComSenha, lerDoAparelho } = await import('/src/lib/chaves.js')
    const { encryptText, decryptText } = await import('/src/lib/crypto.js')
    const { data: { user } } = await supabase.auth.getUser()

    const dek = await lerDoAparelho()
    const segredo = await encryptText(dek, 'ata da reunião de ontem')

    // Simula o reset: refecha o cofre com uma senha NOVA usando a chave local.
    await refecharCofreComChaveLocal(user.id, 'senha-nova-123456')

    const dekNova = await abrirComSenha(user.id, 'senha-nova-123456')
    const legivel = await decryptText(dekNova, segredo)

    // Devolve tudo ao normal.
    await refecharCofreComChaveLocal(user.id, senhaReal)
    return { legivel, voltou: !!(await abrirComSenha(user.id, senhaReal)) }
  } catch (e) { return { erro: String(e?.message || e?.name || JSON.stringify(e)) } }
}, { senhaReal: creds.password })
if (c1.erro) console.log('  ERRO:', c1.erro)
check('senha nova passa a abrir o cofre', c1.legivel === 'ata da reunião de ontem')
check('nada foi perdido — sem chave de recuperação nenhuma', c1.legivel === 'ata da reunião de ontem')
check('estado restaurado com a senha real', c1.voltou)

console.log('\n== o caso aceito como risco: aparelho novo, sem a chave ==')
// Sem ChaveGate, isto não trava mais tela nenhuma: só falha, pontualmente, na
// ação que precisa da chave. É o risco que o Pedro decidiu aceitar em troca de
// não complicar o login de todo mundo.
const semChave = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { createConversation } = await import('/src/lib/conversas.js')
  const { esquecerDoAparelho } = await import('/src/lib/chaves.js')
  const { data: { user } } = await supabase.auth.getUser()
  await esquecerDoAparelho()
  try {
    await createConversation(user.id, {
      transcript: 'não deveria gravar', summary: 's', segments: [], insights: {}, title: 'x', duration_s: 1,
    }, 'record', 'x')
    return { falhou: false }
  } catch (e) {
    return { falhou: true, mensagem: e.message }
  }
})
check('sem chave, salvar cifrado FALHA (não grava em claro por engano)', semChave.falhou)
console.log(`  mensagem: "${semChave.mensagem}"`)

// Devolve a chave ao aparelho para não deixar a conta de teste travada.
await page.evaluate(async ({ senha }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { abrirComSenha } = await import('/src/lib/chaves.js')
  const { data: { user } } = await supabase.auth.getUser()
  await abrirComSenha(user.id, senha)
}, { senha: creds.password })

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
