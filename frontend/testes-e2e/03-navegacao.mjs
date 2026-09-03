// Barra lateral, busca, histórico e os modais do rodapé.
import { BASE, criarRelator, certo, novaPagina, entrar, dublarBackend } from './ajuda.mjs'

export default async function (browser) {
  const t = criarRelator('navegação')
  const page = await novaPagina(browser)
  await dublarBackend(page)
  await entrar(page)

  await t('a lista de conversas carrega sem erro', async () => {
    await page.waitForFunction(
      () => !document.querySelector('.sidebar-list')?.innerText.includes('Carregando'),
      { timeout: 25000 },
    )
    const texto = await page.locator('.sidebar-list').innerText()
    certo(!/não foi possível/i.test(texto), `a lista falhou: "${texto}"`)
  })

  await t('as conversas vêm agrupadas por época', async () => {
    const n = await page.locator('.sidebar-item').count()
    if (n === 0) throw new Error('conta de teste sem conversas — rode a suíte de captura antes')
    const grupos = await page.locator('.sidebar-group-label').allInnerTexts()
    certo(grupos.length > 0, 'nenhum rótulo de época')
    // O CSS deixa os rótulos em caixa alta, então a comparação ignora caixa.
    certo(grupos.every(g => /hoje|ontem|últimos 7|últimos 30|mais antigas/i.test(g)), `rótulos: ${grupos.join(', ')}`)
  })

  await t('cada conversa mostra o ícone da origem', async () => {
    certo(await page.locator('.sidebar-item .kind-icon').count() > 0, 'nenhum ícone de origem')
  })

  await t('clicar numa conversa abre a rota dela e marca como ativa', async () => {
    await page.locator('.sidebar-item').first().click()
    await page.waitForURL(/#\/conversa\//, { timeout: 25000 })
    await page.waitForSelector('.sidebar-item.active', { timeout: 10000 })
  })

  await t('"+ Novo" volta para a captura', async () => {
    await page.locator('.sidebar-novo').click()
    await page.waitForSelector('.home', { timeout: 15000 })
  })

  await t('recolher a barra lateral esconde a lista e deixa como reabrir', async () => {
    await page.locator('.sidebar-toggle').click()
    await page.waitForSelector('.desktop-reopen', { timeout: 8000 })
    certo(await page.evaluate(() => document.querySelector('.app-shell').classList.contains('collapsed')), 'não recolheu')
  })

  await t('o estado recolhido sobrevive ao reload', async () => {
    await page.reload()
    await page.waitForSelector('.app-shell', { timeout: 25000 })
    certo(await page.evaluate(() => document.querySelector('.app-shell').classList.contains('collapsed')), 'voltou expandida')
    await page.locator('.desktop-reopen').click()
    await page.waitForSelector('.sidebar-list', { timeout: 8000 })
  })

  await t('o botão voltar começa desabilitado e liga depois de navegar', async () => {
    const voltar = page.locator('.tool-btn[aria-label="Voltar"]')
    await page.locator('.sidebar-item').first().click()
    await page.waitForURL(/#\/conversa\//, { timeout: 20000 })
    certo(!(await voltar.isDisabled()), 'o voltar continuou desabilitado depois de navegar')
    await voltar.click()
    await page.waitForTimeout(800)
  })

  await t('a busca abre com o campo já focado', async () => {
    await page.locator('.tool-btn[aria-label="Buscar conversas"]').click()
    await page.waitForSelector('.sidebar-search input', { timeout: 8000 })
    certo(await page.evaluate(() => document.activeElement?.type === 'search'), 'o campo de busca não recebeu foco')
  })

  await t('a busca acha por palavra do título', async () => {
    await page.fill('.sidebar-search input', 'E2E')
    await page.waitForFunction(
      () => /nos títulos|nas transcrições|nada encontrado/i.test(document.querySelector('.sidebar-list')?.innerText || ''),
      { timeout: 30000 },
    )
    const texto = await page.locator('.sidebar-list').innerText()
    certo(/nos títulos/i.test(texto), `o título com "E2E" não foi achado: "${texto.slice(0, 200)}"`)
  })

  await t('a busca acha por palavra dita só na transcrição', async () => {
    await page.fill('.sidebar-search input', 'orçamento')
    await page.waitForFunction(
      () => /nas transcrições|nada encontrado/i.test(document.querySelector('.sidebar-list')?.innerText || ''),
      { timeout: 30000 },
    )
    const texto = await page.locator('.sidebar-list').innerText()
    certo(/nas transcrições/i.test(texto), 'não achou uma palavra que só existe na transcrição')
  })

  await t('busca sem resultado diz "nada encontrado" em vez de lista vazia', async () => {
    await page.fill('.sidebar-search input', 'zzqxwvnaoexiste')
    await page.waitForFunction(
      () => /nada encontrado/i.test(document.querySelector('.sidebar-list')?.innerText || ''),
      { timeout: 25000 },
    )
  })

  await t('Esc fecha a busca e devolve a lista', async () => {
    await page.locator('.sidebar-search input').press('Escape')
    await page.waitForSelector('.sidebar-search', { state: 'detached', timeout: 8000 })
    await page.waitForFunction(() => document.querySelectorAll('.sidebar-item').length > 0, { timeout: 15000 })
  })

  // ── Modais do rodapé ──────────────────────────────────────
  await t('o tema escuro se aplica de verdade', async () => {
    await page.getByRole('button', { name: /Tema/ }).click()
    await page.waitForSelector('.modal', { timeout: 8000 })
    await page.locator('.modal .seg button', { hasText: 'Escuro' }).click()
    await page.waitForTimeout(400)
    const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const luminancia = (fundo.match(/\d+/g) || [255, 255, 255]).slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3
    certo(luminancia < 120, `o fundo continuou claro no tema escuro: ${fundo}`)
  })

  await t('o tema escolhido sobrevive ao reload', async () => {
    await page.locator('.modal .btn-primary').click()
    await page.reload()
    await page.waitForSelector('.sidebar', { timeout: 25000 })
    const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const luminancia = (fundo.match(/\d+/g) || [255, 255, 255]).slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3
    certo(luminancia < 120, `o tema não persistiu: ${fundo}`)
  })

  await t('voltar para o tema claro funciona', async () => {
    await page.getByRole('button', { name: /Tema/ }).click()
    await page.locator('.modal .seg button', { hasText: 'Claro' }).click()
    await page.locator('.modal .btn-primary').click()
    await page.waitForTimeout(400)
    const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const luminancia = (fundo.match(/\d+/g) || [0, 0, 0]).slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3
    certo(luminancia > 150, `não voltou ao claro: ${fundo}`)
  })

  await t('o modal de feedback não envia mensagem vazia', async () => {
    await page.getByRole('button', { name: /Enviar feedback/ }).click()
    await page.waitForSelector('.feedback-textarea', { timeout: 8000 })
    // "Enviar feedback" (rodapé) e "Enviar" (submit) casam pelo mesmo nome —
    // o alvo tem de ser o botão dentro do modal.
    certo(await page.locator('.modal button[type="submit"]').isDisabled(), 'deixou enviar feedback vazio')
  })

  await t('clicar fora fecha o modal; clicar dentro não', async () => {
    await page.locator('.feedback-textarea').click()
    await page.waitForTimeout(200)
    certo(await page.locator('.modal').count() === 1, 'o clique dentro fechou o modal')
    await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } })
    await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
  })

  await t('"Meu plano" abre e fecha', async () => {
    await page.getByRole('button', { name: /Meu plano/ }).click()
    await page.waitForSelector('.modal', { timeout: 8000 })
    certo(/plano/i.test(await page.locator('.modal').innerText()), 'conteúdo inesperado')
    await page.getByRole('button', { name: 'Entendi' }).click()
    await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
  })

  await t('nenhum erro de console na navegação', async () => {
    certo(page.erros.length === 0, `erros: ${page.erros.join(' || ')}`)
  })

  await page.context().close()
  return t.itens
}
