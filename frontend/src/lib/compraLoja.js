// A compra por dentro do app de celular — App Store e Play Store.
//
// Por que ela existe: a regra 3.1.3(b) da Apple deixa a conta do Dito valer em
// todos os aparelhos, mas com uma condição — os mesmos planos precisam TAMBÉM
// poder ser comprados por dentro do app. Foi a falta disso, e não a conta
// compartilhada, que custou dois envios (app-store-atualizacao-30.09.md).
//
// Quem fala com as lojas é o RevenueCat: um plugin resolve as duas e manda um
// webhook só para o servidor (/billing/webhook-loja). Ele vê plano, valor e id
// da compra; conversa e áudio continuam cifrados no aparelho e não passam por
// aqui.
//
// Tudo o que é específico de loja mora neste arquivo. As telas chamam
// `lerProdutos`, `comprar`, `restaurar`, `confirmarNaLoja` e `gerenciarNaLoja`,
// e não sabem o nome de nenhuma biblioteca.
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { isNative, platformName } from './platform'
import { sincronizarLoja } from './api'

// A tela de assinaturas da Apple, aberta por cima do app (AssinaturasPlugin.swift).
// Só existe nos builds de iPhone a partir de 06/10; nos anteriores, e no
// Android, vale o link da loja.
const Assinaturas = registerPlugin('Assinaturas')

// Chaves PÚBLICAS do RevenueCat (as que começam com `appl_` e `goog_`). São
// feitas para viajar dentro do app, como a SUPABASE_ANON_KEY que já mora em
// supabase.js — quem valida a compra de verdade é a loja, e quem libera o plano
// é o webhook no servidor, com o segredo que só ele tem.
//
// Vazias, `lojaDisponivel()` devolve falso e o app volta a se comportar como
// antes desta versão: não vende no iPhone. É de propósito — um build sem a
// chave não pode ir para a loja mostrando uma tela de compra que não compra.
const CHAVES = {
  ios: 'appl_eetazejSkrolleMGVYwLwjgbkzD',
  android: '',
}

// O identificador de cada produto vem do servidor, em GET /planos?plataforma=ios
// (campo `produtos`), para os nomes existirem num lugar só. Este mapa é o
// desenho inicial, do mesmo jeito que planos.js guarda os preços: serve
// enquanto a resposta não chega, e precisa bater com o App Store Connect.
export const PRODUTOS_PADRAO = {
  iniciante: {
    mensal: 'br.com.albiecloud.dito.iniciante.mensal',
    anual: 'br.com.albiecloud.dito.iniciante.anual',
  },
  avancado: {
    mensal: 'br.com.albiecloud.dito.avancado.mensal',
    anual: 'br.com.albiecloud.dito.avancado.anual',
  },
}

export const chaveDaLoja = () => CHAVES[platformName()] || ''

// Onde a compra é pela loja: o app empacotado de iPhone e de Android. O site e
// o app de Windows não entram — a Microsoft Store deixa app que não é jogo usar
// a própria cobrança (política 10.8.1), então lá o Stripe continua, sem
// comissão nenhuma.
export const lojaDisponivel = () => isNative() && !!chaveDaLoja()

// O nome da loja como a pessoa a conhece, para os textos da tela. A App Store é
// feminina e o Google Play é masculino, então os textos pedem o nome já com o
// artigo: "na App Store", "no Google Play".
const ehApple = () => platformName() === 'ios'
export const nomeDaLoja = () => (ehApple() ? 'App Store' : 'Google Play')
export const naLojaTexto = () => (ehApple() ? 'na App Store' : 'no Google Play')
export const pelaLojaTexto = () => (ehApple() ? 'pela App Store' : 'pelo Google Play')
export const aLojaTexto = () => (ehApple() ? 'a App Store' : 'o Google Play')
export const nesteIdTexto = () => (ehApple() ? 'neste Apple ID' : 'nesta conta Google')

// `configure` é caro e não pode rodar duas vezes; `logIn` é o jeito de trocar
// de dono depois. Guardamos quem está configurado para que abrir o "Meu plano"
// dez vezes não vire dez configurações.
let configurado = false
let donoAtual = null
let configurando = null

// O id do usuário no Supabase vai como `appUserID`. É por ele que o webhook
// sabe de quem é a assinatura que a loja avisou — sem isso, a compra chega no
// servidor sem dono e o plano não é liberado para ninguém.
export async function configurarLoja(userId) {
  if (!lojaDisponivel() || !userId) return false
  if (configurado && donoAtual === userId) return true
  // Duas telas pedindo ao mesmo tempo esperam a mesma configuração, em vez de
  // disputar o estado interno do plugin.
  if (configurando) { await configurando; if (donoAtual === userId) return true }

  configurando = (async () => {
    try {
      if (!configurado) {
        if (import.meta.env?.DEV) await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG })
        await Purchases.configure({ apiKey: chaveDaLoja(), appUserID: userId })
        configurado = true
      } else {
        await Purchases.logIn({ appUserID: userId })
      }
      donoAtual = userId
    } catch (err) {
      // Loja fora do ar ou sem rede: a tela mostra o preço do servidor e o
      // botão de comprar avisa que não deu. Não é motivo para derrubar o app.
      console.warn('Não foi possível configurar a compra pela loja', err)
    } finally {
      configurando = null
    }
  })()
  await configurando
  return donoAtual === userId
}

// Quem sai da conta não pode deixar a compra amarrada ao id anterior: o próximo
// login no mesmo aparelho herdaria a assinatura de quem saiu.
export async function sairDaLoja() {
  if (!configurado) return
  try {
    await Purchases.logOut()
  } catch {
    // Já estava anônimo, ou o plugin nem chegou a configurar. Nada a fazer.
  }
  donoAtual = null
}

// O preço que a loja vai cobrar, e não o que está escrito no nosso código: é a
// Apple que aplica imposto e câmbio, e mostrar outro número seria mostrar um
// preço que não é o da cobrança. Devolve um mapa de identificador → produto.
export async function lerProdutos(identificadores) {
  const ids = identificadores.filter(Boolean)
  if (!lojaDisponivel() || ids.length === 0) return {}
  try {
    const { products } = await Purchases.getProducts({ productIdentifiers: ids })
    return Object.fromEntries((products || []).map(p => [p.identifier, p]))
  } catch (err) {
    console.warn('Não foi possível ler os preços da loja', err)
    return {}
  }
}

// Erro que a tela precisa distinguir: desistir no meio da compra da Apple não é
// falha, e não pode virar uma faixa vermelha.
export class CompraCancelada extends Error {
  constructor() { super('Compra cancelada.') }
}

// Os códigos de erro do RevenueCat que pedem um texto nosso
// (PURCHASES_ERROR_CODE no plugin).
const ERRO_CANCELADA = '1'
const ERRO_JA_COMPRADO = '6'
const ERRO_AGUARDANDO = '20'

export async function comprar(produto) {
  if (!lojaDisponivel()) throw new Error(`A compra ${pelaLojaTexto()} não está disponível neste aparelho.`)
  try {
    await Purchases.purchaseStoreProduct({ product: produto })
  } catch (err) {
    if (err?.userCancelled || err?.code === ERRO_CANCELADA || /cancel/i.test(err?.message || '')) {
      throw new CompraCancelada()
    }
    // Compra Solicitada, da família: alguém ainda precisa aprovar.
    if (err?.code === ERRO_AGUARDANDO) {
      throw new Error('A compra está aguardando aprovação. O plano entra assim que ela for aprovada.')
    }
    // O mesmo Apple ID já assina, por outra conta do Dito. Foi o que aconteceu
    // no teste de 05/10: a assinatura é do Apple ID, não da conta.
    if (err?.code === ERRO_JA_COMPRADO) {
      throw new Error(`Este ${ehApple() ? 'Apple ID' : 'Google ID'} já tem uma assinatura do Dito. Toque em "Restaurar compras" para trazê-la para esta conta.`)
    }
    throw new Error(err?.message || 'Não foi possível concluir a compra. Nada foi cobrado.')
  }
}

// Exigência da Apple: quem trocou de aparelho, reinstalou, ou comprou logado
// em outra conta do Dito precisa de um jeito de recuperar o que já pagou sem
// pagar de novo. Devolve quantas assinaturas ativas a loja reconheceu.
export async function restaurar() {
  if (!lojaDisponivel()) return 0
  const { customerInfo } = await Purchases.restorePurchases()
  return (customerInfo?.activeSubscriptions || []).length
}

// Onde a assinatura da loja é trocada e cancelada: só a loja tem esse poder.
// No iPhone, a tela da Apple por cima do app, que é a única que mostra também
// as compras de teste (as do revisor). Sem ela (build antigo, Android), o link
// que a loja informa. Resolve quando a pessoa fecha a tela da Apple.
export async function gerenciarNaLoja() {
  if (!lojaDisponivel()) throw new Error('Abra os ajustes do aparelho para gerenciar sua assinatura.')
  if (ehApple() && Capacitor.isPluginAvailable('Assinaturas')) {
    await Assinaturas.gerenciar()
    return
  }
  let url = null
  try {
    const { customerInfo } = await Purchases.getCustomerInfo()
    url = customerInfo?.managementURL || null
  } catch {
    // Sem resposta da loja: cai no aviso abaixo.
  }
  if (!url) throw new Error(`Abra os ajustes do aparelho para gerenciar sua assinatura ${naLojaTexto()}.`)
  window.open(url, '_blank', 'noopener')
}

// Depois de comprar ou restaurar, o servidor pergunta à loja o que vale agora e
// grava. A loja já sabe da compra quando `comprar` termina (o plugin entrega o
// recibo antes de responder), então a resposta é imediata.
//
// Nunca lança, de propósito: quando esta função é chamada, a loja já cobrou. Um
// erro subindo daqui faria a tela dizer que o pagamento não deu certo depois de
// ele ter dado, e a pessoa compraria de novo. Sem resposta, devolve null, e a
// tela diz que a compra está confirmada e o plano chega sozinho.
const TENTATIVAS = 3
const ESPERA_MS = 1500

export async function confirmarNaLoja() {
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      return await sincronizarLoja()
    } catch {
      // Servidor acordando ou loja oscilando. O aviso da loja pelo webhook
      // chega de qualquer forma, por um caminho que não depende desta tela.
      await new Promise(r => setTimeout(r, ESPERA_MS))
    }
  }
  return null
}
