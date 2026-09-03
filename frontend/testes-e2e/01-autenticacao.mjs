// Porta de entrada: landing, cadastro, login, sessão, rotas protegidas.
import { BASE, creds, criarRelator, certo, novaPagina, entrar, dublarBackend } from './ajuda.mjs'

export default async function (browser) {
  const t = criarRelator('autenticação')
  const page = await novaPagina(browser)
  await dublarBackend(page)

  await t('a landing aparece para quem não está logado', async () => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    certo(await page.locator('.lp').count() === 1, 'landing não renderizou')
    certo(await page.getByRole('button', { name: 'Entrar', exact: true }).count() > 0, 'sem botão Entrar')
  })

  await t('a landing explica o produto antes de pedir conta', async () => {
    const texto = await page.locator('.lp').innerText()
    certo(/transcre|grava|reuni/i.test(texto), 'a landing não diz o que o app faz')
  })

  await t('"Entrar" leva para a tela de acesso', async () => {
    await page.getByRole('button', { name: 'Entrar', exact: true }).first().click()
    await page.waitForSelector('input[type="email"]', { timeout: 15000 })
    certo(page.url().includes('#/auth'), `rota errada: ${page.url()}`)
  })

  await t('a tela abre na aba "Criar conta"', async () => {
    const ativa = await page.locator('.auth-tabs .on, .seg .on, [aria-selected="true"]').first().innerText().catch(() => null)
    certo(ativa === null || /criar/i.test(ativa), `aba ativa inesperada: ${ativa}`)
  })

  await t('senha curta no cadastro é barrada com explicação', async () => {
    await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click()
    await page.fill('input[type="email"]', 'novo.usuario.e2e@exemplo.com')
    await page.fill('input[type="password"]', '123')
    certo(await page.locator('button[type="submit"]').isDisabled(), 'deixou enviar senha curta')
    const texto = await page.locator('.field-hint').first().innerText()
    certo(/falta/i.test(texto), `o aviso não diz quanto falta (veio: "${texto}")`)
  })

  await t('cadastro com e-mail já existente avisa em português', async () => {
    await page.fill('input[type="email"]', creds.email)
    await page.fill('input[type="password"]', 'senhaQualquer123')
    await page.click('button[type="submit"]')
    await page.waitForSelector('.alert-error', { timeout: 25000 })
    const texto = await page.locator('.alert-error').innerText()
    certo(/já existe uma conta/i.test(texto), `mensagem inesperada: "${texto}"`)
  })

  await t('login com senha errada avisa em português, não em inglês', async () => {
    await page.getByRole('button', { name: 'Acessar', exact: true }).click()
    await page.fill('input[type="email"]', creds.email)
    await page.fill('input[type="password"]', 'senha-de-proposito-errada')
    await page.click('button[type="submit"]')
    await page.waitForSelector('.alert-error', { timeout: 25000 })
    const texto = await page.locator('.alert-error').innerText()
    certo(/incorret/i.test(texto), `mensagem inesperada: "${texto}"`)
    certo(!/invalid|credentials/i.test(texto), `vazou texto cru da API: "${texto}"`)
  })

  await t('"esqueci a senha" sem e-mail preenchido pede o e-mail', async () => {
    await page.fill('input[type="email"]', '')
    const link = page.getByText(/esqueci|esqueceu/i).first()
    if (!(await link.count())) throw new Error('não há caminho de recuperação de senha na tela')
    await link.click()
    await page.waitForSelector('.alert-error', { timeout: 10000 })
    certo(/digite seu e-mail/i.test(await page.locator('.alert-error').innerText()), 'não pediu o e-mail')
  })

  await t('rota protegida sem sessão manda para o login', async () => {
    await page.goto(BASE + '#/conversa/00000000-0000-0000-0000-000000000000')
    await page.waitForFunction(() => location.hash.includes('/auth'), { timeout: 15000 })
  })

  await t('rota inexistente cai na raiz em vez de tela branca', async () => {
    await page.goto(BASE + '#/rota-que-nao-existe')
    await page.waitForFunction(() => location.hash === '#/' || location.hash.includes('/auth'), { timeout: 15000 })
  })

  await t('login válido entra no app', async () => {
    await entrar(page)
    certo(await page.locator('.sidebar').count() === 1, 'não chegou no app')
  })

  await t('a sessão sobrevive a um reload', async () => {
    await page.reload()
    await page.waitForSelector('.sidebar', { timeout: 30000 })
  })

  await t('o e-mail do usuário aparece no rodapé da barra lateral', async () => {
    const texto = await page.locator('.foot-user .email').innerText()
    certo(texto.includes(creds.email), `rodapé mostra "${texto}"`)
  })

  await t('a versão do build fica visível (para saber o que está rodando)', async () => {
    const v = await page.locator('.foot-version').innerText()
    certo(/v\d/.test(v), `versão ilegível: "${v}"`)
  })

  await t('sair volta para a tela de acesso', async () => {
    await page.locator('.foot-user button[title="Sair"]').click()
    await page.waitForFunction(() => location.hash.includes('/auth'), { timeout: 20000 })
  })

  await t('depois de sair, a rota do app não é mais acessível', async () => {
    await page.goto(BASE + '#/')
    await page.waitForLoadState('networkidle')
    certo(await page.locator('.sidebar').count() === 0, 'a sessão continuou viva depois do logout')
  })

  await t('nenhum erro de console inesperado na jornada de acesso', async () => {
    // Os 400 do Supabase são as respostas dos testes negativos acima (senha
    // errada, e-mail repetido) — esperados, e não defeito do app.
    const reais = page.erros.filter(e => !/status of 400/.test(e))
    certo(reais.length === 0, `erros: ${reais.join(' || ')}`)
  })

  await page.context().close()
  return t.itens
}
