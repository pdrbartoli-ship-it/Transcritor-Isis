import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'

// Onde o app está rodando. `isNative` distingue o app empacotado (Capacitor) do
// site; `isMobile` é sobre o tamanho da tela — um celular no navegador é mobile
// mas não é native, e as duas coisas exigem tratamentos diferentes.
const MOBILE_QUERY = '(max-width: 760px)'

export const isNative = () => Capacitor.isNativePlatform()
export const platformName = () => Capacitor.getPlatform() // 'android' | 'ios' | 'web'

// Endereço público do Dito. No app empacotado a página roda em localhost, então
// window.location.origin não serve para montar links que saem daqui (o de
// confirmação de e-mail, por exemplo) — eles precisam apontar para o domínio.
export const SITE_URL = 'https://dito.albiecloud.com'
export const siteUrl = () => (isNative() ? SITE_URL : window.location.origin)

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
  }
}
