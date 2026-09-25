import { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { transcribeFile, processUrl, wakeBackend, criarTranscricao } from '../lib/api'
import { createConversation, seedChatWithSummary, displayTitle } from '../lib/conversas'
import { track } from '../lib/analytics'
import { showToast } from '../lib/toast'
import { MODO_SIMPLES } from '../components/capture/modos'
import { garantirChave, abrirResultado } from '../lib/chaveTranscricao'
import { listarNoServidor, resultadoNoServidor, reivindicarNoServidor, apagarNoServidor } from '../lib/transcricoesServidor'
import { aoAvisoDeTranscricao, pedirNotificacoes } from '../lib/notificacoes'

// As transcrições em andamento moram AQUI, acima das rotas, e não no painel de
// captura.
//
// Antes o painel esperava a transcrição inteira, com a tela presa em
// "Transcrevendo e resumindo…": para gravar a próxima reunião era preciso
// esperar a anterior terminar. Agora "Transcrever" entrega o pedido a esta
// fila e o painel fica livre na hora. A fila guarda a conversa quando o
// resultado chega, marca a linha dela na lateral com a bolinha de não lida e
// avisa com discrição, sem arrancar a pessoa do que ela estiver fazendo.
//
// Dois caminhos por trás do mesmo pedido:
// - no servidor: o arquivo sobe, o servidor devolve um número e segue sozinho.
//   A pessoa pode fechar o app; o resultado fica guardado cifrado para a chave
//   dela (chaveTranscricao.js) até um aparelho dela buscar, e o celular recebe
//   uma notificação. É o caminho de quem tem conta.
// - no app: a espera é uma requisição só, como sempre foi. Vale para o
//   convidado (que não tem chave), para servidor antigo e para quem ainda não
//   tem a tabela no banco. O app precisa ficar aberto até o fim.
const TranscricoesContext = createContext(null)

export function useTranscricoes() {
  const valor = useContext(TranscricoesContext)
  if (!valor) throw new Error('useTranscricoes precisa de um TranscricoesProvider acima na árvore')
  return valor
}

// Quantas sobem ao mesmo tempo. Mais que isso disputa a mesma conexão do
// celular e deixa todas lentas; as outras esperam a vez na fila.
const MAX_SUBINDO = 2

// De quanto em quanto tempo perguntar ao servidor, enquanto há alguma lá.
const INTERVALO_SERVIDOR_MS = 4000

// Uma transcrição "processando" há mais que isto não vai terminar: o servidor
// reiniciou no meio (publicação nova, hibernação). Oito horas de áudio levam
// poucos minutos, então a folga é grande.
const PARADA_MS = 45 * 60 * 1000

export const ROTULO_ORIGEM = { record: 'Gravação', file: 'Áudio', url: 'Vídeo' }

const VAZIO = {
  record: 'Não captamos áudio suficiente. Tente gravar novamente, mais perto do microfone.',
  file: 'Não conseguimos extrair áudio ou texto deste arquivo.',
  url: 'Não conseguimos extrair conteúdo deste link.',
}

const PARADA = 'A transcrição não terminou no servidor. Envie de novo.'

function novoId() {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

const chaveNaoLidas = userId => `dito-nao-lidas:${userId}`
const chaveRecebendo = userId => `dito-recebendo:${userId}:`

function lerNaoLidas(userId) {
  if (!userId) return new Set()
  try { return new Set(JSON.parse(localStorage.getItem(chaveNaoLidas(userId)) || '[]')) } catch { return new Set() }
}

function gravarNaoLidas(userId, conjunto) {
  if (!userId) return
  try { localStorage.setItem(chaveNaoLidas(userId), JSON.stringify([...conjunto])) } catch { /* sem storage */ }
}

// Uma linha do servidor que este aparelho não conhece (enviada do outro
// aparelho, ou antes de o app ser fechado): vira um item da fila com o que a
// linha diz, sem o arquivo, que ficou com quem enviou.
function itemDoServidor(linha) {
  return {
    id: `srv-${linha.id}`,
    jobId: linha.id,
    origem: linha.origem,
    modo: linha.modo,
    duracaoS: linha.duracao_s || null,
    rotulo: ROTULO_ORIGEM[linha.origem] || 'Transcrição',
    criadoEm: Date.parse(linha.criada_em) || Date.now(),
    estado: 'processando',
  }
}

export function TranscricoesProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = user?.id || null
  const convidado = !!user?.is_anonymous

  const [itens, setItens] = useState([])
  const itensRef = useRef(itens)
  itensRef.current = itens

  const [naoLidas, setNaoLidas] = useState(() => lerNaoLidas(userId))
  // Sobe a cada conversa nova: a lateral relê a lista quando ele muda.
  const [versaoLista, setVersaoLista] = useState(0)

  // A tela aberta agora, lida dentro de trabalhos que terminam minutos depois.
  // O navigate vai num ref pelo mesmo motivo, e por mais um: ele muda de
  // identidade a cada troca de tela, e arrastaria junto todas as funções
  // daqui (e a consulta ao servidor que depende delas) a cada navegação.
  const rotaRef = useRef(location.pathname)
  rotaRef.current = location.pathname
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // null = ainda não sabido; true/false depois da primeira tentativa.
  const servidorRef = useRef(null)
  const recebendoRef = useRef(new Set())
  const sincronizandoRef = useRef(false)
  const deNovoRef = useRef(null)

  // Trocou de conta (ou saiu): a fila e as bolinhas eram da outra pessoa.
  useEffect(() => {
    setItens([])
    setNaoLidas(lerNaoLidas(userId))
    servidorRef.current = null
  }, [userId])

  const atualizar = useCallback((id, mudanca) => {
    setItens(prev => prev.map(i => (i.id === id ? { ...i, ...mudanca } : i)))
  }, [])

  const remover = useCallback(id => {
    setItens(prev => prev.filter(i => i.id !== id))
  }, [])

  const marcarNaoLida = useCallback(conversaId => {
    setNaoLidas(prev => {
      const novo = new Set(prev)
      novo.add(conversaId)
      gravarNaoLidas(userId, novo)
      return novo
    })
  }, [userId])

  const marcarLida = useCallback(conversaId => {
    setNaoLidas(prev => {
      if (!prev.has(conversaId)) return prev
      const novo = new Set(prev)
      novo.delete(conversaId)
      gravarNaoLidas(userId, novo)
      return novo
    })
  }, [userId])

  // O resultado chegou: vira conversa, cifrada como qualquer outra.
  const concluir = useCallback(async (item, result, { abrir = false } = {}) => {
    if (!result?.transcript || result.transcript.trim().length < 5) {
      atualizar(item.id, { estado: 'erro', erro: VAZIO[item.origem] || VAZIO.file, semRetentar: true })
      return
    }
    // O convidado (sem conta, sem senha) não tem chave de criptografia
    // possível: a conversa dele nasce em texto puro, não cifrada.
    const cifrar = !convidado
    const nomeReserva = item.origem === 'url' ? item.url : item.nomeArquivo || item.rotulo
    const conversa = await createConversation(userId, result, item.origem, nomeReserva, { cifrar })
    // Vale o modo que o backend RODOU, não o pedido: no plano Grátis um
    // pedido de completa (de uma versão antiga do app) é atendido como
    // simples, e cairia numa tela sem tópicos.
    const simples = (result.mode || item.modo) === MODO_SIMPLES
    if (simples) await seedChatWithSummary(userId, conversa.id, result.summary, { cifrar })

    track('captura', {
      origem: { record: 'gravacao', file: 'arquivo', url: 'link' }[item.origem] || item.origem,
      midia: item.origem === 'url'
        ? (result.usage?.audio_seconds ? 'video' : 'texto')
        : (item.tipoArquivo?.startsWith('video/') ? 'video' : 'audio'),
      duracao_s: item.duracaoS || null,
      modo: result.mode || item.modo,
      usage: result.usage,
      no_servidor: !!item.jobId,
    })

    marcarNaoLida(conversa.id)
    setVersaoLista(v => v + 1)

    // Quem abriu a linha desta transcrição e está esperando nela vai direto
    // para a conversa. Os outros continuam onde estão e recebem o aviso. A
    // navegação vem antes de tirar o item da fila: sem o item, a tela de
    // espera mandaria para a home antes de a conversa abrir.
    const destino = `/conversa/${conversa.id}${simples ? '/chat' : ''}`
    if (abrir || rotaRef.current === `/transcrevendo/${item.id}`) {
      navigateRef.current(destino, { replace: rotaRef.current === `/transcrevendo/${item.id}` })
    } else {
      showToast(`Pronta: ${displayTitle(conversa)}`, {
        actionLabel: 'Abrir',
        onAction: () => navigateRef.current(destino),
        duration: 7000,
      })
    }
    remover(item.id)
  }, [atualizar, convidado, marcarNaoLida, remover, userId])

  async function podeUsarServidor() {
    if (!userId || convidado) return false
    if (servidorRef.current !== null) return servidorRef.current
    const ok = await garantirChave(userId).catch(() => false)
    servidorRef.current = ok
    return ok
  }

  const enviar = useCallback(async item => {
    try {
      // O plano grátis do Render hiberna: mandar o arquivo para uma instância
      // dormindo derrubava a conexão no meio do upload.
      await wakeBackend().catch(() => {})

      if (await podeUsarServidor()) {
        try {
          const { id: jobId } = await criarTranscricao({
            arquivo: item.arquivo, url: item.url, origem: item.origem, modo: item.modo, duracaoS: item.duracaoS,
          })
          atualizar(item.id, { estado: 'processando', jobId, enviadaEm: Date.now() })
          // O momento em que "avisar quando ficar pronta" faz sentido. Só
          // pergunta uma vez; no computador não faz nada.
          pedirNotificacoes()
          return
        } catch (err) {
          // Servidor antigo (404) ou sem a chave pública (409): segue pelo
          // caminho de sempre nesta sessão.
          if (err.status !== 404 && err.status !== 409) throw err
          servidorRef.current = false
        }
      }

      const result = item.url
        ? await processUrl(item.url, item.modo)
        : await transcribeFile(item.arquivo, item.modo, item.origem)
      await concluir(item, result)
    } catch (err) {
      atualizar(item.id, { estado: 'erro', erro: err.message, erroStatus: err.status || null })
    }
    // podeUsarServidor lê só refs e o usuário; listar as dependências dele
    // aqui recriaria `enviar` a cada render sem mudar nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atualizar, concluir, userId, convidado])

  // Anda a fila: sobe o próximo sempre que há vaga.
  useEffect(() => {
    const subindo = itens.filter(i => i.estado === 'subindo').length
    const proximo = itens.find(i => i.estado === 'fila')
    if (!proximo || subindo >= MAX_SUBINDO) return
    atualizar(proximo.id, { estado: 'subindo' })
    enviar(proximo)
  }, [itens, atualizar, enviar])

  // ── Servidor ───────────────────────────────────────────────
  const receber = useCallback(async (linha, local, { abrir = false } = {}) => {
    if (recebendoRef.current.has(linha.id)) return
    recebendoRef.current.add(linha.id)
    const item = local || itemDoServidor(linha)
    const guardado = `${chaveRecebendo(userId)}${linha.id}`
    try {
      const texto = await resultadoNoServidor(linha.id)
      if (!texto) return
      const result = await abrirResultado(userId, texto)
      // Guardado cifrado antes de apagar do servidor: se o app fechar entre
      // apagar e salvar a conversa, a próxima abertura termina o serviço.
      try { localStorage.setItem(guardado, JSON.stringify({ texto, linha })) } catch { /* grande demais: segue */ }
      if (!(await reivindicarNoServidor(linha.id))) {
        // Outro aparelho desta conta levou (e guardou a conversa).
        try { localStorage.removeItem(guardado) } catch { /* idem */ }
        remover(item.id)
        setVersaoLista(v => v + 1)
        return
      }
      if (!local) setItens(prev => (prev.some(i => i.id === item.id) ? prev : [...prev, item]))
      await concluir(item, result, { abrir })
      try { localStorage.removeItem(guardado) } catch { /* idem */ }
    } catch (err) {
      setItens(prev => (prev.some(i => i.id === item.id) ? prev : [...prev, item]))
      atualizar(item.id, { estado: 'erro', erro: err.message || 'Não foi possível abrir esta transcrição.' })
    } finally {
      recebendoRef.current.delete(linha.id)
    }
  }, [atualizar, concluir, remover, userId])

  // O que ficou guardado no meio de um recebimento que não terminou.
  const terminarRecebimentos = useCallback(async () => {
    if (!userId) return
    let chaves = []
    try {
      chaves = Object.keys(localStorage).filter(k => k.startsWith(chaveRecebendo(userId)))
    } catch { return }
    for (const k of chaves) {
      try {
        const { texto, linha } = JSON.parse(localStorage.getItem(k))
        const result = await abrirResultado(userId, texto)
        await concluir(itemDoServidor(linha), result)
      } catch { /* ilegível: não há o que salvar */ }
      try { localStorage.removeItem(k) } catch { /* sem storage */ }
    }
  }, [concluir, userId])

  const sincronizar = useCallback(async ({ abrirJobId = null } = {}) => {
    if (!userId || convidado) return
    if (sincronizandoRef.current) { deNovoRef.current = { abrirJobId }; return }
    sincronizandoRef.current = true
    try {
      await terminarRecebimentos()
      const linhas = await listarNoServidor()
      if (!linhas) return
      const doServidor = new Set(linhas.map(l => l.id))
      const locais = itensRef.current

      for (const linha of linhas) {
        const local = locais.find(i => i.jobId === linha.id)
        const idade = Date.now() - (Date.parse(linha.criada_em) || Date.now())

        if (linha.estado === 'pronta') {
          await receber(linha, local, { abrir: abrirJobId === linha.id })
        } else if (linha.estado === 'erro' || (linha.estado === 'processando' && idade > PARADA_MS)) {
          const erro = linha.estado === 'erro' ? linha.erro || 'A transcrição falhou.' : PARADA
          if (local) {
            if (local.estado !== 'erro') atualizar(local.id, { estado: 'erro', erro, erroStatus: linha.erro_status || null })
          } else {
            const novo = { ...itemDoServidor(linha), estado: 'erro', erro, erroStatus: linha.erro_status || null }
            setItens(prev => (prev.some(i => i.jobId === linha.id) ? prev : [...prev, novo]))
          }
        } else if (!local) {
          const novo = itemDoServidor(linha)
          setItens(prev => (prev.some(i => i.jobId === linha.id) ? prev : [...prev, novo]))
        }
      }

      // Estava no servidor e sumiu de lá sem passar por aqui: outro aparelho
      // desta conta buscou. A conversa já existe; só falta reler a lista.
      const levadas = locais.filter(i => i.jobId && i.estado === 'processando' && !doServidor.has(i.jobId))
      if (levadas.length) {
        setItens(prev => prev.filter(i => !levadas.some(l => l.id === i.id)))
        setVersaoLista(v => v + 1)
      }
    } finally {
      sincronizandoRef.current = false
      const deNovo = deNovoRef.current
      deNovoRef.current = null
      if (deNovo) sincronizar(deNovo)
    }
  }, [atualizar, convidado, receber, terminarRecebimentos, userId])

  // Ao entrar: o que terminou com o app fechado já é buscado na abertura.
  useEffect(() => { if (userId && !convidado) sincronizar() }, [userId, convidado, sincronizar])

  // Enquanto há alguma no servidor, pergunta de tempos em tempos, só com a
  // tela à vista; ao voltar para o app, pergunta na hora.
  const temNoServidor = itens.some(i => i.jobId && i.estado === 'processando')
  useEffect(() => {
    if (!temNoServidor) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') sincronizar()
    }, INTERVALO_SERVIDOR_MS)
    return () => clearInterval(timer)
  }, [temNoServidor, sincronizar])

  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible') sincronizar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [sincronizar])

  // A notificação de pronta: com o app aberto só busca; tocada, busca e abre.
  useEffect(() => aoAvisoDeTranscricao((dados, { tocou }) => {
    sincronizar({ abrirJobId: tocou ? dados?.id || null : null })
  }), [sincronizar])

  // Sair da página no meio de um envio perde o envio (no caminho do app, a
  // transcrição inteira). Depois que o servidor recebeu, fechar é seguro.
  const subindoAlgum = itens.some(i => i.estado === 'subindo' || i.estado === 'fila')
  useEffect(() => {
    if (!subindoAlgum) return
    const avisar = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [subindoAlgum])

  // ── O que as telas usam ────────────────────────────────────
  const transcrever = useCallback(pedido => {
    const item = {
      id: novoId(),
      estado: 'fila',
      criadoEm: Date.now(),
      nomeArquivo: pedido.arquivo?.name || null,
      tipoArquivo: pedido.arquivo?.type || null,
      ...pedido,
    }
    setItens(prev => [...prev, item])
    return item.id
  }, [])

  const tentarDeNovo = useCallback(id => {
    const item = itensRef.current.find(i => i.id === id)
    if (!item || (!item.arquivo && !item.url)) return
    if (item.jobId) apagarNoServidor(item.jobId).catch(() => {})
    atualizar(id, { estado: 'fila', jobId: null, erro: null, erroStatus: null })
  }, [atualizar])

  const dispensar = useCallback(id => {
    const item = itensRef.current.find(i => i.id === id)
    if (item?.jobId) apagarNoServidor(item.jobId).catch(() => {})
    remover(id)
  }, [remover])

  // Minutos das que ainda não terminaram: a captura seguinte precisa saber
  // quanto do mês já está comprometido, senão a segunda passaria na conferência
  // e só falharia no fim, por falta de saldo.
  const minutosEmAndamento = useMemo(() => itens
    .filter(i => i.estado !== 'erro')
    .reduce((soma, i) => soma + (i.duracaoS ? i.duracaoS / 60 : 0), 0), [itens])

  const valor = useMemo(() => ({
    itens,
    naoLidas,
    versaoLista,
    minutosEmAndamento,
    transcrever,
    tentarDeNovo,
    dispensar,
    marcarLida,
  }), [itens, naoLidas, versaoLista, minutosEmAndamento, transcrever, tentarDeNovo, dispensar, marcarLida])

  return <TranscricoesContext.Provider value={valor}>{children}</TranscricoesContext.Provider>
}

// Como a linha se descreve: o que é, e em que pé está.
export function estadoDoItem(item) {
  if (item.estado === 'erro') return 'Não deu certo'
  if (item.estado === 'fila') return 'Na fila'
  return 'Transcrevendo'
}
