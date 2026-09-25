import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { readFile } from '@tauri-apps/plugin-fs'
import { isTauriApp } from '../../lib/platform'
import { lerSaldoAtual } from '../../lib/api'
import { tetoPorSaldo } from '../../lib/reuniao'
import { GravadorNativo, temGravadorNativo, lerGravacaoNativa } from '../../lib/gravadorNativo'

// A metade que GRAVA, separada da metade que envia (useCapture).
//
// A separação existe por um motivo concreto: o estado da gravação morava dentro
// do painel de captura, que vive na home. Abrir uma conversa da barra lateral
// desmontava o painel — o JS perdia o cronômetro e o blob, enquanto o Rust
// continuava gravando, e a gravação seguinte falhava com "já existe uma
// gravação em andamento". Numa reunião de uma hora isso deixa de ser raro.
// Montado no Layout (ver GravacaoProvider), nada disso depende mais de qual
// tela está aberta.
//
// São três gravações por trás do mesmo botão: dentro do app nativo
// (Windows/Tauri) é a captura WASAPI de sistema + microfone (src-tauri/audio);
// no app de celular é o gravador nativo (plugins/gravador), que continua com a
// tela travada; no navegador é getUserMedia + MediaRecorder, só microfone.
//
// `aoEncerrarDeFora` é chamado quando a gravação do celular acaba sem o botão
// do app: pela notificação, pelo fim do saldo, ou porque o app foi fechado no
// meio. Quem a chama leva a pessoa até a revisão.
export function useGravacao({ userId, convidado = false, aoEncerrarDeFora } = {}) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  // Entre "parei de gravar" e "a gravação está pronta" há um trabalho real:
  // fechar o arquivo, lê-lo do disco, montar o blob. Numa reunião de uma hora
  // isso leva alguns segundos, e sem este estado a tela voltava ao repouso
  // nesse intervalo — parecia que a gravação tinha se perdido.
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [erro, setErro] = useState(null)

  // Saldo acabando, durante a gravação. Vem do Rust (que conta as amostras
  // escritas) e sobe até quem desenha o aviso; o contador no fim garante que
  // dois avisos iguais seguidos ainda contem como dois eventos.
  const [avisoSaldo, setAvisoSaldo] = useState(null) // { restantesS, seq }
  // A gravação parou sozinha porque o saldo acabou. O áudio está guardado e a
  // tela de revisão é a mesma de sempre — o que muda é o aviso que aparece.
  const [paradaPorSaldo, setParadaPorSaldo] = useState(false)
  // Um recado neutro do gravador do celular, que não é erro: a ligação que
  // pausou a gravação, ou o app que fechou no meio dela.
  const [avisoGravacao, setAvisoGravacao] = useState(null)

  // A gravação em curso (ou a última) é a do gravador nativo do celular.
  const nativoRef = useRef(false)
  // O arquivo nativo já trazido para a tela. O fim da gravação chega por dois
  // caminhos (a resposta do encerrar e o evento "mudou"), e só um pode ler.
  const lidaRef = useRef(null)
  const lendoRef = useRef(false)
  const aoEncerrarDeForaRef = useRef(aoEncerrarDeFora)
  aoEncerrarDeForaRef.current = aoEncerrarDeFora

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const unlistenWarningRef = useRef(null)
  const unlistenLimitRef = useRef(null)

  // O cronômetro contava +1 por tick de setInterval. Isso funciona enquanto a
  // janela está na frente e quebra exatamente quando ela não está: minimizada
  // (ou em aba de fundo) o navegador estrangula os timers, e a gravação
  // aparecia com metade do tempo que tinha de verdade. Guardando os instantes
  // e derivando o tempo de Date.now(), um tick atrasado só se corrige sozinho
  // no tick seguinte — e é o mesmo cálculo que a janelinha flutuante usa.
  const startedAtRef = useRef(null)
  const pausedMsRef = useRef(0)
  const pausedAtRef = useRef(null)

  // Nível do áudio, 0..1 — é o que faz a onda da janelinha reagir ao que está
  // sendo dito em vez de pulsar sozinha. Uma onda decorativa mente: ela diz
  // "estou captando" mesmo com o microfone mudo, que é justamente quando o
  // usuário mais precisa saber a verdade.
  //
  // Fica num ref, e não em estado: isto muda dezenas de vezes por segundo, e
  // como estado arrastaria a árvore inteira do painel de captura junto a cada
  // quadro. Quem desenha a onda lê daqui no próprio ritmo (ver MiniRecorder).
  const levelRef = useRef(0)
  // O maior nível visto na gravação inteira. É o que separa "gravou baixinho"
  // de "não gravou nada": em cima de silêncio puro o Whisper inventa frases, e
  // era daí que saía a conversa transcrita como "Thank you. Thank you.".
  const picoRef = useRef(0)
  const audioCtxRef = useRef(null)
  const levelRafRef = useRef(null)
  const unlistenLevelRef = useRef(null)
  const getLevel = useCallback(() => levelRef.current, [])

  function elapsedSeconds() {
    if (!startedAtRef.current) return 0
    const until = pausedAtRef.current ?? Date.now()
    return Math.max(0, Math.floor((until - startedAtRef.current - pausedMsRef.current) / 1000))
  }

  function startTimer() {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setRecordingTime(elapsedSeconds()), 500)
  }

  // No navegador o nível sai do próprio stream do microfone, por um analisador
  // do Web Audio. O pico da janela é mais legível que a média: fala normal tem
  // muito silêncio entre as sílabas, e a média deixaria a onda quase parada.
  function startLevelMeter(stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const analyser = ctx.createAnalyser()
      // 2048 amostras ≈ 43ms a 48kHz. Com os 512 de antes cada leitura via só
      // ~10ms, e como elas acontecem a cada 50ms, quatro quintos do áudio —
      // picos de sílaba inclusive — passavam sem ser vistos.
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)
      audioCtxRef.current = ctx

      const buffer = new Uint8Array(analyser.frequencyBinCount)
      // setInterval, e não requestAnimationFrame: o rAF da janela principal é
      // congelado pelo navegador quando ela é minimizada — exatamente quando a
      // janelinha existe para ser olhada. O intervalo é estrangulado nesse
      // estado, mas não para, e quem desenha a onda amostra no ritmo da PRÓPRIA
      // janela (que está visível), então a leitura continua chegando.
      const read = () => {
        // Pausado, o microfone continua aberto e o analisador continua ouvindo
        // a sala — mas nada disso está sendo gravado, então a onda tem de
        // ficar parada. Reportar o nível real aqui seria mentir ao contrário.
        if (pausedAtRef.current) {
          levelRef.current = 0
          return
        }
        analyser.getByteTimeDomainData(buffer)
        let peak = 0
        for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128) / 128)
        levelRef.current = peak
        picoRef.current = Math.max(picoRef.current, peak)
      }
      read()
      levelRafRef.current = setInterval(read, 40)
    } catch {
      // Sem medidor a gravação continua igual; só a onda fica parada.
    }
  }

  function stopLevelMeter() {
    clearInterval(levelRafRef.current)
    levelRafRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    unlistenLevelRef.current?.()
    unlistenLevelRef.current = null
    levelRef.current = 0
  }

  function soltarOuvintes() {
    unlistenWarningRef.current?.()
    unlistenWarningRef.current = null
    unlistenLimitRef.current?.()
    unlistenLimitRef.current = null
  }

  // Este desmonte é o do provedor, ou seja, o fim do app: antes ele acontecia
  // a cada troca de tela, e era ele que matava a gravação de quem só queria
  // abrir uma conversa no meio de uma reunião.
  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    stopLevelMeter()
    soltarOuvintes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // O gravador do celular vive fora da página: grava com ela congelada, pode
  // ser pausado por uma ligação ou encerrado pela notificação, e sobrevive ao
  // app fechado. A tela confere o estado dele ao abrir e a cada volta ao
  // primeiro plano, e escuta o que muda enquanto está à vista.
  //
  // Não há nada a parar no desmonte: sair da página não pode encerrar a
  // gravação, é justamente o que ela veio resolver.
  const aplicarNativoRef = useRef(null)
  useEffect(() => {
    if (!temGravadorNativo()) return undefined
    let vivo = true
    const alcas = []
    const guardar = p => p.then(h => (vivo ? alcas.push(h) : h.remove())).catch(() => {})
    guardar(GravadorNativo.addListener('nivel', e => { levelRef.current = e?.nivel || 0 }))
    guardar(GravadorNativo.addListener('mudou', e => aplicarNativoRef.current?.(e)))
    const conferir = () => {
      if (document.visibilityState !== 'visible') return
      GravadorNativo.estado().then(e => vivo && aplicarNativoRef.current?.(e)).catch(() => {})
    }
    conferir()
    document.addEventListener('visibilitychange', conferir)
    return () => {
      vivo = false
      alcas.forEach(h => h.remove())
      document.removeEventListener('visibilitychange', conferir)
    }
  }, [])

  function resetRecording() {
    setRecordedBlob(null)
    setRecordingTime(0)
    setIsRecording(false)
    setIsPaused(false)
    setIsFinalizing(false)
    setParadaPorSaldo(false)
    setAvisoSaldo(null)
    setAvisoGravacao(null)
    startedAtRef.current = null
    pausedMsRef.current = 0
    pausedAtRef.current = null
    chunksRef.current = []
    // O áudio já está em memória (ou foi descartado): o arquivo do aparelho
    // não serve mais para nada.
    if (lidaRef.current) {
      lidaRef.current = null
      GravadorNativo.descartar().catch(() => {})
    }
    nativoRef.current = false
  }

  // O que o gravador do celular diz vira o estado da tela. Serve para a
  // resposta de cada chamada, para o evento "mudou" e para a conferência na
  // volta ao app. O relógio é realinhado pela duração que o aparelho mediu:
  // com a página congelada, o da tela pode ter ficado para trás.
  async function aplicarNativo(s) {
    if (!s?.estado) return
    if (s.estado === 'gravando' || s.estado === 'pausado') {
      nativoRef.current = true
      const pausado = s.estado === 'pausado'
      startedAtRef.current = Date.now() - (s.duracaoMs || 0)
      pausedMsRef.current = 0
      pausedAtRef.current = pausado ? Date.now() : null
      setIsRecording(true)
      setIsPaused(pausado)
      setIsFinalizing(false)
      setRecordingTime(elapsedSeconds())
      setAvisoGravacao(pausado && s.motivo === 'ligacao' ? AVISO_LIGACAO : null)
      if (pausado) clearInterval(timerRef.current)
      else startTimer()
      return
    }
    if (s.estado === 'encerrado') {
      await receberEncerrada(s)
      return
    }
    // "parado" com a tela achando que grava: o aparelho perdeu a gravação
    // (o arquivo sumiu junto com o app). Melhor dizer do que fingir.
    if (nativoRef.current && isRecording) {
      clearInterval(timerRef.current)
      levelRef.current = 0
      setIsRecording(false)
      setIsPaused(false)
      nativoRef.current = false
      setErro('A gravação foi interrompida e não havia áudio guardado. Tente gravar de novo.')
    }
  }
  aplicarNativoRef.current = aplicarNativo

  // Devolve se foi esta chamada que trouxe o arquivo.
  async function receberEncerrada(s) {
    if (!s.caminho || lidaRef.current === s.caminho) return false
    lidaRef.current = s.caminho
    nativoRef.current = true
    const segundos = Math.floor((s.duracaoMs || 0) / 1000)
    clearInterval(timerRef.current)
    levelRef.current = 0
    startedAtRef.current = null
    setIsRecording(false)
    setIsPaused(false)
    setIsFinalizing(true)
    setRecordingTime(segundos)
    setAvisoGravacao(AVISO_DO_FIM[s.motivo] || null)
    if (s.motivo === 'limite') setParadaPorSaldo(true)
    if (s.motivo && s.motivo !== 'voce') aoEncerrarDeForaRef.current?.()

    if (!s.teveSom && segundos >= MIN_S_PARA_ACUSAR_SILENCIO) {
      setIsFinalizing(false)
      setAvisoGravacao(null)
      setErro(SEM_SOM_CELULAR)
      lidaRef.current = null
      GravadorNativo.descartar().catch(() => {})
      return true
    }
    lendoRef.current = true
    try {
      setRecordedBlob(await lerGravacaoNativa(s))
    } catch {
      // O arquivo continua no aparelho; a próxima volta ao app tenta de novo.
      lidaRef.current = null
      setErro('Não foi possível abrir a gravação. Feche e abra o Dito para tentar de novo.')
    } finally {
      lendoRef.current = false
      setIsFinalizing(false)
    }
    return true
  }

  function beginTiming() {
    startedAtRef.current = Date.now()
    pausedMsRef.current = 0
    pausedAtRef.current = null
    setRecordingTime(0)
    startTimer()
  }

  // Pausar no app nativo é o Rust parando de escrever no .wav (os dispositivos
  // seguem abertos); no navegador é o próprio MediaRecorder. Nos dois casos o
  // relógio para junto, senão o tempo mostrado não seria o tempo do áudio.
  async function pauseRecording() {
    if (!isRecording || pausedAtRef.current) return
    try {
      if (isTauriApp()) {
        await invoke('set_recording_paused', { paused: true })
      } else if (nativoRef.current) {
        await GravadorNativo.pausar()
      } else if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.pause()
      }
    } catch (err) {
      setErro(typeof err === 'string' ? err : err?.message || 'Não foi possível pausar a gravação.')
      return
    }
    pausedAtRef.current = Date.now()
    setIsPaused(true)
    setRecordingTime(elapsedSeconds())
  }

  async function resumeRecording() {
    if (!isRecording || !pausedAtRef.current) return
    try {
      if (isTauriApp()) {
        await invoke('set_recording_paused', { paused: false })
      } else if (nativoRef.current) {
        await GravadorNativo.retomar()
      } else if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume()
      }
    } catch (err) {
      setErro(typeof err === 'string' ? err : err?.message || 'Não foi possível retomar a gravação.')
      return
    }
    pausedMsRef.current += Date.now() - pausedAtRef.current
    pausedAtRef.current = null
    setIsPaused(false)
    setAvisoGravacao(null)
    startTimer()
  }

  // Quanto tempo esta gravação pode durar sem estourar o saldo do mês. O
  // backend só recusa no FIM, medindo a duração do arquivo: sem teto, uma
  // reunião de duas horas com meia hora de saldo terminava em 402 depois do
  // upload, com o áudio já gravado e a espera já paga.
  //
  // Saldo ilegível (sem rede, Supabase fora) grava SEM teto, de propósito:
  // falha do contador não pode virar recurso que não funciona.
  async function tetoDaGravacao() {
    if (!userId || convidado) return null
    try {
      const { restanteMin } = await lerSaldoAtual(userId)
      return tetoPorSaldo(restanteMin)
    } catch {
      return null
    }
  }

  // stopRecording muda de identidade a cada render, e o ouvinte do limite é
  // montado uma vez só — sem o ref ele pararia uma gravação já antiga.
  const stopRef = useRef(null)

  async function ouvirLimites() {
    unlistenLimitRef.current = await listen('recording-limit-warning', event => {
      const restantesS = event.payload?.remaining_s ?? event.payload?.remainingS
      if (restantesS == null) return
      setAvisoSaldo(anterior => ({ restantesS, seq: (anterior?.seq || 0) + 1 }))
    })
    const unlistenReached = await listen('recording-limit-reached', () => {
      // O Rust já parou de escrever no .wav; aqui fechamos a gravação pelo
      // mesmo caminho do botão de parar, para o áudio virar blob e cair na
      // tela de revisão como qualquer outra gravação.
      setParadaPorSaldo(true)
      stopRef.current?.()
    })
    const anterior = unlistenLimitRef.current
    unlistenLimitRef.current = () => { anterior?.(); unlistenReached?.() }
  }

  // `opcoes.tetoS` deixa quem já leu o saldo (o convite de reunião) não ler de
  // novo. A checagem por chave é o que mantém a função à prova de ser passada
  // direto para um onClick, onde o argumento seria o evento do React.
  async function startRecording(opcoes) {
    const tetoInformado = opcoes && typeof opcoes === 'object' && 'tetoS' in opcoes
    setErro(null)
    resetRecording()
    picoRef.current = 0

    if (isTauriApp()) {
      try {
        const tetoS = tetoInformado ? opcoes.tetoS : await tetoDaGravacao()
        unlistenWarningRef.current = await listen('recording-warning', event => {
          setErro(event.payload)
        })
        await ouvirLimites()
        // O Tauri 2 converte camelCase para snake_case do lado do Rust.
        await invoke('start_recording', { maxSeconds: tetoS ?? null })
        // No app nativo quem mede o nível é o Rust, que já tem as amostras
        // mixadas na mão — o JS aqui não vê o áudio em momento nenhum.
        unlistenLevelRef.current = await listen('recording-level', e => { levelRef.current = e.payload || 0 })
        setIsRecording(true)
        beginTiming()
        return true
      } catch (err) {
        soltarOuvintes()
        setErro(typeof err === 'string' ? err : 'Não foi possível iniciar a gravação.')
        return false
      }
    }

    if (temGravadorNativo()) {
      try {
        const tetoS = tetoInformado ? opcoes.tetoS : await tetoDaGravacao()
        const s = await GravadorNativo.iniciar({ maxSegundos: tetoS ?? 0 })
        await aplicarNativo(s)
        return true
      } catch (err) {
        setErro(err?.message || 'Não foi possível iniciar a gravação.')
        return false
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: RECORDING_CONSTRAINTS })
      const recorder = new MediaRecorder(stream, recorderOptions())
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timerRef.current)
        stopLevelMeter()
        setIsFinalizing(false)
        // Microfone mudo (abafado, desligado na tecla do headset, entrada
        // errada) grava um arquivo de silêncio, e silêncio faz o Whisper
        // inventar frase. Melhor dizer que não entrou som do que devolver uma
        // transcrição que ninguém falou.
        if (picoRef.current < PICO_SILENCIO && elapsedSeconds() >= MIN_S_PARA_ACUSAR_SILENCIO) {
          setErro(SEM_SOM)
          return
        }
        // O tipo sai do próprio gravador: fixar 'audio/webm' aqui rotulava
        // errado o arquivo no Safari/Firefox, onde o container é ogg.
        setRecordedBlob(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
      }
      // Com fatia de tempo o áudio chega em pedaços ao longo da gravação, em
      // vez de um único blob gigante materializado só no stop. Numa reunião
      // longa é a diferença entre um encerramento instantâneo e vários
      // segundos de tela parada.
      recorder.start(RECORDER_TIMESLICE_MS)
      setIsRecording(true)
      beginTiming()
      startLevelMeter(stream)
      return true
    } catch (err) {
      setErro(micErrorMessage(err))
      return false
    }
  }

  async function stopRecording() {
    // O tempo final é fixado ANTES de parar o relógio: `recordingTime` é o que
    // alimenta a estimativa de processamento mais adiante, e um último tick
    // que não chegasse a rodar deixaria a gravação com alguns segundos a menos.
    const finalSeconds = elapsedSeconds()

    if (isTauriApp()) {
      setIsRecording(false)
      setIsPaused(false)
      setIsFinalizing(true)
      setRecordingTime(finalSeconds)
      clearInterval(timerRef.current)
      stopLevelMeter()
      soltarOuvintes()
      try {
        const fim = await invoke('stop_recording')
        // Instaladores antigos devolvem só o caminho, em vez do objeto: o site
        // novo chega ao app antes do executável novo, e por um tempo os dois
        // convivem.
        const caminho = typeof fim === 'string' ? fim : fim.caminho
        const teveSom = typeof fim === 'string' ? true : fim.teve_som !== false
        if (!teveSom && finalSeconds >= MIN_S_PARA_ACUSAR_SILENCIO) {
          setErro(SEM_SOM)
          return
        }
        const bytes = await readFile(caminho)
        setRecordedBlob(new Blob([bytes], { type: 'audio/wav' }))
      } catch (err) {
        setErro(typeof err === 'string' ? err : 'Não foi possível finalizar a gravação.')
      } finally {
        setIsFinalizing(false)
      }
      return
    }

    if (nativoRef.current) {
      setIsRecording(false)
      setIsPaused(false)
      setIsFinalizing(true)
      setRecordingTime(finalSeconds)
      clearInterval(timerRef.current)
      try {
        const trouxe = await receberEncerrada(await GravadorNativo.encerrar())
        // O evento "mudou" chegou antes e já está lendo o arquivo: o
        // "finalizando" é dele desligar.
        if (!trouxe && !lendoRef.current) setIsFinalizing(false)
      } catch (err) {
        setIsFinalizing(false)
        setErro(err?.message || 'Não foi possível finalizar a gravação.')
      }
      return
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      // `onstop` desliga o "finalizando"; sem gravador ativo não há o que
      // finalizar, e ligá-lo aqui deixaria a tela presa nesse estado.
      setIsFinalizing(true)
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    setIsPaused(false)
    setRecordingTime(finalSeconds)
    clearInterval(timerRef.current)
  }
  stopRef.current = stopRecording

  return {
    isRecording, isPaused, isFinalizing, recordedBlob, recordingTime, getLevel,
    erro, setErro,
    avisoSaldo, paradaPorSaldo, avisoGravacao,
    // Os instantes crus vazam de propósito: a janelinha flutuante calcula o
    // relógio dela a partir deles, em vez de receber um contador que atrasa
    // junto com os timers da janela minimizada.
    startedAt: startedAtRef.current,
    pausedMs: pausedMsRef.current,
    pausedAt: pausedAtRef.current,
    startRecording, stopRecording, resetRecording,
    pauseRecording, resumeRecording,
    // Só em desenvolvimento: põe uma gravação na tela de revisão sem gravar
    // nada, para o teste exercitar o que acontece quando uma reunião nova
    // começa com ela pendurada ali (ver useDeteccaoReuniao).
    ...(import.meta.env.DEV ? { __simularGravacaoPronta: (segundos = 90) => {
      setRecordedBlob(new Blob(['x'], { type: 'audio/webm' }))
      setRecordingTime(segundos)
    } } : {}),
  }
}

// Uma reunião é fala, não música: 32 kbps em Opus mono já entrega tudo que o
// Whisper precisa ouvir. O padrão do MediaRecorder (~128 kbps estéreo) fazia
// uma hora de reunião pesar ~57 MB sem transcrever nada melhor — e 8 horas
// estourariam qualquer teto de upload.
// Abaixo deste pico a gravação inteira foi silêncio digital: nem o rumor da
// sala entrou. Não é "gravou baixinho", é "não gravou". Vale para o medidor do
// navegador; no app nativo quem decide isso é o Rust, com as amostras na mão.
const PICO_SILENCIO = 0.004

// Abaixo disto não há evidência suficiente para acusar silêncio: numa
// gravação de um segundo o medidor pode não ter visto nem uma sílaba, e
// recusar uma gravação boa é pior que deixar passar um clipe mudo de um
// segundo. O estrago que motivou tudo isto (uma reunião inteira transcrita
// como "Thank you.") vive bem acima deste limite.
const MIN_S_PARA_ACUSAR_SILENCIO = 2

const SEM_SOM = 'Não entrou som nenhum nesta gravação. Confira se o microfone certo está escolhido no Windows e se ele não está no mudo, e tente de novo.'

const SEM_SOM_CELULAR = 'Não entrou som nenhum nesta gravação. Confira se outro app, como uma ligação, não estava usando o microfone, e tente de novo.'

const AVISO_LIGACAO = 'Uma ligação pausou a gravação.'

// Como a gravação do celular acabou, quando não foi pelo botão do app. O fim
// pela notificação dispensa recado: foi a própria pessoa.
const AVISO_DO_FIM = {
  interrompida: 'O Dito fechou no meio da gravação. O que foi gravado até ali está guardado.',
  erro: 'A gravação parou sozinha. O que foi gravado até ali está guardado.',
  limite: 'A gravação parou quando seus minutos do mês acabaram.',
}

const RECORDING_BITS_PER_SECOND = 32_000

// Um canal, na taxa que o Whisper usa. Pedir estéreo em 48 kHz era gravar o
// dobro de dados para depois jogar metade fora no servidor.
const RECORDING_CONSTRAINTS = { channelCount: 1, sampleRate: 16_000 }

// De quanto em quanto tempo o MediaRecorder entrega um pedaço.
const RECORDER_TIMESLICE_MS = 5000

// Em ordem de preferência. Chrome/Edge/Android ficam no primeiro; Safari e
// Firefox caem no ogg. Se nenhum for suportado, `undefined` deixa o navegador
// escolher — melhor gravar num formato qualquer do que não gravar.
const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function recorderOptions() {
  const options = { audioBitsPerSecond: RECORDING_BITS_PER_SECOND }
  try {
    const supported = RECORDING_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t))
    if (supported) options.mimeType = supported
  } catch {
    // Navegador sem isTypeSupported: segue com a escolha dele.
  }
  return options
}

// O `catch` genérico de antes dizia sempre "verifique as permissões do
// navegador", mesmo quando o problema era outro. Os nomes de erro do
// getUserMedia são padronizados, então dá para ser específico.
function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Acesso ao microfone negado. Autorize o microfone nas permissões e tente de novo.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado neste aparelho.'
    case 'NotReadableError':
      return 'O microfone está em uso por outro aplicativo. Feche-o e tente de novo.'
    default:
      return 'Não foi possível acessar o microfone. Verifique as permissões e tente de novo.'
  }
}
