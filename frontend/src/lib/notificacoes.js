import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { isNative, platformName } from './platform'
import { registrarAparelho, removerAparelho } from './api'

// Notificação no celular (Android e iPhone). Hoje só existe um aviso: o do
// convite premiado, quando um amigo completa as transcrições. No computador
// não há notificação de propósito; lá o aviso aparece quando o app abre.
//
// O pedido de permissão não sai na abertura do app, onde ele não teria
// contexto nenhum: sai quando a pessoa compartilha o link de convite, que é
// quando "avisar quando um amigo entrar" faz sentido.

// O token que o Google ou a Apple deram a este aparelho, para tirá-lo da
// lista ao sair da conta.
const CHAVE_TOKEN = 'dito-push-token'

// O canal do Android. O id é o mesmo que o servidor manda (main.py:
// CANAL_ANDROID); o nome é o que aparece nas configurações do celular.
const CANAL = {
  id: 'convites',
  name: 'Convites',
  description: 'Quando um amigo começa a usar o Dito pelo seu convite',
  importance: 4,
  visibility: 1,
}

// O código novo chega por OTA a um app instalado antes do plugin existir. Sem
// esta conferência, a chamada ao plugin ausente quebraria a tela.
const disponivel = () => isNative() && Capacitor.isPluginAvailable('PushNotifications')

let ouvindo = false
let aoChegarAtual = null

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
  // aviso do próprio app, que aparece ao reler o convite. Tocar numa
  // notificação com o app em segundo plano cai no mesmo caminho.
  PushNotifications.addListener('pushNotificationReceived', () => aoChegarAtual?.())
  PushNotifications.addListener('pushNotificationActionPerformed', () => aoChegarAtual?.())
}

async function registrar() {
  if (platformName() === 'android') await PushNotifications.createChannel(CANAL).catch(() => {})
  await PushNotifications.register()
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
