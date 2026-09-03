// A mesma jornada numa tela de celular. O defeito clássico aqui é o transbordo
// horizontal — invisível no desktop e insuportável no telefone.
import { criarRelator, certo, novaPagina, entrar, dublarBackend } from './ajuda.mjs'

const TELA = { width: 380, height: 780 }

export default async function (browser) {
  const t = criarRelator('celular')
  const page = await novaPagina(browser, { viewport: TELA })
  await dublarBackend(page)

  await t('a landing cabe na largura do celular', async () => {
    await page.goto('http://localhost:5173/')
    await page.waitForSelector('.lp', { timeout: 25000 })
    const transborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    certo(!transborda, 'a landing rola para o lado no celular')
  })

  await t('entrar funciona na tela pequena', async () => {
    await entrar(page)
  })

  await t('o menu lateral abre e fecha pelo hambúrguer', async () => {
    await page.locator('.hamburger').click()
    await page.waitForSelector('.sidebar.open', { timeout: 8000 })
    // A gaveta (268px, z-index 60) cobre a esquerda do overlay — o único ponto
    // clicável dele é a faixa à direita dela. É também a única forma de fechar
    // a gaveta no celular: não há botão de fechar nem gesto de arrastar.
    await page.locator('.sidebar-overlay').click({ position: { x: 340, y: 400 } })
    await page.waitForSelector('.sidebar.open', { state: 'detached', timeout: 8000 })
  })

  await t('a home não rola para o lado', async () => {
    const transborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    certo(!transborda, 'a home transborda no celular')
  })

  await t('a captura no celular usa o botão de toque, não a área de arrastar', async () => {
    await page.goto('http://localhost:5173/#/audio')
    await page.waitForSelector('.capture-mode', { timeout: 20000 })
    certo(await page.locator('.drop-zone').count() === 0, 'a área de arrastar apareceu no celular')
    certo(await page.locator('.pick-file').count() === 1, 'sem o botão de escolher arquivo')
  })

  await t('o botão de gravar é grande o bastante para o dedo', async () => {
    await page.goto('http://localhost:5173/#/')
    await page.waitForSelector('.record-btn', { timeout: 20000 })
    const box = await page.locator('.record-btn').boundingBox()
    certo(box.width >= 44 && box.height >= 44, `alvo de ${Math.round(box.width)}×${Math.round(box.height)}px`)
  })

  await t('a tela de conversa não rola para o lado', async () => {
    await page.locator('.hamburger').click()
    await page.waitForSelector('.sidebar.open', { timeout: 8000 })
    await page.locator('.sidebar-item').first().click()
    await page.waitForSelector('.conversa-head', { timeout: 25000 })
    const transborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    certo(!transborda, 'a conversa transborda no celular')
  })

  await t('a barra de perguntar não cobre o conteúdo', async () => {
    const ask = await page.locator('.ask-bar').boundingBox()
    certo(ask && ask.y + ask.height <= TELA.height + 2, `a barra sai da tela (y=${ask?.y})`)
  })

  await t('nenhum erro de console no celular', async () => {
    certo(page.erros.length === 0, `erros: ${page.erros.join(' || ')}`)
  })

  await page.context().close()
  return t.itens
}
