// Testa o núcleo criptográfico sozinho, sem app, sem banco, sem navegador.

// Node 24 já expõe crypto global; só btoa/atob precisam de apoio
globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64')
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary')

const m = await import('./src/lib/crypto.js')

let ok = 0, falhas = 0
const check = (nome, cond) => {
  if (cond) { ok++; console.log(`  OK   ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome}`) }
}

console.log('\n== ida e volta do conteúdo ==')
const dek = await m.generateDEK()
const texto = 'Reunião sobre a demissão do João — confidencial. Acentuação: ção, ê, ü. 😀'
const cifrado = await m.encryptText(dek, texto)
check('decifra de volta idêntico', await m.decryptText(dek, cifrado) === texto)
check('o cifrado não contém o texto', !cifrado.includes('demissão') && !cifrado.includes('João'))
check('nulo continua nulo', await m.encryptText(dek, null) === null)

const obj = { topicos: [{ t: 'Preço', ini: 12 }], todos: ['ligar pro João'] }
check('JSON ida e volta', JSON.stringify(await m.decryptJson(dek, await m.encryptJson(dek, obj))) === JSON.stringify(obj))

console.log('\n== IV nunca se repete ==')
const a = await m.encryptText(dek, 'mesmo texto')
const b = await m.encryptText(dek, 'mesmo texto')
check('mesmo texto gera cifras diferentes', a !== b)
check('mas ambas decifram igual', await m.decryptText(dek, a) === await m.decryptText(dek, b))

console.log('\n== cofre da senha ==')
const senha = 'minha-senha-secreta-123'
const { salt, cofre } = await m.wrapDEK(dek, senha)
const dekVolta = await m.unwrapDEK(cofre, salt, senha)
check('DEK recuperada decifra o conteúdo antigo', await m.decryptText(dekVolta, cifrado) === texto)

let recusou = false
try { await m.unwrapDEK(cofre, salt, 'senha-errada') } catch { recusou = true }
check('senha errada FALHA (não devolve lixo)', recusou)

console.log('\n== cofre da recuperação ==')
const chaveRec = m.generateRecoveryKey()
console.log(`  chave gerada: ${chaveRec}`)
check('formato legível XXXX-XXXX-…', /^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/.test(chaveRec))
check('sem caracteres ambíguos (I, L, O, U)', !/[ILOU]/.test(chaveRec))

const rec = await m.wrapDEK(dek, m.normalizeRecoveryKey(chaveRec))
const dekPorRec = await m.unwrapDEK(rec.cofre, rec.salt, m.normalizeRecoveryKey(chaveRec))
check('recuperação devolve a MESMA DEK', await m.decryptText(dekPorRec, cifrado) === texto)

console.log('\n== o cenário que assusta: esqueci a senha ==')
// Senha nova não abre o cofre antigo...
let travou = false
try { await m.unwrapDEK(cofre, salt, 'senha-NOVA-depois-do-reset') } catch { travou = true }
check('senha nova sozinha NÃO abre o dado', travou)
// ...mas com a chave de recuperação dá pra refazer o cofre da senha.
const dekResgatada = await m.unwrapDEK(rec.cofre, rec.salt, m.normalizeRecoveryKey(chaveRec), { extractable: true })
const novoCofre = await m.wrapDEK(dekResgatada, 'senha-NOVA-depois-do-reset')
const dekFinal = await m.unwrapDEK(novoCofre.cofre, novoCofre.salt, 'senha-NOVA-depois-do-reset')
check('com a chave de recuperação, o dado volta', await m.decryptText(dekFinal, cifrado) === texto)

console.log('\n== a chave do aparelho não pode ser lida de volta ==')
const doAparelho = await m.unwrapDEK(cofre, salt, senha)
let naoExtraiu = false
try { await m.exportDEK(doAparelho) } catch { naoExtraiu = true }
check('DEK do login normal é NÃO extraível', naoExtraiu)
check('mas ainda decifra normalmente', await m.decryptText(doAparelho, cifrado) === texto)

console.log('\n== tolerância ao que o usuário digita ==')
const alvo = m.normalizeRecoveryKey(chaveRec)
check('aceita minúsculas', m.normalizeRecoveryKey(chaveRec.toLowerCase()) === alvo)
check('aceita sem hífen', m.normalizeRecoveryKey(chaveRec.replace(/-/g, '')) === alvo)
check('aceita com espaços colados', m.normalizeRecoveryKey(`  ${chaveRec}  `) === alvo)

console.log('\n== adulteração é detectada ==')
const partes = cifrado.split('.')
const adulterado = `${partes[0]}.${partes[1]}.${partes[2].slice(0, -6)}AAAAAA`
let detectou = false
try { await m.decryptText(dek, adulterado) } catch { detectou = true }
check('byte trocado no cifrado FALHA', detectou)

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
process.exit(falhas ? 1 : 0)
