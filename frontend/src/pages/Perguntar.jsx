import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { askAcervo, embeddar, entenderPergunta } from '../lib/api'
import { track } from '../lib/analytics'
import ChatTextarea from '../components/chat/ChatTextarea'
import MarkdownText from '../components/chat/MarkdownText'
import FeedbackModal from '../components/FeedbackModal'
import { IconClock, IconFlag, IconPlus, IconSend } from '../components/Icons'
import { cifrarMensagem, cifrarTextos, decifrarMensagens, decifrarTextos } from '../lib/cofre'
import { displayTitle, listConversations } from '../lib/conversas'
import { textoPerguntasRestantes } from './conversa/perguntas'
import { formatTimestamp } from './conversa/shared'
import { sincronizar } from '../lib/acervo/indexador'
import { carregarTrechos } from '../lib/acervo/indice'
import { buscar, construirBM25 } from '../lib/acervo/busca'

// O chat geral: uma pergunta, todas as conversas. O desenho inteiro está em
// plano-busca-geral.md; o resumo do que acontece aqui, em ordem:
//   1. o índice do aparelho é posto em dia (a primeira abertura indexa tudo)
//   2. a pergunta vai ao /entender-pergunta, que devolve palavras e filtros
//   3. a busca roda AQUI, no aparelho, e escolhe ~8 trechos
//   4. só esses 8 vão ao /chat-acervo, que responde citando as fontes
//   5. as citações viram chips que abrem a conversa no minuto

// Quantas perguntas já feitas cabem embaixo da barra sem virar uma pilha de
// texto de novo. As mais antigas continuam guardadas; o que se perde é só o
// atalho para elas.
const ANTERIORES_NA_TELA = 5

const MAX_CHARS_PER_TURN = 2000
const MAX_HISTORY_MESSAGES = 20

// Quanto uma pergunta nova espera o índice terminar antes de buscar com o que
// já houver. A espera existe para a resposta sair sempre com os vetores; o
// teto existe para uma indexação travada nunca prender a pessoa.
const ESPERA_MAX_INDICE_MS = 60_000
const ETAPA_INDICE = 'indice'

function novaEspera() {
  let resolver
  const promessa = new Promise(r => { resolver = r })
  return { promessa, resolver }
}

// As fontes de uma resposta não cabem em nenhuma coluna de `chat_messages`, e
// criar uma exigiria SQL que só o dono do banco roda. Elas viajam no fim do
// próprio texto, num comentário que o app tira antes de mostrar: assim uma
// pergunta reaberta amanhã continua com os chips clicáveis, sem migração.
const MARCA_FONTES = '<!--dito-fontes:'

function comFontes(texto, fontes, busca) {
  if (!fontes?.length) return texto
  return `${texto}\n\n${MARCA_FONTES}${JSON.stringify({ f: fontes, b: busca })}-->`
}

function semFontes(conteudo) {
  const at = conteudo.indexOf(MARCA_FONTES)
  if (at < 0) return { texto: conteudo, fontes: [] }
  const texto = conteudo.slice(0, at).trimEnd()
  try {
    const dados = JSON.parse(conteudo.slice(at + MARCA_FONTES.length, conteudo.lastIndexOf('-->')))
    // As primeiras respostas guardaram só a lista de fontes, sem a contagem da
    // busca. Elas continuam abrindo: o que falta é uma linha, não a resposta.
    return Array.isArray(dados)
      ? { texto, fontes: dados }
      : { texto, fontes: dados.f || [], busca: dados.b || null }
  } catch {
    return { texto, fontes: [] }
  }
}

export default function Perguntar() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const {
    conversations, perguntasRestantes, atualizarPerguntasRestantes, abrirPlano, convidado,
  } = useOutletContext()

  // A barra lateral mostra as 50 mais recentes; aqui a pergunta é sobre o
  // acervo inteiro, então a lista é buscada de novo, completa. É uma consulta
  // leve (sem transcrição) e só desta tela.
  const [acervo, setAcervo] = useState(null)

  const [indice, setIndice] = useState({ estado: 'carregando', trechos: [], bm25: null, progresso: null })
  const [messages, setMessages] = useState([])
  const [chatId, setChatId] = useState(null)
  const [anteriores, setAnteriores] = useState([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [etapa, setEtapa] = useState('')
  const [error, setError] = useState(null)
  const [errorStatus, setErrorStatus] = useState(null)
  const [reportando, setReportando] = useState(false)
  const bottomRef = useRef(null)

  // `enviar` espera o índice no meio da execução, e o `indice` e o `acervo` que
  // ele enxerga são os do clique. Os refs trazem os de agora.
  const indiceRef = useRef(indice)
  const acervoRef = useRef(acervo)
  indiceRef.current = indice
  acervoRef.current = acervo
  const esperaRef = useRef(null)
  if (!esperaRef.current) esperaRef.current = novaEspera()

  const esgotado = perguntasRestantes === 0
  const idsDoAcervo = (acervo || []).map(c => c.id).join(',')

  // Relida quando a barra lateral muda (uma captura nova terminou), para a
  // conversa de agora já entrar na próxima pergunta.
  useEffect(() => {
    if (!user?.id) return
    let vivo = true
    listConversations(user.id, { limit: 500 })
      .then(lista => vivo && setAcervo(lista))
      .catch(() => vivo && setAcervo([]))
    return () => { vivo = false }
  }, [user?.id, conversations.length])

  // ── O índice do aparelho ─────────────────────────────────────
  // Indexar só quando esta tela abre é de propósito: quem nunca perguntar ao
  // acervo não paga a indexação dele. A primeira fase (o texto) é de graça e
  // já deixa a busca por palavra responder; a segunda (os vetores) continua em
  // segundo plano, e a tela fica utilizável durante ela. Nada disso aparece na
  // tela: quem espera por ele é só a pergunta nova (ver `esperarIndice`).
  useEffect(() => {
    if (!user?.id || !acervo) return
    let vivo = true
    const espera = esperaRef.current
    let atual = { trechos: [], bm25: null }
    // Uma rodada nova quase sempre é uma captura que acabou de terminar, e é
    // dela que a pessoa vai perguntar: a próxima pergunta espera por ela.
    setIndice(i => ({ ...i, estado: 'carregando' }))

    ;(async () => {
      const titulos = new Map(acervo.map(c => [c.id, displayTitle(c)]))
      const recarregar = async () => {
        const trechos = await carregarTrechos(titulos)
        if (!vivo) return
        atual = { trechos, bm25: trechos.length ? construirBM25(trechos) : null }
        setIndice(i => ({ ...i, ...atual }))
      }

      try {
        await recarregar()
      } catch {
        // Sem chave neste aparelho, ou IndexedDB indisponível.
        if (vivo) setIndice(i => ({ ...i, trechos: [], bm25: null }))
      }

      const resumo = await sincronizar(user.id, acervo, {
        parar: () => !vivo,
        aoAndar: p => vivo && setIndice(i => ({ ...i, estado: 'indexando', progresso: p })),
      })
      if (!vivo) return
      try {
        await recarregar()
      } catch { /* a busca segue com o que já havia */ }
      setIndice(i => ({ ...i, estado: 'pronto', progresso: null, resumo }))
      // O índice vai junto porque quem espera não pode ler do estado: o React
      // ainda não desenhou o `setIndice` acima quando a promessa resolve.
      espera.resolver(atual)
    })()

    return () => {
      vivo = false
      // A lista de conversas mudou no meio (ou a tela fechou): quem esperava
      // passa a esperar a próxima rodada, que recomeça do que já foi feito.
      esperaRef.current = novaEspera()
      espera.resolver(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, idsDoAcervo])

  // ── Perguntas anteriores ─────────────────────────────────────
  // As do acervo são as que não pertencem a conversa nenhuma (`session_id`
  // nulo). O rótulo é a primeira pergunta de cada thread, decifrada aqui: o
  // título do chat ficaria em claro no banco, e o que a pessoa perguntou é
  // conteúdo dela como qualquer outro.
  const anterioresDaRede = useRef(false)
  const carregarAnteriores = useCallback(async () => {
    if (!user?.id) return
    const mostrar = lista => {
      anterioresDaRede.current = true
      setAnteriores(lista)
      guardarAnterioresNoAparelho(user.id, lista.slice(0, ANTERIORES_NA_TELA))
    }
    try {
      const { data: chats } = await supabase.from('chats')
        .select('id, created_at').is('session_id', null)
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
      if (!chats?.length) return mostrar([])

      const { data: msgs } = await supabase.from('chat_messages')
        .select('chat_id, content, enc_version, created_at')
        .in('chat_id', chats.map(c => c.id)).eq('role', 'user')
        .order('created_at')
      const abertas = await decifrarMensagens(msgs || [])

      const primeira = new Map()
      for (const m of abertas) if (!primeira.has(m.chat_id)) primeira.set(m.chat_id, m.content)
      // Perguntar duas vezes a mesma coisa é comum (a resposta não convenceu,
      // a pessoa tentou de novo), e a lista ficava com a linha repetida. Fica
      // a mais recente, que é a que tem a resposta que ela quis.
      const vistas = new Set()
      const lista = []
      for (const c of chats) {
        const pergunta = primeira.get(c.id)
        if (!pergunta) continue
        const chave = pergunta.trim().toLowerCase()
        if (vistas.has(chave)) continue
        vistas.add(chave)
        lista.push({ id: c.id, pergunta, quando: c.created_at })
      }
      mostrar(lista)
    } catch { /* a lista é um extra; sem ela a tela funciona igual */ }
  }, [user?.id])

  // A lista da última visita aparece antes das duas consultas acima
  // terminarem, e é trocada pela de agora assim que elas chegam.
  useEffect(() => {
    if (!user?.id) return
    anterioresDaRede.current = false
    lerAnterioresDoAparelho(user.id).then(lista => {
      if (lista && !anterioresDaRede.current) setAnteriores(lista)
    })
    carregarAnteriores()
  }, [user?.id, carregarAnteriores])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, sending])

  // Abrir uma pergunta anterior é só ler o que já foi respondido: nenhuma
  // chamada de IA acontece aqui, então reabrir não gasta pergunta do mês.
  async function abrirThread(id) {
    setError(null); setErrorStatus(null)
    const { data: msgs } = await supabase.from('chat_messages')
      .select('role, content, enc_version').eq('chat_id', id).order('created_at')
    const abertas = await decifrarMensagens(msgs || [])
    setChatId(id)
    setMessages(abertas.map(m => (m.role === 'assistant'
      ? { role: 'assistant', ...semFontes(m.content) }
      : { role: 'user', texto: m.content })))
  }

  function novaPergunta() {
    setChatId(null); setMessages([]); setQuestion('')
    setError(null); setErrorStatus(null)
  }

  async function enviar(e, texto) {
    e?.preventDefault()
    const pergunta = (texto ?? question).trim()
    if (!pergunta || sending || esgotado) return

    setQuestion(''); setError(null); setErrorStatus(null); setSending(true)
    const anteriorMessages = messages
    setMessages([...anteriorMessages, { role: 'user', texto: pergunta }])

    try {
      const historico = anteriorMessages
        .slice(-MAX_HISTORY_MESSAGES)
        .map(m => ({ role: m.role, content: (m.texto || '').slice(0, MAX_CHARS_PER_TURN) }))

      // Na maioria das vezes o índice já está pronto e isto não custa nada. Na
      // primeira abertura, ou logo depois de uma captura, a resposta espera os
      // vetores em vez de sair da busca por palavra, que acerta menos.
      let indiceAgora = indiceRef.current
      if (indiceAgora.estado !== 'pronto') {
        setEtapa(ETAPA_INDICE)
        indiceAgora = (await esperarIndice()) || indiceRef.current
      }

      setEtapa('Entendendo a pergunta')
      // Só título, data, idioma e duração saem do aparelho neste passo. O
      // conteúdo das conversas, nunca.
      const resumoDoAcervo = (acervoRef.current || []).map(c => ({
        id: c.id,
        titulo: displayTitle(c),
        data: new Date(c.created_at).toISOString().slice(0, 10),
        minutos: Math.round((c.duration_s || 0) / 60) || null,
      }))
      // O plano e o vetor da pergunta são pedidos juntos: são duas idas ao
      // servidor que não dependem uma da outra, e somá-las em série era o
      // maior pedaço da espera.
      const [plano, vetorCru] = await Promise.all([
        entenderPergunta(pergunta, resumoDoAcervo, { history: historico }),
        vetorDaPergunta(pergunta),
      ])
      // A pergunta reescrita só existe quando há histórico ("e sobre o
      // prazo?"). Aí vale a segunda ida: é ela que sabe do que se falava.
      const reescrita = historico.length && plano.pergunta && plano.pergunta !== pergunta ? plano.pergunta : null
      const vetor = reescrita ? await vetorDaPergunta(reescrita) : vetorCru

      setEtapa('Procurando nas suas conversas')
      const { escolhidos, conversasBuscadas, conversasUsadas } = buscar({
        trechos: indiceAgora.trechos, pergunta, plano, vetorPergunta: vetor, bm25: indiceAgora.bm25,
      })

      const rotulados = escolhidos.map((t, i) => ({
        rotulo: `C${i + 1}`,
        titulo: t.titulo || 'Sem título',
        data: new Date(t.data).toLocaleDateString('pt-BR'),
        minuto: t.ini != null ? formatTimestamp(t.ini) : null,
        texto: t.texto,
      }))

      setEtapa('Escrevendo a resposta')
      const resposta = await askAcervo(pergunta, rotulados, { history: historico })

      const fontes = escolhidos.map((t, i) => ({
        r: `C${i + 1}`, s: t.sessionId, i: t.ini ?? null,
        t: t.titulo || 'Sem título', d: t.data,
      }))
      const citadas = fontes.filter(f => resposta.answer.includes(`[${f.r}]`))
      const busca = { conversasBuscadas, trechos: escolhidos.length, conversasUsadas }

      setMessages(prev => [...prev, { role: 'assistant', texto: resposta.answer, fontes: citadas, busca }])
      atualizarPerguntasRestantes?.(resposta.perguntas_restantes)
      await guardar(pergunta, resposta.answer, citadas, busca)
      track('chat_acervo', { usage: resposta.usage, trechos: escolhidos.length, conversas: conversasBuscadas })
    } catch (err) {
      setError(err.message)
      setErrorStatus(err.status || null)
      if (err.status === 402) atualizarPerguntasRestantes?.(0)
      // A pergunta volta para o campo: perdê-la porque a rede caiu é a pior
      // parte de um erro aqui.
      setMessages(anteriorMessages)
      setQuestion(pergunta)
    } finally {
      setSending(false)
      setEtapa('')
    }
  }

  // Devolve o índice pronto, ou null se o teto de espera passou (aí quem chamou
  // segue com o que houver). Quando a rodada é cancelada no meio, a espera
  // continua na rodada seguinte.
  async function esperarIndice() {
    if (!user?.id) return null
    const limite = Date.now() + ESPERA_MAX_INDICE_MS
    while (indiceRef.current.estado !== 'pronto') {
      const falta = limite - Date.now()
      if (falta <= 0) return null
      let timer
      const pronto = await Promise.race([
        esperaRef.current.promessa,
        new Promise(ok => { timer = setTimeout(ok, falta, null) }),
      ])
      clearTimeout(timer)
      if (pronto) return pronto
    }
    return null
  }

  async function vetorDaPergunta(texto) {
    try {
      const [vetor] = await embeddar([texto], 'pergunta')
      return vetor || null
    } catch {
      // Sem vetor a busca por palavra responde sozinha, com um acerto menor.
      return null
    }
  }

  // Best-effort, como no chat de conversa: uma falha ao gravar não pode apagar
  // a resposta da tela. `session_id` nulo é o que marca a pergunta como sendo
  // do acervo inteiro, e não de uma conversa.
  async function guardar(pergunta, resposta, fontes, busca) {
    try {
      let id = chatId
      if (!id) {
        const { data, error } = await supabase.from('chats')
          .insert({ user_id: user.id, session_id: null }).select('id').single()
        if (error) throw error
        id = data.id
        setChatId(id)
      }
      const cifrar = !convidado
      const p = cifrar ? await cifrarMensagem(pergunta) : { content: pergunta }
      const texto = comFontes(resposta, fontes, busca)
      const r = cifrar ? await cifrarMensagem(texto) : { content: texto }
      await supabase.from('chat_messages').insert([
        { chat_id: id, user_id: user.id, role: 'user', ...p },
        { chat_id: id, user_id: user.id, role: 'assistant', ...r },
      ])
      carregarAnteriores()
    } catch {}
  }

  function abrirFonte(fonte) {
    navigate(fonte.i != null
      ? `/conversa/${fonte.s}/timeline?t=${Math.floor(fonte.i)}`
      : `/conversa/${fonte.s}`)
  }

  const vazio = messages.length === 0 && !sending
  const statusIndice = textoDoIndice(indice, acervo?.length ?? 0)
  const alerta = error && errorStatus !== 402 ? <div className="alert alert-error">{error}</div> : null

  // A mesma barra nos dois estados da tela: no meio da altura enquanto não há
  // pergunta nenhuma, presa ao rodapé assim que a conversa começa. Escrever o
  // formulário duas vezes era como as duas acabavam diferentes uma da outra.
  const barra = esgotado ? (
    <div className="ask-bar ask-esgotado">
      <span>Você usou todas as perguntas deste mês.</span>
      {abrirPlano && <button type="button" className="btn-primary btn-sm" onClick={abrirPlano}>Ver planos</button>}
    </div>
  ) : (
    <form className="ask-bar" onSubmit={enviar}>
      <ChatTextarea
        value={question}
        onChange={setQuestion}
        onSubmit={enviar}
        placeholder="Pergunte alguma coisa sobre suas conversas"
        disabled={sending}
      />
      <button type="submit" className="btn-icon ask-send" disabled={sending} aria-label="Enviar">
        <IconSend width={18} height={18} />
      </button>
    </form>
  )

  const restantes = !esgotado && perguntasRestantes != null
    ? <p className="ask-restantes">{textoPerguntasRestantes(perguntasRestantes)}</p>
    : null

  return (
    <div className={`conversa chat-page${vazio ? ' chat-page-vazia' : ''}`}>
      <div className="conversa-topbar">
        <button className="btn-ghost btn-sm btn-reportar-ia" onClick={() => setReportando(true)}>
          <IconFlag width={14} height={14} /> <span>Sinalizar<span className="reportar-ia-extra"> conteúdo da IA</span></span>
        </button>
        {!vazio && (
          <button className="btn-ghost btn-sm" onClick={novaPergunta}>
            <IconPlus width={14} height={14} /> Nova pergunta
          </button>
        )}
      </div>

      {vazio ? (
        // Em repouso a tela é uma pergunta só: o convite, a barra no meio da
        // altura e, embaixo, as últimas perguntas já feitas. O título da
        // página, o parágrafo de explicação e as sugestões prontas saíram —
        // eram três blocos de texto na frente da única coisa que se faz aqui.
        <div className="ask-hero">
          <h1 className="ask-hero-titulo">O que você precisa saber hoje?</h1>
          <div className="ask-hero-barra">
            {alerta}
            {barra}
          </div>
          {anteriores.length > 0 && (
            <div className="ask-anteriores">
              {anteriores.slice(0, ANTERIORES_NA_TELA).map(a => (
                <button key={a.id} type="button" onClick={() => abrirThread(a.id)} title={a.pergunta}>
                  <IconClock width={15} height={15} />
                  <span>{a.pergunta}</span>
                </button>
              ))}
            </div>
          )}
          <div className="ask-hero-rodape">
            {restantes}
            {statusIndice && <p className="ask-hero-status">{statusIndice}</p>}
          </div>
        </div>
      ) : (
        <>
          <header className="conversa-head">
            <h1>Perguntar</h1>
            <p className="text-muted text-sm">
              Uma pergunta, todas as suas conversas
              {statusIndice && <> · {statusIndice}</>}
            </p>
          </header>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <div className="bubble">
                  {m.role === 'assistant' ? (
                    <>
                      <MarkdownText text={m.texto} />
                      {m.fontes?.length > 0 && (
                        <div className="acervo-fontes">
                          {m.fontes.map(f => (
                            <button key={f.r} type="button" className="fonte-chip" onClick={() => abrirFonte(f)}>
                              <span className="fonte-rotulo">{f.r}</span>
                              {f.t}
                              <span className="fonte-quando">
                                {new Date(f.d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                {f.i != null && ` · ${formatTimestamp(f.i)}`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {m.busca && (
                        <p className="acervo-procura">{textoDaProcura(m.busca, m.fontes)}</p>
                      )}
                    </>
                  ) : m.texto}
                </div>
              </div>
            ))}

            {sending && (
              <div className="message assistant">
                <div className="bubble">
                  <span className="spinner spinner-sm" /> {etapa === ETAPA_INDICE ? textoDaEspera(indice) : etapa || 'Procurando'}…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {alerta}

          <div className="chat-input-area">
            {barra}
            {restantes}
          </div>
        </>
      )}

      {reportando && <FeedbackModal reportIA onClose={() => setReportando(false)} />}
    </div>
  )
}

// ── Perguntas anteriores guardadas no aparelho ────────────────
// As perguntas são conteúdo da pessoa, então vão cifradas com a mesma chave do
// resto: ela sai do aparelho junto com a conta, e a lista fica ilegível junto.
// Sem chave (o convidado) ficam como estão, igual ao índice do acervo.
const chaveAnteriores = userId => `dito-perguntas-anteriores:${userId}`

async function guardarAnterioresNoAparelho(userId, lista) {
  try {
    const { textos: [texto], encVersion } = await cifrarTextos([JSON.stringify(lista)])
    localStorage.setItem(chaveAnteriores(userId), JSON.stringify({ v: encVersion, t: texto }))
  } catch { /* sem localStorage a lista só demora mais a aparecer */ }
}

async function lerAnterioresDoAparelho(userId) {
  try {
    const bruto = localStorage.getItem(chaveAnteriores(userId))
    if (!bruto) return null
    const { v, t } = JSON.parse(bruto)
    const [texto] = await decifrarTextos([t], v)
    const lista = JSON.parse(texto)
    return Array.isArray(lista) ? lista : null
  } catch {
    return null
  }
}

// "Procurei em 47 conversas e a resposta veio de 2 trechos de 1 delas": quem
// pergunta a um acervo inteiro precisa saber onde a resposta foi procurada,
// senão não há como distinguir "não está nas minhas conversas" de "a busca não
// achou". O número de trechos e de conversas é o das fontes CITADAS, não o dos
// 8 trechos enviados à IA: a busca sempre enche as 8 vagas, com no máximo 3 por
// conversa, então o enviado dava "8 trechos de 3 delas" em toda pergunta.
function textoDaProcura({ conversasBuscadas, trechos }, fontes = []) {
  const onde = conversasBuscadas === 1 ? '1 conversa' : `${conversasBuscadas} conversas`
  if (!trechos) return `Procurei em ${onde} e não encontrei nada relacionado.`
  if (!fontes.length) return `Procurei em ${onde}, mas a resposta não se apoiou em nenhum trecho.`
  const usados = fontes.length === 1 ? '1 trecho' : `${fontes.length} trechos`
  const conversas = new Set(fontes.map(f => f.s)).size
  const delas = conversas === 1 ? '1 delas' : `${conversas} delas`
  return `Procurei em ${onde} e a resposta veio de ${usados} de ${delas}.`
}

// O progresso do índice só aparece quando uma pergunta está esperando por ele.
// Na tela em repouso ele não dizia nada que a pessoa pudesse usar, e disputava
// a atenção com as perguntas anteriores, que são o que ela veio buscar.
function textoDaEspera(indice) {
  if (indice.estado === 'indexando' && indice.progresso?.total) {
    const { fase, feitas, total: quantas } = indice.progresso
    const nome = fase === 'texto' ? 'Lendo suas conversas' : 'Preparando a busca'
    return `${nome} (${Math.min(feitas + 1, quantas)} de ${quantas})`
  }
  return 'Preparando a busca'
}

// O que sobra na tela sobre o índice são as falhas: elas mudam a qualidade da
// resposta, e a pessoa precisa saber disso antes de perguntar. Aparece no
// subtítulo depois de um ponto e sozinho embaixo da barra na tela em repouso.
function textoDoIndice(indice, total) {
  if (indice.estado === 'pronto' && !indice.trechos.length && total > 0) {
    return 'Não consegui preparar a busca neste aparelho'
  }
  if (indice.estado === 'pronto' && indice.resumo?.semVetor) {
    return 'Busca por palavra por enquanto'
  }
  return null
}
