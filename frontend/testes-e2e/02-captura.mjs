// Captura: gravar, enviar arquivo, colar link — e as bordas que o usuário
// encontra de verdade (arquivo grande, arquivo vazio, áudio mudo, erro de rede).
import {
  BASE, criarRelator, certo, novaPagina, entrar, dublarBackend,
  resultadoFalso, API,
} from './ajuda.mjs'

export default async function (browser) {
  const t = criarRelator('captura')
  const page = await novaPagina(browser)
  const enviados = []
  await dublarBackend(page, { espiao: r => r.rota === '/transcribe' && enviados.push(r) })
  await entrar(page)

  await t('a home mostra as três origens de captura', async () => {
    const abas = await page.locator('.home-capture-nav a').allInnerTexts()
    certo(abas.length === 3, `abas: ${abas.join(', ')}`)
    certo(/Grava/.test(abas[0]) && /Áudio/.test(abas[1]) && /Vídeo/.test(abas[2]), `rótulos: ${abas.join(', ')}`)
  })

  await t('cada origem tem rota própria e painel próprio', async () => {
    await page.locator('.home-capture-nav a', { hasText: 'Áudio' }).click()
    await page.waitForSelector('.drop-zone', { timeout: 10000 })
    certo(page.url().includes('#/audio'), `rota: ${page.url()}`)
    await page.locator('.home-capture-nav a', { hasText: 'Vídeo' }).click()
    await page.waitForSelector('.url-form', { timeout: 10000 })
    certo(page.url().includes('#/video'), `rota: ${page.url()}`)
    await page.locator('.home-capture-nav a', { hasText: 'Gravação' }).click()
    await page.waitForSelector('.record-btn', { timeout: 10000 })
  })

  await t('gravar liga o cronômetro e o indicador de gravação', async () => {
    await page.locator('.record-btn').click()
    await page.waitForSelector('.rec-dot', { timeout: 15000 })
    await page.waitForFunction(
      () => /0[01]:0[2-9]|0[01]:[1-5]\d/.test(document.querySelector('.record-label')?.innerText || ''),
      { timeout: 12000 },
    )
  })

  await t('pausar congela o relógio e retomar volta a contar', async () => {
    await page.getByRole('button', { name: /Pausar/ }).click()
    await page.waitForSelector('text=Pausado', { timeout: 5000 })
    const antes = await page.locator('.record-label').innerText()
    await page.waitForTimeout(2000)
    const depois = await page.locator('.record-label').innerText()
    certo(antes === depois, `o relógio andou durante a pausa: "${antes}" → "${depois}"`)
    await page.getByRole('button', { name: /Retomar/ }).click()
    await page.waitForFunction(
      t0 => (document.querySelector('.record-label')?.innerText || '') !== t0,
      antes, { timeout: 12000 },
    )
  })

  // Regressão do defeito relatado: numa gravação longa, parar deixava a tela
  // idêntica à de repouso por segundos — parecia que nada tinha sido gravado.
  await t('parar nunca mostra a tela de repouso antes da revisão', async () => {
    await page.locator('.record-btn').click()
    const proibido = []
    for (let i = 0; i < 40; i++) {
      const estado = await page.evaluate(() => ({
        rotulo: document.querySelector('.record-label')?.innerText || '',
        revisao: !!document.querySelector('.record-actions'),
      }))
      if (estado.revisao) break
      if (/para gravar/i.test(estado.rotulo)) proibido.push(estado.rotulo)
      await page.waitForTimeout(50)
    }
    certo(proibido.length === 0, `voltou ao repouso enquanto finalizava: ${proibido[0]}`)
  })

  await t('a revisão oferece transcrever e regravar', async () => {
    await page.waitForSelector('.record-actions', { timeout: 20000 })
    certo(await page.getByRole('button', { name: 'Transcrever' }).count() === 1, 'sem botão Transcrever')
    certo(await page.getByRole('button', { name: 'Regravar' }).count() === 1, 'sem botão Regravar')
  })

  await t('regravar volta ao estado inicial com o relógio zerado', async () => {
    await page.getByRole('button', { name: 'Regravar' }).click()
    await page.waitForSelector('.record-btn', { timeout: 10000 })
    const rotulo = await page.locator('.record-label').innerText()
    certo(/para gravar/i.test(rotulo), `rótulo após regravar: "${rotulo}"`)
  })

  // Verificação direta da correção do arquivo gigante: o que sobe tem de ser
  // áudio comprimido de fala, não PCM cru.
  await t('a gravação sobe comprimida (≈32 kbps), não em taxa cheia', async () => {
    enviados.length = 0
    await page.locator('.record-btn').click()
    await page.waitForTimeout(10000)
    await page.locator('.record-btn').click()
    await page.waitForSelector('.record-actions', { timeout: 25000 })
    await page.getByRole('button', { name: 'Transcrever' }).click()
    await page.waitForURL(/#\/conversa\//, { timeout: 40000 })

    certo(enviados.length >= 1, 'nenhum upload foi feito')
    const bytes = enviados[0].corpo?.length || 0
    const kbps = (bytes * 8) / 10 / 1000
    certo(bytes > 0, 'upload vazio')
    // 10s a 32 kbps ≈ 40 KB. O padrão antigo (128 kbps estéreo) daria ≈160 KB.
    certo(kbps < 70, `gravação a ~${kbps.toFixed(0)} kbps — a compressão não está sendo aplicada`)
  })

  await t('o arquivo enviado tem nome e extensão coerentes com o formato', async () => {
    const corpo = enviados[0].corpo.toString('latin1').slice(0, 400)
    certo(/filename="gravacao\.(webm|ogg|m4a)"/.test(corpo), `nome inesperado no upload: ${corpo.slice(0, 200)}`)
  })

  await t('terminada a transcrição, a conversa abre sozinha', async () => {
    await page.waitForSelector('.conversa-head h1', { timeout: 20000 })
    const titulo = await page.locator('.conversa-head h1').innerText()
    certo(titulo.includes('[E2E]'), `título salvo: "${titulo}"`)
  })

  await t('a conversa nova aparece na barra lateral', async () => {
    await page.waitForFunction(
      () => [...document.querySelectorAll('.sidebar-item-text')].some(e => e.innerText.includes('[E2E]')),
      { timeout: 15000 },
    )
  })

  // ── Bordas do envio de arquivo ────────────────────────────
  await t('arquivo vazio é recusado com explicação, não com "failed to fetch"', async () => {
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'vazio.m4a', mimeType: 'audio/m4a', buffer: Buffer.alloc(0) })
    await page.waitForSelector('.alert-error', { timeout: 15000 })
    const texto = await page.locator('.alert-error').innerText()
    certo(/vazio/i.test(texto), `mensagem: "${texto}"`)
    certo(!/failed to fetch/i.test(texto), 'vazou erro técnico de rede')
  })

  await t('arquivo acima do teto é barrado ANTES de subir 1 GB pela rede', async () => {
    enviados.length = 0
    // Recarregar limpa o erro do teste anterior: sem isto a asserção leria a
    // mensagem antiga ainda na tela e passaria (ou falharia) pelo motivo errado.
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    // O tamanho é FALSIFICADO em cima de um arquivo pequeno: montar 1 GB de
    // verdade no navegador consumia a memória da máquina de teste (e chegou a
    // derrubar o dev server). `size` é um getter do protótipo do Blob, então
    // uma propriedade própria o sombreia — e é `size` que a guarda consulta.
    await page.evaluate(() => {
      const entrada = document.querySelector('input[type="file"]')
      const arquivo = new File([new Uint8Array(4096)], 'enorme.wav', { type: 'audio/wav' })
      Object.defineProperty(arquivo, 'size', { value: 1_100_000_000 })
      const dt = new DataTransfer()
      dt.items.add(arquivo)
      entrada.files = dt.files
      entrada.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForFunction(
      () => /limite|GB/.test(document.querySelector('.alert-error')?.innerText || ''),
      { timeout: 30000 },
    )
    const texto = await page.locator('.alert-error').innerText()
    certo(/1 GB|limite/i.test(texto), `mensagem: "${texto}"`)
    certo(enviados.length === 0, 'o arquivo gigante foi empurrado pela rede mesmo assim')
  })

  await t('transcrição vazia não cria conversa e explica o que fazer', async () => {
    await page.unroute(`${API}/**`)
    await dublarBackend(page, {
      transcribe: route => route.fulfill({ status: 200, json: { ...resultadoFalso(), transcript: '' } }),
    })
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'mudo.m4a', mimeType: 'audio/m4a', buffer: Buffer.alloc(2048, 1) })
    await page.waitForFunction(
      () => /extrair|áudio suficiente/i.test(document.querySelector('.alert-error')?.innerText || ''),
      { timeout: 30000 },
    )
  })

  await t('erro do servidor vira mensagem legível, não código', async () => {
    await page.unroute(`${API}/**`)
    await dublarBackend(page, {
      transcribe: route => route.fulfill({ status: 413, json: { detail: 'Arquivo muito grande. O limite é 1 GB — cerca de 8 horas de gravação.' } }),
    })
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'x.m4a', mimeType: 'audio/m4a', buffer: Buffer.alloc(2048, 1) })
    await page.waitForSelector('.alert-error', { timeout: 25000 })
    certo(/8 horas/.test(await page.locator('.alert-error').innerText()), 'a mensagem do backend não chegou à tela')
  })

  await t('link vazio não dispara requisição', async () => {
    await page.unroute(`${API}/**`)
    const chamadas = []
    await dublarBackend(page, { espiao: r => r.rota === '/process-url' && chamadas.push(r) })
    await page.goto(BASE + '#/video')
    await page.waitForSelector('.url-form', { timeout: 15000 })
    certo(await page.locator('.url-form button[type="submit"]').isDisabled(), 'o botão aceita link vazio')
    // Enter no campo vazio também não pode disparar nada.
    await page.locator('.url-form input').press('Enter')
    await page.waitForTimeout(1200)
    certo(chamadas.length === 0, 'enviou um link vazio ao backend')
  })

  await t('link válido gera conversa', async () => {
    await page.locator('.url-form input').fill('https://pt.wikipedia.org/wiki/Filosofia')
    await page.locator('.url-form button').first().click()
    await page.waitForURL(/#\/conversa\//, { timeout: 40000 })
  })

  await t('durante o processamento a tela avisa para não sair', async () => {
    await page.unroute(`${API}/**`)
    await dublarBackend(page, {
      transcribe: async route => {
        await new Promise(r => setTimeout(r, 4000))
        // A rota pode ter sido descartada enquanto esperávamos (o teste
        // seguinte troca o dublê); responder a ela então é um erro fatal.
        await route.fulfill({ status: 200, json: resultadoFalso() }).catch(() => {})
      },
    })
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'y.m4a', mimeType: 'audio/m4a', buffer: Buffer.alloc(2048, 1) })
    await page.waitForSelector('.processing-box', { timeout: 15000 })
    const texto = await page.locator('.processing-box').innerText()
    certo(/não feche/i.test(texto), `caixa de processamento: "${texto}"`)
    // Deixar o envio terminar antes de trocar o dublê no teste seguinte.
    await page.waitForSelector('.processing-box', { state: 'detached', timeout: 30000 })
  })

  // ── Pontas soltas do ciclo de vida da gravação ────────────
  await t('sair da tela com a gravação em curso avisa antes de perdê-la', async () => {
    // O teste anterior deixou um envio lento em voo; sem restaurar o dublê
    // rápido a home abre na caixa de processamento e não no botão de gravar.
    await page.unroute(`${API}/**`)
    await dublarBackend(page)
    await page.goto(BASE + '#/')
    await page.waitForSelector('.record-btn', { timeout: 20000 })
    await page.locator('.record-btn').click()
    await page.waitForSelector('.rec-dot', { timeout: 15000 })
    await page.waitForTimeout(2500)
    // Clicar numa conversa da barra lateral desmonta o painel de captura.
    await page.locator('.sidebar-item').first().click()
    await page.waitForTimeout(1500)
    const gravando = await page.locator('.rec-dot').count()
    const avisou = await page.locator('.modal, .alert-error, .toast').count()
    certo(gravando > 0 || avisou > 0,
      'a gravação em curso foi descartada em silêncio ao navegar para outra tela')
  })

  await t('fechar a janela com a gravação em curso pede confirmação', async () => {
    await page.goto(BASE + '#/')
    await page.waitForSelector('.record-btn', { timeout: 20000 })
    await page.locator('.record-btn').click()
    await page.waitForSelector('.rec-dot', { timeout: 15000 })
    await page.waitForTimeout(2000)
    // O navegador só oferece o "tem certeza que quer sair?" se a página tiver
    // registrado um beforeunload. Sem ele, um Ctrl+W leva a reunião junto.
    const temGuarda = await page.evaluate(() => {
      let registrado = false
      const evento = new Event('beforeunload', { cancelable: true })
      Object.defineProperty(evento, 'returnValue', {
        set() { registrado = true }, get() { return '' }, configurable: true,
      })
      window.dispatchEvent(evento)
      return registrado || evento.defaultPrevented
    })
    await page.locator('.record-btn').click().catch(() => {})
    certo(temGuarda, 'nada impede a janela de fechar com a gravação em andamento')
  })

  await t('nenhum erro de console inesperado durante a captura', async () => {
    // 413 e RANGE_NOT_SATISFIABLE são consequência dos testes negativos acima
    // (erro do servidor dublado e arquivo de 1 GB), não defeito do app.
    const reais = page.erros.filter(e => !/status of 413|RANGE_NOT_SATISFIABLE/.test(e))
    certo(reais.length === 0, `erros: ${reais.join(' || ')}`)
  })

  await page.waitForURL(/#\/conversa\//, { timeout: 40000 }).catch(() => {})
  await page.context().close()
  return t.itens
}
