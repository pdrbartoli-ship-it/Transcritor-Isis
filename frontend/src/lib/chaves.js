// Ciclo de vida da chave: criar no primeiro login, abrir nos seguintes, e
// guardá-la no aparelho para não pedir a senha de novo a cada recarga.
//
// A criação NÃO acontece no cadastro, e isso não é descuido: com a confirmação
// de e-mail ligada, o `signUp` do Supabase não abre sessão, então ali não há
// como gravar na tabela (a RLS exige `auth.uid()`). O primeiro login é o único
// momento em que existem sessão E senha em claro ao mesmo tempo — que é
// exatamente o que a criação precisa. De quebra, isso cobre quem já tem conta.

import { supabase } from './supabase'
import { generateDEK, wrapDEK, unwrapDEK, generateRecoveryKey } from './crypto'

const DB_NAME = 'dito-chaves'
const STORE = 'chaves'
const CHAVE_ATUAL = 'dek'
const NOT_NULL_VIOLATION = '23502'

// ── Guarda no aparelho ───────────────────────────────────────
// IndexedDB guarda o objeto CryptoKey em si, não os bytes. localStorage não
// serviria: lá só cabe texto, o que obrigaria a guardar a chave em claro.
//
// A chave é EXTRAÍVEL, e isso é uma troca consciente. Guardá-la não-extraível
// impediria de lê-la de volta — mas também impediria o app de refechar o cofre
// sozinho quando o usuário troca a senha, que é justamente o que evita ele
// perder tudo num "esqueci a senha". E a proteção que se perde é pequena: quem
// conseguir rodar código nesta página consegue mandar a chave decifrar tudo,
// extraindo-a ou não. Trocamos uma defesa fraca por uma recuperação que
// funciona.
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function noAparelho(modo, fn) {
  const db = await abrirDB()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, modo)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function guardarNoAparelho(dek) {
  try { await noAparelho('readwrite', s => s.put(dek, CHAVE_ATUAL)) } catch {}
}

export async function lerDoAparelho() {
  try { return (await noAparelho('readonly', s => s.get(CHAVE_ATUAL))) || null } catch { return null }
}

// Sair da conta tem de levar a chave junto: deixá-la num computador
// compartilhado seria deixar o cofre destrancado para o próximo que logar.
export async function esquecerDoAparelho() {
  try { await noAparelho('readwrite', s => s.delete(CHAVE_ATUAL)) } catch {}
}

// ── A linha de cofres no banco ───────────────────────────────
async function buscarCofres(userId) {
  const { data, error } = await supabase
    .from('user_keys')
    .select('senha_salt, senha_cofre, recuperacao_salt, recuperacao_cofre')
    .eq('user_id', userId)
    .maybeSingle()
  // Tabela ainda não criada (migração não rodou): tratamos como "sem chave",
  // para o app seguir funcionando em texto puro em vez de travar o login.
  if (error && error.code !== 'PGRST116') {
    if (error.code === '42P01') return null
    throw error
  }
  return data || null
}

export async function temChave(userId) {
  return !!(await buscarCofres(userId))
}

// ── Cria a chave: só o cofre da senha ───────────────────────
// Não existe chave de recuperação nem tela para quando o cofre fica
// desencontrado da senha (ex.: reset por e-mail longe deste aparelho): é um
// risco aceito para manter o login simples para todo mundo. Quem cair nesse
// caso perde o conteúdo cifrado; o app segue funcionando normalmente daí em
// diante (nova chave, nova conta zerada de conteúdo cifrado).
export async function criarChave(userId, senha) {
  const dek = await generateDEK()
  const porSenha = await wrapDEK(dek, senha)

  const linha = {
    user_id: userId,
    senha_salt: porSenha.salt,
    senha_cofre: porSenha.cofre,
    atualizado_em: new Date().toISOString(),
  }
  let { error } = await supabase.from('user_keys').upsert(linha, { onConflict: 'user_id' })

  // Enquanto as colunas de recuperação no banco ainda forem NOT NULL (antes de
  // chaves.sql rodar o bloco que as torna opcionais), esta gravação falha
  // (23502). Preenchemos com um cofre fechado por um segredo aleatório que
  // ninguém guarda — equivale a não ter recuperação, que é o padrão aqui.
  if (error?.code === NOT_NULL_VIOLATION) {
    const descartavel = await wrapDEK(dek, generateRecoveryKey())
    ;({ error } = await supabase.from('user_keys').upsert({
      ...linha,
      recuperacao_salt: descartavel.salt,
      recuperacao_cofre: descartavel.cofre,
    }, { onConflict: 'user_id' }))
  }
  if (error) throw error

  await guardarNoAparelho(dek)
  return dek
}

// ── Logins seguintes: abre o cofre da senha ──────────────────
export async function abrirComSenha(userId, senha) {
  const cofres = await buscarCofres(userId)
  if (!cofres) return null
  const dek = await unwrapDEK(cofres.senha_cofre, cofres.senha_salt, senha, { extractable: true })
  await guardarNoAparelho(dek)
  return dek
}

// ── O caminho comum do "esqueci a senha" ─────────────────────
// A chave não depende da senha para existir: ela está guardada aqui no
// aparelho. Então, no computador de sempre — que é onde a pessoa quase sempre
// está —, trocar a senha não precisa de chave de recuperação nenhuma: basta
// refechar o cofre com a senha nova usando a chave que já temos em mãos.
//
// É isto que tira o ônus do usuário sem entregar nada ao servidor: quem refecha
// é o navegador dele, com uma chave que nunca saiu dali.
export async function refecharCofreComChaveLocal(userId, senhaNova) {
  const dek = await lerDoAparelho()
  if (!dek) return false

  // `update`, não `upsert`: só faz sentido refechar um cofre que já existe, e
  // o upsert monta um INSERT por baixo — que o Postgres valida contra as
  // colunas NOT NULL antes mesmo de perceber que a linha já estava lá.
  const porSenha = await wrapDEK(dek, senhaNova)
  const { error } = await supabase.from('user_keys').update({
    senha_salt: porSenha.salt,
    senha_cofre: porSenha.cofre,
    atualizado_em: new Date().toISOString(),
  }).eq('user_id', userId)
  if (error) throw error
  return true
}

