import { useState, useEffect, useRef } from 'react'
import { useOutletContext, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { askConversation } from '../../lib/api'
import { track } from '../../lib/analytics'
import ChatTextarea from '../../components/chat/ChatTextarea'
import MarkdownText from '../../components/chat/MarkdownText'
import { IconSend, IconMessage } from '../../components/Icons'
import ConversaHeader from './ConversaHeader'
import { cifrarMensagem, decifrarMensagens } from '../../lib/cofre'
import { textoPerguntasRestantes } from './perguntas'

// Cada mensagem reenvia o histórico; sem teto, uma conversa longa cresce sem
// parar. O corte é por mensagem, para uma resposta gigante não comer o espaço
// das outras.
const MAX_CHARS_PER_TURN = 2000

// Uma thread persistente cresce para sempre entre visitas; sem limite de
// turnos, reabrir uma conversa antiga depois de meses passaria a pagar (em
// tokens e em latência) por perguntas que não têm mais nada a ver com a de
// agora. 20 mensagens é dez idas e vindas — sobra contexto de sobra.
const MAX_HISTORY_MESSAGES = 20

// O estado vazio era um parágrafo e seiscentos pixels de nada. Quem acabou de
// transcrever uma reunião não sabe o que dá para perguntar, então não pergunta
// — e o recurso mais caro do app fica sem uso.
const SUGESTOES = [
  'Quais foram as decisões?',
  'O que ficou pendente e com quem?',
  'Resuma para quem não estava presente',
  'Que números foram citados?',
]

// Uma conversa tem UMA thread de chat, não várias. Perguntar de novo sobre a
// mesma gravação continua a mesma leitura, com o que já foi perguntado ali em
// cima — não um chat novo que esconde o anterior atrás de uma aba de
// histórico. O id da thread mora em `chats.session_id`; a primeira pergunta
// cria a linha, as seguintes só acrescentam mensagens a ela.
export default function Chat() {
  const { user } = useAuth()
  const { conversation, perguntasRestantes, atualizarPerguntasRestantes, abrirPlano } = useOutletContext()
  const location = useLocation()
  const navigate = useNavigate()

  const [ready, setReady] = useState(false)
  const [chatId, setChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [errorStatus, setErrorStatus] = useState(null)
  const bottomRef = useRef(null)
  const firstScrollRef = useRef(true)

  const esgotado = perguntasRestantes === 0

  // Carrega a thread existente desta conversa, se houver, antes de qualquer
  // outra coisa: perguntar de novo precisa enxergar o que já foi perguntado.
  //
  // Quando se chega aqui com uma pergunta pendente (vinda da AskBar de outra
  // tela), ela não pode esperar essa carga: descriptografar um histórico
  // grande leva um tempo visível, e ficar esse tempo com a tela em branco pra
  // só então fazer pergunta+"Pensando"+histórico aparecerem juntos, de
  // supetão, é exatamente o "buga" que se quer evitar. Por isso a pergunta e
  // o "Pensando" entram no ar na hora, otimistas, e o histórico se encaixa
  // por baixo deles quando terminar de carregar — a `runAsk` (a chamada de
  // verdade à IA) só dispara depois, já com o histórico certo em mãos.
  useEffect(() => {
    let cancelled = false
    const pending = location.state?.ask
    if (pending) navigate('.', { replace: true, state: null })

    setReady(false)
    setChatId(null)
    setError(null)
    setErrorStatus(null)
    firstScrollRef.current = true
    if (pending) {
      setQuestion('')
      setMessages([{ role: 'user', content: pending }])
      setSending(true)
    } else {
      setMessages([])
      setSending(false)
    }

    ;(async () => {
      const { data: chat } = await supabase
        .from('chats').select('id')
        .eq('session_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(1).maybeSingle()
      if (cancelled) return

      let history = []
      if (chat) {
        setChatId(chat.id)
        const { data: msgs } = await supabase
          .from('chat_messages').select('role, content, enc_version')
          .eq('chat_id', chat.id).order('created_at')
        history = await decifrarMensagens(msgs)
      }
      if (cancelled) return

      if (pending) {
        setMessages([...history, { role: 'user', content: pending }])
        setReady(true)
        await runAsk(pending, history)
      } else {
        setMessages(history)
        setReady(true)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id])

  // Reentrar numa conversa que já tem histórico disparava uma sequência de
  // rolagens ANIMADAS em cima da outra — carregou o histórico, entrou a
  // pergunta, entrou o "Pensando…", entrou a resposta — e a tela sacudia do
  // topo até o fim quatro vezes. A primeira posição é um salto seco: ninguém
  // precisa ver a tela percorrer meses de conversa. Só o que chega DEPOIS,
  // com o usuário já olhando, rola suave.
  useEffect(() => {
    if (!ready) return
    const behavior = firstScrollRef.current ? 'auto' : 'smooth'
    firstScrollRef.current = false
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [messages, sending, ready])

  // Um chip não passa pelo campo: mandar o texto direto evita depender de o
  // setState ter sido aplicado antes do submit.
  function ask(texto) { send(null, texto) }

  async function send(e, texto) {
    e?.preventDefault()
    const text = (texto ?? question).trim()
    if (!text || sending || esgotado) return

    setQuestion('')
    setError(null)
    setErrorStatus(null)
    setSending(true)
    const history = messages
    setMessages([...history, { role: 'user', content: text }])
    await runAsk(text, history)
  }

  // Compartilhada pela pergunta digitada aqui e pela pendente que chega já
  // com a UI otimista no ar (ver o efeito de carga acima): as duas só diferem
  // em COMO a pergunta entrou na tela, não em como a resposta é buscada,
  // guardada e tratada quando falha.
  async function runAsk(text, previousMessages) {
    try {
      const history = previousMessages
        .slice(-MAX_HISTORY_MESSAGES)
        .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_TURN) }))
      const result = await askConversation(text, conversation, { history })

      setMessages(prev => [...prev, { role: 'assistant', content: result.answer }])
      atualizarPerguntasRestantes?.(result.perguntas_restantes)
      await persist(text, result)
      track('chat', { usage: result.usage })
    } catch (err) {
      setError(err.message)
      setErrorStatus(err.status || null)
      // 402 aqui é o limite de perguntas desta transcrição: o servidor já
      // disse que acabou, e a tela passa a mostrar o convite no lugar do campo.
      if (err.status === 402) atualizarPerguntasRestantes?.(0)
      // A pergunta volta para o campo: perdê-la porque a rede caiu é a pior
      // parte de um erro aqui.
      setMessages(previousMessages)
      setQuestion(text)
    } finally {
      setSending(false)
    }
  }

  // Best-effort: uma falha ao gravar não pode apagar a resposta da tela.
  async function persist(text, result) {
    try {
      let id = chatId
      if (!id) {
        const { data, error: insertError } = await supabase.from('chats')
          .insert({ session_id: conversation.id, user_id: user.id })
          .select('id').single()
        if (insertError) throw insertError
        id = data.id
        setChatId(id)
      }
      // A pergunta e a resposta são conteúdo do usuário como qualquer outro:
      // guardá-las em claro deixaria pela porta dos fundos justamente o resumo
      // do que foi dito na conversa.
      const pergunta = await cifrarMensagem(text)
      const resposta = await cifrarMensagem(result.answer)
      await supabase.from('chat_messages').insert([
        { chat_id: id, user_id: user.id, role: 'user', ...pergunta },
        { chat_id: id, user_id: user.id, role: 'assistant', ...resposta },
      ])
    } catch {}
  }

  return (
    <div className="conversa chat-page">
      <ConversaHeader
        conversation={conversation}
        title="Pergunte qualquer coisa"
        subtitle="Sobre esta conversa"
      />

      <div className="chat-messages">
        {ready && messages.length === 0 && !sending && (
          <div className="chat-starter">
            <IconMessage width={26} height={26} />
            <p>Pergunte o que quiser sobre esta conversa — o que ficou decidido, o que fulano disse, o que faltou.</p>
            {!esgotado && (
              <div className="starter-chips">
                {SUGESTOES.map(texto => (
                  <button key={texto} type="button" onClick={() => ask(texto)} disabled={sending}>
                    {texto}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="bubble">
              {m.role === 'assistant' ? <MarkdownText text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="message assistant">
            <div className="bubble"><span className="spinner spinner-sm" /> Pensando…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* O 402 do limite já vira o convite logo abaixo; repetir a mesma frase
          num alerta vermelho em cima dele seria dizer duas vezes que acabou. */}
      {error && errorStatus !== 402 && <div className="alert alert-error">{error}</div>}

      {/* Mesma casca visual do AskBar (classe .ask-bar): a barra de perguntar não
          pode ter uma cara dentro do chat e outra fora dele — .chat-input aqui
          só ajusta a POSIÇÃO (fixa no rodapé desta tela), a aparência vem toda
          de .ask-bar. O botão fica sempre no laranja cheio, igual ao do
          AskBar; `disabled` some por enviar (`send` já ignora texto vazio),
          não por a pergunta estar em branco — só assim o estado de repouso
          desta tela e o do AskBar são visualmente idênticos. */}
      {esgotado ? (
        <div className="ask-bar chat-input ask-esgotado">
          <span>Você usou todas as perguntas desta transcrição.</span>
          <button type="button" className="btn-primary btn-sm" onClick={abrirPlano}>Ver planos</button>
        </div>
      ) : (
        <div className="chat-input-area">
          <form className="ask-bar chat-input" onSubmit={send}>
            <ChatTextarea
              value={question}
              onChange={setQuestion}
              onSubmit={send}
              placeholder="Pergunte qualquer coisa sobre esta conversa"
              disabled={sending}
            />
            <button type="submit" className="btn-icon ask-send" disabled={sending} aria-label="Enviar">
              <IconSend width={18} height={18} />
            </button>
          </form>
          {perguntasRestantes != null && (
            <p className="ask-restantes">{textoPerguntasRestantes(perguntasRestantes)}</p>
          )}
        </div>
      )}
    </div>
  )
}
