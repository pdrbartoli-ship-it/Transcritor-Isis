// A fronteira da criptografia. TUDO que entra ou sai do banco com conteúdo do
// usuário passa por aqui — e só por aqui.
//
// Ter um ponto único é a decisão mais importante deste arquivo. Criptografia
// espalhada pelo app é como ela falha na prática: um lugar esquecido grava em
// texto puro para sempre, e ninguém percebe, porque a tela continua igual.
//
// Convivemos com dois formatos, de propósito:
//   enc_version null → texto puro (tudo que existia antes desta versão)
//   enc_version 1    → cifrado com a chave do usuário
//
// Nada de "grande dia da migração": as conversas antigas continuam abrindo
// como sempre, e as novas já nascem cifradas. Não existe estado intermediário
// para dar errado.

import { encryptText, decryptText, encryptJson, decryptJson } from './crypto'
import { lerDoAparelho } from './chaves'

export const ENC_ATUAL = 1

// Campos que carregam o que o usuário disse. O resto da linha (datas, duração,
// origem, ids) fica em claro: sem isso não dá nem para listar nem para ordenar,
// e nenhum deles conta o que foi dito.
const CAMPOS_TEXTO = ['title', 'transcript', 'summary']
const CAMPOS_JSON = ['segments', 'insights']

// Sem chave no aparelho não dá para cifrar nem decifrar. Isso acontece de
// verdade: sessão restaurada num computador novo, ou depois de limpar os dados
// do navegador. Quem chama decide o que fazer — o que não pode é gravar em
// texto puro achando que cifrou.
export class SemChaveError extends Error {
  constructor() {
    super('Conteúdo bloqueado: digite sua senha para desbloquear neste aparelho.')
    this.name = 'SemChaveError'
  }
}

export async function temChaveNoAparelho() {
  return !!(await lerDoAparelho())
}

// ── Escrita: texto puro → cifrado ────────────────────────────
// Devolve uma cópia da linha pronta para gravar. Se não houver chave, falha em
// vez de gravar em claro: gravar sem cifrar seria pior do que não gravar,
// porque ninguém ficaria sabendo.
export async function cifrarLinha(linha) {
  const dek = await lerDoAparelho()
  if (!dek) throw new SemChaveError()

  const saida = { ...linha, enc_version: ENC_ATUAL }
  for (const campo of CAMPOS_TEXTO) {
    if (campo in linha) saida[campo] = await encryptText(dek, linha[campo])
  }
  for (const campo of CAMPOS_JSON) {
    if (campo in linha) saida[campo] = await encryptJson(dek, linha[campo])
  }
  return saida
}

// ── Leitura: cifrado → texto puro ────────────────────────────
// Linha antiga (enc_version null) volta como veio. É isso que faz as conversas
// de antes continuarem funcionando sem nenhuma conversão.
export async function decifrarLinha(linha) {
  if (!linha || linha.enc_version !== ENC_ATUAL) return linha

  const dek = await lerDoAparelho()
  if (!dek) throw new SemChaveError()

  const saida = { ...linha }
  for (const campo of CAMPOS_TEXTO) {
    if (linha[campo] != null) saida[campo] = await decryptText(dek, linha[campo])
  }
  for (const campo of CAMPOS_JSON) {
    if (linha[campo] != null) saida[campo] = await decryptJson(dek, linha[campo])
  }
  return saida
}

// Uma linha ilegível não pode derrubar a lista inteira: uma conversa gravada
// com outra chave (ou corrompida) tiraria todas as outras da tela junto. Ela
// vira uma linha marcada, e as vizinhas seguem normais.
export async function decifrarLista(linhas) {
  return Promise.all((linhas || []).map(async linha => {
    try {
      return await decifrarLinha(linha)
    } catch {
      return { ...linha, title: '(conteúdo bloqueado)', _bloqueada: true }
    }
  }))
}

// ── Mensagens de chat ────────────────────────────────────────
export async function cifrarMensagem(conteudo) {
  const dek = await lerDoAparelho()
  if (!dek) throw new SemChaveError()
  return { content: await encryptText(dek, conteudo), enc_version: ENC_ATUAL }
}

export async function decifrarMensagens(mensagens) {
  const dek = await lerDoAparelho()
  return Promise.all((mensagens || []).map(async m => {
    if (m.enc_version !== ENC_ATUAL) return m
    if (!dek) return { ...m, content: '(mensagem bloqueada)' }
    try {
      return { ...m, content: await decryptText(dek, m.content) }
    } catch {
      return { ...m, content: '(mensagem bloqueada)' }
    }
  }))
}
