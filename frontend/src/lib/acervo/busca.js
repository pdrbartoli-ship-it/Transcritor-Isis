// A busca do "Perguntar ao acervo", inteira no aparelho. É a tradução para
// JavaScript do que o teste de recall mediu em 20/09/2026
// (.claude/skills/teste-qualidade/casos/recall/recall2.py): BM25 com as
// palavras que a IA devolveu, fundido com a similaridade dos vetores.
//
// Os números que justificam este desenho, em 43 perguntas sobre 5 conversas:
//   busca por palavra    63% de acerto em 1º, 88% de chance de o trecho certo
//                        chegar à IA
//   vetores do Gemini    93% e 100%
// A fusão dos dois teve a melhor ordenação média, e a busca por palavra é de
// graça — por isso as duas ficam ligadas, e por isso uma conversa ainda sem
// vetor continua aparecendo nos resultados.

// Acentos fora, minúsculas. "Sessão" e "sessao" têm de casar: transcrição de
// fala erra acento o tempo todo.
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const STOP = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem e ou que qual quais quem quando onde como foi ser era sao e ao aos se ja mais muito nao sim tem ter vai vao esta estao pelo pela pelos pelas sobre segundo dele dela deles delas seu sua seus suas meu minha eu voce ela ele isso esse essa este esta aquele aquela entre ate depois antes so tambem mas').split(' '))

// Corte em 6 letras: é o "stemming" mais burro que existe e foi o que mediu
// melhor no teste — junta "decidiu/decidido/decisão" sem dicionário nenhum.
export function tokens(texto) {
  const brutos = norm(texto).match(/[a-z0-9]+/g) || []
  return brutos.filter(w => w.length > 1 && !STOP.has(w)).map(w => w.slice(0, 6))
}

export class BM25 {
  constructor(docs, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1; this.b = b
    this.tf = docs.map(d => {
      const m = new Map()
      for (const w of d) m.set(w, (m.get(w) || 0) + 1)
      return m
    })
    this.len = docs.map(d => d.length)
    this.avg = this.len.reduce((a, b) => a + b, 0) / (docs.length || 1)
    const df = new Map()
    for (const t of this.tf) for (const w of t.keys()) df.set(w, (df.get(w) || 0) + 1)
    const n = docs.length || 1
    this.idf = new Map()
    for (const [w, f] of df) this.idf.set(w, Math.log(1 + (n - f + 0.5) / (f + 0.5)))
  }

  score(consulta) {
    const termos = [...new Set(consulta)]
    return this.tf.map((t, i) => {
      let sc = 0
      for (const w of termos) {
        const f = t.get(w)
        if (!f) continue
        sc += this.idf.get(w) * f * (this.k1 + 1) /
          (f + this.k1 * (1 - this.b + this.b * this.len[i] / this.avg))
      }
      return sc
    })
  }
}

// Os vetores do Gemini já vêm normalizados, mas dividir pela norma custa
// nada e protege de um vetor gravado por uma versão anterior.
export function similaridade(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let num = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { num += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? num / Math.sqrt(na * nb) : 0
}

// Fusão por posição (Reciprocal Rank Fusion), e não por nota: a nota do BM25 e
// o cosseno dos vetores não vivem na mesma escala, e somá-las direto deixaria
// o BM25 mandar sozinho em consultas com palavra rara.
export function rrf(listas, k = 60) {
  const sc = new Map()
  for (const ordem of listas) {
    ordem.forEach((i, pos) => sc.set(i, (sc.get(i) || 0) + 1 / (k + pos + 1)))
  }
  return [...sc.keys()].sort((x, y) => sc.get(y) - sc.get(x))
}

const ordemPor = notas =>
  notas.map((n, i) => i).filter(i => notas[i] > 0).sort((x, y) => notas[y] - notas[x])

// Quantos trechos vão para a IA, e quantos no máximo de uma mesma conversa.
// O teto por conversa é o que impede "as últimas 2 reuniões" de ser respondida
// só com a primeira delas.
export const MAX_TRECHOS = 8
export const MAX_POR_CONVERSA = 3

// Recência e intervalo de datas vêm do passo que entende a pergunta ("as
// últimas 2", "mês passado"). Aplicados ANTES da escolha dos 8: filtrar depois
// deixaria as vagas ocupadas por conversas que a pessoa excluiu na pergunta.
function filtrarPorTempo(trechos, plano) {
  let permitidos = null

  if (plano?.desde || plano?.ate) {
    const desde = plano.desde ? new Date(`${plano.desde}T00:00:00`) : null
    const ate = plano.ate ? new Date(`${plano.ate}T23:59:59`) : null
    permitidos = new Set(
      trechos.filter(t => {
        const d = new Date(t.data)
        return (!desde || d >= desde) && (!ate || d <= ate)
      }).map(t => t.sessionId)
    )
  }

  if (plano?.recencia) {
    // "As últimas N" é sobre conversas, não sobre trechos: as N mais recentes
    // entre as que sobraram dos outros filtros.
    const porConversa = new Map()
    for (const t of trechos) {
      if (permitidos && !permitidos.has(t.sessionId)) continue
      if (!porConversa.has(t.sessionId)) porConversa.set(t.sessionId, t.data)
    }
    const recentes = [...porConversa.entries()]
      .sort((a, b) => new Date(b[1]) - new Date(a[1]))
      .slice(0, plano.recencia)
      .map(([id]) => id)
    permitidos = new Set(recentes)
  }

  return permitidos
}

/**
 * Escolhe os trechos que vão para a IA.
 *
 * `trechos` é o índice inteiro já em memória; `vetorPergunta` pode ser null
 * (conversa ainda sem vetor, chave do Gemini fora do ar), e nesse caso a busca
 * por palavra responde sozinha.
 */
export function buscar({ trechos, pergunta, plano = {}, vetorPergunta = null, bm25 = null }) {
  if (!trechos.length) return { escolhidos: [], conversasBuscadas: 0, conversasUsadas: 0 }

  const conversasBuscadas = new Set(trechos.map(t => t.sessionId)).size
  const indice = bm25 || construirBM25(trechos)

  // As palavras que a IA devolveu entram junto com a pergunta, não no lugar
  // dela: foi assim que o teste mediu, e é o que resolve conteúdo em outro
  // idioma (40% → 80% de acerto em 1º lugar no vídeo em inglês).
  const consulta = tokens(`${plano.pergunta || pergunta} ${(plano.palavras || []).join(' ')}`)
  const ordens = [ordemPor(indice.score(consulta))]

  if (vetorPergunta) {
    ordens.push(ordemPor(trechos.map(t => (t.vetor ? similaridade(vetorPergunta, t.vetor) : 0))))
  }

  const permitidos = filtrarPorTempo(trechos, plano)
  // As conversas que a IA apontou pelo título sobem, mas não excluem as
  // outras: no teste ela acertou a conversa certa em 42 de 43 perguntas, e a
  // 43ª não pode ficar sem resposta por causa disso.
  const apontadas = new Set(plano.conversas || [])

  let ordem = rrf(ordens)
  if (permitidos) ordem = ordem.filter(i => permitidos.has(trechos[i].sessionId))
  if (apontadas.size) {
    const dentro = ordem.filter(i => apontadas.has(trechos[i].sessionId))
    const fora = ordem.filter(i => !apontadas.has(trechos[i].sessionId))
    ordem = [...dentro, ...fora]
  }

  // "O que ficou decidido esta semana?" não tem palavra rara nenhuma: pode
  // acontecer de o filtro de tempo apontar as conversas certas e nenhum trecho
  // casar por palavra nem por vetor. Devolver nada aí seria pior do que
  // devolver o começo do que ela pediu, que é o que uma pessoa faria.
  if (!ordem.length && permitidos?.size) {
    ordem = trechos
      .map((t, i) => i)
      .filter(i => permitidos.has(trechos[i].sessionId))
      .sort((x, y) => {
        const resumo = i => (trechos[i].tipo === 'fala' ? 1 : 0)
        return resumo(x) - resumo(y) || new Date(trechos[y].data) - new Date(trechos[x].data)
      })
  }

  const escolhidos = []
  const porConversa = new Map()
  for (const i of ordem) {
    const conv = trechos[i].sessionId
    const usados = porConversa.get(conv) || 0
    if (usados >= MAX_POR_CONVERSA) continue
    porConversa.set(conv, usados + 1)
    escolhidos.push(trechos[i])
    if (escolhidos.length === MAX_TRECHOS) break
  }

  return {
    escolhidos,
    conversasBuscadas,
    conversasUsadas: new Set(escolhidos.map(t => t.sessionId)).size,
  }
}

// O índice de palavras é construído uma vez por carga do acervo e reaproveitado
// entre as perguntas: refazê-lo a cada pergunta é o que faria a segunda
// demorar tanto quanto a primeira.
export function construirBM25(trechos) {
  // O título entra nos tokens de cada trecho da conversa: quem pergunta por
  // "reunião de sprint" costuma estar lembrando do nome, não do que foi dito.
  return new BM25(trechos.map(t => [...tokens(t.texto), ...tokens(t.titulo)]))
}
