// Núcleo criptográfico. Só primitivas — nada de Supabase, nada de React, nada
// de estado. É de propósito: este é o arquivo que, se estiver errado, torna o
// dado do usuário ilegível para sempre, então ele precisa ser testável sozinho,
// sem subir o app.
//
// O desenho é o de sempre em cofre de senha (1Password, Bitwarden):
//
//   Chave de Dados (DEK)  ← aleatória, criada uma vez, NUNCA muda
//           │
//           ├── cofre 1: fechado com uma chave derivada da SENHA
//           └── cofre 2: fechado com uma chave derivada da CHAVE DE RECUPERAÇÃO
//
// Os dados são cifrados com a DEK. A senha nunca cifra dado nenhum: ela só
// abre um cofre que guarda a DEK. É isso que faz trocar de senha custar um
// campo, e não recriptografar o acervo inteiro — e é isso que permite existir
// uma segunda porta (a recuperação) sem enfraquecer a primeira.

const KDF_ITERATIONS = 600_000   // recomendação OWASP para PBKDF2-SHA256
const SALT_BYTES = 16
const IV_BYTES = 12
const DEK_BITS = 256
const FORMAT = '1'               // versão do empacotamento, para poder evoluir

const enc = new TextEncoder()
const dec = new TextDecoder()

// ── Base64 seguro para URL/JSON ──────────────────────────────
export function toB64(bytes) {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromB64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n))
}

// ── Derivação: segredo humano → chave que abre um cofre ──────
// PBKDF2 com muitas iterações é o que torna caro testar senhas em lote: quem
// levar o banco embora tem os cofres, e sem isso poderia atacá-los à vontade.
async function deriveKEK(segredo, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(segredo), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── Cifrar / decifrar um texto qualquer com uma chave ────────
// IV novo a cada chamada: reusar IV com a mesma chave em AES-GCM é a falha
// clássica que expõe o conteúdo. Ele vai junto do resultado, em claro — é
// assim mesmo, IV não é segredo.
async function encryptRaw(key, bytes) {
  const iv = randomBytes(IV_BYTES)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  return `${FORMAT}.${toB64(iv)}.${toB64(ct)}`
}

async function decryptRaw(key, packed) {
  const [versao, ivB64, ctB64] = String(packed).split('.')
  if (versao !== FORMAT) throw new Error('Formato de criptografia desconhecido.')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64),
  )
  return new Uint8Array(plain)
}

export async function encryptText(dek, texto) {
  if (texto == null) return null
  return encryptRaw(dek, enc.encode(String(texto)))
}

export async function decryptText(dek, packed) {
  if (packed == null) return null
  return dec.decode(await decryptRaw(dek, packed))
}

// JSON cifrado: `segments` e `insights` são objetos, e passar por texto é o que
// evita dois caminhos de serialização diferentes espalhados pelo app.
export async function encryptJson(dek, valor) {
  if (valor == null) return null
  return encryptText(dek, JSON.stringify(valor))
}

export async function decryptJson(dek, packed) {
  if (packed == null) return null
  const texto = await decryptText(dek, packed)
  try { return JSON.parse(texto) } catch { return null }
}

// ── A chave de dados (DEK) ───────────────────────────────────
export async function generateDEK() {
  // Extraível porque ela precisa ser embrulhada nos dois cofres logo em
  // seguida. A cópia que fica no aparelho é reimportada como NÃO extraível
  // (ver importDEK), para o JS poder usá-la sem conseguir lê-la de volta.
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: DEK_BITS }, true, ['encrypt', 'decrypt'])
}

export async function exportDEK(dek) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', dek))
}

export async function importDEK(bytes, { extractable = false } = {}) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt'])
}

// ── Os cofres ────────────────────────────────────────────────
// Guardar a DEK fechada por um segredo humano. O `salt` sai junto porque é
// preciso para rederivar a mesma chave depois; ele não é segredo.
export async function wrapDEK(dek, segredo) {
  const salt = randomBytes(SALT_BYTES)
  const kek = await deriveKEK(segredo, salt)
  const cofre = await encryptRaw(kek, await exportDEK(dek))
  return { salt: toB64(salt), cofre }
}

// `extractable` só é ligado por quem precisa REEMBRULHAR a DEK — trocar a
// senha, ou usar a chave de recuperação para refazer o cofre da senha. No
// login normal ela fica não-extraível: o app usa a chave sem nunca conseguir
// ler os bytes dela de volta, então nem um XSS consegue roubá-la.
export async function unwrapDEK(cofre, salt, segredo, { extractable = false } = {}) {
  const kek = await deriveKEK(segredo, fromB64(salt))
  // AES-GCM é autenticado: segredo errado não devolve lixo, ele FALHA. É por
  // isso que dá para usar a própria decifragem como verificação de senha, sem
  // guardar hash nenhum em lugar nenhum.
  const bytes = await decryptRaw(kek, cofre)
  return importDEK(bytes, { extractable })
}

// ── Chave de recuperação ─────────────────────────────────────
// Alfabeto sem I, L, O e U: o usuário vai ler isto de um papel e digitar de
// volta, e é aí que 1/I e 0/O viram suporte. O U sai para nenhuma palavra feia
// nascer por acaso.
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRecoveryKey() {
  const bytes = randomBytes(20)   // 100 bits de entropia real (32 símbolos = 5 bits cada)
  let s = ''
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length]
  return s.match(/.{1,4}/g).join('-')   // XXXX-XXXX-… (5 grupos)
}

// Aceita o que o usuário digitar: com ou sem hífen, minúsculo, com espaço
// colado do copiar-e-colar. Recusar por causa de um hífen seria trancar a
// pessoa para fora do próprio dado por formatação.
export function normalizeRecoveryKey(entrada) {
  return String(entrada || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}
