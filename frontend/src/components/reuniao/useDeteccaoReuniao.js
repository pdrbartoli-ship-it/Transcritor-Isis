import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauriApp } from '../../lib/platform'
import { lerSaldoAtual } from '../../lib/api'
import { track } from '../../lib/analytics'
import { openMiniWindow } from '../../lib/miniRecorder'
import { abrirAviso, fecharAviso, emitirAviso, ouvirRespostas, prepararAviso } from '../../lib/avisoWindow'
import { pedirConvite } from '../../lib/conviteModal'
import {
  variantePorSaldo, montarConvite, montarAvisoSaldo, montarParouPorSaldo,
  tetoPorSaldo, SEM_SALDO_POR_DIA,
} from '../../lib/reuniao'
import { useGravacaoAtual } from '../../contexts/GravacaoContext'
import { useTranscricoes } from '../../contexts/TranscricoesContext'
import { modoRecomendado } from '../capture/modos'
import { extensionFor } from '../capture/useCapture'
import { formatTime } from '../capture/estimate'

// O cérebro da detecção de reunião. O Rust percebe que um Zoom, Teams ou Meet
// abriu o microfone; daqui para frente tudo é decisão de produto: se vale
// interromper, com que texto, e o que fazer com a resposta.
//
// Montado acima das rotas (ver ReuniaoContext), e não dentro do Layout: a home
// e as telas de conversa estão em ramos diferentes do roteador, e a cada troca
// de tela este hook perderia os ouvintes e a memória de quais reuniões já
// foram perguntadas. A janelinha de aviso é burra (ver pages/Aviso.jsx): quem
// decide é este hook.
// Quanto tempo o saldo lido continua valendo para decidir se vale interromper.
// Ler na hora custava de 0,3 a 1 s bem no instante em que a pessoa entra na
// chamada; neste intervalo o número não muda o bastante para mudar a decisão,
// e o teto da gravação continua saindo de uma leitura fresca (ver 'gravar').
const SALDO_VALE_POR_MS = 5 * 60 * 1000

export function useDeteccaoReuniao({ userId, convidado, avisar, abrirPlano }) {
  const gravacao = useGravacaoAtual()
  const { transcrever } = useTranscricoes()
  const navigate = useNavigate()
  const [disponivel, setDisponivel] = useState(false)

  // Os ouvintes são montados uma vez e precisam do valor de agora, não do que
  // valia quando foram montados.
  const atualRef = useRef({})
  atualRef.current = { userId, convidado, avisar, abrirPlano, gravacao, navigate, transcrever }

  // O último saldo lido, com a hora da leitura. Ver SALDO_VALE_POR_MS.
  const saldoRef = useRef({ valor: null, em: 0 })
  // A última gravação mandada para a fila por transcreverPendente.
  const enfileiradoRef = useRef(null)

  // O que está na janelinha agora, para responder ao `sync` que ela pede ao
  // nascer, e o que aquele aviso significa quando a resposta voltar.
  const pendenteRef = useRef(null)
  const estadoRef = useRef(null)
  // Reuniões já tratadas: uma vez respondida (ou ignorada), a mesma reunião
  // não pergunta de novo.
  const tratadasRef = useRef(new Set())

  // Em instaladores antigos o comando não existe: o site novo chega ao app
  // antes do executável novo, e sem esta pergunta a opção apareceria nas
  // Configurações sem fazer nada.
  useEffect(() => {
    if (!isTauriApp()) {
      // Fora do app nativo o interruptor não existe. Em desenvolvimento, uma
      // marca no navegador o faz aparecer: é o que permite conferir a tela de
      // Configurações sem Windows, junto com o __simularReuniao lá embaixo.
      if (import.meta.env.DEV) {
        try { setDisponivel(localStorage.getItem('dito-simular-detector') === '1') } catch { /* modo anônimo */ }
      }
      return
    }
    invoke('meeting_detection_available')
      .then(valor => setDisponivel(!!valor))
      .catch(() => setDisponivel(false))
  }, [])

  // "Abrir o Dito quando o Windows iniciar". Só existe no executável baixado
  // do site: lá, gravar o início com o Windows sem a pessoa pedir foi o que fez
  // o Defender barrar o instalador, então quem liga é ela (ver inicio.rs). Na
  // versão da Store o início acompanha o aviso e o Rust responde null. Num
  // executável antigo o comando nem existe, e o interruptor também some.
  const [iniciarComWindows, setIniciarComWindows] = useState(null)

  useEffect(() => {
    if (!disponivel) return
    // Com o detector simulado em desenvolvimento, o interruptor aparece como
    // no executável do site, para a tela poder ser conferida sem Windows.
    if (!isTauriApp()) {
      if (import.meta.env.DEV) setIniciarComWindows(false)
      return
    }
    invoke('start_with_windows_state')
      .then(valor => setIniciarComWindows(typeof valor === 'boolean' ? valor : null))
      .catch(() => setIniciarComWindows(null))
  }, [disponivel])

  // Com o detector ligado, a janelinha do aviso é criada escondida e o saldo é
  // relido de tempos em tempos. As duas coisas existem para o aviso aparecer
  // na hora: sem elas, a reunião começava e o Dito ainda estava carregando
  // uma página e consultando o banco.
  useEffect(() => {
    if (!disponivel || !avisar || convidado || !userId) return
    prepararAviso().catch(() => { /* sem janelinha pronta, ela nasce na hora */ })

    let vivo = true
    const reler = () => {
      lerSaldoAtual(userId)
        .then(saldo => { if (vivo) saldoRef.current = { valor: saldo, em: Date.now() } })
        .catch(() => { /* sem saldo lido, a decisão lê na hora */ })
    }
    reler()
    const id = setInterval(reler, SALDO_VALE_POR_MS)
    return () => { vivo = false; clearInterval(id) }
  }, [disponivel, avisar, convidado, userId])

  // A preferência manda no detector e no modo de bandeja: os dois são o mesmo
  // recurso para quem usa, e separá-los daria um detector que só funciona com
  // a janela aberta.
  useEffect(() => {
    if (!disponivel) return
    const ligado = !!avisar && !convidado
    // Desligado, o Rust apaga o início com o Windows junto: sem detector não
    // há o que abrir sozinho.
    if (!ligado) setIniciarComWindows(valor => (valor === null ? null : false))
    if (!isTauriApp()) return
    invoke('set_meeting_detection', { enabled: ligado }).catch(() => {})
    invoke('set_background_mode', { enabled: ligado }).catch(() => {})
  }, [avisar, convidado, disponivel])

  async function definirIniciarComWindows(ligado) {
    if (!isTauriApp()) {
      setIniciarComWindows(ligado)
      return
    }
    try {
      const ficou = await invoke('set_start_with_windows', { enabled: ligado })
      setIniciarComWindows(!!ficou)
    } catch {
      // O Windows recusou (uma política da empresa, por exemplo): o interruptor
      // continua mostrando o que vale de verdade.
    }
  }

  async function mostrarPrincipal() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const janela = getCurrentWindow()
      await janela.show()
      await janela.unminimize()
      await janela.setFocus()
    } catch {
      // Sem permissão ou fora do app nativo: nada a fazer, e nada quebra.
    }
  }

  async function mostrar(estado, opcoes) {
    estadoRef.current = estado
    await abrirAviso(estado, opcoes)
  }

  // Uma reunião detectada que não vira aviso deixava de existir: nenhum
  // registro dizia por que o Dito ficou calado, e o "não avisou" do usuário
  // não tinha como ser investigado. O motivo não leva título nem conteúdo.
  function calado(motivo) {
    track('reuniao_ignorada', { motivo })
    return null
  }

  // A gravação que ficou na tela de revisão, esperando o clique em
  // "Transcrever", vai para a fila sozinha quando uma reunião nova começa. É o
  // que o usuário pediu em 25/09/2026: entrar noutra reunião é sinal claro de
  // que a anterior acabou, e antes disso o aviso da nova simplesmente não
  // aparecia enquanto a anterior estivesse pendurada ali.
  //
  // O tipo de transcrição é o mesmo que o botão escolheria para aquela
  // duração, e o resultado aparece na lateral como qualquer outra.
  async function transcreverPendente() {
    const { gravacao: grav, transcrever: enfileirar } = atualRef.current
    if (!grav.recordedBlob) return
    // Duas detecções quase juntas (sair e voltar à chamada) chegam aqui antes
    // de o `resetRecording` da primeira ter sido aplicado, e a mesma gravação
    // iria duas vezes para a fila. O blob é a identidade: enfileirado uma vez,
    // não vai de novo.
    if (enfileiradoRef.current === grav.recordedBlob) return
    enfileiradoRef.current = grav.recordedBlob
    const duracao = grav.recordingTime
    const blob = grav.recordedBlob
    try {
      enfileirar({
        origem: 'record',
        modo: modoRecomendado({ origem: 'record', durationSec: duracao }),
        arquivo: new File([blob], `gravacao.${extensionFor(blob.type)}`, { type: blob.type }),
        duracaoS: duracao,
        rotulo: `Gravação de ${formatTime(duracao)}`,
      })
      grav.resetRecording()
      track('gravacao_pendente_enfileirada', { duracaoS: duracao })
    } catch {
      // Falhar aqui não pode impedir o aviso da reunião nova: a gravação
      // continua na revisão, como antes.
    }
  }

  // O saldo guardado, quando ainda vale; senão, uma leitura na hora. Devolve
  // null quando não dá para saber (rede fora, consulta recusada).
  async function saldoParaDecidir(uid) {
    const guardado = saldoRef.current
    if (guardado.valor && Date.now() - guardado.em < SALDO_VALE_POR_MS) return guardado.valor
    try {
      const saldo = await lerSaldoAtual(uid)
      saldoRef.current = { valor: saldo, em: Date.now() }
      return saldo
    } catch {
      return null
    }
  }

  // Decide se vale interromper. Devolve o aviso mostrado, ou null quando
  // decidimos ficar calados — é por esse retorno que a simulação de
  // desenvolvimento confere a decisão.
  async function tratarReuniao({ id, app }) {
    const { userId: uid, convidado: semConta, avisar: ligado, gravacao: grav } = atualRef.current
    if (!ligado || !uid || semConta) return calado('desligado')
    // Já gravando: a pessoa já sabe que o Dito está ali.
    if (grav.isRecording || grav.isFinalizing) return calado('ja-gravando')
    if (pendenteRef.current) return calado('aviso-aberto')
    if (tratadasRef.current.has(id)) return calado('ja-tratada')
    tratadasRef.current.add(id)

    // Uma gravação encerrada e ainda não transcrita (a tela de revisão aberta)
    // calava o aviso da reunião nova, e a pessoa só descobria isso ao voltar
    // ao computador. Agora a anterior vai para a fila sozinha e a pergunta
    // sai normalmente. Ver transcreverPendente.
    await transcreverPendente()

    // A vaga é reservada antes de ler o saldo: duas detecções seguidas (sair e
    // entrar na chamada) passavam juntas pela checagem acima enquanto a
    // leitura corria, e as duas tentavam abrir a mesma janela.
    const reserva = { tipo: 'lendo', reuniaoId: id }
    pendenteRef.current = reserva
    const desistir = motivo => {
      if (pendenteRef.current === reserva) pendenteRef.current = null
      return calado(motivo)
    }

    track('reuniao_detectada', { app })

    const saldo = await saldoParaDecidir(uid)
    if (!saldo) {
      // Sem saber o saldo não sugerimos: prometer uma gravação que o plano não
      // cobre é pior do que ficar calado.
      return desistir('saldo-ilegivel')
    }
    // A reunião acabou enquanto o saldo era lido: não há mais o que perguntar.
    if (pendenteRef.current !== reserva) return null

    const variante = variantePorSaldo(saldo.restanteMin)
    if (!variante) return desistir('saldo-ilegivel')
    if (variante === 'sem-saldo' && !podeAvisarSemSaldo()) return desistir('sem-saldo-hoje')

    const estado = montarConvite({ variante, app, restanteMin: saldo.restanteMin })
    pendenteRef.current = { tipo: 'convite', reuniaoId: id, variante, tetoS: tetoPorSaldo(saldo.restanteMin) }
    track('reuniao_aviso', { variante, app })
    await mostrar(estado)
    return estado
  }

  // Quem sai da chamada antes de responder não precisa mais da pergunta. Sem
  // isto o convite ficava na tela depois de a reunião acabar.
  async function tratarFim({ id }) {
    const pendente = pendenteRef.current
    if (!pendente || pendente.reuniaoId !== id) return
    pendenteRef.current = null
    estadoRef.current = null
    if (pendente.tipo === 'convite') {
      track('reuniao_resposta', { resposta: 'reuniao-acabou', variante: pendente.variante })
    }
    await fecharAviso()
  }

  async function tratarResposta(resposta) {
    // A janelinha pede o estado ao nascer: ela pode terminar de carregar
    // depois de a principal já ter emitido.
    if (resposta === 'sync') {
      if (estadoRef.current) emitirAviso(estadoRef.current)
      return
    }
    const pendente = pendenteRef.current
    pendenteRef.current = null
    estadoRef.current = null
    await fecharAviso()

    const { gravacao: grav, navigate: ir, abrirPlano: planos, userId: uid } = atualRef.current

    if (pendente?.tipo === 'convite') {
      track('reuniao_resposta', { resposta, variante: pendente.variante })
    }

    if (resposta === 'gravar') {
      // O teto sai de uma leitura FRESCA, e não do saldo guardado que decidiu
      // mostrar o aviso: é este número que faz a gravação parar antes de o
      // plano acabar, e errá-lo para mais devolve 402 quando a reunião já
      // acabou e a pessoa já esperou o upload.
      const saldo = uid ? await lerSaldoAtual(uid).catch(() => null) : null
      if (saldo) saldoRef.current = { valor: saldo, em: Date.now() }
      const tetoS = saldo ? tetoPorSaldo(saldo.restanteMin) : (pendente?.tetoS ?? null)
      // O saldo acabou entre o aviso e o clique (outro aparelho, ou o guardado
      // estava velho): gravar aqui seria prometer o que não cabe.
      if (saldo && !variantePorSaldo(saldo.restanteMin)) {
        track('reuniao_gravar_sem_saldo')
        await mostrarPrincipal()
        planos?.()
        return
      }
      // A tela inicial é a única que mostra a gravação e a revisão dela. E a
      // janelinha é aberta na mão porque o useMiniRecorder só a abre sozinho
      // ao MINIMIZAR — e a principal pode já estar minimizada ou escondida na
      // bandeja, que é o caso normal aqui.
      ir('/')
      await openMiniWindow()
      await grav.startRecording({ tetoS })
      return
    }
    if (resposta === 'planos') {
      await mostrarPrincipal()
      planos?.()
      return
    }
    // Sem saldo, o caminho que resolve na hora e de graça: cada amigo vale
    // mais minutos (ver lib/reuniao.js).
    if (resposta === 'convite') {
      track('convite_aberto', { origem: 'aviso-reuniao' })
      await mostrarPrincipal()
      ir('/')
      pedirConvite()
      return
    }
    if (resposta === 'abrir') {
      await mostrarPrincipal()
      ir('/')
    }
  }

  useEffect(() => {
    if (!isTauriApp()) return
    let disposed = false
    const soltar = []
    listen('meeting-started', evento => tratarReuniao(evento.payload || {}))
      .then(un => { if (disposed) un?.(); else soltar.push(un) })
    listen('meeting-ended', evento => tratarFim(evento.payload || {}))
      .then(un => { if (disposed) un?.(); else soltar.push(un) })
    return () => { disposed = true; soltar.forEach(un => un?.()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isTauriApp()) return
    let unlisten = null
    let disposed = false
    ouvirRespostas(resposta => tratarResposta(resposta))
      .then(un => { if (disposed) un?.(); else unlisten = un })
    return () => { disposed = true; unlisten?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Saldo acabando: aviso de passagem, sem botão. Fica acima da janelinha de
  // gravação, que mora no mesmo canto.
  const aviso = gravacao.avisoSaldo
  useEffect(() => {
    if (!aviso || !isTauriApp()) return
    pendenteRef.current = { tipo: 'passagem' }
    mostrar(montarAvisoSaldo(aviso.restantesS), { desviarDaJanelinha: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aviso?.seq])

  // A gravação parou sozinha no teto do saldo. O áudio está guardado e a tela
  // de revisão é a de sempre — o aviso existe para a pessoa não descobrir isso
  // só quando voltar ao computador.
  useEffect(() => {
    if (!gravacao.paradaPorSaldo || !isTauriApp()) return
    track('gravacao_parada_saldo')
    pendenteRef.current = { tipo: 'parou' }
    mostrar(montarParouPorSaldo())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravacao.paradaPorSaldo])

  // Fora do Windows não há detector, então a decisão inteira ficaria sem jeito
  // de ser exercitada. Com isto, o Playwright dispara o mesmo caminho de
  // `meeting-started` e confere saldo, variante e texto sem Rust nenhum.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__simularReuniao = async (payload = {}) => {
      // O saldo guardado é justamente o que a simulação NÃO quer: ela existe
      // para exercitar a decisão com o saldo que o teste montou, e o valor
      // guardado (lido da conta de verdade) passaria por cima dele.
      saldoRef.current = { valor: null, em: 0 }
      const reuniao = { ...payload, id: payload.id ?? Date.now(), app: payload.app || 'zoom' }
      const mostrado = await tratarReuniao(reuniao)
      // O `pendente` leva o teto calculado a partir do saldo — é o número que
      // o Rust recebe, e o único jeito de conferi-lo sem Windows.
      return mostrado ? { ...mostrado, pendente: pendenteRef.current } : null
    }
    window.__responderReuniao = resposta => tratarResposta(resposta)
    // Põe uma gravação na revisão e dispara uma reunião: é o caminho da
    // decisão de 25/09 (a anterior vai para a fila sozinha).
    window.__simularGravacaoPronta = segundos => atualRef.current.gravacao.__simularGravacaoPronta?.(segundos)
    window.__temGravacaoPendente = () => !!atualRef.current.gravacao.recordedBlob
    window.__simularFimReuniao = async id => {
      await tratarFim({ id })
      return pendenteRef.current
    }
    return () => {
      delete window.__simularReuniao
      delete window.__responderReuniao
      delete window.__simularGravacaoPronta
      delete window.__temGravacaoPendente
      delete window.__simularFimReuniao
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    disponivel,
    iniciarComWindows: convidado ? null : iniciarComWindows,
    definirIniciarComWindows,
  }
}

// O "sem saldo" é um bom momento de venda, e por isso mesmo não pode virar
// barulho: uma vez por dia, e a reunião seguinte passa em silêncio.
function podeAvisarSemSaldo() {
  const hoje = new Date().toISOString().slice(0, 10)
  try {
    const bruto = localStorage.getItem('dito-aviso-sem-saldo')
    const { dia, vezes } = bruto ? JSON.parse(bruto) : {}
    const contagem = dia === hoje ? vezes : 0
    if (contagem >= SEM_SALDO_POR_DIA) return false
    localStorage.setItem('dito-aviso-sem-saldo', JSON.stringify({ dia: hoje, vezes: contagem + 1 }))
    return true
  } catch {
    // Modo anônimo, armazenamento cheio: na dúvida, avisa.
    return true
  }
}
