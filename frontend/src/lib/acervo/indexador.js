// Indexa o acervo em segundo plano, uma conversa por vez e sem repetir
// trabalho. Roda ao abrir a tela "Perguntar ao acervo": indexar antes disso
// gastaria a indexação de quem nunca vai usar o recurso.
//
// São duas fases, nesta ordem, e a separação é o que faz a tela funcionar
// mesmo quando a segunda falha:
//   texto    quebra a conversa em trechos e guarda no aparelho. De graça, e
//            já basta para a busca por palavra responder.
//   vetores  manda os trechos ao /embeddar e guarda os vetores. Custa
//            R$ 0,012 por hora de conversa, uma vez só, e é o que leva o
//            acerto de 63% para 93% (teste de recall, 20/09/2026).

import { carregarConversasCompletas } from '../conversas'
import { embeddar } from '../api'
import { trechosDaConversa, impressaoDaConversa } from './trechos'
import {
  lerEstado, gravarConversa, gravarVetores, lerTrechosSemVetor, limparOrfaos,
} from './indice'

// Lotes: 10 conversas por consulta ao banco (as colunas `segments` e
// `insights` são pesadas) e 100 trechos por chamada ao /embeddar, que é o teto
// do backend.
const LOTE_CONVERSAS = 10
const LOTE_EMBED = 100

/**
 * Deixa o índice em dia com a lista de conversas.
 *
 * `conversas` são as linhas da listagem (já decifradas). `aoAndar` recebe
 * { fase, feitas, total } para a tela mostrar o progresso, e `parar` é
 * consultado entre os passos para o indexador morrer junto com a tela.
 *
 * Nunca lança: uma conversa que falha é pulada e tentada na próxima vez. Uma
 * feature que gasta API não pode derrubar a tela por causa de uma linha
 * ilegível ou de uma queda de rede.
 */
export async function sincronizar(userId, conversas, { aoAndar, parar } = {}) {
  const pare = () => (parar ? parar() : false)
  const avisar = (fase, feitas, total) => aoAndar?.({ fase, feitas, total })
  const resultado = { indexadas: 0, comVetor: 0, falhas: 0, semVetor: 0 }

  let estado
  try {
    estado = await lerEstado(userId)
    await limparOrfaos(new Set(conversas.map(c => c.id)))
  } catch {
    // Sem IndexedDB (navegador em modo restrito) não há índice possível.
    return { ...resultado, indisponivel: true }
  }

  // Conversa bloqueada (gravada com outra chave) não tem como ser indexada, e
  // insistir nela a cada abertura da tela seria erro toda vez.
  const candidatas = conversas.filter(c => !c._bloqueada)
  const pendentes = candidatas.filter(c => estado.get(c.id)?.impressao !== impressaoDaConversa(c))

  // ── Fase 1: texto ──────────────────────────────────────────
  for (let i = 0; i < pendentes.length; i += LOTE_CONVERSAS) {
    if (pare()) return resultado
    avisar('texto', i, pendentes.length)
    const ids = pendentes.slice(i, i + LOTE_CONVERSAS).map(c => c.id)
    let completas = []
    try {
      completas = await carregarConversasCompletas(ids)
    } catch {
      resultado.falhas += ids.length
      continue
    }
    for (const completa of completas) {
      if (completa._bloqueada) { resultado.falhas++; continue }
      try {
        const daLista = pendentes.find(c => c.id === completa.id)
        const trechos = trechosDaConversa(completa)
        await gravarConversa(userId, { ...completa, impressao: impressaoDaConversa(daLista || completa) }, trechos)
        resultado.indexadas++
      } catch {
        resultado.falhas++
      }
    }
  }
  avisar('texto', pendentes.length, pendentes.length)

  // ── Fase 2: vetores ────────────────────────────────────────
  // Releem do índice em vez de reaproveitar o que a fase 1 tinha em mãos: é o
  // mesmo caminho para a conversa indexada agora e para a que ficou sem vetor
  // numa tentativa anterior.
  const semVetor = candidatas.filter(c => {
    const reg = estado.get(c.id)
    return !reg || reg.semVetor > 0 || pendentes.includes(c)
  })

  for (const [n, conversa] of semVetor.entries()) {
    if (pare()) return resultado
    avisar('vetores', n, semVetor.length)
    let pendentesDaConversa
    try {
      pendentesDaConversa = await lerTrechosSemVetor(conversa.id)
    } catch {
      continue
    }
    if (!pendentesDaConversa.length) continue

    try {
      for (let i = 0; i < pendentesDaConversa.length; i += LOTE_EMBED) {
        if (pare()) return resultado
        const lote = pendentesDaConversa.slice(i, i + LOTE_EMBED)
        const vetores = await embeddar(lote.map(t => t.texto))
        await gravarVetores(conversa.id, lote.map((t, k) => [t.id, vetores[k]]))
      }
      resultado.comVetor++
    } catch {
      // Sem rede, sem chave do Gemini ou cota estourada: o texto já está
      // indexado e a busca por palavra responde. Paramos a fase inteira em vez
      // de tentar as outras conversas — o motivo da falha é o mesmo para
      // todas, e insistir seria uma chamada perdida por conversa. Na próxima
      // abertura da tela tentamos de novo de onde parou.
      resultado.semVetor = semVetor.length - n
      return resultado
    }
  }
  avisar('vetores', semVetor.length, semVetor.length)

  return resultado
}
