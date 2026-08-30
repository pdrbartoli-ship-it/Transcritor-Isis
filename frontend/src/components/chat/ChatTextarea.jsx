import { useRef, useEffect } from 'react'
import { useIsTouchInput } from '../../lib/platform'

const MAX_ROWS = 6

// Campo que cresce com o texto até seis linhas. Extraído do FolderView quando
// as pastas saíram do produto — a lógica não tinha nada de específico de pasta.
export default function ChatTextarea({ value, onChange, onSubmit, placeholder, disabled }) {
  const ref = useRef(null)
  const touchInput = useIsTouchInput()

  // Auto-grow: zera a altura antes de medir, senão o scrollHeight nunca encolhe.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
    const padding = el.offsetHeight - el.clientHeight
    const max = lineHeight * MAX_ROWS + padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value])

  function handleKeyDown(e) {
    if (e.key !== 'Enter') return
    // No celular o Enter é quebra de linha e o envio fica só no botão; com
    // teclado físico, Enter envia e Shift+Enter quebra a linha.
    if (touchInput || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    onSubmit(e)
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}
