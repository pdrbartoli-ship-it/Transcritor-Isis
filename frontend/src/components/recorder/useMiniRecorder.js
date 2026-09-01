import { useState, useEffect, useRef, useCallback } from 'react'
import { isTauriApp } from '../../lib/platform'
import {
  openMiniWindow, closeMiniWindow,
  emitRecordingState, listenRecordingCommands,
} from '../../lib/miniRecorder'

// Hospeda a janelinha de gravação a partir da janela principal, que é quem tem
// a gravação de verdade. Duas plataformas, dois mecanismos:
//
// • App nativo (Windows/Tauri): uma segunda janela do sistema, sempre por cima
//   e fora da barra de tarefas. Aparece SOZINHA quando o Dito é minimizado —
//   que é exatamente o momento em que o usuário perde de vista que está sendo
//   gravado — e some quando ele volta para o app.
//
// • Navegador: a API de picture-in-picture de documento (Chrome/Edge). Ela
//   exige um gesto do usuário para abrir, então não dá para abrir sozinha ao
//   minimizar; quem abre é o botão "destacar" ao lado do cronômetro. Uma vez
//   aberta, ela sobrevive a minimizar a janela e a trocar de aba, que é o que
//   importa.
//
// Onde não há nenhum dos dois (Firefox, Safari, Android) `supported` volta
// false e a interface simplesmente não oferece o botão, em vez de oferecer
// algo que não funciona.
export function useMiniRecorder({
  isRecording, isPaused, startedAt, pausedMs, pausedAt,
  onPause, onResume, onStop,
}) {
  const [pipWindow, setPipWindow] = useState(null)
  const [nativeOpen, setNativeOpen] = useState(false)
  // A janelinha nativa reaparece sozinha a cada minimizada; o X precisa
  // significar "não me mostre mais nesta gravação", senão fechá-la seria
  // inútil — ela voltaria na minimizada seguinte.
  const dismissedRef = useRef(false)

  const supported = isTauriApp() || (typeof window !== 'undefined' && 'documentPictureInPicture' in window)

  // Os callbacks mudam de identidade a cada render; guardá-los num ref deixa os
  // ouvintes serem montados uma vez só, sem religar a cada tique do relógio.
  const handlersRef = useRef({})
  handlersRef.current = { onPause, onResume, onStop }

  // O estado é emitido quando muda. Uma janelinha que abre DEPOIS da última
  // mudança não veria nada e ficaria parada em 00:00 — por isso ela pede um
  // "sync" ao nascer, e responder a ele exige ter o estado atual à mão aqui.
  const stateRef = useRef(null)
  stateRef.current = { isRecording, isPaused, startedAt, pausedMs, pausedAt }

  // Abrir/fechar são a mesma ação para quem clica; o que muda por baixo é o
  // mecanismo — janela do sistema no app nativo, picture-in-picture no
  // navegador.
  const open = useCallback(async () => {
    dismissedRef.current = false
    if (isTauriApp()) {
      await openMiniWindow()
      setNativeOpen(true)
      return
    }
    if (!('documentPictureInPicture' in window)) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 232, height: 74 })
      copyStyles(pip)
      pip.addEventListener('pagehide', () => setPipWindow(null))
      setPipWindow(pip)
    } catch {
      // Negado ou sem suporte: seguir sem a janelinha é melhor do que um erro
      // na cara de quem só queria gravar.
    }
  }, [])

  const close = useCallback(() => {
    if (isTauriApp()) {
      dismissedRef.current = true
      closeMiniWindow()
      setNativeOpen(false)
      return
    }
    setPipWindow(prev => { prev?.close(); return null })
  }, [])

  // Parou de gravar: a janelinha não tem mais o que mostrar, em qualquer
  // plataforma.
  useEffect(() => {
    if (isRecording) return
    dismissedRef.current = false
    setNativeOpen(false)
    closeMiniWindow()
    setPipWindow(prev => { prev?.close(); return null })
  }, [isRecording])

  // ── App nativo: abre ao minimizar, fecha ao voltar ─────────
  useEffect(() => {
    if (!isTauriApp() || !isRecording) return
    let disposed = false
    const unlisteners = []

    ;(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()

      unlisteners.push(await win.onResized(async () => {
        if (disposed || dismissedRef.current) return
        if (await win.isMinimized()) {
          await openMiniWindow()
          setNativeOpen(true)
        }
      }))

      // De volta ao app, a janelinha vira ruído: o que ela informava já está
      // na tela inteira na frente do usuário.
      unlisteners.push(await win.onFocusChanged(({ payload: focused }) => {
        if (disposed || !focused) return
        closeMiniWindow()
        setNativeOpen(false)
      }))
    })()

    return () => {
      disposed = true
      unlisteners.forEach(un => un?.())
    }
  }, [isRecording])

  // ── App nativo: estado para a janelinha, comandos de volta ──
  useEffect(() => {
    if (!isTauriApp()) return
    emitRecordingState({ isRecording, isPaused, startedAt, pausedMs, pausedAt })
  }, [isRecording, isPaused, startedAt, pausedMs, pausedAt])

  useEffect(() => {
    if (!isTauriApp()) return
    let unlisten = null
    let disposed = false
    listenRecordingCommands(action => {
      const { onPause: p, onResume: r, onStop: s } = handlersRef.current
      if (action === 'pause') p?.()
      else if (action === 'resume') r?.()
      else if (action === 'stop') s?.()
      else if (action === 'sync') emitRecordingState(stateRef.current)
      else if (action === 'close') {
        dismissedRef.current = true
        closeMiniWindow()
        setNativeOpen(false)
      }
    }).then(un => {
      if (disposed) un?.()
      else unlisten = un
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  return { supported, pipWindow, open, close, isOpen: isTauriApp() ? nativeOpen : !!pipWindow }
}

// A janela de picture-in-picture nasce com um documento vazio — sem isto o
// componente aparece lá dentro sem nenhum estilo. Folhas do mesmo domínio são
// copiadas regra a regra; as demais entram como <link>. O tema vem junto no
// atributo, senão a janelinha nasce clara com o app escuro.
function copyStyles(pip) {
  const theme = document.documentElement.getAttribute('data-theme')
  if (theme) pip.document.documentElement.setAttribute('data-theme', theme)

  for (const sheet of document.styleSheets) {
    try {
      const css = [...sheet.cssRules].map(rule => rule.cssText).join('')
      const style = pip.document.createElement('style')
      style.textContent = css
      pip.document.head.appendChild(style)
    } catch {
      if (!sheet.href) continue
      const link = pip.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      pip.document.head.appendChild(link)
    }
  }
  pip.document.body.classList.add('mini-body')
}
