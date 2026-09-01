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
  generateDEK, wrapDEK, unwrapDEK,
  generateRecoveryKey, normalizeRecoveryKey,
} from './crypto'

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
// A chave de recuperação NÃO nasce aqui. Ela é opcional, gerada em "Meus
// dados" por quem quiser o seguro — obrigá-la no primeiro acesso era pedir ao
// usuário que guardasse um papel antes de ter usado o produto uma vez.
export async function criarChave(userId, senha) {
  const dek = await generateDEK()
  const porSenha = await wrapDEK(dek, senha)

  // upsert, e não insert: recriar o cofre depois de um "recomeçar" cai aqui de
  // novo, e um insert falharia contra a linha que já existe.
  const linha = {
    user_id: userId,
    senha_salt: porSenha.salt,
    senha_cofre: porSenha.cofre,
    atualizado_em: new Date().toISOString(),
  }
  let { error } = await supabase.from('user_keys').upsert(linha, { onConflict: 'user_id' })

  // Antes de chaves.sql ganhar o bloco que torna a recuperação opcional, as
  // duas colunas eram NOT NULL e esta gravação falha (23502). Em vez de travar
  // o app no intervalo entre publicar e rodar a migração, preenchemos os campos
  // com um cofre fechado por um segredo aleatório que ninguém guarda — o que
  // equivale a não ter recuperação, que é justamente o padrão agora. Gerar uma
  // chave de verdade em "Meus dados" sobrescreve isto.
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

  await guardarNoAparelho(dek)
  return true
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

// ── Chave de recuperação: agora opcional, sob demanda ────────
// Gera (ou troca) o cofre de recuperação e devolve a chave UMA vez. Ela não é
// guardada em lugar nenhum de onde possa ser lida depois — só o cofre que ela
// abre. Se desse para mostrá-la de novo, nós conseguiríamos abrir o cofre.
export async function gerarChaveRecuperacao(userId) {
  const dek = await lerDoAparelho()
  if (!dek) throw new Error('Desbloqueie o app neste aparelho antes de gerar a chave.')

  const chave = generateRecoveryKey()
  const porRecuperacao = await wrapDEK(dek, normalizeRecoveryKey(chave))

  const { error } = await supabase.from('user_keys').update({
    recuperacao_salt: porRecuperacao.salt,
    recuperacao_cofre: porRecuperacao.cofre,
    atualizado_em: new Date().toISOString(),
  }).eq('user_id', userId)
  if (error) throw error
  return chave
}

export async function temChaveRecuperacao(userId) {
  const cofres = await buscarCofres(userId)
  return !!cofres?.recuperacao_cofre
}

// ── Recomeçar: cofre novo, conteúdo velho perdido ────────────
// Saída para quem resetou a senha longe do aparelho de sempre e não tem chave
// de recuperação. O conteúdo cifrado com a chave antiga não volta — ninguém no
// mundo consegue abri-lo — então ele é removido, e a conta segue funcionando
// em vez de ficar travada.
export async function recomecarCofre(userId, senha) {
  await esquecerDoAparelho()
  await criarChave(userId, senha)
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

  await guardarNoAparelho(dek)
  return true
}
