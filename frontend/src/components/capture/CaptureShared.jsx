import { useState, useEffect, useRef } from 'react'
import { formatTime } from './estimate'
import { MODOS, MODO_SIMPLES, MODO_COMPLETA, modoRecomendado } from './modos'
import { IconPause, IconPlay, IconPopOut, IconCaretDown, IconFile } from '../Icons'

// Peças visuais idênticas nas duas plataformas. O que diverge (arrastar
// arquivo, textos do microfone, tamanho dos alvos de toque) fica em
// CaptureWeb/CaptureNative; o que não diverge fica aqui.

// Uma linha, um símbolo de carregando, e nada mais.
//
// Aqui já houve um contador regressivo, um "acordando o servidor…", um aviso de
// hibernação e um pedido para não fechar a tela. Cada um deles era verdade, e
// juntos diziam a mesma coisa quatro vezes com cara de problema: quem só queria
// a transcrição lia uma tela de erro em andamento. O que a pessoa precisa saber
// enquanto espera é que o Dito está trabalhando — o resto é ruído.
export function ProcessingBox() {
  return (
    <div className="processing-box">
      <div className="spinner" />
      <div className="processing-title">Transcrevendo e resumindo…</div>
    </div>
  )
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
export function TranscribeButton({ recomendado = MODO_COMPLETA, onSubmit, loading, disabled }) {
  const [modo, setModo] = useState(recomendado)
  const [aberto, setAberto] = useState(false)
  const caixaRef = useRef(null)

  useEffect(() => { setModo(recomendado) }, [recomendado])

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

  const travado = disabled || loading

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
          : MODOS[modo].label}
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
          {[MODO_SIMPLES, MODO_COMPLETA].map(m => (
            <li key={m}>
              <button
                type="button"
                role="option"
                aria-selected={m === modo}
                className={m === modo ? 'on' : ''}
                onClick={() => { setModo(m); setAberto(false) }}
              >
                <span className="split-menu-head">
                  <span className="split-menu-label">{MODOS[m].label}</span>
                  {m === recomendado && <span className="split-badge">Recomendada</span>}
                </span>
                <span className="split-menu-hint">{MODOS[m].hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
      <p className="record-label">Gravação concluída — {formatTime(recordingTime)}</p>
      <div className="record-actions">
        <TranscribeButton
          recomendado={modoRecomendado({ origem: 'record', durationSec: recordingTime })}
          onSubmit={onSubmit}
          loading={loading}
        />
        <button className="btn-ghost" onClick={onReset} disabled={loading}>Regravar</button>
      </div>
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
          onSubmit={onSubmit}
          loading={loading}
        />
        <button className="btn-ghost" onClick={onReset} disabled={loading}>Trocar arquivo</button>
      </div>
    </div>
  )
}

export function UrlForm({ url, setUrl, onSubmit, loading }) {
  return (
    <div className="url-form">
      <input
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="Cole um link do YouTube"
        disabled={loading}
        onKeyDown={e => {
          // Sem <form> em volta (o botão dividido tem um botão dentro do outro,
          // e um submit implícito dispararia o modo errado), então o Enter
          // precisa ser ligado à mão — é como quem cola um link espera enviar.
          if (e.key === 'Enter' && url.trim() && !loading) onSubmit(modoRecomendado({ origem: 'url' }))
        }}
      />
      <TranscribeButton
        recomendado={modoRecomendado({ origem: 'url' })}
        onSubmit={onSubmit}
        loading={loading}
        disabled={!url.trim()}
      />
    </div>
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
