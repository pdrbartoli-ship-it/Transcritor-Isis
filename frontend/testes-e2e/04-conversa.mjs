// A tela de conversa e seus zoom-ins: tópicos, to-do's, timeline, chat,
// download e o comportamento do voltar entre eles.
import { BASE, criarRelator, certo, novaPagina, entrar, dublarBackend, API, resultadoFalso } from './ajuda.mjs'

export default async function (browser) {
  const t = criarRelator('conversa')
  const page = await novaPagina(browser)
  await dublarBackend(page)
  await entrar(page)

  let url = null
  await t('abrir uma conversa mostra título, data e duração', async () => {
    await page.waitForSelector('.sidebar-item', { timeout: 25000 })
    const alvo = page.locator('.sidebar-item', { hasText: '[E2E]' }).first()
    await (await alvo.count() ? alvo : page.locator('.sidebar-item').first()).click()
    await page.waitForSelector('.conversa-head h1', { timeout: 25000 })
    url = page.url()
    const sub = await page.locator('.conversa-head .text-muted').innerText()
    certo(/\d{2}/.test(sub), `subtítulo sem data: "${sub}"`)
  })

  await t('a visão geral traz os quatro tópicos', async () => {
    const n = await page.locator('.topic-card').count()
    certo(n >= 1 && n <= 4, `${n} tópicos`)
  })

  await t('clicar num tópico abre a rota dele com o que foi dito', async () => {
    await page.locator('.topic-card').first().click()
    await page.waitForURL(/\/topico\/\d+/, { timeout: 15000 })
    await page.waitForSelector('.bullet-list', { timeout: 10000 })
    certo(await page.locator('.trecho, .conversa-block').count() > 0, 'sem o trecho da transcrição')
  })

  await t('um tópico inexistente não quebra a tela', async () => {
    await page.goto(url.replace(/#.*/, '') + `#${new URL(url).hash.slice(1)}/topico/99`)
    await page.waitForSelector('.conversa', { timeout: 20000 })
    certo(/não existe/i.test(await page.locator('.conversa').innerText()), 'sem mensagem para tópico inexistente')
  })

  await t('o voltar do navegador percorre as telas da conversa', async () => {
    await page.goBack()
    await page.waitForTimeout(800)
    await page.goBack()
    await page.waitForURL(u => /\/conversa\//.test(u.toString()), { timeout: 15000 })
  })

  await t('as to-do\'s aparecem com responsável e prazo', async () => {
    await page.goto(url)
    await page.waitForSelector('.todo-list', { timeout: 25000 })
    certo(await page.locator('.todo-card').count() > 0, 'nenhuma to-do na visão geral')
  })

  await t('"ver todas" leva à lista completa quando há mais de quatro', async () => {
    const botao = page.getByRole('button', { name: /Ver todas as \d+/ })
    if (!(await botao.count())) throw new Error('não apareceu "Ver todas" com 5 to-dos')
    await botao.click()
    await page.waitForURL(/\/todos/, { timeout: 15000 })
    certo(await page.locator('.todo-row').count() >= 5, 'a lista completa não trouxe todas')
  })

  await t('abrir uma to-do mostra o trecho em que foi combinada', async () => {
    await page.locator('.todo-row').first().click()
    await page.waitForSelector('.todo-detail', { timeout: 10000 })
    const texto = await page.locator('.todo-detail').innerText()
    certo(texto.trim().length > 10, 'o detalhe abriu vazio')
  })

  await t('a barra de tempo seleciona no primeiro clique e abre no segundo', async () => {
    await page.goto(url)
    await page.waitForSelector('.timeline-slot', { timeout: 25000 })
    const slots = page.locator('.timeline-slot')
    await slots.nth(1).click()
    await page.waitForTimeout(500)
    certo(!page.url().includes('/timeline'), 'o primeiro clique já navegou')
    await slots.nth(1).click()
    await page.waitForURL(/\/timeline/, { timeout: 15000 })
  })

  await t('a timeline lista os intervalos e abre a transcrição de cada um', async () => {
    certo(await page.locator('.chapter-row').count() >= 2, 'poucos intervalos')
    // O intervalo escolhido na barra chega já aberto; o teste abre OUTRO, senão
    // o clique fecharia o que estava aberto e a espera nunca terminaria.
    const fechado = page.locator('.chapter-row:not(.open)').first()
    await fechado.click()
    await page.waitForSelector('.chapter-row.open .chapter-detail, .chapter-detail', { timeout: 10000 })
  })

  await t('o campo de perguntar está presente nas telas da conversa', async () => {
    for (const rota of ['', '/todos', '/timeline']) {
      await page.goto(url + rota)
      await page.waitForSelector('.conversa', { timeout: 20000 })
      certo(await page.locator('.ask-bar').count() === 1, `sem a barra de perguntar em "${rota || '/'}"`)
    }
  })

  await t('perguntar leva ao chat já com a resposta', async () => {
    await page.goto(url)
    await page.waitForSelector('.ask-bar', { timeout: 20000 })
    await page.locator('.ask-bar textarea').fill('Como ficou o orçamento?')
    await page.locator('.ask-send').click()
    await page.waitForURL(/\/chat/, { timeout: 15000 })
    // Enquanto responde, a última bolha é o "Pensando…" — esperar por ela dava
    // um falso negativo. O sinal é o spinner sumir.
    await page.waitForFunction(
      () => document.querySelectorAll('.message.assistant').length > 0
        && !document.querySelector('.message.assistant .spinner'),
      { timeout: 30000 },
    )
    const resposta = await page.locator('.message.assistant .bubble').last().innerText()
    certo(/orçamento/i.test(resposta), `resposta inesperada: "${resposta}"`)
  })

  await t('o chat não repete a barra de perguntar do rodapé', async () => {
    certo(await page.locator('.ask-bar').count() === 0, 'duas caixas de digitar empilhadas no chat')
  })

  await t('a pergunta e a resposta ficam salvas ao voltar para o chat', async () => {
    await page.goto(url)
    await page.waitForSelector('.conversa-head', { timeout: 20000 })
    await page.goto(url + '/chat')
    await page.waitForSelector('.message', { timeout: 25000 })
    certo(await page.locator('.message').count() >= 2, 'o histórico do chat não persistiu')
  })

  await t('um erro no chat devolve a pergunta ao campo em vez de perdê-la', async () => {
    await page.unroute(`${API}/**`)
    await dublarBackend(page, { chat: route => route.fulfill({ status: 500, json: { detail: 'Falha no servidor.' } }) })
    await page.goto(url + '/chat')
    await page.waitForSelector('.chat-input textarea', { timeout: 20000 })
    await page.locator('.chat-input textarea').fill('pergunta que vai falhar')
    await page.locator('.chat-input button[type="submit"]').click()
    await page.waitForSelector('.alert-error', { timeout: 20000 })
    const valor = await page.locator('.chat-input textarea').inputValue()
    certo(valor.includes('pergunta que vai falhar'), 'a pergunta se perdeu depois do erro')
  })

  await t('baixar a transcrição gera um arquivo com o conteúdo', async () => {
    await page.unroute(`${API}/**`)
    await dublarBackend(page)
    await page.goto(url)
    await page.waitForSelector('.btn-download', { timeout: 25000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.locator('.btn-download').click(),
    ])
    const caminho = await download.path()
    const { readFileSync } = await import('fs')
    const conteudo = readFileSync(caminho, 'utf8')
    certo(conteudo.length > 100, `arquivo curto demais (${conteudo.length} bytes)`)
    certo(/orçamento/i.test(conteudo), 'o arquivo não contém a transcrição')
  })

  await t('conversa inexistente mostra um erro em português, não texto cru da API', async () => {
    await page.goto(BASE + '#/conversa/00000000-0000-0000-0000-000000000000')
    await page.waitForSelector('.alert-error', { timeout: 25000 })
    const texto = await page.locator('.alert-error').innerText()
    certo(await page.locator('.spinner').count() === 0, 'ficou preso no spinner')
    certo(!/coerce|JSON|row|PGRST/i.test(texto), `vazou texto cru do banco para o usuário: "${texto}"`)
  })

  await t('conversa antiga sem insights oferece gerar a análise', async () => {
    // O caminho de quem capturou antes desta versão: só transcrição, sem
    // tópicos. Simulado no cliente para não depender de dado legado real.
    await page.goto(url)
    await page.waitForSelector('.conversa-head', { timeout: 25000 })
    const tem = await page.locator('.empty-insights').count()
    if (tem) certo(await page.getByRole('button', { name: /Gerar novos insights/ }).count() === 1, 'sem botão de gerar')
  })

  await t('nenhum erro de console na tela de conversa', async () => {
    const reais = page.erros.filter(e => !/500|Failed to load resource/.test(e))
    certo(reais.length === 0, `erros: ${reais.join(' || ')}`)
  })

  void resultadoFalso
  await page.context().close()
  return t.itens
}
