// Ponte entre a janela principal (que decide) e a janelinha de aviso (que só
// desenha). Mesmo desenho da janelinha de gravação, pelo mesmo motivo: uma
// única dona do estado. A janela de aviso não lê saldo, não fala com o
// Supabase e não sabe o que é uma reunião — recebe título, corpo e botões
// prontos e devolve o id do que foi clicado.

import { isTauriApp } from './platform'
import { cantoInferiorDireito, MINI_SIZE } from './miniRecorder'

const ESTADO_EVENT = 'dito://aviso-estado'
const RESPOSTA_EVENT = 'dito://aviso-resposta'
const AVISO_LABEL = 'aviso'

// Em pixels lógicos. Cabe o título, duas linhas de corpo e os botões; sem
// botões a janela encolhe, para não sobrar um vazio embaixo do texto.
export const AVISO_W = 340
const AVISO_H_COM_BOTOES = 132
const AVISO_H_SEM_BOTOES = 88

const tauriEvent = () => import('@tauri-apps/api/event')
const tauriWebviewWindow = () => import('@tauri-apps/api/webviewWindow')
const tauriDpi = () => import('@tauri-apps/api/dpi')

export function alturaDoAviso(acoes) {
  return acoes?.length ? AVISO_H_COM_BOTOES : AVISO_H_SEM_BOTOES
}

// `desviarDaJanelinha` empurra o aviso para cima da altura da janelinha de
// gravação. Ela nasce no centro, mas pode ter sido arrastada para este canto,
// e durante uma gravação (o aviso de saldo acabando) os dois ficariam um em
// cima do outro.
export async function abrirAviso(estado, { desviarDaJanelinha = false } = {}) {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()
  const altura = alturaDoAviso(estado?.acoes)

  // Reaproveitar a janela evita o piscar de fechar e abrir quando um aviso
  // sucede o outro (o de 5 min e o de 1 min, por exemplo). Ela muda de altura
  // porque as variantes sem botão são mais baixas.
  const existente = await WebviewWindow.getByLabel(AVISO_LABEL)
  if (existente) {
    try {
      const { LogicalSize } = await tauriDpi()
      await existente.setSize(new LogicalSize(AVISO_W, altura))
    } catch {
      // Sem permissão ou versão antiga: a janela fica do tamanho que estava.
    }
    await existente.show()
    await emitirAviso(estado)
    return
  }

  const posicao = await cantoInferiorDireito(
    AVISO_W,
    altura,
    desviarDaJanelinha ? MINI_SIZE.altura + 12 : 0,
  )
  const aviso = new WebviewWindow(AVISO_LABEL, {
    // Como a janelinha de gravação: a página vem de onde veio a principal (o
    // site publicado), e não da cópia congelada dentro do instalador.
    url: window.location.protocol === 'https:' ? `${window.location.origin}/#/aviso` : 'index.html#/aviso',
    title: 'Dito',
    width: AVISO_W,
    height: altura,
    resizable: false,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: true,
    // Aparecer no meio de uma reunião já é interromper. Roubar o foco de quem
    // está entrando na chamada seria demais.
    focus: false,
    ...posicao,
  })
  aviso.once('tauri://error', e => console.error('janelinha de aviso:', e))
  // A janela pede `sync` ao nascer (ver pages/Aviso.jsx); emitir aqui também
  // cobre o caso de a página carregar depois do evento.
  await emitirAviso(estado)
}

export async function fecharAviso() {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()
  const aviso = await WebviewWindow.getByLabel(AVISO_LABEL)
  await aviso?.close()
}

export async function avisoEstaAberto() {
  if (!isTauriApp()) return false
  const { WebviewWindow } = await tauriWebviewWindow()
  return !!(await WebviewWindow.getByLabel(AVISO_LABEL))
}

// ── Estado: principal → janelinha ────────────────────────────

export async function emitirAviso(estado) {
  if (!isTauriApp()) return
  const { emit } = await tauriEvent()
  await emit(ESTADO_EVENT, estado)
}

export async function ouvirAviso(callback) {
  if (!isTauriApp()) return () => {}
  const { listen } = await tauriEvent()
  return listen(ESTADO_EVENT, evento => callback(evento.payload))
}

// ── Resposta: janelinha → principal ──────────────────────────
//
// `id` é o do botão clicado, ou 'expirou' quando ninguém respondeu, ou 'sync'
// quando a janela acabou de nascer e está pedindo o estado.

export async function responderAviso(id) {
  if (!isTauriApp()) return
  const { emit } = await tauriEvent()
  await emit(RESPOSTA_EVENT, { id })
}

export async function ouvirRespostas(callback) {
  if (!isTauriApp()) return () => {}
  const { listen } = await tauriEvent()
  return listen(RESPOSTA_EVENT, evento => callback(evento.payload?.id))
}
