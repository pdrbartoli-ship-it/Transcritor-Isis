// Posição da janelinha de gravação do app de Windows: nasce no centro de baixo
// (e não mais no canto direito, em cima da câmera do Teams) e renasce onde a
// pessoa a deixou.
//
// A janelinha é uma janela do Windows, que não existe aqui. O teste finge ser o
// Tauri (`__TAURI_INTERNALS__`) e confere o que o site pede a ele: com que
// posição a janela é criada e o que a janelinha guarda quando é arrastada.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const b = await chromium.launch()

// Monitor e escala são passados por página; o falso Tauri anota cada janela
// criada e guarda os ouvintes de evento para o teste disparar um "moveu".
function falsoTauri({ monitores, escala, label }) {
  const ouvintes = {}
  let proximo = 1
  window.__criadas = []
  window.isTauri = true
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
    transformCallback(cb) { const id = proximo++; window[`_${id}`] = cb; return id },
    unregisterCallback(id) { delete window[`_${id}`] },
    async invoke(cmd, args) {
      if (cmd === 'plugin:window|current_monitor') return monitores[0]
      if (cmd === 'plugin:window|available_monitors') return monitores
      if (cmd === 'plugin:window|get_all_windows') return []
      if (cmd === 'plugin:window|scale_factor') return escala
      if (cmd === 'plugin:webview|create_webview_window') { window.__criadas.push(args.options); return null }
      if (cmd === 'plugin:event|listen') { (ouvintes[args.event] ||= []).push(args.handler); return proximo++ }
      return null
    },
  }
  window.__disparar = (evento, payload) =>
    (ouvintes[evento] || []).forEach(id => window[`_${id}`]?.({ event: evento, id: 0, payload }))
}

const monitor = (x, y, w, h, scaleFactor = 1) => ({
  name: 'tela', scaleFactor, position: { x, y }, size: { width: w, height: h },
  workArea: { position: { x, y }, size: { width: w, height: h } },
})
const fullHd = monitor(0, 0, 1920, 1080)

async function abrir(opcoes, salvo) {
  const p = await b.newPage()
  await p.addInitScript(falsoTauri, opcoes)
  await p.addInitScript(s => {
    if (s === undefined) localStorage.removeItem('dito-mini-posicao')
    else localStorage.setItem('dito-mini-posicao', s)
  }, salvo === undefined ? undefined : JSON.stringify(salvo))
  await p.goto(`${base}#/mini`)
  await p.waitForTimeout(800)
  return p
}

async function criarJanelinha(p) {
  return p.evaluate(async () => {
    const m = await import('/src/lib/miniRecorder.js')
    await m.openMiniWindow()
    const o = window.__criadas.at(-1)
    return { x: o.x, y: o.y }
  })
}

function confere(nome, obtido, esperado) {
  const ok = obtido.x === esperado.x && obtido.y === esperado.y
  console.log(`${ok ? 'ok ' : 'ERRO'} ${nome}: ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`)
  if (!ok) process.exitCode = 1
}

// 1. Sem posição guardada: centro de baixo, 232 de largura e 74 de altura.
let p = await abrir({ monitores: [fullHd], escala: 1, label: 'main' })
confere('sem posição guardada nasce no centro', await criarJanelinha(p), { x: 844, y: 934 })
await p.close()

// 2. Na janelinha (escala 150%), arrastar guarda a posição em pixels lógicos.
p = await abrir({ monitores: [monitor(0, 0, 2880, 1620, 1.5)], escala: 1.5, label: 'mini' })
await p.evaluate(() => window.__disparar('tauri://move', { x: 450, y: 225 }))
await p.waitForTimeout(200)
const salvo = await p.evaluate(() => JSON.parse(localStorage.getItem('dito-mini-posicao')))
confere('arrastar guarda a posição lógica', salvo, { x: 300, y: 150 })
await p.close()

// 3. Com a posição guardada, renasce onde foi deixada.
p = await abrir({ monitores: [fullHd], escala: 1, label: 'main' }, { x: 300, y: 150 })
confere('renasce onde foi deixada', await criarJanelinha(p), { x: 300, y: 150 })
await p.close()

// 4. Guardada num segundo monitor que ainda está ligado: vale.
const dois = [fullHd, monitor(1920, 0, 1920, 1080)]
p = await abrir({ monitores: dois, escala: 1, label: 'main' }, { x: 2500, y: 900 })
confere('segundo monitor ligado', await criarJanelinha(p), { x: 2500, y: 900 })
await p.close()

// 5. Guardada num monitor que foi desligado: volta para o centro.
p = await abrir({ monitores: [fullHd], escala: 1, label: 'main' }, { x: 2500, y: 900 })
confere('monitor desligado volta ao centro', await criarJanelinha(p), { x: 844, y: 934 })
await p.close()

await b.close()
console.log(process.exitCode ? 'posição da janelinha FALHOU' : 'posição da janelinha ok')
