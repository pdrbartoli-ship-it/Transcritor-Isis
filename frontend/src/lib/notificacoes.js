import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { isNative, platformName } from './platform'
import { registrarAparelho, removerAparelho } from './api'

// Notificação no celular (Android e iPhone). Dois avisos: a transcrição que
// ficou pronta com o app fechado, e o convite premiado, quando um amigo
// completa as transcrições. No computador não há notificação de propósito; lá
// o aviso aparece na tela do app.
//
// O pedido de permissão não sai na abertura do app, onde ele não teria
// contexto nenhum: sai no primeiro "Transcrever" (avisar quando ficar pronta)
// ou quando a pessoa compartilha o link de convite.

// O token que o Google ou a Apple deram a este aparelho, para tirá-lo da
// lista ao sair da conta.
const CHAVE_TOKEN = 'dito-push-token'

// Os canais do Android. Os ids são os mesmos que o servidor manda (main.py:
// CANAL_ANDROID e CANAL_TRANSCRICOES); o nome é o que aparece nas
// configurações do celular, onde a pessoa pode calar um sem calar o outro.
const CANAIS = [
  {
    id: 'convites',
    name: 'Convites',
    description: 'Quando um amigo começa a usar o Dito pelo seu convite',
    importance: 4,
    visibility: 1,
  },
  {
    // Importância 3: aparece na barra, sem som e sem invadir a tela. O aviso
    // de pronta é bem-vindo, mas não é urgente.
    id: 'transcricoes',
    name: 'Transcrições prontas',
    description: 'Quando uma transcrição fica pronta com o app fechado',
    importance: 3,
    visibility: 0,
  },
]

// O código novo chega por OTA a um app instalado antes do plugin existir. Sem
// esta conferência, a chamada ao plugin ausente quebraria a tela.
const disponivel = () => isNative() && Capacitor.isPluginAvailable('PushNotifications')

let ouvindo = false
let aoChegarAtual = null
let aoTranscricaoAtual = null

// A notificação diz de que se trata no campo `tipo` (main.py). As antigas, sem
// ele, são do convite: era o único aviso que existia.
function tipoDe(notificacao) {
  return notificacao?.data?.tipo || 'convite'
}

function ouvir() {
  if (ouvindo) return
  ouvindo = true
  PushNotifications.addListener('registration', ({ value }) => {
    try { localStorage.setItem(CHAVE_TOKEN, value) } catch { /* sem storage */ }
    registrarAparelho(value, platformName()).catch(() => {
      // Servidor dormindo: o cadastro se refaz na próxima abertura do app.
    })
  })
  // Com o app aberto o sistema não mostra a notificação; quem mostra é o
  // próprio app (o aviso do convite, ou o "Pronta" da transcrição). Tocar
  // numa notificação com o app em segundo plano cai no mesmo caminho, e no
  // caso da transcrição leva direto a ela.
  PushNotifications.addListener('pushNotificationReceived', notificacao => {
    if (tipoDe(notificacao) === 'transcricao') aoTranscricaoAtual?.(notificacao.data, { tocou: false })
    else aoChegarAtual?.()
  })
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    if (tipoDe(notification) === 'transcricao') aoTranscricaoAtual?.(notification.data, { tocou: true })
    else aoChegarAtual?.()
  })
}

async function registrar() {
  if (platformName() === 'android') {
    for (const canal of CANAIS) await PushNotifications.createChannel(canal).catch(() => {})
  }
  await PushNotifications.register()
}

// Quem cuida das transcrições (TranscricoesContext) recebe aqui o aviso de que
// uma ficou pronta no servidor, para buscá-la e, se a pessoa tocou na
// notificação, abri-la.
export function aoAvisoDeTranscricao(fn) {
  aoTranscricaoAtual = fn
  if (disponivel()) {
    try { ouvir() } catch { /* sem o plugin: o app busca ao voltar para a tela */ }
  }
  return () => { if (aoTranscricaoAtual === fn) aoTranscricaoAtual = null }
}

// Na abertura do app: quem já permitiu tem o aparelho recadastrado em
// silêncio (o token muda de vez em quando). Quem não permitiu não é
// perguntado aqui.
export async function iniciarNotificacoes(aoChegar) {
  if (!disponivel()) return
  aoChegarAtual = aoChegar
  try {
    ouvir()
    const { receive } = await PushNotifications.checkPermissions()
    if (receive === 'granted') await registrar()
  } catch {
    // Sem Firebase configurado no app, ou a Apple recusou: segue sem aviso.
  }
}

// Depois de a pessoa compartilhar o convite. Só pergunta uma vez: quem negou
// não é perguntado de novo (o sistema nem deixaria).
export async function pedirNotificacoes() {
  if (!disponivel()) return
  try {
    ouvir()
    let { receive } = await PushNotifications.checkPermissions()
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      ({ receive } = await PushNotifications.requestPermissions())
    }
    if (receive === 'granted') await registrar()
  } catch {
    // Idem: sem notificação, o aviso continua aparecendo ao abrir o app.
  }
}

// Ao sair da conta, antes do signOut (o servidor precisa saber de quem é o
// pedido): quem entrar depois neste celular não recebe o aviso do prêmio de
// outra pessoa.
export async function esquecerAparelho() {
  if (!disponivel()) return
  let token = null
  try { token = localStorage.getItem(CHAVE_TOKEN) } catch { /* sem storage */ }
  if (!token) return
  try { await removerAparelho(token) } catch { /* sem rede: o token some quando outra conta entrar */ }
  try { localStorage.removeItem(CHAVE_TOKEN) } catch { /* sem storage */ }
}
