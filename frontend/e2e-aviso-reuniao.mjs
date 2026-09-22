// A janelinha de aviso de reunião, variante por variante, nos dois temas.
//
// No app ela é uma janela do Windows, que não existe aqui. A rota `#/aviso`
// aceita os parâmetros da variante justamente para ela poder ser aberta como
// página normal: é o que permite conferir texto, tamanho e contraste sem
// Windows, e é a única parte da detecção que dá para ver de fora dele.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const b = await chromium.launch()

const variantes = [
  ['convite', 'variante=convite&app=zoom', 132],
  ['convite-saldo-curto', 'variante=convite-saldo-curto&app=teams&restante=42', 132],
  ['sem-saldo-zero', 'variante=sem-saldo&app=meet&restante=0', 132],
  ['sem-saldo-pouco', 'variante=sem-saldo&app=zoom&restante=3', 132],
  ['aviso-5min', 'variante=aviso-5min', 88],
  ['aviso-1min', 'variante=aviso-1min', 88],
  ['parou-saldo', 'variante=parou-saldo', 132],
]

for (const tema of ['light', 'dark']) {
  for (const [nome, query, altura] of variantes) {
    const p = await b.newPage({ viewport: { width: 340, height: altura } })
    await p.addInitScript(t => localStorage.setItem('dito-theme', t), tema)
    await p.goto(`${base}#/aviso?${query}`)
    await p.waitForSelector('.aviso-titulo', { timeout: 5000 })
    const titulo = await p.locator('.aviso-titulo').textContent()
    const corpo = await p.locator('.aviso-corpo').textContent()
    const botoes = await p.locator('.aviso-acoes button').allTextContents()
    // O texto passa pelas regras do Dito: sem travessão, sem emoji, sem
    // exclamação. Uma janelinha que grita é o oposto do que ela deve ser.
    for (const texto of [titulo, corpo, ...botoes]) {
      if (/[—!]/.test(texto)) throw new Error(`texto fora do tom em ${nome}: ${texto}`)
    }
    // Nada pode transbordar: a janela tem tamanho fixo e não rola.
    const transbordou = await p.evaluate(() =>
      document.body.scrollHeight > window.innerHeight + 1 ||
      document.body.scrollWidth > window.innerWidth + 1)
    if (transbordou) throw new Error(`o conteúdo não cabe na janelinha em ${nome}`)
    if (tema === 'light') console.log(`${nome.padEnd(20)} "${titulo}" · "${corpo}" · [${botoes.join(', ')}]`)
    await p.screenshot({ path: `.test-results/aviso-${nome}-${tema}.png` })
    await p.close()
  }
}
await b.close()
console.log('variantes do aviso ok')
