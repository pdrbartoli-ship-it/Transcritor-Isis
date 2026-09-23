// A janelinha de aviso que ficava em branco e presa na tela (23/09/2026: entrar
// numa chamada do Meet e sair às pressas deixou um retângulo branco por cima de
// tudo, sem botão).
//
// A janela só existe no Windows, então aqui a ponte do Tauri é de mentira: a
// página acha que é a janela `aviso`, e cada cenário decide como a "principal"
// responde. Nada disto fala com o Supabase nem gasta minutos da conta.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const creds = JSON.parse(readFileSync('../e2e/credentials.json', 'utf8'))
const base = creds.dev_url || 'http://localhost:5173/'
const b = await chromium.launch()

const CONVITE = {
  variante: 'convite', titulo: 'Reunião no Google Meet', corpo: 'Quer gravar com o Dito?',
  acoes: [{ id: 'nao', rotulo: 'Agora não' }, { id: 'gravar', rotulo: 'Gravar', primaria: true }],
  timeoutS: 30,
}

// `principal`: 'responde' devolve o convite a cada `sync`; 'muda' nunca
// responde. `atrasoListenMs` segura o registro do ouvinte, que é a corrida que
// deixava a janela em branco quando a resposta chegava antes dele.
async function abrir({ principal, atrasoListenMs = 0 }) {
  const p = await b.newPage({ viewport: { width: 340, height: 132 } })
  await p.addInitScript(({ principal, atrasoListenMs, CONVITE }) => {
    const callbacks = new Map()
    const ouvintes = new Map()
    let proximo = 1
    window.__log = []
    const entregar = (event, payload) => {
      for (const id of ouvintes.get(event) || []) callbacks.get(id)?.({ event, id: 0, payload })
    }
    window.isTauri = true
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'aviso' },
        currentWebview: { label: 'aviso', windowLabel: 'aviso' },
      },
      transformCallback(cb) { const id = proximo++; callbacks.set(id, cb); return id },
      unregisterCallback(id) { callbacks.delete(id) },
      convertFileSrc: s => s,
      async invoke(cmd, args) {
        window.__log.push(cmd === 'plugin:event|emit' ? `emit ${args.event} ${args.payload?.id ?? ''}` : cmd)
        if (cmd === 'plugin:event|listen') {
          await new Promise(r => setTimeout(r, atrasoListenMs))
          const lista = ouvintes.get(args.event) || []
          lista.push(args.handler)
          ouvintes.set(args.event, lista)
          return args.handler
        }
        if (cmd === 'plugin:event|emit') {
          // A principal responde ao `sync` na hora, antes de qualquer outra
          // coisa: o pior caso para quem ainda está montando o ouvinte.
          if (args.event === 'dito://aviso-resposta' && args.payload?.id === 'sync' && principal === 'responde') {
            entregar('dito://aviso-estado', CONVITE)
          }
          return null
        }
        return null
      },
    }
  }, { principal, atrasoListenMs, CONVITE })
  await p.goto(`${base}#/aviso`)
  return p
}

const fechou = p => p.evaluate(() => window.__log.includes('plugin:window|close'))

// 1. Ouvinte lento, principal rápida: antes a resposta se perdia e a janela
//    ficava em branco. Agora o texto aparece.
{
  const p = await abrir({ principal: 'responde', atrasoListenMs: 400 })
  await p.waitForSelector('.aviso-titulo', { timeout: 5000 })
  console.log('ouvinte lento, principal rápida:', await p.locator('.aviso-titulo').textContent())
  await p.screenshot({ path: '.test-results/aviso-travado-convite.png' })
  await p.close()
}

// 2. A principal nunca responde: a janela pede de novo algumas vezes e fecha
//    sozinha, em vez de ficar em branco para sempre.
{
  const p = await abrir({ principal: 'muda' })
  await p.waitForSelector('.aviso-fechar', { timeout: 5000 })
  const inicio = Date.now()
  await p.waitForFunction(() => window.__log.includes('plugin:window|close'), null, { timeout: 12000 })
  const pedidos = await p.evaluate(() => window.__log.filter(l => l.endsWith(' sync')).length)
  console.log(`principal muda: fechou sozinha em ${((Date.now() - inicio) / 1000).toFixed(1)} s, depois de ${pedidos} pedidos`)
  await p.close()
}

// 3. O × sempre tira a janela da tela, com ou sem principal ouvindo.
for (const principal of ['responde', 'muda']) {
  const p = await abrir({ principal })
  await p.waitForSelector('.aviso-fechar', { timeout: 5000 })
  if (principal === 'responde') await p.waitForSelector('.aviso-titulo', { timeout: 5000 })
  await p.click('.aviso-fechar')
  await p.waitForTimeout(300)
  if (!(await fechou(p))) throw new Error(`o × não fechou a janela (principal ${principal})`)
  const avisou = await p.evaluate(() => window.__log.includes('emit dito://aviso-resposta fechar'))
  console.log(`× com principal ${principal}: fechou${avisou ? ' e avisou a principal' : ''}`)
  await p.close()
}

await b.close()
console.log('janelinha de aviso não trava mais')
