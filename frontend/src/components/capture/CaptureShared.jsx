import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { formatTime } from './estimate'
import { MODOS, MODO_SIMPLES, MODO_COMPLETA, modoRecomendado } from './modos'
import SemSaldo from '../SemSaldo'
import { planoPorId } from '../../lib/planos'
import { duracaoDoLink } from '../../lib/api'
import { useIsTouchInput } from '../../lib/platform'
import { perceptual } from '../recorder/MiniRecorder'
import { IconPause, IconPlay, IconPopOut, IconCaretDown, IconFile, IconLock } from '../Icons'

// Peças visuais idênticas nas duas plataformas. O que diverge (arrastar
// arquivo, textos do microfone, tamanho dos alvos de toque) fica em
// CaptureWeb/CaptureNative; o que não diverge fica aqui.

// Um círculo pulsando e uma linha, e nada mais.
//
// Aqui já houve um contador regressivo, um "acordando o servidor…", um aviso de
// hibernação e um pedido para não fechar a tela. Cada um deles era verdade, e
// juntos diziam a mesma coisa quatro vezes com cara de problema: quem só queria
// a transcrição lia uma tela de erro em andamento. O que a pessoa precisa saber
// enquanto espera é que o Dito está trabalhando — o resto é ruído.
//
// O círculo tem o mesmo diâmetro do botão de gravar (var(--record-btn) no
// CSS): é o que faz a troca de "gravando" para "processando" continuar no
// mesmo lugar, em vez de a tela pular de um alvo redondo grande para uma
// caixa retangular pequena flutuando no meio do vazio — que era o "estranho".
export function ProcessingBox({ titulo = 'Transcrevendo e resumindo…' }) {
  return (
    <div className="hero-record">
      <div className="processing-orb">
        <span className="processing-ring" />
        <span className="spinner" />
      </div>
      <p className="processing-title">{titulo}</p>
    </div>
  )
}

// Minutos que uma captura consome do mês. Arredonda para o mais próximo — é a
// duração que a pessoa reconhece —, mas nunca abaixo de 1: um áudio de 20 s
// escrito "0 min" leria como de graça.
export function minutosDaCaptura(duracaoSec) {
  return duracaoSec > 0 ? Math.max(1, Math.round(duracaoSec / 60)) : null
}

// Botão de transcrever com a lista das duas profundidades pendurada nele.
//
// É um botão dividido, não um menu: a metade grande já executa a opção
// recomendada — que é a certa na maioria das vezes — e a setinha existe para as
// outras. Um menu puro cobraria dois cliques de todo mundo para trocar de
// opinião de vez em quando.
//
// `recomendado` vem de fora e muda conforme o que está para ser enviado (a
// duração da gravação, o arquivo escolhido, a origem). Quando muda, a seleção
// acompanha: o usuário ainda não escolheu nada, e manter a escolha anterior
// significaria mandar uma reunião de uma hora no resumo curto porque o teste
// anterior era um áudio de dois minutos.
//
// `duracaoSec` põe no próprio botão quanto a captura vai consumir. Foi a
// escolha no lugar de um "Consumir X minutos?" antes do envio: a mesma
// informação, sem cobrar um clique a mais de quem já decidiu.
export function TranscribeButton(props) {
  // No celular o botão dividido vira as duas opções à vista: a setinha era
  // menor que o dedo, e uma lista pendurada num botão é peça de computador.
  const toque = useIsTouchInput()
  return toque ? <EscolhaDeTranscricao {...props} /> : <BotaoDividido {...props} />
}

function BotaoDividido({ recomendado = MODO_COMPLETA, duracaoSec = null, onSubmit, loading, conferindo, disabled }) {
  // O plano vem do Layout. Enquanto não chega, nada fica trancado: quem paga
  // não pode ver um cadeado piscando, e o backend atende como simples quem
  // pedir a completa sem ter direito a ela.
  const { plano, abrirPlano } = useOutletContext() || {}
  const completaLiberada = !plano || planoPorId(plano).completa
  const sugerido = completaLiberada ? recomendado : MODO_SIMPLES

  const [modo, setModo] = useState(sugerido)
  const [aberto, setAberto] = useState(false)
  const caixaRef = useRef(null)

  useEffect(() => { setModo(sugerido) }, [sugerido])

  // Fechar clicando fora e no Esc: sem isso a lista fica pendurada na tela
  // depois que a pessoa desiste dela, cobrindo o resto do painel.
  useEffect(() => {
    if (!aberto) return
    const foraDaCaixa = e => { if (!caixaRef.current?.contains(e.target)) setAberto(false) }
    const escapou = e => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', foraDaCaixa)
    document.addEventListener('keydown', escapou)
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa)
      document.removeEventListener('keydown', escapou)
    }
  }, [aberto])

  const travado = disabled || loading || conferindo
  const minutos = minutosDaCaptura(duracaoSec)

  return (
    <div className="split-btn" ref={caixaRef}>
      <button
        type="button"
        className="split-main"
        onClick={() => onSubmit(modo)}
        disabled={travado}
      >
        {loading
          ? <><span className="spinner spinner-sm" /> Processando…</>
          : conferindo
          ? <><span className="spinner spinner-sm" /> Conferindo o saldo…</>
          : <>{MODOS[modo].label}{minutos && <span className="split-minutos"> · {minutos} min</span>}</>}
      </button>
      <button
        type="button"
        className="split-toggle"
        onClick={() => setAberto(a => !a)}
        disabled={travado}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label="Escolher o tipo de transcrição"
      >
        <IconCaretDown width={15} height={15} />
      </button>

      {aberto && (
        <ul className="split-menu" role="listbox" aria-label="Tipo de transcrição">
          {[MODO_SIMPLES, MODO_COMPLETA].map(m => {
            const travada = m === MODO_COMPLETA && !completaLiberada
            return (
              <li key={m}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m === modo}
                  // Sem aria-disabled: a opção trancada FAZ algo (abre os
                  // planos), e anunciá-la como desabilitada mentiria para quem
                  // usa leitor de tela. O "Planos pagos" do selo já está no nome.
                  className={[m === modo && 'on', travada && 'travada'].filter(Boolean).join(' ')}
                  // Onde o app não vende (iPhone) não há planos para abrir, e
                  // a opção trancada ficaria respondendo ao clique com nada.
                  disabled={travada && !abrirPlano}
                  onClick={() => {
                    setAberto(false)
                    // Trancada não é parede: o clique leva aos planos, que é
                    // onde ela se destrava, e a explicação do que ela entrega
                    // já está logo abaixo do nome.
                    if (travada) { abrirPlano?.(); return }
                    setModo(m)
                  }}
                >
                  <span className="split-menu-head">
                    <span className="split-menu-label">{MODOS[m].label}</span>
                    {travada
                      ? <span className="split-badge pago"><IconLock width={11} height={11} /> Planos pagos</span>
                      : m === sugerido && <span className="split-badge">Recomendada</span>}
                  </span>
                  <span className="split-menu-hint">{MODOS[m].hint}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// A escolha à vista, para o celular: as duas opções lado a lado, uma linha
// dizendo o que a escolhida entrega, e o botão de transcrever na largura toda,
// no lugar do botão dividido. Um toque só para quem aceita a recomendação,
// como antes.
function EscolhaDeTranscricao({ recomendado = MODO_COMPLETA, duracaoSec = null, onSubmit, conferindo, disabled }) {
  const { plano, abrirPlano } = useOutletContext() || {}
  const completaLiberada = !plano || planoPorId(plano).completa
  const sugerido = completaLiberada ? recomendado : MODO_SIMPLES
  const [modo, setModo] = useState(sugerido)
  useEffect(() => { setModo(sugerido) }, [sugerido])
  const minutos = minutosDaCaptura(duracaoSec)

  return (
    <div className="escolha-transcricao">
      <div className="escolha-opcoes" role="radiogroup" aria-label="Tipo de transcrição">
        {[MODO_SIMPLES, MODO_COMPLETA].map(m => {
          const trancada = m === MODO_COMPLETA && !completaLiberada
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === modo}
              className={`escolha-opcao ${m === modo ? 'on' : ''} ${trancada ? 'trancada' : ''}`}
              // No iPhone não há planos para abrir: a opção fica visível, mas
              // não finge que responde ao toque.
              disabled={trancada && !abrirPlano}
              onClick={() => {
                if (trancada) { abrirPlano?.(); return }
                setModo(m)
              }}
            >
              {trancada && <IconLock width={13} height={13} />}
              {m === MODO_SIMPLES ? 'Simples' : 'Completa'}
            </button>
          )
        })}
      </div>
      <p className="escolha-dica">
        {MODOS[modo].hint}
        {!completaLiberada && ' A completa está nos planos pagos.'}
      </p>
      <button
        type="button"
        className="btn-primary escolha-enviar"
        onClick={() => onSubmit(modo)}
        disabled={disabled || conferindo}
      >
        {conferindo
          ? <><span className="spinner spinner-sm" /> Conferindo o saldo…</>
          : <>Transcrever{minutos && <span className="split-minutos"> · {minutos} min</span>}</>}
      </button>
    </div>
  )
}

// Jogar uma gravação fora não tem volta: o primeiro toque pergunta, e só o
// segundo descarta. Antes "Regravar" apagava a reunião com um toque só, ao
// lado do botão de transcrever.
function BotaoDescartar({ onConfirmar, disabled }) {
  const [perguntando, setPerguntando] = useState(false)
  useEffect(() => {
    if (!perguntando) return
    const timer = setTimeout(() => setPerguntando(false), 5000)
    return () => clearTimeout(timer)
  }, [perguntando])

  if (perguntando) {
    return (
      <p className="descartar-pergunta">
        Descartar esta gravação?
        <button type="button" className="btn-link perigo" onClick={onConfirmar}>Descartar</button>
        <button type="button" className="btn-link" onClick={() => setPerguntando(false)}>Manter</button>
      </p>
    )
  }
  return (
    <button type="button" className="btn-link discreto" onClick={() => setPerguntando(true)} disabled={disabled}>
      Descartar
    </button>
  )
}

// A onda da voz na tela de gravar: o histórico do nível do microfone, da
// esquerda para a direita, como no gravador do celular. Lê o mesmo nível da
// janelinha flutuante, e pelo mesmo motivo não é uma animação em laço: em
// silêncio ela fica parada, e é assim que se percebe um microfone mudo.
const BARRAS_DA_ONDA = 28
const PASSO_DA_ONDA_MS = 70

export function Onda({ getLevel, paused }) {
  const barras = useRef([])
  useEffect(() => {
    const historico = new Array(BARRAS_DA_ONDA).fill(0)
    let mostrado = 0
    // setInterval, e não requestAnimationFrame: o quadro de animação para
    // quando a janela sai da frente, e a onda voltaria parada no tempo.
    const timer = setInterval(() => {
      const alvo = paused ? 0 : perceptual(getLevel?.() || 0)
      mostrado = alvo > mostrado ? alvo : mostrado + (alvo - mostrado) * 0.35
      historico.push(mostrado)
      historico.shift()
      historico.forEach((valor, i) => {
        const barra = barras.current[i]
        if (barra) barra.style.transform = `scaleY(${Math.max(0.06, Math.min(1, valor))})`
      })
    }, PASSO_DA_ONDA_MS)
    return () => clearInterval(timer)
  }, [getLevel, paused])

  return (
    <div className={`onda ${paused ? 'pausada' : ''}`} aria-hidden="true">
      {Array.from({ length: BARRAS_DA_ONDA }, (_, i) => (
        <span key={i} ref={el => { barras.current[i] = el }} />
      ))}
    </div>
  )
}

// Gravar é um modo: tempo grande, a onda, e os controles embaixo, no alcance
// do polegar. O botão do meio é o de parar, com o quadrado que todo gravador
// usa, em vez de continuar mostrando um microfone.
export function GravandoAgora({ recordingTime, isPaused, getLevel, onStop, onPause, onResume, mini, dica }) {
  return (
    <div className="gravando-agora">
      <p className="gravando-estado">
        <span className={`rec-dot ${isPaused ? 'paused' : ''}`} /> {isPaused ? 'Pausado' : 'Gravando'}
      </p>
      <p className="gravando-tempo">{formatTime(recordingTime)}</p>
      <Onda getLevel={getLevel} paused={isPaused} />
      <div className="gravando-controles">
        <button type="button" className="gravando-lateral" onClick={isPaused ? onResume : onPause}>
          {isPaused ? <IconPlay width={20} height={20} /> : <IconPause width={20} height={20} />}
          <span>{isPaused ? 'Retomar' : 'Pausar'}</span>
        </button>
        <button type="button" className="gravando-parar" onClick={onStop} aria-label="Parar a gravação">
          <span className="gravando-quadrado" />
        </button>
        {/* "Destacar" só existe onde a janelinha existe de verdade (app de
            Windows, ou Chrome e Edge no computador). No celular o lugar fica
            vazio, para o botão de parar continuar no meio. */}
        {mini?.supported && !mini.isOpen ? (
          <button type="button" className="gravando-lateral" onClick={mini.open}>
            <IconPopOut width={20} height={20} />
            <span>Destacar</span>
          </button>
        ) : <span className="gravando-lateral vazio" aria-hidden="true" />}
      </div>
      {dica && <p className="mic-hint">{dica}</p>}
    </div>
  )
}

// A linha discreta debaixo do botão: quanto do mês sobra depois desta captura.
// Quando a captura não cabe, ela avisa ANTES do envio — descobrir isso só
// depois de esperar o upload e a transcrição era o pior jeito de saber.
export function LinhaConsumo({ duracaoSec, calculando }) {
  const { saldo, abrirPlano, abrirConvite, premioConvite } = useOutletContext() || {}
  // Plano sem limite: não há conta a fazer nem aviso a dar.
  if (!saldo || saldo.limite == null) return null

  const restam = Math.max(0, Math.round(saldo.limite - saldo.usados))
  const minutos = minutosDaCaptura(duracaoSec)

  // Sem nada no mês não há conta a fazer, nem duração a esperar: o servidor
  // recusaria qualquer captura, então a linha já diz isso em vez de calar.
  if (saldo.usados >= saldo.limite) {
    return (
      <SemSaldo
        texto={`Você usou os ${saldo.limite} minutos do seu mês.`}
        onConvidar={abrirConvite}
        onVerPlanos={abrirPlano}
        premio={premioConvite}
        origem="sem-minutos"
        compacto
      />
    )
  }

  // A busca da duração de um link passa por uma API externa e pode levar
  // alguns segundos. Sem isto a linha ficava calada nesse intervalo — parecia
  // que nada tinha acontecido, quando na verdade o cálculo estava em curso.
  if (calculando) {
    return <p className="linha-consumo">Calculando a duração do vídeo…</p>
  }

  if (minutos && minutos > restam) {
    return (
      <p className="linha-consumo excede">
        Esta captura tem {minutos} min e restam {restam} no seu mês.
        {abrirPlano && <> <button type="button" onClick={abrirPlano}>Ver planos</button></>}
      </p>
    )
  }

  return (
    <p className="linha-consumo">
      Restam {minutos ? restam - minutos : restam} dos seus {saldo.limite} minutos
    </p>
  )
}

// `aviso` é o recado de uma gravação que acabou sem o botão do app (o Dito
// fechou no meio, o saldo acabou): diz por que ela está ali.
export function RecordingReview({ recordingTime, onSubmit, onReset, loading, aviso }) {
  return (
    <div className="revisao">
      <p className="revisao-titulo">Gravação concluída</p>
      <p className="revisao-tempo">{formatTime(recordingTime)}</p>
      {aviso && <p className="mic-hint revisao-aviso">{aviso}</p>}
      <TranscribeButton
        recomendado={modoRecomendado({ origem: 'record', durationSec: recordingTime })}
        duracaoSec={recordingTime}
        onSubmit={onSubmit}
        loading={loading}
      />
      <LinhaConsumo duracaoSec={recordingTime} />
      <BotaoDescartar onConfirmar={onReset} disabled={loading} />
    </div>
  )
}

// O arquivo escolhido, esperando a escolha do tipo de transcrição. Antes o
// seletor enviava direto; agora há esta parada no meio, e ela precisa dizer
// QUAL arquivo está prestes a ser enviado — senão a pessoa que clicou no
// arquivo errado só descobre no fim.
export function FileReview({ pendingFile, onSubmit, onReset, loading }) {
  const { file, durationSec } = pendingFile
  return (
    <div className="file-review">
      <p className="file-review-name">
        <IconFile width={16} height={16} />
        <span>{file.name}</span>
      </p>
      <p className="text-muted text-sm">
        {durationSec ? formatTime(Math.round(durationSec)) : formatBytes(file.size)}
      </p>
      <TranscribeButton
        recomendado={modoRecomendado({ origem: 'file', durationSec })}
        duracaoSec={durationSec}
        onSubmit={onSubmit}
        loading={loading}
      />
      <LinhaConsumo duracaoSec={durationSec} />
      {/* Trocar não perde nada (o arquivo continua no aparelho), então não
          pergunta; e é texto, não um segundo botão disputando com o de
          transcrever. */}
      <button type="button" className="btn-link discreto" onClick={onReset} disabled={loading}>Trocar arquivo</button>
    </div>
  )
}

// Espera a pessoa parar de digitar antes de perguntar: cada consulta gasta cota
// ou crédito, e um link digitado letra a letra dispararia uma por tecla.
// Colar não tem essa dúvida — a URL inteira chega pronta num só golpe — então
// PULA esta espera (ver `aoColar` abaixo). É o caminho mais comum de preencher
// este campo, e era quem menos precisava do debounce e mais sentia o atraso.
const ESPERA_DURACAO_MS = 600

// Clicar em transcrever antes de a duração chegar não trava nem espera à toa:
// o clique só aguarda o que falta da consulta, no máximo isto, e depois envia
// mesmo sem a conta (o servidor confere de novo e é quem recusa de fato).
const ESPERA_MAXIMA_CONFERENCIA_MS = 4000

function useDuracaoDoLink(url, ativa = true) {
  const [duracao, setDuracao] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const semEsperaRef = useRef(false)
  // Devolve a consulta em curso (disparando-a já, se ainda estava no debounce).
  // É por aqui que o clique em "transcrever" pega carona nela, em vez de abrir
  // uma segunda.
  const iniciarRef = useRef(() => Promise.resolve(null))

  useEffect(() => {
    setDuracao(null)
    const limpo = url.trim()
    if (!ativa || !/^https?:\/\/\S+\.\S+/.test(limpo)) {
      setCalculando(false)
      iniciarRef.current = () => Promise.resolve(null)
      return
    }
    let vivo = true
    let promessa = null
    const iniciar = () => {
      if (!promessa) {
        promessa = duracaoDoLink(limpo).then(segundos => {
          if (vivo) { setDuracao(segundos); setCalculando(false) }
          return segundos
        })
      }
      return promessa
    }
    iniciarRef.current = iniciar
    const espera = semEsperaRef.current ? 0 : ESPERA_DURACAO_MS
    semEsperaRef.current = false
    setCalculando(true)
    const timer = setTimeout(iniciar, espera)
    return () => { vivo = false; clearTimeout(timer) }
  }, [url, ativa])

  const aoColar = () => { semEsperaRef.current = true }
  const esperarDuracao = () => iniciarRef.current()

  return { duracao, calculando, aoColar, esperarDuracao }
}

export function UrlForm({ url, setUrl, onSubmit, loading }) {
  const { saldo, abrirPlano } = useOutletContext() || {}
  const toque = useIsTouchInput()
  const campoRef = useRef(null)
  const comLimite = saldo?.limite != null
  const semSaldo = comLimite && saldo.usados >= saldo.limite
  const restam = comLimite ? Math.max(0, Math.round(saldo.limite - saldo.usados)) : null
  // Sem saldo nenhuma duração muda o resultado: nem consulta, o que ainda
  // poupa a cota da API.
  const { duracao: duracaoSec, calculando, aoColar, esperarDuracao } = useDuracaoDoLink(url, !semSaldo)
  const [conferindo, setConferindo] = useState(false)
  const urlRef = useRef(url)
  urlRef.current = url

  const naoCabe = segundos => {
    const minutos = minutosDaCaptura(segundos)
    return !!minutos && restam != null && minutos > restam
  }

  async function enviar(modo) {
    if (semSaldo) { abrirPlano?.(); return }
    // Já sabemos que não cabe (a linha vermelha está na tela): o clique leva
    // aos planos em vez de mandar uma captura que o servidor vai recusar.
    if (naoCabe(duracaoSec)) { abrirPlano?.(); return }
    if (calculando && restam != null) {
      const daqui = url
      setConferindo(true)
      const segundos = await Promise.race([
        esperarDuracao(),
        new Promise(resolve => setTimeout(() => resolve(null), ESPERA_MAXIMA_CONFERENCIA_MS)),
      ])
      setConferindo(false)
      // Editou o link enquanto conferíamos: aquele clique era de outro vídeo.
      if (urlRef.current !== daqui) return
      // Não cabe: fica parado, e a linha abaixo já explica (a duração chegou ao
      // estado junto com esta resposta).
      if (naoCabe(segundos)) return
      onSubmit(modo, segundos)
      return
    }
    // A duração vai junto: enquanto a transcrição não termina, ela conta como
    // saldo já comprometido.
    onSubmit(modo, duracaoSec)
  }

  // Colar num toque: no celular, segurar o campo até aparecer o "Colar" é o
  // passo que mais erra. Sem permissão para ler a área de transferência (ou
  // num navegador que não deixa), o foco vai para o campo, e o colar de
  // sempre continua valendo.
  async function colar() {
    try {
      const texto = await navigator.clipboard.readText()
      const link = (String(texto).match(/https?:\/\/\S+/) || [])[0]
      if (!link) { campoRef.current?.focus(); return }
      aoColar()
      setUrl(link)
    } catch {
      campoRef.current?.focus()
    }
  }

  return (
    <>
      <div className={`url-form ${toque ? 'toque' : ''}`}>
        <div className="url-campo">
          <input
            ref={campoRef}
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onPaste={aoColar}
            placeholder="Cole um link do YouTube"
            disabled={loading || conferindo}
            onKeyDown={e => {
              // Sem <form> em volta (o botão dividido tem um botão dentro do outro,
              // e um submit implícito dispararia o modo errado), então o Enter
              // precisa ser ligado à mão — é como quem cola um link espera enviar.
              if (e.key === 'Enter' && url.trim() && !loading && !conferindo) enviar(modoRecomendado({ origem: 'url' }))
            }}
          />
          {!url.trim() && navigator.clipboard?.readText && (
            <button type="button" className="url-colar" onClick={colar} disabled={loading || conferindo}>
              Colar
            </button>
          )}
        </div>
        {/* Sem saldo, o caminho de saída é assinar — mas onde o app não vende
            (iPhone) não existe esse caminho, e o botão de transcrever fica
            apenas travado: a linha acima já diz que os minutos acabaram. */}
        {semSaldo && abrirPlano ? (
          <button type="button" className="btn-primary" onClick={abrirPlano}>Ver planos</button>
        ) : (
          <TranscribeButton
            recomendado={modoRecomendado({ origem: 'url' })}
            duracaoSec={duracaoSec}
            onSubmit={enviar}
            loading={loading}
            conferindo={conferindo}
            disabled={!url.trim() || semSaldo}
          />
        )}
      </div>
      {(url.trim() || semSaldo) && <LinhaConsumo duracaoSec={duracaoSec} calculando={calculando} />}
    </>
  )
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Rótulo do painel. "Arquivos" sozinho não conta a ninguém que dá para jogar
// ali o áudio do WhatsApp — o título é onde isso é dito.
export const MODE_TITLE = {
  file: 'Transcreva áudios do WhatsApp',
  url: 'Transcreva vídeos do YouTube',
}
