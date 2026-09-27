// Os níveis de cada lado de uma gravação do app de Windows (Fase 6.3 da
// atualização do desktop, 26/09/2026) chegam ao servidor junto com o áudio.
//
// O gravador devolve, no fim, o volume do microfone e o do som do computador a
// cada 250 ms (src-tauri/src/audio/niveis.rs). O site guarda isso com a
// gravação e manda no campo `niveis`, que o servidor usa para separar a voz de
// quem gravou da voz dos outros (marcar_canais, backend/main.py).
//
// A ponte do Tauri é de mentira e o envio é interceptado: nada é transcrito e
// nenhum minuto da conta é gasto.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
mkdirSync('.test-results', { recursive: true })

let falhas = 0
function check(nome, ok, extra = '') {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'}  ${nome} ${extra}`)
  if (!ok) falhas++
}

const NIVEIS = '250:' + 'gA'.repeat(8) + 'Ag'.repeat(8)
const b = await chromium.launch()

// `antigo`: um instalador de antes dos níveis, que devolve só caminho e som.
async function gravarETranscrever(antigo) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.addInitScript(({ NIVEIS, antigo }) => {
    const callbacks = new Map()
    let proximo = 1
    window.__comandos = []
    window.isTauri = true
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
      transformCallback(cb) { const id = proximo++; callbacks.set(id, cb); return id },
      unregisterCallback(id) { callbacks.delete(id) },
      convertFileSrc: s => s,
      async invoke(cmd, args) {
        window.__comandos.push(cmd)
        if (cmd === 'plugin:event|listen') return args.handler
        if (cmd === 'meeting_detection_available') return false
        if (cmd === 'stop_recording') {
          const fim = { caminho: 'C:\\cache\\gravacao-1.wav', teve_som: true }
          return antigo ? fim : { ...fim, niveis: NIVEIS }
        }
        // Um .wav de 44 bytes: só o cabeçalho, que é o que o envio precisa.
        if (cmd === 'plugin:fs|read_file') return Array.from({ length: 44 }, (_, i) => i)
        return null
      },
    }
  }, { NIVEIS, antigo })

  const enviados = []
  const interceptar = async route => {
    enviados.push({ url: route.request().url(), corpo: route.request().postData() || '' })
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'teste' }) })
  }
  await page.route('**/transcricoes', interceptar)
  await page.route('**/transcribe', interceptar)

  await page.goto(base + '#/auth')
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.click('text=Acessar')
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home', { timeout: 25000 })

  await page.click('.record-btn')
  await page.waitForSelector('.gravando-estado:has-text("Gravando")', { timeout: 10000 })
  await page.waitForTimeout(1500)
  await page.click('.gravando-parar')
  await page.waitForSelector('.revisao-titulo:has-text("Gravação concluída")', { timeout: 20000 })
  await page.locator('.escolha-enviar, .split-main').first().click()
  for (let i = 0; i < 40 && !enviados.length; i++) await page.waitForTimeout(250)
  const comandos = await page.evaluate(() => window.__comandos)
  await ctx.close()
  return { enviados, comandos }
}

console.log('\n1. Instalador novo')
{
  const { enviados, comandos } = await gravarETranscrever(false)
  check('gravou e parou pelo Rust', comandos.includes('start_recording') && comandos.includes('stop_recording'))
  check('o áudio subiu', enviados.length > 0, enviados.map(e => e.url).join(' '))
  const corpo = enviados[0]?.corpo || ''
  check('com o campo niveis', /name="niveis"\r?\n\r?\n/.test(corpo))
  check('com o valor que o gravador devolveu', corpo.includes(NIVEIS))
}

console.log('\n2. Instalador antigo (sem níveis)')
{
  const { enviados } = await gravarETranscrever(true)
  check('o áudio subiu', enviados.length > 0)
  check('sem o campo niveis, como antes', enviados.length > 0 && !/name="niveis"/.test(enviados[0].corpo))
}

await b.close()
console.log(falhas ? `\n${falhas} falha(s)` : '\nníveis da gravação ok')
process.exit(falhas ? 1 : 0)
