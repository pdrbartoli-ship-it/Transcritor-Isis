// A promessa central do Dito é que o conteúdo fica ilegível para quem tiver
// acesso ao banco. Isso não dá para verificar olhando a tela: é preciso ler a
// linha crua pela API do Supabase, com a sessão do próprio usuário.
import { criarRelator, certo, novaPagina, entrar, dublarBackend, TRANSCRICAO } from './ajuda.mjs'

const SUPA = 'https://hgmwngasnltlrqlwimdj.supabase.co'

async function lerLinhaCrua(page) {
  return page.evaluate(async ({ supa }) => {
    const chave = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    const token = JSON.parse(localStorage.getItem(chave))?.access_token
    const anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXduZ2Fzbmx0bHJxbHdpbWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTU0NTcsImV4cCI6MjA5NTk5MTQ1N30.d936pnaq2YLJ54NvNNKddUP62TPJhtbUMz2PdbSi6Sc'
    const r = await fetch(`${supa}/rest/v1/sessions?select=id,title,transcript,summary,enc_version&order=created_at.desc&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    })
    return (await r.json())[0] || null
  }, { supa: SUPA })
}

export default async function (browser) {
  const t = criarRelator('privacidade')
  const page = await novaPagina(browser)
  await dublarBackend(page)
  await entrar(page)
  await page.waitForSelector('.sidebar-item', { timeout: 30000 })

  let crua = null
  await t('a conversa mais recente existe no banco', async () => {
    crua = await lerLinhaCrua(page)
    certo(crua && crua.id, 'não foi possível ler a linha')
  })

  await t('a transcrição está cifrada no banco, não em texto puro', async () => {
    const texto = String(crua.transcript || '')
    certo(texto.length > 0, 'transcrição vazia no banco')
    certo(!texto.includes('orçamento') && !TRANSCRICAO.slice(0, 30).split(' ').every(p => texto.includes(p)),
      'a transcrição está legível no banco')
    certo(crua.enc_version, 'a linha não tem marca de versão de cifra')
  })

  await t('o título também está cifrado', async () => {
    certo(!String(crua.title || '').includes('[E2E]'), 'o título está legível no banco')
  })

  await t('mesmo cifrada, a conversa é legível na tela', async () => {
    await page.goto(`http://localhost:5173/#/conversa/${crua.id}`)
    await page.waitForSelector('.conversa-head h1', { timeout: 25000 })
    const titulo = await page.locator('.conversa-head h1').innerText()
    certo(titulo.trim().length > 2 && !/^[A-Za-z0-9+/=]{20,}$/.test(titulo), `título ilegível na tela: "${titulo}"`)
  })

  await t('a chave sai do aparelho ao sair da conta', async () => {
    const antes = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).length)
    await page.locator('.foot-user button[title="Sair"]').click()
    await page.waitForFunction(() => location.hash.includes('/auth'), { timeout: 20000 })
    const sobrou = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => /chave|dek|cofre|key/i.test(k)))
    certo(sobrou.length === 0, `sobrou chave no aparelho: ${sobrou.join(', ')}`)
    void antes
  })

  await t('depois de sair, a conversa não abre mais', async () => {
    await page.goto(`http://localhost:5173/#/conversa/${crua.id}`)
    await page.waitForFunction(() => location.hash.includes('/auth'), { timeout: 20000 })
  })

  await page.context().close()
  return t.itens
}
