// O caminho que trouxe o problema de 2026-09-28: escolher o plano Avançado na
// landing, logar e chegar pronto para pagar. O login é contra o Supabase de
// verdade (ver ajuda.mjs) — é a única forma de pegar de novo um problema como
// aquele, que não estava no código e sim entre o navegador e o Supabase
// (certificado não confiável na rede/máquina de quem testou).
import { criarRelator, certo, novaPagina, dublarBackend, BASE, creds } from './ajuda.mjs'

export default async function (browser) {
  const t = criarRelator('assinatura')
  const page = await novaPagina(browser)
  await dublarBackend(page)

  // O checkout de verdade é do Stripe — aqui só confirmamos que o app pede a
  // sessão certa, sem abrir um pagamento de verdade nem depender da rede do
  // Stripe (que tornaria esta suíte tão frágil quanto o bug que ela previne).
  let pedidoCheckout = null
  await page.route('**/billing/create-checkout-session', async route => {
    pedidoCheckout = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status: 200, json: { url: 'https://checkout.stripe.com/dito-e2e-teste' } })
  })
  await page.route('https://checkout.stripe.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>checkout de teste</html>' }))

  // A régua de preços depende da plataforma desde que o iPhone passou a vender
  // por dentro do app: lá a loja fica com uma parte de cada cobrança, e o preço
  // é outro. O navegador tem que continuar pedindo (e mostrando) o do site.
  const plataformasPedidas = []
  // Filtro por caminho exato, e não `**/planos*`: esse padrão também casa com
  // `/src/lib/planos.js`, e o dev server passava a devolver JSON no lugar do
  // módulo — o app nem carregava.
  await page.route(url => url.pathname === '/planos', async route => {
    plataformasPedidas.push(new URL(route.request().url()).searchParams.get('plataforma'))
    await route.fulfill({ status: 200, json: {} })
  })

  await t('a landing aparece deslogada', async () => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    certo(await page.locator('.lp').count() === 1, 'landing não renderizou')
  })

  await t('o navegador pede a régua de preços do site, não a da loja', async () => {
    certo(plataformasPedidas.length > 0, 'o app não pediu GET /planos')
    certo(plataformasPedidas.every(p => p === 'web'), `plataforma errada: ${plataformasPedidas.join(', ')}`)
  })

  await t('a landing mostra os preços do site', async () => {
    // O espaço que o `toLocaleString` põe entre o "R$" e o número é um espaço
    // fixo (U+00A0), não o da barra de espaço — comparar sem normalizar não
    // casa com nada.
    const precos = (await page.locator('.lp-plano-preco strong').allInnerTexts())
      .map(p => p.replace(/\u00a0/g, ' '))
    // R$ 18 e R$ 36 são o anual dividido por mês dos planos do site. Se um
    // deles virar o preço do iPhone, o repasse da comissão escapou para fora
    // do app — que é o único lugar onde ele deve valer.
    certo(precos.includes('R$ 18') && precos.includes('R$ 36'), `preços da landing: ${precos.join(', ')}`)
  })

  await t('a landing avisa que pelo iPhone a assinatura sai mais cara', async () => {
    const notas = (await page.locator('.lp-precos-nota').allInnerTexts()).join(' ')
    certo(/aplicativo do iPhone/i.test(notas) && /mais cara/i.test(notas), `notas: ${notas}`)
    certo(/taxa sobre cada cobrança/i.test(notas), 'a nota não explica por quê')
  })

  await t('"Assinar Avançado" guarda a escolha e leva ao login', async () => {
    await page.getByRole('button', { name: 'Assinar Avançado', exact: true }).click()
    await page.waitForSelector('input[type="email"]', { timeout: 15000 })
    certo(page.url().includes('#/auth'), `rota errada: ${page.url()}`)
    const guardado = await page.evaluate(() => localStorage.getItem('dito-plano-escolhido'))
    certo(guardado === 'avancado', `plano não guardado antes do login (veio: ${guardado})`)
  })

  await t('login real no Supabase entra no app (aqui travava com certificado inválido)', async () => {
    await page.getByRole('button', { name: 'Acessar', exact: true }).click()
    await page.fill('input[type="email"]', creds.email)
    await page.fill('input[type="password"]', creds.password)
    await page.click('button[type="submit"]')
    await page.waitForSelector('.sidebar', { timeout: 40000 })
  })

  await t('"Meu plano" abre direto nas opções de pagamento do Avançado', async () => {
    await page.waitForSelector('.modal-wide', { timeout: 15000 })
    const titulo = await page.locator('.modal-header h3').innerText()
    certo(/assinar o plano avançado/i.test(titulo), `modal abriu em outro lugar: "${titulo}"`)
    certo(await page.locator('.faturamento').count() === 1, 'não chegou nas opções de faturamento')
  })

  await t('no navegador não aparece nada de loja no "Meu plano"', async () => {
    // O rodapé com a frase da renovação automática, os termos e o "Restaurar
    // compras" é exigência da Apple e só faz sentido onde a compra é da loja.
    // No navegador, quem cobra é o Stripe: nada disso pode aparecer. Fica antes
    // do checkout e sem sair da tela de faturamento — a conta de teste já
    // assina, e na grade não há mais botão de assinar para voltar por ele.
    certo(await page.locator('.planos-legal').count() === 0, 'o rodapé de loja apareceu no navegador')
    certo(await page.getByRole('button', { name: /restaurar compras/i }).count() === 0,
      '"Restaurar compras" apareceu no navegador')
    const renova = await page.locator('.faturamento-renova').innerText()
    certo(/direto no seu plano/.test(renova), `o texto do faturamento virou o da loja: ${renova}`)
    certo(!/ajustes do seu aparelho|App Store|Google Play/i.test(renova), `texto de loja no faturamento: ${renova}`)
  })

  await t('"Continuar para o pagamento" pede o checkout do plano certo', async () => {
    await page.getByRole('button', { name: 'Continuar para o pagamento', exact: true }).click()
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 })
    certo(pedidoCheckout?.plano === 'avancado', `plano pedido errado: ${JSON.stringify(pedidoCheckout)}`)
    certo(pedidoCheckout?.ciclo === 'anual', `ciclo pedido errado: ${JSON.stringify(pedidoCheckout)}`)
  })

  await t('nenhum erro de console na jornada de assinatura', async () => {
    certo(page.erros.length === 0, `erros: ${page.erros.join(' || ')}`)
  })

  await page.context().close()
  return t.itens
}
