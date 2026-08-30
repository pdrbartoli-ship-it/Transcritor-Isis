import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generateInsights } from '../../lib/api'
import { IconArrowRight, IconDownload, IconCheck, IconMessage } from '../../components/Icons'
import ConversaHeader from './ConversaHeader'
import { track } from '../../lib/analytics'
import {
  formatTimestamp, formatRange, sliceSegments,
  buildTranscriptFile, downloadText, safeFilename, speakersAreUncertain,
} from './shared'

// Visão geral: os quatro blocos que o usuário pode aprofundar. Cada um é uma
// porta, e a sinalização disso é deliberada — seta sempre visível (no toque não
// existe hover), borda que reage ao ponteiro, foco de teclado e um clique só.
// Duplo clique não existe em celular e é invisível para quem não sabe.
export default function Conversa() {
  const navigate = useNavigate()
  const { conversation, setConversation, refreshConversations } = useOutletContext()

  const [error, setError] = useState(null)
  const [regenerating, setRegenerating] = useState(false)
  const [chapter, setChapter] = useState(0)

  const insights = conversation.insights
  const topics = insights?.topics || []
  const todos = insights?.todos || []
  const chapters = insights?.chapters || []

  // Conversas anteriores a esta versão não têm insights. A mídia nunca foi
  // guardada, mas a transcrição sim — reanalisar custa uma chamada de texto.
  async function regenerate() {
    setRegenerating(true)
    setError(null)
    try {
      const { insights: fresh, summary } = await generateInsights(
        conversation.transcript, conversation.segments || [],
      )
      const { error: dbError } = await supabase.from('sessions')
        .update({ insights: fresh, summary, duration_s: fresh.duration_s || conversation.duration_s })
        .eq('id', conversation.id)
      if (dbError) throw dbError
      setConversation(c => ({ ...c, insights: fresh, summary }))
      await refreshConversations()
    } catch (err) {
      setError(`Não foi possível analisar esta conversa: ${err.message}`)
    } finally {
      setRegenerating(false)
    }
  }

  function download() {
    track('download_transcricao')
    downloadText(safeFilename(conversation.title), buildTranscriptFile(conversation))
  }

  // Saber quais blocos são realmente abertos é o que vai dizer o que manter e
  // o que cortar — sem isso a próxima decisão de produto seria no palpite.
  function open(destino, evento, state) {
    track(evento)
    navigate(destino, state)
  }

  if (!insights) {
    return (
      <div className="conversa">
        <ConversaHeader conversation={conversation} backTo="/" backLabel="Conversas" />
        {error && <div className="alert alert-error">{error}</div>}
        <div className="empty-insights">
          <p>Esta conversa foi capturada antes da nova análise, então ainda não tem tópicos, tarefas nem linha do tempo.</p>
          <button className="btn-primary" onClick={regenerate} disabled={regenerating}>
            {regenerating ? <><span className="spinner spinner-sm" /> Analisando…</> : 'Gerar novos insights'}
          </button>
        </div>
        {conversation.summary && (
          <section className="conversa-block">
            <h2>Resumo antigo</h2>
            <p className="legacy-summary">{conversation.summary.replace(/\*\*/g, '').replace(/^#+ */gm, '')}</p>
          </section>
        )}
        <DownloadButton onClick={download} />
      </div>
    )
  }

  const current = chapters[chapter]

  return (
    <div className="conversa">
      <ConversaHeader conversation={conversation} backTo="/" backLabel="Conversas" />
      {error && <div className="alert alert-error">{error}</div>}

      <div className="conversa-grid">
        <section className="conversa-block">
          <h2>4 tópicos mais importantes</h2>
          <p className="block-hint">Clique em um tópico para ver o que foi dito sobre ele.</p>
          <div className="topic-grid">
            {topics.map((t, i) => (
              <Card key={i} onOpen={() => open(`topico/${i}`, 'topico_aberto')} className="topic-card">
                <span className="topic-label">{t.label}</span>
                {t.time_refs?.[0] && (
                  <span className="topic-time">{formatRange(t.time_refs[0][0], t.time_refs[0][1])}</span>
                )}
              </Card>
            ))}
          </div>
        </section>

        <section className="conversa-block">
          <h2>Lista de to do's</h2>
          {todos.length === 0 ? (
            <p className="text-muted text-sm">Nenhuma ação ficou combinada nesta conversa.</p>
          ) : (
            <>
              <p className="block-hint">Clique para ver o trecho em que cada uma foi combinada.</p>
              <ul className="todo-list">
                {todos.slice(0, 4).map((t, i) => (
                  <li key={i}>
                    <Card onOpen={() => open('todos', 'todo_aberto', { state: { focus: i } })} className="todo-card">
                      <span className="todo-check"><IconCheck width={14} height={14} /></span>
                      <span className="todo-main">
                        <span className="todo-task">{t.task}</span>
                        {(t.owners?.length > 0 || t.due) && (
                          <span className="todo-meta">
                            {t.owners?.join(', ')}
                            {t.owners?.length > 0 && t.due && ' · '}
                            {t.due}
                          </span>
                        )}
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
              {todos.length > 4 && (
                <button className="btn-ghost" onClick={() => navigate('todos')}>
                  Ver todas as {todos.length}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {chapters.length > 0 && (
        <section className="conversa-block">
          <h2>Resumo minuto a minuto</h2>
          <p className="block-hint">Escolha um intervalo na barra; clique de novo para ler a transcrição dele.</p>

          {/* Cada bloco é proporcional à duração do trecho, então a barra
              mostra de relance onde a conversa se demorou. */}
          <div className="timeline-bar" role="tablist" aria-label="Intervalos da conversa">
            {chapters.map((c, i) => {
              const width = Math.max(2, ((c.end - c.start) / (conversation.duration_s || 1)) * 100)
              return (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === chapter}
                  className={`timeline-slot ${i === chapter ? 'on' : ''}`}
                  style={{ flexGrow: width }}
                  title={`${formatRange(c.start, c.end)} — ${c.title}`}
                  onClick={() => (i === chapter ? open('timeline', 'timeline_aberta', { state: { focus: i } }) : setChapter(i))}
                />
              )
            })}
          </div>

          {current && (
            <Card onOpen={() => open('timeline', 'timeline_aberta', { state: { focus: chapter } })} className="chapter-preview">
              <span className="chapter-time">{formatRange(current.start, current.end)}</span>
              <span className="chapter-title">{current.title}</span>
              <ul className="bullet-list">
                {(current.bullets || []).map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </Card>
          )}
        </section>
      )}

      {insights.speakers?.length > 0 && (
        <section className="conversa-block">
          <h2>Quem falou</h2>
          <div className="speaker-row">
            {insights.speakers.map((s, i) => (
              <span key={i} className="speaker-chip">
                {s.name || s.label}
                {s.name && s.confidence !== 'alta' && <span className="speaker-guess">?</span>}
              </span>
            ))}
          </div>
          {speakersAreUncertain(insights) && (
            <p className="text-muted text-sm">
              Os nomes são deduzidos do que foi dito na conversa, não da voz — os marcados com “?” podem estar errados.
            </p>
          )}
        </section>
      )}

      <div className="conversa-actions">
        <button className="btn-primary" onClick={() => open('chat', 'chat_aberto')}>
          <IconMessage width={16} height={16} /> Pergunte qualquer coisa
        </button>
        <DownloadButton onClick={download} />
      </div>
    </div>
  )
}

function DownloadButton({ onClick }) {
  return (
    <button className="btn-secondary btn-download" onClick={onClick}>
      <IconDownload width={16} height={16} /> Baixar a transcrição
    </button>
  )
}

// Todo bloco navegável usa esta casca, para a afordância ser idêntica em todos:
// clicável com um clique, alcançável por teclado e com a seta sempre visível.
export function Card({ onOpen, className = '', children }) {
  return (
    <div
      className={`nav-card ${className}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
    >
      {children}
      <IconArrowRight className="card-arrow" width={16} height={16} />
      <span className="card-cue">ver detalhes</span>
    </div>
  )
}
