import { useState, useEffect, useRef, useCallback } from 'react'
import MiniRecorder from '../components/recorder/MiniRecorder'
import { listenRecordingState, listenRecordingLevel, sendRecordingCommand } from '../lib/miniRecorder'
import { getTheme } from '../lib/prefs'

// O que roda DENTRO da janelinha do app nativo. Ela não grava nada e não fala
// com o Supabase nem com o backend: recebe o estado da janela principal e
// devolve cliques. Por isso fica fora das rotas protegidas — não há nada aqui
// que dependa de sessão.
export default function Mini() {
  const [state, setState] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const levelRef = useRef(0)
  const getLevel = useCallback(() => levelRef.current, [])

  // A janela nasce com o tema salvo; sem isto ela abriria clara em cima de um
  // app escuro.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', getTheme())
    document.body.classList.add('mini-body')
  }, [])

  useEffect(() => {
    let unlisten = null
    let disposed = false
    listenRecordingState(payload => setState(payload)).then(un => {
      if (disposed) un?.()
      else unlisten = un
    })
    // A principal só emite quando algo muda. Como esta janela costuma abrir
    // bem depois disso, ela pede o estado ao nascer em vez de esperar a
    // próxima mudança — que pode não vir tão cedo.
    sendRecordingCommand('sync')
    return () => { disposed = true; unlisten?.() }
  }, [])

  // O nível vem DIRETO do Rust, sem passar pela janela principal: ela está
  // minimizada quando esta aqui aparece, e retransmitir por ela faria a onda
  // engasgar junto com os timers estrangulados dela. Num ref, não em estado —
  // chega dez vezes por segundo, e a onda se desenha sozinha a partir dele.
  useEffect(() => {
    let unlisten = null
    let disposed = false
    listenRecordingLevel(value => { levelRef.current = value }).then(un => {
      if (disposed) un?.()
      else unlisten = un
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  // O relógio é calculado aqui, a partir dos instantes que vieram no estado. A
  // janela principal está minimizada quando esta aqui aparece, e o sistema
  // estrangula os timers dela — um contador vindo de lá atrasaria.
  useEffect(() => {
    if (!state?.startedAt) return
    const tick = () => {
      const until = state.pausedAt ?? Date.now()
      setSeconds(Math.max(0, Math.floor((until - state.startedAt - (state.pausedMs || 0)) / 1000)))
    }
    tick()
    if (state.pausedAt) return
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [state])

  return (
    <MiniRecorder
      seconds={seconds}
      paused={!!state?.pausedAt}
      getLevel={getLevel}
      nativeDrag
      onPause={() => sendRecordingCommand('pause')}
      onResume={() => sendRecordingCommand('resume')}
      onStop={() => sendRecordingCommand('stop')}
      onClose={() => sendRecordingCommand('close')}
    />
  )
}
