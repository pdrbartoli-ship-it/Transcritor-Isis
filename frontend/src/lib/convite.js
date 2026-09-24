import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { lerConvite, marcarConviteVisto, aceitarConvite } from './api'

// O convite premiado, do lado do app.
//
// O link de quem convida é o site com `?c=codigo`. O código fica guardado
// neste navegador até a pessoa criar a conta, vai junto do cadastro
// (user_metadata.convite, ver Auth.jsx) e, no primeiro login, o app avisa o
// servidor de quem ela é amiga. Daí em diante tudo é do servidor: ele conta as
// transcrições, dá o prêmio e diz o que ainda não foi mostrado.

const CHAVE_CODIGO = 'dito-convite'
// Um código esquecido no navegador não pode premiar, meses depois, quem nem
// lembra de ter clicado no link — nem outra pessoa que crie conta ali.
const VALIDADE_CODIGO_MS = 30 * 24 * 60 * 60 * 1000
const CODIGO_VALIDO = /^[a-z0-9]{4,16}$/

// Chamado no boot (main.jsx), antes do roteador. O `?c=` sai do endereço
// logo em seguida: ele não diz nada a quem está lendo a página, e ficaria
// para trás em qualquer link que a pessoa copiasse dali.
export function guardarConviteDaUrl() {
  try {
    const url = new URL(window.location.href)
    const codigo = (url.searchParams.get('c') || '').trim().toLowerCase()
    if (!CODIGO_VALIDO.test(codigo)) return
    localStorage.setItem(CHAVE_CODIGO, JSON.stringify({ codigo, em: Date.now() }))
    url.searchParams.delete('c')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // Modo anônimo sem storage: o convite se perde, e a pessoa entra normal.
  }
}

export function conviteGuardado() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CODIGO) || 'null')
    if (!salvo || Date.now() - salvo.em > VALIDADE_CODIGO_MS) return null
    return CODIGO_VALIDO.test(salvo.codigo) ? salvo.codigo : null
  } catch {
    return null
  }
}

function esquecerConvite() {
  try { localStorage.removeItem(CHAVE_CODIGO) } catch { /* sem storage */ }
}

// Uma vez por conta e por aparelho. A recusa do servidor (conta antiga, o
// próprio código) também encerra: o amigo não vê nada em nenhum dos casos, e
// insistir a cada abertura seria só barulho. Falha de rede tenta de novo na
// próxima vez.
async function aplicarConviteDoCadastro(user) {
  const codigo = user.user_metadata?.convite || conviteGuardado()
  if (!codigo) return
  const marca = `dito-convite-enviado-${user.id}`
  try { if (localStorage.getItem(marca)) return } catch { /* sem storage */ }
  try {
    await aceitarConvite(codigo)
    try { localStorage.setItem(marca, '1') } catch { /* sem storage */ }
    esquecerConvite()
  } catch {
    // Servidor dormindo ou sem rede: fica para a próxima abertura.
  }
}

// ── Estado compartilhado ─────────────────────────────────────────────────
// Fora do React porque o Layout é remontado a cada troca entre a home e uma
// conversa: guardado nele, o estado seria buscado de novo a cada clique.
let estado = null
let buscadoEm = 0
let emVoo = null
const ouvintes = new Set()
const avisar = () => ouvintes.forEach(fn => fn())
const assinar = fn => { ouvintes.add(fn); return () => ouvintes.delete(fn) }

// Ao voltar para o app, no máximo uma leitura a cada tantos minutos. É o que
// faz o aviso de prêmio aparecer sem a pessoa precisar fechar e abrir o app.
const INTERVALO_MS = 5 * 60 * 1000

async function buscar({ forcar = false } = {}) {
  if (!forcar && Date.now() - buscadoEm < INTERVALO_MS) return
  if (emVoo) return emVoo
  buscadoEm = Date.now()
  emVoo = lerConvite()
    .then(novo => { estado = novo; avisar() })
    .catch(() => { /* o convite é um extra: sem resposta, nada aparece */ })
    .finally(() => { emVoo = null })
  return emVoo
}

export function useConvite(user) {
  const ativo = !!user?.id && !user.is_anonymous
  const atual = useSyncExternalStore(assinar, () => estado)

  useEffect(() => {
    if (!ativo) return
    aplicarConviteDoCadastro(user)
    buscar()
    const aoVoltar = () => { if (document.visibilityState === 'visible') buscar() }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('focus', aoVoltar)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('focus', aoVoltar)
    }
    // O objeto `user` muda a cada renovação de token; a conta é o id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, user?.id])

  const atualizar = useCallback(() => buscar({ forcar: true }), [])

  // Some da tela na hora; o servidor é avisado em seguida.
  const marcarVisto = useCallback(() => {
    if (estado?.novidade) {
      estado = { ...estado, novidade: null }
      avisar()
    }
    marcarConviteVisto().catch(() => { /* volta a aparecer na próxima leitura */ })
  }, [])

  return { convite: ativo ? atual : null, atualizar, marcarVisto }
}

// O selo de apoiador é comemorado uma vez por aparelho. Ele pode chegar sem
// nenhum amigo novo (quem juntou os cinco no Grátis e depois assinou o
// Avançado), então não dá para depender só do "visto" dos convites.
export function useSeloNovo(convite, userId) {
  const chave = `dito-selo-visto-${userId}`
  const [visto, setVisto] = useState(() => {
    try { return !!localStorage.getItem(chave) } catch { return true }
  })
  const novo = !!convite?.apoiador && !visto
  const dispensar = useCallback(() => {
    try { localStorage.setItem(chave, '1') } catch { /* sem storage */ }
    setVisto(true)
  }, [chave])
  return [novo, dispensar]
}

// O texto que vai junto do link na folha de compartilhar do sistema.
export const TEXTO_CONVITE =
  'Uso o Dito para transcrever e resumir reuniões, aulas e áudios. Crie sua conta pelo meu link:'

// O link sem o "https://", para caber na caixa da tela sem quebrar.
export const linkCurto = link => (link || '').replace(/^https?:\/\//, '')
