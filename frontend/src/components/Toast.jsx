import { useEffect, useState } from 'react'
import { onToast } from '../lib/toast'
import { IconCheck, IconClose } from './Icons'

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

  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className="toast">
          <IconCheck width={15} height={15} className="toast-icon" />
          <div className="toast-body">
            <span className="toast-msg">{t.message}</span>
            {t.detail && <span className="toast-detail">{t.detail}</span>}
          </div>
          {t.actionLabel && (
            <button
              className="toast-action"
              onClick={() => { t.onAction?.(); dismiss(t.id) }}
            >
              {t.actionLabel}
            </button>
          )}
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Fechar aviso">
            <IconClose width={12} height={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
