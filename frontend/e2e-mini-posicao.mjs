// Posição da janelinha de gravação do app de Windows: nasce no centro de baixo,
// acima das barras de botões do Meet e do Zoom, na ÁREA LIVRE da tela (fora da
// barra de tarefas) e no monitor onde está o mouse. Dentro da mesma gravação
// ela renasce onde a pessoa a deixou.
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
function falsoTauri({ monitores, escala, label, ponteiro = null }) {
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
      // Sem ponteiro simulado, o Tauri responde null e o site cai no monitor
      // da janela principal — que é o caminho de quem usa sessão remota.
      if (cmd === 'plugin:window|cursor_position') return ponteiro
      if (cmd === 'plugin:window|monitor_from_point') {
        return monitores.find(m => args.x >= m.position.x && args.x < m.position.x + m.size.width) || null
      }
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

const monitor = (x, y, w, h, scaleFactor = 1, barra = 0) => ({
  name: 'tela', scaleFactor, position: { x, y }, size: { width: w, height: h },
  // A área livre é a tela menos a barra de tarefas, que é o que o Windows
  // informa de verdade.
  workArea: { position: { x, y }, size: { width: w, height: h - barra } },
})
const fullHd = monitor(0, 0, 1920, 1080)
// Onde a janelinha deve nascer num monitor 1920x1080 sem barra de tarefas:
// centro na horizontal, e 104 px acima do fim da área livre (os controles do
// Meet ficam nesses 104).
const CENTRO = { x: 844, y: 1080 - 74 - 104 }

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
confere('sem posição guardada nasce no centro', await criarJanelinha(p), CENTRO)
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
confere('monitor desligado volta ao centro', await criarJanelinha(p), CENTRO)
await p.close()

// 6. Barra de tarefas alta: a conta usa a área livre, não a tela inteira.
p = await abrir({ monitores: [monitor(0, 0, 1920, 1080, 1, 120)], escala: 1, label: 'main' })
confere('respeita a barra de tarefas', await criarJanelinha(p), { x: 844, y: 1080 - 120 - 74 - 104 })
await p.close()

// 7. Dois monitores: nasce no que está sob o mouse, e não no da janela
// principal (durante uma reunião ela costuma estar minimizada, e podia ter
// ficado no outro monitor).
p = await abrir({ monitores: dois, escala: 1, label: 'main', ponteiro: { x: 2500, y: 500 } })
confere('nasce no monitor do mouse', await criarJanelinha(p), { x: 1920 + 844, y: CENTRO.y })
await p.close()

// 8. A posição guardada morre com a gravação: a próxima nasce no centro.
p = await abrir({ monitores: [fullHd], escala: 1, label: 'main' }, { x: 300, y: 150 })
await p.evaluate(async () => {
  const m = await import('/src/lib/miniRecorder.js')
  m.esquecerPosicaoMini()
})
confere('esquecer a posição volta ao centro', await criarJanelinha(p), CENTRO)
await p.close()

await b.close()
console.log(process.exitCode ? 'posição da janelinha FALHOU' : 'posição da janelinha ok')
