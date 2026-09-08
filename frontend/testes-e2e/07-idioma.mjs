// Idioma de saída: a escolha nas Configurações tem de chegar a TODA captura.
//
// O que se verifica aqui é o caminho da preferência (tela → localStorage →
// corpo da requisição), não o texto que a IA devolve: o backend é dublado, e
// se ele traduz ou não é problema dos testes dele.
import {
  BASE, criarRelator, certo, novaPagina, entrar, dublarBackend, API,
} from './ajuda.mjs'

// O `language` viaja em multipart; ler o campo do corpo cru é mais simples do
// que reconstruir o FormData.
function campo(corpo, nome) {
  if (!corpo) return null
  const texto = corpo.toString('utf8')
  const m = texto.match(new RegExp(`name="${nome}"\\r?\\n\\r?\\n([^\\r\\n]*)`))
  return m ? m[1] : null
}

async function abrirConfiguracoes(page) {
  await page.goto(BASE)
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.locator('.nav-item', { hasText: 'Configurações' }).click()
  await page.waitForSelector('.modal', { timeout: 10000 })
}

async function escolherIdioma(page, rotulo) {
  await abrirConfiguracoes(page)
  await page.locator('.settings-group', { hasText: 'Idioma' }).getByRole('button', { name: rotulo, exact: true }).click()
  await page.getByRole('button', { name: 'Concluído' }).click()
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 })
}

export default async function (browser) {
  const t = criarRelator('idioma')
  const page = await novaPagina(browser)
  const enviados = []
  await dublarBackend(page, { espiao: r => enviados.push(r) })
  await entrar(page)

  await t('a engrenagem da barra lateral se chama Configurações', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.sidebar', { timeout: 20000 })
    const rotulos = await page.locator('.sidebar-foot .nav-item').allInnerTexts()
    certo(rotulos.some(r => /Configurações/.test(r)), `itens do rodapé: ${rotulos.join(' | ')}`)
    certo(!rotulos.some(r => r.trim() === 'Tema'), 'o item ainda se chama Tema')
  })

  await t('Configurações reúne Tema e Idioma', async () => {
    await abrirConfiguracoes(page)
    certo(/Configurações/.test(await page.locator('.modal-header h3').innerText()), 'o título do modal mudou de nome')
    const grupos = await page.locator('.settings-group > label').allInnerTexts()
    certo(grupos.includes('Tema') && grupos.includes('Idioma'), `grupos: ${grupos.join(' | ')}`)
    // O tema continua funcionando: o bloco não podia ser mexido.
    await page.getByRole('button', { name: /Escuro/ }).click()
    certo(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'o tema escuro não aplicou')
    await page.getByRole('button', { name: /Claro/ }).click()
    await page.getByRole('button', { name: 'Concluído' }).click()
  })

  await t('a explicação diz que é o idioma de saída, não o da gravação', async () => {
    await abrirConfiguracoes(page)
    const dica = await page.locator('.settings-group', { hasText: 'Idioma' }).locator('.hint').innerText()
    certo(/escreve/i.test(dica), `a dica não fala do que o Dito escreve: "${dica}"`)
    certo(/vídeo|áudio/i.test(dica), `a dica não separa o idioma da mídia: "${dica}"`)
    certo(!dica.includes('—'), `a dica usa travessão: "${dica}"`)
    await page.getByRole('button', { name: 'Concluído' }).click()
  })

  await t('sem escolher nada, a captura vai como "auto"', async () => {
    enviados.length = 0
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'a.m4a', mimeType: 'audio/m4a', buffer: Buffer.alloc(2048, 1) })
    // Escolher o arquivo só o encosta na tela; quem envia é o botão do modo.
    await page.locator('.split-main').click()
    await page.waitForFunction(() => location.hash.includes('/conversa/'), { timeout: 40000 })
    const envio = enviados.find(r => r.rota === '/transcribe')
    certo(campo(envio?.corpo, 'language') === 'auto', `language enviado: ${campo(envio?.corpo, 'language')}`)
  })

  await t('escolher English manda language=en no arquivo', async () => {
    await escolherIdioma(page, 'English')
    enviados.length = 0
    await page.goto(BASE + '#/audio')
    await page.waitForSelector('.drop-zone', { timeout: 15000 })
    await page.locator('input[type="file"]').setInputFiles({ name: 'b.m4a', mimeType: 'audio/m4a', buffer: Buffer.alloc(2048, 1) })
    await page.locator('.split-main').click()
    await page.waitForFunction(() => location.hash.includes('/conversa/'), { timeout: 40000 })
    const envio = enviados.find(r => r.rota === '/transcribe')
    certo(campo(envio?.corpo, 'language') === 'en', `language enviado: ${campo(envio?.corpo, 'language')}`)
  })

  await t('o link também leva o idioma escolhido', async () => {
    enviados.length = 0
    await page.goto(BASE + '#/video')
    await page.waitForSelector('.url-form', { timeout: 15000 })
    await page.locator('.url-form input').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await page.locator('.url-form .split-main').click()
    await page.waitForFunction(() => location.hash.includes('/conversa/'), { timeout: 40000 })
    const envio = enviados.find(r => r.rota === '/process-url')
    certo(campo(envio?.corpo, 'language') === 'en', `language enviado: ${campo(envio?.corpo, 'language')}`)
  })

  await t('a escolha sobrevive a recarregar o app', async () => {
    await page.reload()
    await page.waitForSelector('.sidebar', { timeout: 20000 })
    await abrirConfiguracoes(page)
    const ativo = await page.locator('.settings-group', { hasText: 'Idioma' }).locator('.seg button.on').innerText()
    certo(ativo.trim() === 'English', `ficou marcado: ${ativo}`)
    await page.getByRole('button', { name: 'Concluído' }).click()
  })

  // Volta ao padrão para não contaminar as outras suítes nem a conta de teste.
  await escolherIdioma(page, 'Do áudio')

  certo(page.erros.length === 0, `erros no console: ${page.erros.join(' | ')}`)
  await page.context().close()
  return t.itens
}
