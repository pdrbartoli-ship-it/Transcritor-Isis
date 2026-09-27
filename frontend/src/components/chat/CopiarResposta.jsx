import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy } from '../Icons'
import { showToast } from '../../lib/toast'
import { track } from '../../lib/analytics'

// O botão de copiar embaixo de cada resposta, como o do Claude e o do ChatGPT.
// Copiar é o que mais se faz com uma resposta: mandar no WhatsApp, colar num
// e-mail, guardar numa nota.
export default function CopiarResposta({ texto, origem }) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copiar() {
    const ok = await copiarTexto(textoParaCopiar(texto))
    if (!ok) {
      showToast('Não foi possível copiar')
      return
    }
    track('resposta_copiada', { origem })
    showToast('Resposta copiada')
    setCopiado(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <button
      type="button"
      className={`btn-copiar-resposta${copiado ? ' feito' : ''}`}
      onClick={copiar}
      title="Copiar resposta"
      aria-label="Copiar resposta"
    >
      {copiado ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
    </button>
  )
}

// O que se lê na tela, sem os sinais do markdown (**, ##, >) e sem as marcas
// de fonte [C1] do Perguntar, que fora do app não levam a lugar nenhum. Colado
// no WhatsApp ou num e-mail, sai limpo.
export function textoParaCopiar(md) {
  return String(md || '')
    .replace(/[ \t]*\[C\d+\]/g, '')
    .split('\n')
    .map(linha => linha
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)[-*]\s+/, '$1• '))
    .join('\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// A área de transferência moderna pede página segura e toque recente; o
// caminho antigo (um campo escondido e o "copiar" do documento) cobre onde ela
// falta.
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const campo = document.createElement('textarea')
    campo.value = texto
    campo.setAttribute('readonly', '')
    campo.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(campo)
    campo.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { /* sem nenhum dos dois */ }
    campo.remove()
    return ok
  }
}
