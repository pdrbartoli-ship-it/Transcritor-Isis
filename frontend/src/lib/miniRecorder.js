// Ponte entre a janela principal (dona da gravação) e a janelinha flutuante.
//
// A janelinha é um controle remoto burro: ela nunca grava nada, só mostra o que
// a principal manda e devolve o que o usuário clicou. Manter uma única dona do
// estado é o que evita as duas divergirem — o pior defeito possível aqui seria
// a janelinha dizer "gravando" com a gravação já encerrada.
//
// No app nativo (Windows/Tauri) as duas são janelas de sistema separadas e
// conversam pelo barramento de eventos do Tauri. No navegador a janelinha é uma
// janela de picture-in-picture no MESMO contexto de JS, então lá não passa nada
// por aqui — o React desenha direto nela (ver useMiniRecorder).

import { isTauriApp } from './platform'

const STATE_EVENT = 'dito://recording-state'
const COMMAND_EVENT = 'dito://recording-command'
const MINI_LABEL = 'mini'

// Tamanho da janelinha, em pixels lógicos. Cabe o símbolo, a onda, o relógio e
// os três botões sem apertar nada.
const MINI_W = 268
const MINI_H = 96
const MARGIN = 24

// Importação dinâmica: no navegador comum estes módulos nunca são carregados, e
// o bundle da web não paga por código que só o app nativo usa.
const tauriEvent = () => import('@tauri-apps/api/event')
const tauriWebviewWindow = () => import('@tauri-apps/api/webviewWindow')
const tauriWindow = () => import('@tauri-apps/api/window')

export async function openMiniWindow() {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()

  // Já existe (foi só escondida antes): reaproveitar evita recriar a janela e
  // perder a posição em que o usuário a deixou.
  const existing = await WebviewWindow.getByLabel(MINI_LABEL)
  if (existing) {
    await existing.show()
    return
  }

  const position = await bottomRightPosition()
  const mini = new WebviewWindow(MINI_LABEL, {
    url: 'index.html#/mini',
    title: 'Dito — gravando',
    width: MINI_W,
    height: MINI_H,
    resizable: false,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: true,
    // Roubar o foco de onde a pessoa está trabalhando é o oposto do que esta
    // janela existe para fazer.
    focus: false,
    ...position,
  })
  // Sem isto uma falha na criação morre em silêncio e a janelinha simplesmente
  // não aparece, sem nada no log para explicar.
  mini.once('tauri://error', e => console.error('janelinha de gravação:', e))
}

export async function closeMiniWindow() {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()
  const mini = await WebviewWindow.getByLabel(MINI_LABEL)
  await mini?.close()
}

// Canto inferior direito do monitor atual. Se não der para descobrir o monitor,
// a janela nasce onde o sistema quiser — melhor do que não nascer.
async function bottomRightPosition() {
  try {
    const { currentMonitor } = await tauriWindow()
    const monitor = await currentMonitor()
    if (!monitor) return {}
    const scale = monitor.scaleFactor || 1
    return {
      x: Math.round(monitor.size.width / scale - MINI_W - MARGIN),
      y: Math.round(monitor.size.height / scale - MINI_H - MARGIN * 3),
    }
  } catch {
    return {}
  }
}

// ── Estado: principal → janelinha ────────────────────────────
// O payload leva instantes, não um contador: a janela principal minimizada tem
// os timers estrangulados pelo sistema, então um contador vindo dela ficaria
// para trás. Com os instantes, a janelinha (que está visível) calcula o tempo
// sozinha e sempre certo.

export async function emitRecordingState(state) {
  if (!isTauriApp()) return
  const { emit } = await tauriEvent()
  await emit(STATE_EVENT, state)
}

export async function listenRecordingState(callback) {
  if (!isTauriApp()) return () => {}
  const { listen } = await tauriEvent()
  return listen(STATE_EVENT, event => callback(event.payload))
}

// ── Comandos: janelinha → principal ──────────────────────────

export async function sendRecordingCommand(action) {
  if (!isTauriApp()) return
  const { emit } = await tauriEvent()
  await emit(COMMAND_EVENT, { action })
}

export async function listenRecordingCommands(callback) {
  if (!isTauriApp()) return () => {}
  const { listen } = await tauriEvent()
  return listen(COMMAND_EVENT, event => callback(event.payload?.action))
}
