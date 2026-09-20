// O índice do acervo, no aparelho. É o único lugar onde ele existe: as
// conversas são cifradas no navegador e o servidor só guarda ruído, então não
// há (nem pode haver) índice do lado de lá.
//
// Guardamos por trecho: o texto (cifrado com a chave do usuário, ver cofre.js)
// e o vetor de 768 números que o /embeddar devolveu. Cabem ~90 KB de vetores e
// ~50 KB de texto por hora de conversa, ou cerca de 14 MB para 100 horas.

import { cifrarTextos, decifrarTextos } from '../cofre'

const DB_NAME = 'dito-acervo'
const DB_VERSAO = 1
const TRECHOS = 'trechos'
const CONVERSAS = 'conversas'

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSAO)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(TRECHOS)) {
        db.createObjectStore(TRECHOS, { keyPath: 'id' }).createIndex('sessionId', 'sessionId')
      }
      if (!db.objectStoreNames.contains(CONVERSAS)) {
        db.createObjectStore(CONVERSAS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Uma transação por operação, sempre fechando o banco: o Safari deixa
// transações abertas travarem a próxima, e o índice não é quente o bastante
// para valer manter conexão viva.
async function transacao(stores, modo, fn) {
  const db = await abrirDB()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, modo)
      let resultado
      tx.oncomplete = () => resolve(resultado)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      Promise.resolve(fn(...stores.map(s => tx.objectStore(s)), tx))
        .then(v => { resultado = v })
        .catch(reject)
    })
  } finally {
    db.close()
  }
}

const pedir = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

// ── O que já está indexado ───────────────────────────────────
// `impressao` é o que decide reindexar: ela muda quando a transcrição ou os
// insights mudam, e NÃO muda quando a pessoa só renomeia a conversa — o título
// não vira vetor, então renomear não pode custar uma indexação nova.
export async function lerEstado(userId) {
  const linhas = await transacao([CONVERSAS], 'readonly', s => pedir(s.getAll()))
  const mapa = new Map()
  for (const l of linhas) if (l.userId === userId) mapa.set(l.id, l)
  return mapa
}

export async function gravarConversa(userId, conversa, trechos) {
  const { textos, encVersion } = await cifrarTextos(trechos.map(t => t.texto))
  const { textos: titulos } = await cifrarTextos([conversa.title || ''])

  const registros = trechos.map((t, i) => ({
    id: t.id,
    sessionId: t.sessionId,
    data: t.data,
    ini: t.ini,
    fim: t.fim,
    tipo: t.tipo,
    texto: textos[i],
    titulo: titulos[0],
    encVersion,
    vetor: null,
  }))

  await transacao([TRECHOS, CONVERSAS], 'readwrite', async (st, sc) => {
    await apagarTrechosDe(st, conversa.id)
    for (const r of registros) st.put(r)
    sc.put({
      id: conversa.id,
      userId,
      impressao: conversa.impressao,
      nTrechos: registros.length,
      semVetor: registros.length,
      indexadoEm: new Date().toISOString(),
    })
  })
}

function apagarTrechosDe(store, sessionId) {
  return new Promise((resolve, reject) => {
    const req = store.index('sessionId').openKeyCursor(IDBKeyRange.only(sessionId))
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) return resolve()
      store.delete(cur.primaryKey)
      cur.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

// Os vetores chegam depois do texto, em lotes: indexar é um passo que pode
// falhar (sem rede, chave do Gemini fora do ar) e a busca por palavra responde
// enquanto isso.
export async function gravarVetores(sessionId, vetoresPorId) {
  await transacao([TRECHOS, CONVERSAS], 'readwrite', async (st, sc) => {
    for (const [id, vetor] of vetoresPorId) {
      const atual = await pedir(st.get(id))
      if (atual) st.put({ ...atual, vetor: Float32Array.from(vetor) })
    }
    const conv = await pedir(sc.get(sessionId))
    if (conv) sc.put({ ...conv, semVetor: Math.max(0, (conv.semVetor ?? 0) - vetoresPorId.length) })
  })
}

export async function apagarConversa(sessionId) {
  await transacao([TRECHOS, CONVERSAS], 'readwrite', async (st, sc) => {
    await apagarTrechosDe(st, sessionId)
    sc.delete(sessionId)
  })
}

export async function apagarTudo() {
  try {
    await transacao([TRECHOS, CONVERSAS], 'readwrite', (st, sc) => { st.clear(); sc.clear() })
  } catch { /* nada indexado ainda */ }
}

// ── Carga para a busca ───────────────────────────────────────
// `titulos` vem de fora (da lista que o app já tem em mãos) porque ele muda
// sem reindexação: renomear uma conversa tem de aparecer na citação na hora.
export async function carregarTrechos(titulosPorId) {
  const linhas = await transacao([TRECHOS], 'readonly', s => pedir(s.getAll()))
  // Trecho de conversa apagada (ou de outro usuário neste mesmo aparelho) fica
  // de fora: a lista de conversas é a fonte de verdade, não o índice.
  const validos = linhas.filter(l => titulosPorId.has(l.sessionId))

  const porVersao = new Map()
  for (const l of validos) {
    const chave = l.encVersion ?? 0
    if (!porVersao.has(chave)) porVersao.set(chave, [])
    porVersao.get(chave).push(l)
  }

  const saida = []
  for (const [versao, lote] of porVersao) {
    const textos = await decifrarTextos(lote.map(l => l.texto), versao || null)
    lote.forEach((l, i) => saida.push({
      id: l.id,
      sessionId: l.sessionId,
      data: l.data,
      ini: l.ini,
      fim: l.fim,
      tipo: l.tipo,
      texto: textos[i],
      titulo: titulosPorId.get(l.sessionId),
      vetor: l.vetor || null,
    }))
  }
  return saida
}

// Os trechos de uma conversa que ainda não têm vetor, com o texto já
// decifrado. É o que a segunda fase do indexador manda para o /embeddar —
// inclusive na execução seguinte, quando a primeira tentativa falhou por falta
// de rede.
export async function lerTrechosSemVetor(sessionId) {
  const linhas = await transacao([TRECHOS], 'readonly', s =>
    pedir(s.index('sessionId').getAll(IDBKeyRange.only(sessionId))))
  const pendentes = linhas.filter(l => !l.vetor)
  if (!pendentes.length) return []

  const saida = []
  const porVersao = new Map()
  for (const l of pendentes) {
    const chave = l.encVersion ?? 0
    if (!porVersao.has(chave)) porVersao.set(chave, [])
    porVersao.get(chave).push(l)
  }
  for (const [versao, lote] of porVersao) {
    const textos = await decifrarTextos(lote.map(l => l.texto), versao || null)
    lote.forEach((l, i) => saida.push({ id: l.id, texto: textos[i] }))
  }
  return saida
}

export async function limparOrfaos(idsValidos) {
  const linhas = await transacao([CONVERSAS], 'readonly', s => pedir(s.getAll()))
  for (const l of linhas) {
    if (!idsValidos.has(l.id)) await apagarConversa(l.id)
  }
}
