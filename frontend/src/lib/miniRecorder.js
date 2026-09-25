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
const MINI_W = 232
const MINI_H = 74
const MARGIN = 24

// Quanto a janelinha fica ACIMA do fim da área livre da tela (o topo da barra
// de tarefas). Não é folga estética: é o que a tira de cima dos controles da
// reunião.
//
// Onde cada coisa fica, conferido na documentação dos três (25/09/2026):
// · Meet: barra de botões embaixo, sempre visível, por volta de 80 px, com
//   microfone, câmera e desligar no centro. A sua própria imagem é um quadro
//   flutuante no canto de baixo à DIREITA numa chamada de duas pessoas.
// · Teams: os botões ficam no topo, mas a sua imagem também fica no canto de
//   baixo à direita do palco.
// · Zoom: barra embaixo, por volta de 60 px; no modo orador as miniaturas
//   ficam em cima.
//
// Daí o lugar escolhido: centro, embaixo, logo ACIMA das barras. O canto
// direito (onde a janelinha nascia antes de 23/09) é a câmera de quem está na
// chamada nos dois primeiros; colada na borda, ela cobriria o microfone e o
// desligar do Meet; e em cima ela bate nas miniaturas do Zoom. No centro, o
// máximo que ela cobre é a parte de baixo do vídeo do meio.
const ACIMA_DOS_CONTROLES = 104

// Onde o usuário arrastou a janelinha, em pixels lógicos. Ela é fechada (e não
// escondida) a cada vez que a pessoa volta ao app, então sem guardar isto ela
// renasceria no lugar padrão a cada minimizada, e quem a tirou do caminho
// teria de arrastar de novo no meio da mesma reunião.
//
// Vale só ENQUANTO aquela gravação dura (ver esquecerPosicaoMini): guardar
// entre gravações fazia a janelinha voltar, semanas depois, a um canto que a
// pessoa escolheu numa reunião com outro layout, e foi assim que ela continuou
// aparecendo em cima da câmera mesmo depois de o padrão virar o centro.
const POSICAO_KEY = 'dito-mini-posicao'

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

  const position = (await posicaoGuardada()) || (await centroInferior(MINI_W, MINI_H))
  const mini = new WebviewWindow(MINI_LABEL, {
    // Um caminho relativo abriria a cópia do site que vai dentro do instalador,
    // congelada no dia do build. A janelinha tem de vir de onde veio a janela
    // principal — o site publicado —, senão as duas rodam versões diferentes.
    url: window.location.protocol === 'https:' ? `${window.location.origin}/#/mini` : 'index.html#/mini',
    title: 'Dito · gravando',
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

// O monitor onde o mouse está, que é onde a reunião está acontecendo. A janela
// principal do Dito não serve de referência: durante uma reunião ela costuma
// estar minimizada ou escondida na bandeja, e podia ter sido deixada no outro
// monitor.
async function monitorDeAgora() {
  const { cursorPosition, monitorFromPoint, currentMonitor } = await tauriWindow()
  try {
    const ponteiro = await cursorPosition()
    const debaixo = await monitorFromPoint(ponteiro.x, ponteiro.y)
    if (debaixo) return debaixo
  } catch {
    // Sem ponteiro (sessão remota, versão antiga da API): vale o monitor da
    // janela principal, que é o que havia antes.
  }
  return currentMonitor()
}

// Centro da borda de baixo da ÁREA LIVRE da tela, acima dos controles da
// reunião (ver ACIMA_DOS_CONTROLES). Se não der para descobrir o monitor, a
// janela nasce onde o sistema quiser: melhor do que não nascer.
//
// A área livre é a tela menos a barra de tarefas. A conta antiga usava a
// altura TOTAL menos uma folga fixa, e por isso errava em quem tem a barra de
// tarefas mais alta, na lateral ou escondida.
//
// Recebe o tamanho porque a janelinha de gravação não é a única que nasce ali:
// o aviso de reunião usa o mesmo lugar, e `acima` é o que o empurra para cima
// da janelinha quando as duas estão na tela ao mesmo tempo.
export async function centroInferior(largura = MINI_W, altura = MINI_H, acima = 0) {
  try {
    const monitor = await monitorDeAgora()
    if (!monitor) return {}
    const scale = monitor.scaleFactor || 1
    // `workArea` só existe nas versões novas da API; sem ele, a tela inteira
    // menos uma folga, que é o que havia antes.
    const area = monitor.workArea || { position: monitor.position, size: monitor.size }
    const x0 = (area.position?.x || 0) / scale
    const y0 = (area.position?.y || 0) / scale
    const larguraTela = area.size.width / scale
    const alturaTela = area.size.height / scale
    const folga = monitor.workArea ? ACIMA_DOS_CONTROLES : MARGIN * 3
    return {
      x: Math.round(x0 + (larguraTela - largura) / 2),
      y: Math.round(y0 + alturaTela - altura - folga - acima),
    }
  } catch {
    return {}
  }
}

// Chamado pela própria janelinha a cada vez que é arrastada. O localStorage é
// o mesmo nas duas janelas porque as duas vêm do mesmo site.
export function guardarPosicaoMini(x, y) {
  try {
    localStorage.setItem(POSICAO_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }))
  } catch {
    // Sem armazenamento: ela volta para o centro, que é o padrão aceitável.
  }
}

// Chamado quando a gravação termina: a próxima começa no centro de novo.
export function esquecerPosicaoMini() {
  try { localStorage.removeItem(POSICAO_KEY) } catch { /* sem storage */ }
}

// A posição guardada só vale se ainda cair dentro de algum monitor: quem
// desconectou o segundo monitor não pode ficar com a janelinha fora da tela.
async function posicaoGuardada() {
  let salvo
  try {
    salvo = JSON.parse(localStorage.getItem(POSICAO_KEY))
  } catch {
    return null
  }
  if (!Number.isFinite(salvo?.x) || !Number.isFinite(salvo?.y)) return null
  try {
    const { availableMonitors } = await tauriWindow()
    const monitores = await availableMonitors()
    const cx = salvo.x + MINI_W / 2
    const cy = salvo.y + MINI_H / 2
    const visivel = monitores.some(m => {
      const s = m.scaleFactor || 1
      const x0 = m.position.x / s
      const y0 = m.position.y / s
      return cx >= x0 && cx <= x0 + m.size.width / s && cy >= y0 && cy <= y0 + m.size.height / s
    })
    return visivel ? { x: salvo.x, y: salvo.y } : null
  } catch {
    return null
  }
}

// O tamanho da janelinha de gravação, para quem precisa desviar dela.
export const MINI_SIZE = { largura: MINI_W, altura: MINI_H }

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

// Nível de áudio (0..1) para a onda. Vem do Rust, que é quem tem as amostras
// mixadas, e é ouvido DIRETO pela janelinha — a janela principal está
// minimizada quando a janelinha existe, e retransmitir por ela colocaria os
// timers estrangulados dela no meio do caminho.
export async function listenRecordingLevel(callback) {
  if (!isTauriApp()) return () => {}
  const { listen } = await tauriEvent()
  return listen('recording-level', event => callback(event.payload || 0))
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
