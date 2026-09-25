// Ponte entre a janela principal (que decide) e a janelinha de aviso (que só
// desenha). Mesmo desenho da janelinha de gravação, pelo mesmo motivo: uma
// única dona do estado. A janela de aviso não lê saldo, não fala com o
// Supabase e não sabe o que é uma reunião — recebe título, corpo e botões
// prontos e devolve o id do que foi clicado.

import { isTauriApp } from './platform'
import { centroInferior, MINI_SIZE } from './miniRecorder'

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

// A janelinha nasce assim que o detector liga, escondida e com a página já
// carregada. Sem isto, o aviso só aparecia 1 a 3 s depois da reunião começar:
// era o tempo de criar a janela, baixar o site e montar a página, e tudo isso
// acontecia justamente no instante em que a pessoa estava entrando na chamada.
//
// Escondida ela não aparece na barra de tarefas nem rouba foco, e sem texto
// não desenha nada. A proteção de "janela vazia presa na tela" continua
// valendo, mas só quando ela está visível (ver pages/Aviso.jsx).
export async function prepararAviso() {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()
  if (await WebviewWindow.getByLabel(AVISO_LABEL)) return
  await criarAviso({ visivel: false, altura: AVISO_H_COM_BOTOES, posicao: {} })
}

// `desviarDaJanelinha` empurra o aviso para cima da altura da janelinha de
// gravação: durante uma gravação (o aviso de saldo acabando) os dois moram no
// mesmo lugar e ficariam um em cima do outro.
export async function abrirAviso(estado, { desviarDaJanelinha = false } = {}) {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()
  const altura = alturaDoAviso(estado?.acoes)
  const posicao = await centroInferior(
    AVISO_W,
    altura,
    desviarDaJanelinha ? MINI_SIZE.altura + 12 : 0,
  )

  // Reaproveitar a janela evita o piscar de fechar e abrir quando um aviso
  // sucede o outro (o de 5 min e o de 1 min, por exemplo), e é o caminho
  // normal desde a pré-criação. Ela muda de altura porque as variantes sem
  // botão são mais baixas.
  const existente = await WebviewWindow.getByLabel(AVISO_LABEL)
  if (existente) {
    // O texto vai ANTES de a janela aparecer: mostrar primeiro deixaria o
    // aviso anterior visível por um quadro, já que a janela guardada ainda
    // tem na tela o que desenhou da última vez.
    await emitirAviso(estado)
    try {
      const { LogicalSize, LogicalPosition } = await tauriDpi()
      await existente.setSize(new LogicalSize(AVISO_W, altura))
      // A posição é refeita a cada aviso: o monitor de agora pode ser outro,
      // e a janela guardada ficou onde o aviso anterior apareceu.
      if (Number.isFinite(posicao.x)) {
        await existente.setPosition(new LogicalPosition(posicao.x, posicao.y))
      }
    } catch {
      // Sem permissão ou versão antiga: fica do tamanho e no lugar em que estava.
    }
    await existente.show()
    return
  }

  await criarAviso({ visivel: true, altura, posicao })
  // A janela pede `sync` ao nascer (ver pages/Aviso.jsx); emitir aqui também
  // cobre o caso de a página carregar depois do evento.
  await emitirAviso(estado)
}

async function criarAviso({ visivel, altura, posicao }) {
  const { WebviewWindow } = await tauriWebviewWindow()
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
    visible: visivel,
    ...posicao,
  })
  aviso.once('tauri://error', e => console.error('janelinha de aviso:', e))
}

// Esconder, e não fechar: a janela fica de pé para o próximo aviso aparecer na
// hora (ver prepararAviso). O estado vai a null junto, senão ela guardaria na
// tela o aviso já respondido.
export async function fecharAviso() {
  if (!isTauriApp()) return
  const { WebviewWindow } = await tauriWebviewWindow()
  const aviso = await WebviewWindow.getByLabel(AVISO_LABEL)
  if (!aviso) return
  try {
    await aviso.hide()
    await emitirAviso(null)
  } catch {
    // Esconder falhou: fechar é o que garante que ela não fique por cima de
    // tudo sem botão. A próxima chamada de prepararAviso cria outra.
    await aviso.close().catch(() => {})
  }
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
