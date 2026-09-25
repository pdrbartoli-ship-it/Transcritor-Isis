// O cadeado da transcrição que termina com o app fechado.
//
// Quando a pessoa manda transcrever e sai do app, é o servidor quem guarda o
// resultado até algum aparelho dela buscar. Guardar em texto puro quebraria o
// "nem nós conseguimos ler": por isso cada conta tem um par de chaves. O
// servidor recebe só a parte PÚBLICA, que fecha e não abre; a parte privada
// sobe cifrada com a chave das conversas (a mesma que já mora no aparelho), e
// só um aparelho com essa chave consegue abri-la. É o mesmo desenho do resto
// do cofre, com uma volta a mais.
//
// O par nasce no primeiro envio de quem ainda não tem, em qualquer aparelho,
// e vale para todos os outros da mesma conta.

import { supabase } from './supabase'
import { lerDoAparelho } from './chaves'
import { encryptText, decryptText, fromB64 } from './crypto'

const TABELA = 'chaves_transcricao'

const GERAR = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}
const IMPORTAR = { name: 'RSA-OAEP', hash: 'SHA-256' }

// Violação de chave primária: outro aparelho criou o par no mesmo instante.
const JA_EXISTE = '23505'

// A privada aberta fica só na memória desta página: some ao sair do app, e
// reabri-la é uma consulta e uma decifração, sem pedir nada à pessoa.
let aberta = null // { userId, privada: CryptoKey }

// Diz se este aparelho pode mandar transcrições para o servidor terminar
// sozinho. Falso sem chave das conversas no aparelho (sessão restaurada sem o
// cofre) e falso se a tabela ainda não existe no banco: nos dois casos quem
// chama segue pelo caminho de sempre, com o app aberto.
export async function garantirChave(userId) {
  if (aberta?.userId === userId) return true
  const dek = await lerDoAparelho()
  if (!dek) return false

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('privada_cifrada')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return false

    if (data) {
      try {
        const jwk = JSON.parse(await decryptText(dek, data.privada_cifrada))
        const privada = await crypto.subtle.importKey('jwk', jwk, IMPORTAR, false, ['decrypt'])
        aberta = { userId, privada }
        return true
      } catch {
        // A chave das conversas mudou (senha redefinida em outro aparelho) e
        // a privada antiga ficou ilegível. Um par novo toma o lugar dela.
        return (await criarPar(userId, dek, { substituir: true })) === true
      }
    }

    const criou = await criarPar(userId, dek, { substituir: false })
    if (criou !== JA_EXISTE) return criou
    // Outro aparelho ganhou a corrida: a volta seguinte lê o par dele.
  }
  return false
}

async function criarPar(userId, dek, { substituir }) {
  const par = await crypto.subtle.generateKey(GERAR, true, ['encrypt', 'decrypt'])
  const { kty, n, e } = await crypto.subtle.exportKey('jwk', par.publicKey)
  const privadaJwk = await crypto.subtle.exportKey('jwk', par.privateKey)
  const linha = {
    user_id: userId,
    publica: { kty, n, e },
    privada_cifrada: await encryptText(dek, JSON.stringify(privadaJwk)),
  }
  const { error } = substituir
    ? await supabase.from(TABELA).update(linha).eq('user_id', userId)
    : await supabase.from(TABELA).insert(linha)
  if (error) return error.code === JA_EXISTE ? JA_EXISTE : false
  aberta = { userId, privada: par.privateKey }
  return true
}

// Abre o que o servidor guardou: a chave AES da transcrição vem fechada com a
// pública (RSA-OAEP), e o resultado vem cifrado com essa AES (AES-GCM).
export async function abrirResultado(userId, texto) {
  if (!(await garantirChave(userId))) {
    throw new Error('Não foi possível abrir esta transcrição neste aparelho. Saia da conta e entre novamente.')
  }
  const envelope = JSON.parse(texto)
  const bruta = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, aberta.privada, fromB64(envelope.k))
  const aes = await crypto.subtle.importKey('raw', bruta, { name: 'AES-GCM' }, false, ['decrypt'])
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, aes, fromB64(envelope.c))
  return JSON.parse(new TextDecoder().decode(claro))
}

// Ao sair da conta: a privada aberta não pode sobrar na memória para quem
// entrar depois nesta mesma janela.
export function esquecerChaveAberta() {
  aberta = null
}
