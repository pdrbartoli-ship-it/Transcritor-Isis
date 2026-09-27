import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { isNative, platformName } from './platform'

// O teclado do iPhone, acompanhado pela própria página.
//
// O plugin do teclado, no modo de fábrica ("native"), só encolhe o app DEPOIS
// que o teclado termina de subir: espera a animação inteira e mais 0,2 s
// (Keyboard.m, onKeyboardWillShow). Nesse meio segundo o teclado cobre a barra
// de perguntar, e ela aparece de supetão por cima dele. Era o "a barra pula
// por trás do teclado". Ao voltar de outro app acontecia o mesmo, ao contrário:
// a tela voltava inteira, descia e subia de novo.
//
// Aqui o plugin não mexe em tamanho nenhum ("none"), e a página recebe a
// altura no instante em que o teclado começa a subir. O CSS (celular.css,
// "Teclado do iPhone") encolhe o app junto com ele, na mesma duração.
//
// A rolagem do documento também sai: quem rola é o conteúdo do app, e o
// iPhone, ao focar um campo, empurrava a página inteira alguns pixels para
// cima e de volta (o "treme" ao tocar no campo com o teclado já aberto).
//
// Tudo pelo JavaScript, e não pelo capacitor.config.json, para valer já na
// montagem que está no TestFlight, pela atualização automática.
//
// No Android o próprio sistema encolhe a janela (adjustResize); nada muda lá.

// Um pouco mais que a animação do teclado: o que estava à vista antes de ele
// subir é conferido quando o app já tem o tamanho novo.
const DEPOIS_DA_ANIMACAO_MS = 320

export function iniciarTeclado() {
  // As montagens anteriores a 26/09/2026 não têm o plugin; nelas fica o
  // comportamento de antes.
  if (!isNative() || platformName() !== 'ios' || !Capacitor.isPluginAvailable('Keyboard')) return
  const raiz = document.documentElement
  raiz.classList.add('teclado-ios')

  Keyboard.setResizeMode({ mode: 'none' }).catch(() => {})
  Keyboard.setScroll({ isDisabled: true }).catch(() => {})

  Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
    mudarAltura(`${Math.round(keyboardHeight)}px`)
  })
  Keyboard.addListener('keyboardWillHide', () => mudarAltura('0px'))

  function mudarAltura(altura) {
    if (raiz.style.getPropertyValue('--teclado') === altura) return
    // Com a conversa rolada até o fim, o fim continua à vista enquanto o app
    // encolhe: é a última resposta que a pessoa está lendo ao perguntar.
    const rolagem = document.querySelector('.content')
    const noFim = rolagem && rolagem.scrollHeight - rolagem.scrollTop - rolagem.clientHeight < 24

    raiz.style.setProperty('--teclado', altura)

    const ate = performance.now() + DEPOIS_DA_ANIMACAO_MS
    const acompanhar = () => {
      if (noFim) rolagem.scrollTop = rolagem.scrollHeight
      if (performance.now() < ate) requestAnimationFrame(acompanhar)
      else revelarCampo()
    }
    requestAnimationFrame(acompanhar)
  }
}

// O campo em foco pode ter ficado abaixo do que sobrou da tela (o login, a
// tela do Perguntar em repouso). Sem a rolagem do documento, quem o traz à
// vista é a rolagem de dentro do app.
function revelarCampo() {
  const campo = document.activeElement
  if (campo?.matches?.('input, textarea')) campo.scrollIntoView({ block: 'nearest' })
}
