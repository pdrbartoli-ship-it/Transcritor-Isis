import { useEffect } from 'react'
import { IconCheck } from './Icons'

// Aviso temporário no rodapé. Some sozinho após `duration` ms.
export default function Toast({ message, onDone, duration = 2600 }) {
  useEffect(() => {
    const t = setTimeout(onDone, duration)
    return () => clearTimeout(t)
  }, [onDone, duration])

  return (
    <div className="toast" role="status">
      <IconCheck width={16} height={16} /> {message}
    </div>
  )
}
