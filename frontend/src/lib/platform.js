import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { isTauri } from '@tauri-apps/api/core'
// Importação circular de propósito, no mesmo molde da de api.js com planos.js:
// compraLoja.js só lê `isNative`/`platformName` daqui dentro de funções, e
// `podeVender` só chama `chaveDaLoja` dentro de si — nenhum dos dois precisa do
// outro no instante em que o módulo é avaliado.
import { chaveDaLoja } from './compraLoja'

// Onde o app está rodando. `isNative` distingue o app empacotado (Capacitor) do
// site; `isMobile` é sobre o tamanho da tela — um celular no navegador é mobile
// mas não é native, e as duas coisas exigem tratamentos diferentes.
const MOBILE_QUERY = '(max-width: 760px)'

export const isNative = () => Capacitor.isNativePlatform()
export const platformName = () => Capacitor.getPlatform() // 'android' | 'ios' | 'web'

// App nativo Windows (Tauri) — usado só internamente pelo useCapture.js para
// decidir entre a captura WASAPI (sistema + mic) e o getUserMedia do navegador.
export const isTauriApp = () => isTauri()

// Endereço público do Dito. No app empacotado a página roda em localhost, então
// window.location.origin não serve para montar links que saem daqui (o de
// confirmação de e-mail, por exemplo) — eles precisam apontar para o domínio.
export const SITE_URL = 'https://dito.albiecloud.com'
export const siteUrl = () => (isNative() ? SITE_URL : window.location.origin)

// A App Store proíbe vender assinatura de serviço digital por fora do sistema
// de compras da Apple, e proíbe até apontar o caminho de fora — um "assine no
// site" dentro do app é recusa na revisão. Até esta versão o app de iPhone
// simplesmente não vendia, e quem queria um plano pago assinava no site.
//
// Não bastou: a regra 3.1.3(b), que permite a conta valer em todos os
// aparelhos, exige que os mesmos planos TAMBÉM possam ser comprados por dentro
// do app. Foi essa palavra que custou dois envios. Agora o iPhone vende pela
// compra da Apple (lib/compraLoja.js), e esta função é o interruptor.
//
// Ela continua devolvendo falso no iPhone quando a chave da loja não está no
// build: sem ela a compra não funciona, e uma tela de planos que não compra é
// pior do que nenhuma.
export const podeVender = () => platformName() !== 'ios' || !!chaveDaLoja()

export function isMobileViewport() {
  try { return window.matchMedia(MOBILE_QUERY).matches } catch { return false }
}

// O PWA instalado abre sem barra de endereço, como o app nativo — nesse modo
// não faz sentido mostrar a landing com a caixa de instalar de novo.
export function isStandalonePwa() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  } catch {
    return false
  }
}

// Envio por Enter só faz sentido com teclado físico. No celular o Enter precisa
// quebrar linha, senão a mensagem escapa no meio da frase.
export function useIsTouchInput() {
  const { isMobile, isNative: native } = usePlatform()
  return isMobile || native
}

export function usePlatform() {
  const [isMobile, setIsMobile] = useState(isMobileViewport)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = e => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const native = isNative()
  return {
    isMobile,
    isNative: native,
    isAndroid: platformName() === 'android',
    isIOS: platformName() === 'ios',
    isWeb: !native,
    podeVender: podeVender(),
  }
}
