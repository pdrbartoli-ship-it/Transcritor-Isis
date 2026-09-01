import { useEffect, useState } from 'react'
import { onToast } from '../lib/toast'
import { IconCheck } from './Icons'

const DEFAULT_DURATION = 4500

// Monta uma vez no Layout; showToast() em qualquer arquivo já basta para
// aparecer aqui. Sem isso, ações como "baixar" terminavam em silêncio total —
// o arquivo saía, mas nada na tela dizia que aconteceu.
export default function Toast() {
  const [toasts, setToasts] = useState([])

  useEffect(() => onToast(t => {
    setToasts(ts => [...ts, t])
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== t.id)), t.duration || DEFAULT_DURATION)
  }), [])

  function dismiss(id) {
    setToasts(ts => ts.filter(t => t.id !== id))
  }

  if (!toasts.length) return null

  // Sem botão de fechar: o aviso se apaga sozinho em segundos, e um "×" para
  // dispensar uma confirmação que já está de saída era mais peça na tela do
  // que ajuda. Clicar no aviso dispensa, para quem quiser tirá-lo na hora.
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div
          key={t.id}
          className="toast"
          role="status"
          onClick={() => dismiss(t.id)}
        >
          <IconCheck width={14} height={14} className="toast-icon" />
          <span className="toast-msg">{t.message}</span>
          {t.actionLabel && (
            <button
              className="toast-action"
              onClick={e => { e.stopPropagation(); t.onAction?.(); dismiss(t.id) }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
