// Testa que o app manda o login junto de toda chamada ao backend.
//
// Se este teste quebrar depois de a exigência ser ligada no Render, o sintoma
// no app é todo mundo levando "entre na sua conta" no meio de uma captura —
// então ele existe para essa regressão nunca chegar em produção calada.
//
// Rodar:  cd frontend && node teste-api-auth.mjs

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// O app importa './supabase' sem extensão, que o Vite resolve e o Node não.
// Resolver isso aqui evita ter que sujar o código de produção só para testar.
registerHooks({
  resolve(especificador, contexto, seguinte) {
    if (especificador.startsWith('.') && !/\.[a-z]+$/i.test(especificador)) {
      for (const ext of ['.js', '.jsx']) {
        const alvo = new URL(especificador + ext, contexto.parentURL)
        if (existsSync(fileURLToPath(alvo))) return { url: alvo.href, shortCircuit: true }
      }
    }
    return seguinte(especificador, contexto)
  },
})

let ok = 0, falhas = 0
const check = (nome, cond) => {
  if (cond) { ok++; console.log(`  OK    ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome}`) }
}

// Captura o que o app tentou mandar, sem deixar sair nada para a rede.
let ultimaChamada = null
globalThis.fetch = async (url, opcoes = {}) => {
  ultimaChamada = { url, ...opcoes }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ insights: {}, summary: '', answer: '', usage: {} }),
  }
}

// O cliente do Supabase é um objeto só; trocar o método nele é o que o api.js
// enxerga, porque os dois apontam para a mesma instância.
const { supabase } = await import('./src/lib/supabase.js')
const api = await import('./src/lib/api.js')

const TOKEN = 'token-de-teste-abc123'
const comSessao = async () => ({ data: { session: { access_token: TOKEN } } })
const semSessao = async () => ({ data: { session: null } })
const quebrada = async () => { throw new Error('sessão ilegível') }

const auth = h => (h?.Authorization ?? h?.authorization)

console.log('\n== com o usuário logado ==')
supabase.auth.getSession = comSessao

await api.generateInsights('uma transcrição qualquer')
check('/insights manda o cabeçalho de login', auth(ultimaChamada.headers) === `Bearer ${TOKEN}`)
check('/insights continua mandando o Content-Type', ultimaChamada.headers['Content-Type'] === 'application/json')
check('/insights ainda manda o corpo certo', JSON.parse(ultimaChamada.body).transcript === 'uma transcrição qualquer')

await api.askConversation('do que se trata?', { title: 't', created_at: Date.now(), transcript: 'oi', summary: null })
check('/chat manda o cabeçalho de login', auth(ultimaChamada.headers) === `Bearer ${TOKEN}`)
check('/chat manda a pergunta', JSON.parse(ultimaChamada.body).question === 'do que se trata?')

await api.processUrl('https://exemplo.com/artigo')
check('/process-url manda o cabeçalho de login', auth(ultimaChamada.headers) === `Bearer ${TOKEN}`)
check('/process-url manda o FormData (sem Content-Type na mão)',
  ultimaChamada.body instanceof FormData && !ultimaChamada.headers['Content-Type'])

const arquivo = new File([new Uint8Array([1, 2, 3])], 'audio.m4a', { type: 'audio/m4a' })
await api.transcribeFile(arquivo)
check('/transcribe manda o cabeçalho de login', auth(ultimaChamada.headers) === `Bearer ${TOKEN}`)
check('/transcribe manda o arquivo', ultimaChamada.body instanceof FormData)

console.log('\n== sem sessão: não inventa cabeçalho ==')
supabase.auth.getSession = semSessao
ultimaChamada = null
await api.generateInsights('texto')
check('não manda Authorization quando não há login', auth(ultimaChamada.headers) === undefined)
check('mas ainda faz a chamada (o backend é quem decide recusar)', ultimaChamada !== null)

console.log('\n== sessão ilegível não derruba o app ==')
supabase.auth.getSession = quebrada
ultimaChamada = null
let estourou = false
try { await api.generateInsights('texto') } catch { estourou = true }
check('erro ao ler a sessão não vira exceção na cara do usuário', !estourou)
check('a chamada acontece mesmo assim, só sem o cabeçalho', auth(ultimaChamada?.headers) === undefined)

console.log('\n== o token vem da sessão a cada chamada (não fica velho) ==')
supabase.auth.getSession = async () => ({ data: { session: { access_token: 'token-novo-depois-do-refresh' } } })
await api.generateInsights('texto')
check('usa o token novo, não um guardado da chamada anterior',
  auth(ultimaChamada.headers) === 'Bearer token-novo-depois-do-refresh')

console.log(`\n${falhas === 0 ? 'TUDO OK' : 'HOUVE FALHAS'} — ${ok} passaram, ${falhas} falharam`)
process.exit(falhas ? 1 : 0)
