import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { formatTime } from './estimate'
import { MODOS, MODO_SIMPLES, MODO_COMPLETA, modoRecomendado } from './modos'
import { planoPorId } from '../../lib/planos'
import { duracaoDoLink } from '../../lib/api'
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
export function ProcessingBox() {
  return (
    <div className="hero-record">
      <div className="processing-orb">
        <span className="processing-ring" />
        <span className="spinner" />
      </div>
      <p className="processing-title">Transcrevendo e resumindo…</p>
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
export function TranscribeButton({ recomendado = MODO_COMPLETA, duracaoSec = null, onSubmit, loading, conferindo, disabled }) {
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

// A linha discreta debaixo do botão: quanto do mês sobra depois desta captura.
// Quando a captura não cabe, ela avisa ANTES do envio — descobrir isso só
// depois de esperar o upload e a transcrição era o pior jeito de saber.
export function LinhaConsumo({ duracaoSec, calculando }) {
  const { saldo, abrirPlano } = useOutletContext() || {}
  // Plano sem limite: não há conta a fazer nem aviso a dar.
  if (!saldo || saldo.limite == null) return null

  const restam = Math.max(0, Math.round(saldo.limite - saldo.usados))
  const minutos = minutosDaCaptura(duracaoSec)

  // Sem nada no mês não há conta a fazer, nem duração a esperar: o servidor
  // recusaria qualquer captura, então a linha já diz isso em vez de calar.
  if (saldo.usados >= saldo.limite) {
    return (
      <p className="linha-consumo excede">
        Você usou os {saldo.limite} minutos do seu mês.
        {abrirPlano && <> <button type="button" onClick={abrirPlano}>Ver planos</button></>}
      </p>
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

// Controles que só existem com uma gravação em andamento: pausar/retomar e
// destacar numa janelinha flutuante. Antes o botão grande era tudo — começar e
// encerrar — e não havia como interromper sem encerrar de vez.
//
// "Destacar" só aparece onde a janelinha existe de verdade (app nativo, ou
// Chrome/Edge no desktop). No app nativo ela também aparece sozinha quando o
// Dito é minimizado; o botão é para quem quer deixá-la à vista antes disso.
export function RecordingControls({ paused, onPause, onResume, mini }) {
  return (
    <div className="record-controls">
      <button className="btn-ghost btn-sm" onClick={paused ? onResume : onPause}>
        {paused
          ? <><IconPlay width={14} height={14} /> Retomar</>
          : <><IconPause width={14} height={14} /> Pausar</>}
      </button>
      {mini?.supported && !mini.isOpen && (
        <button className="btn-ghost btn-sm" onClick={mini.open}>
          <IconPopOut width={14} height={14} /> Destacar
        </button>
      )}
    </div>
  )
}

export function RecordingReview({ recordingTime, onSubmit, onReset, loading }) {
  return (
    <>
      <p className="record-label">Gravação concluída · {formatTime(recordingTime)}</p>
      <div className="record-actions">
        <TranscribeButton
          recomendado={modoRecomendado({ origem: 'record', durationSec: recordingTime })}
          duracaoSec={recordingTime}
          onSubmit={onSubmit}
          loading={loading}
        />
        <button className="btn-ghost" onClick={onReset} disabled={loading}>Regravar</button>
      </div>
      <LinhaConsumo duracaoSec={recordingTime} />
    </>
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
      <div className="record-actions">
        <TranscribeButton
          recomendado={modoRecomendado({ origem: 'file', durationSec })}
          duracaoSec={durationSec}
          onSubmit={onSubmit}
          loading={loading}
        />
        <button className="btn-ghost" onClick={onReset} disabled={loading}>Trocar arquivo</button>
      </div>
      <LinhaConsumo duracaoSec={durationSec} />
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
    }
    onSubmit(modo)
  }

  return (
    <>
      <div className="url-form">
        <input
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
