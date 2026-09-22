// A gravação tem de sobreviver a trocar de tela.
//
// Era o defeito que este trabalho existe para corrigir: a gravação morava no
// painel de captura, que só existe na home. Abrir uma conversa da barra
// lateral no meio de uma reunião desmontava o painel, o JS perdia cronômetro e
// áudio, e a gravação seguinte falhava com "já existe uma gravação em
// andamento". Aqui isso é exercitado com microfone falso do Chromium, sem
// gastar nada da conta: nada é enviado para transcrever.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'

const b = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['microphone'] })
const p = await ctx.newPage()

await p.goto(base + '#/auth')
await p.waitForSelector('input[type="email"]', { timeout: 20000 })
await p.click('text=Acessar')
await p.fill('input[type="email"]', creds.email)
await p.fill('input[type="password"]', creds.password)
await p.click('button[type="submit"]')
await p.waitForSelector('.home', { timeout: 25000 })
await p.waitForFunction(() => document.querySelectorAll('.sidebar-item').length > 0, { timeout: 20000 })

const segundos = async () => {
  const texto = await p.locator('.record-label').textContent()
  const [, mm, ss] = texto.match(/(\d+):(\d+)/) || []
  return Number(mm) * 60 + Number(ss)
}

await p.click('.record-btn')
await p.waitForSelector('.record-label:has-text("Gravando")', { timeout: 10000 })
await p.waitForTimeout(3000)
const antes = await segundos()
console.log('gravando na home:', antes, 's')
if (antes < 2) throw new Error('o cronômetro não andou')

// Sai da home no meio da gravação — é aqui que ela morria.
await p.click('.sidebar-item')
await p.waitForURL(/#\/conversa\//, { timeout: 15000 })
await p.waitForTimeout(4000)
console.log('numa conversa por 4 s, url', new URL(p.url()).hash)

await p.click('.sidebar-novo:has-text("Transcrever")')
await p.waitForSelector('.record-label', { timeout: 10000 })
const depois = await segundos()
console.log('de volta na home:', depois, 's')

const aindaGravando = await p.locator('.record-label:has-text("Gravando")').count()
if (!aindaGravando) throw new Error('a gravação não sobreviveu à navegação')
if (depois < antes + 3) throw new Error(`o cronômetro parou no meio (${antes} → ${depois})`)

// Parar tem de entregar o áudio, e não um erro de "já existe uma gravação".
await p.click('.record-btn')
await p.waitForSelector('.record-label:has-text("Gravação concluída")', { timeout: 20000 })
console.log('parada:', await p.locator('.record-label').textContent())
if (await p.locator('.alert-error').count()) {
  throw new Error('erro na tela: ' + await p.locator('.alert-error').textContent())
}

// E uma gravação nova começa normalmente depois dela.
await p.click('.btn-ghost:has-text("Regravar")')
await p.click('.record-btn')
await p.waitForSelector('.record-label:has-text("Gravando")', { timeout: 10000 })
console.log('a gravação seguinte começa sem travar')
await p.click('.record-btn')
await p.waitForSelector('.record-label:has-text("Gravação concluída")', { timeout: 20000 })

await b.close()
console.log('gravação sobrevive à navegação ok')
