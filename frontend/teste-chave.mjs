import { chromium } from 'playwright'
import fs from 'fs'

// Ciclo completo da chave de recuperação: gerar em "Meus dados", perder o
// acesso pela senha, e recuperar SEM perder conteúdo. É o teste que garante que
// o seguro que oferecemos ao usuário pode mesmo ser acionado.
const creds = JSON.parse(fs.readFileSync('../e2e/credentials.json', 'utf-8'))
let ok = 0, falhas = 0
const check = (n, c, x = '') => { if (c) { ok++; console.log(`  OK    ${n}`) } else { falhas++; console.log(`  FALHA ${n} ${x}`) } }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('  [erro]', e.message))

async function logar() {
  await page.goto(creds.dev_url + '#/auth'); await page.waitForTimeout(900)
  const a = page.getByText('Acessar', { exact: true })
  if (await a.isVisible().catch(() => false)) await a.click()
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]'); await page.waitForTimeout(4500)
}

await logar()
check('login entra direto, sem pedir nada', (await page.locator('.app-shell').count()) === 1)

console.log('\n== gerar a chave em "Meus dados" ==')
await page.getByRole('button', { name: 'Meus dados' }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /Gerar minha chave|Gerar uma nova chave/ }).click()
await page.waitForTimeout(3000)
const chave = (await page.locator('.chave-valor').textContent() || '').trim()
console.log(`  chave: ${chave}`)
check('a chave aparece', /^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/.test(chave))
await page.locator('.chave-confirma-input').fill(chave.split('-').pop())
await page.getByRole('button', { name: 'Guardei minha chave, continuar' }).click()
await page.waitForTimeout(1200)

console.log('\n== cria conteúdo e depois perde o acesso pela senha ==')
const preparo = await page.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { data: { user: u0 } } = await supabase.auth.getUser()
  const antes = (await supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', u0.id)).count
  const { createConversation } = await import('/src/lib/conversas.js')
  const { esquecerDoAparelho } = await import('/src/lib/chaves.js')
  const { data: { user } } = await supabase.auth.getUser()
  const c = await createConversation(user.id, {
    transcript: 'CONTEUDO QUE PRECISA SOBREVIVER', summary: 's',
    segments: [], insights: {}, title: 'Sobrevivente', duration_s: 1,
  }, 'record', 'x')
  // Simula o pós-reset: cofre fechado com uma senha que não é a atual, e o
  // aparelho sem chave nenhuma.
  const { refecharCofreComChaveLocal } = await import('/src/lib/chaves.js')
  await refecharCofreComChaveLocal(user.id, 'senha-antiga-esquecida-999')
  await esquecerDoAparelho()
  return { id: c.id, antes }
})
await page.reload(); await page.waitForTimeout(2500)
check('a tela de desbloqueio aparece', (await page.locator('.chave-modal').count()) === 1)

await page.locator('.chave-senha-input').fill(creds.password)
await page.getByRole('button', { name: 'Desbloquear' }).click()
await page.waitForTimeout(2500)
check('a senha atual não abre (como após um reset)', (await page.locator('.alert-error').count()) > 0)

console.log('\n== usar a chave de recuperação ==')
const botaoChave = page.getByRole('button', { name: 'Tenho uma chave de recuperação' })
check('o app OFERECE usar a chave', await botaoChave.count() > 0)
await botaoChave.click()
await page.waitForTimeout(300)

await page.locator('.chave-recomeco input').fill('AAAA-BBBB-CCCC-DDDD-EEEE')
await page.getByRole('button', { name: 'Desbloquear com a chave' }).click()
await page.waitForTimeout(2500)
check('chave errada é recusada', (await page.locator('.alert-error').textContent()).includes('não confere'))

await page.locator('.chave-recomeco input').fill(chave)
await page.getByRole('button', { name: 'Desbloquear com a chave' }).click()
await page.waitForTimeout(3500)
check('entrou no app com a chave certa', (await page.locator('.app-shell').count()) === 1)

const final = await page.evaluate(async ({ id }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { getConversation } = await import('/src/lib/conversas.js')
  const { abrirComSenha } = await import('/src/lib/chaves.js')
  const { data: { user } } = await supabase.auth.getUser()
  const lida = await getConversation(id)
  await supabase.from('sessions').delete().eq('id', id)
  const total = await supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  return {
    texto: lida.transcript,
    senhaAtualVolta: !!(await abrirComSenha(user.id, undefined).catch(() => null)) === false,
    total: total.count,
  }
}, { id: preparo.id })
check('O CONTEÚDO SOBREVIVEU — nada foi perdido', final.texto === 'CONTEUDO QUE PRECISA SOBREVIVER')
// Contagem relativa: o acervo do Pedro cresce entre execuções, e fixar um
// número faria este teste acusar falha só porque ele gravou uma conversa.
// A conversa de teste é criada e apagada dentro do próprio teste, então o
// acervo tem de terminar exatamente como começou.
check('nenhuma conversa foi perdida no caminho', final.total === preparo.antes,
      `(esperava ${preparo.antes}, veio ${final.total})`)

console.log('\n== a senha atual volta a abrir o cofre ==')
const volta = await page.evaluate(async ({ senha }) => {
  const { supabase } = await import('/src/lib/supabase.js')
  const { abrirComSenha } = await import('/src/lib/chaves.js')
  const { data: { user } } = await supabase.auth.getUser()
  return !!(await abrirComSenha(user.id, senha))
}, { senha: creds.password })
check('a senha que a pessoa digitou passa a valer', volta)

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
await browser.close()
process.exit(falhas ? 1 : 0)
