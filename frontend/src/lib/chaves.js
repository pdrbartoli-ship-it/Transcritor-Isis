// Ciclo de vida da chave: criar no primeiro login, abrir nos seguintes, e
// guardá-la no aparelho para não pedir a senha de novo a cada recarga.
//
// A criação NÃO acontece no cadastro, e isso não é descuido: com a confirmação
// de e-mail ligada, o `signUp` do Supabase não abre sessão, então ali não há
// como gravar na tabela (a RLS exige `auth.uid()`). O primeiro login é o único
// momento em que existem sessão E senha em claro ao mesmo tempo — que é
// exatamente o que a criação precisa. De quebra, isso cobre quem já tem conta.

import { supabase } from './supabase'
import {
  generateDEK, wrapDEK, unwrapDEK, exportDEK, importDEK,
  generateRecoveryKey, normalizeRecoveryKey,
} from './crypto'

const DB_NAME = 'dito-chaves'
const STORE = 'chaves'
const CHAVE_ATUAL = 'dek'

// ── Guarda no aparelho ───────────────────────────────────────
// IndexedDB guarda o objeto CryptoKey em si, não os bytes. Como ele foi
// importado como não-extraível, nem o nosso código nem um script injetado
// conseguem ler o material da chave de volta — só pedir que ela cifre e
// decifre. localStorage não serviria: lá só cabe texto, o que obrigaria a
// guardar a chave em claro.
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

// ── Primeiro login: cria a chave e devolve a de recuperação ──
// A chave de recuperação é devolvida UMA vez, aqui, e nunca mais: ela não é
// guardada em lugar nenhum de onde possa ser lida depois — só o cofre que ela
// abre. Se pudéssemos mostrá-la de novo, nós conseguiríamos abrir o cofre, e a
// promessa inteira cairia.
export async function criarChave(userId, senha) {
  const dek = await generateDEK()

  const chaveRecuperacao = generateRecoveryKey()
  const porSenha = await wrapDEK(dek, senha)
  const porRecuperacao = await wrapDEK(dek, normalizeRecoveryKey(chaveRecuperacao))

  const { error } = await supabase.from('user_keys').insert({
    user_id: userId,
    senha_salt: porSenha.salt,
    senha_cofre: porSenha.cofre,
    recuperacao_salt: porRecuperacao.salt,
    recuperacao_cofre: porRecuperacao.cofre,
  })
  if (error) throw error

  // A cópia que fica no aparelho é reimportada como não-extraível.
  await guardarNoAparelho(await importDEK(await exportDEK(dek)))
  return chaveRecuperacao
}

// ── Logins seguintes: abre o cofre da senha ──────────────────
export async function abrirComSenha(userId, senha) {
  const cofres = await buscarCofres(userId)
  if (!cofres) return null
  const dek = await unwrapDEK(cofres.senha_cofre, cofres.senha_salt, senha)
  await guardarNoAparelho(dek)
  return dek
}

// ── Esqueci a senha: a chave de recuperação refaz o cofre ────
// O reset por e-mail já deu uma senha nova; o que falta é reembrulhar a MESMA
// DEK com ela. A DEK não muda — por isso nada precisa ser recriptografado, e
// por isso o conteúdo antigo continua abrindo.
export async function recuperarComChave(userId, chaveRecuperacao, senhaNova) {
  const cofres = await buscarCofres(userId)
  if (!cofres) throw new Error('Esta conta ainda não tem chave de criptografia.')

  const dek = await unwrapDEK(
    cofres.recuperacao_cofre,
    cofres.recuperacao_salt,
    normalizeRecoveryKey(chaveRecuperacao),
    { extractable: true },
  )

  const porSenha = await wrapDEK(dek, senhaNova)
  const { error } = await supabase.from('user_keys').update({
    senha_salt: porSenha.salt,
    senha_cofre: porSenha.cofre,
    atualizado_em: new Date().toISOString(),
  }).eq('user_id', userId)
  if (error) throw error

  await guardarNoAparelho(await importDEK(await exportDEK(dek)))
  return true
}

// ── Trocar a senha sabendo a atual ───────────────────────────
// Só o cofre 1 é refeito. O cofre da recuperação continua valendo, porque a
// chave de recuperação não mudou — e a DEK, que é o que importa, é a mesma.
export async function trocarSenha(userId, senhaAtual, senhaNova) {
  const cofres = await buscarCofres(userId)
  if (!cofres) throw new Error('Esta conta ainda não tem chave de criptografia.')

  const dek = await unwrapDEK(cofres.senha_cofre, cofres.senha_salt, senhaAtual, { extractable: true })
  const porSenha = await wrapDEK(dek, senhaNova)

  const { error } = await supabase.from('user_keys').update({
    senha_salt: porSenha.salt,
    senha_cofre: porSenha.cofre,
    atualizado_em: new Date().toISOString(),
  }).eq('user_id', userId)
  if (error) throw error

  await guardarNoAparelho(await importDEK(await exportDEK(dek)))
  return true
}
