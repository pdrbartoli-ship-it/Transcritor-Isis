// "Baixar a transcrição" (Fase 5 da atualização do desktop, 26/09/2026).
//
// 1. No site, nada muda: o navegador baixa o .txt.
// 2. No app de Windows novo, o arquivo vai para Downloads pelo comando
//    `salvar_transcricao` (src-tauri/src/arquivo.rs), que também abre o
//    Explorador. O aviso diz "Transcrição salva em Downloads".
// 3. Num instalador antigo o comando não existe: a chamada falha e o download
//    de sempre assume.
//
// O app só existe no Windows, então nos cenários 2 e 3 a ponte do Tauri é de
// mentira. Nada disto muda a conta: só lê a primeira conversa.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const OUT = '.test-results'
mkdirSync(OUT, { recursive: true })

let falhas = 0
function check(nome, ok, extra = '') {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'}  ${nome} ${extra}`)
  if (!ok) falhas++
}

const b = await chromium.launch()

// `app`: null é o site; 'novo' responde ao comando; 'antigo' não o conhece.
async function abrirConversa(app) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  if (app) {
    await page.addInitScript(app => {
      const callbacks = new Map()
      let proximo = 1
      window.__salvos = []
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
          if (cmd === 'plugin:event|listen') return args.handler
          if (cmd === 'meeting_detection_available') return false
          if (cmd === 'salvar_transcricao') {
            if (app === 'antigo') throw 'Command salvar_transcricao not found'
            window.__salvos.push(args)
            return `C:\\Users\\teste\\Downloads\\${args.nome}`
          }
          return null
        },
      }
    }, app)
  }
  await page.goto(base + '#/auth')
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.click('text=Acessar')
  await page.fill('input[type="email"]', creds.email)
  await page.fill('input[type="password"]', creds.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.home', { timeout: 25000 })
  await page.waitForSelector('.sidebar-item', { timeout: 20000 })
  await page.locator('.sidebar-item').first().click()
  await page.waitForSelector('.conversa', { timeout: 15000 })
  await page.waitForTimeout(600)
  return { ctx, page }
}

async function baixar(page) {
  await page.getByRole('button', { name: 'Opções da conversa' }).first().click()
  await page.getByText('Baixar a transcrição').click()
}

// 1. Site
{
  console.log('\n1. No site')
  const { ctx, page } = await abrirConversa(null)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), baixar(page)])
  check('o navegador baixa um .txt', download.suggestedFilename().endsWith('.txt'), download.suggestedFilename())
  check('o aviso diz que baixou', await page.getByText(/Transcrição baixada/).isVisible())
  await ctx.close()
}

// 2. App de Windows novo
{
  console.log('\n2. No app de Windows novo')
  const { ctx, page } = await abrirConversa('novo')
  let baixou = false
  page.on('download', () => { baixou = true })
  await baixar(page)
  await page.getByText('Transcrição salva em Downloads').waitFor({ timeout: 5000 }).catch(() => {})
  const salvos = await page.evaluate(() => window.__salvos)
  check('chama salvar_transcricao uma vez', salvos.length === 1, JSON.stringify(salvos.map(s => s.nome)))
  check('com nome .txt e o texto da transcrição',
    salvos[0]?.nome?.endsWith('.txt') && (salvos[0]?.texto || '').length > 20)
  check('o aviso diz "Transcrição salva em Downloads"', await page.getByText('Transcrição salva em Downloads').isVisible())
  await page.waitForTimeout(800)
  check('não baixa pelo navegador também', !baixou)
  await page.screenshot({ path: `${OUT}/baixar-transcricao-app.png` })
  await ctx.close()
}

// 3. Instalador antigo
{
  console.log('\n3. Num instalador antigo')
  const { ctx, page } = await abrirConversa('antigo')
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), baixar(page)])
  check('o download de sempre assume', download.suggestedFilename().endsWith('.txt'), download.suggestedFilename())
  await ctx.close()
}

await b.close()
console.log(falhas ? `\n${falhas} falha(s)` : '\nbaixar a transcrição ok')
process.exit(falhas ? 1 : 0)
