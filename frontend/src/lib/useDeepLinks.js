import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { isNative } from './platform'

// Quando o Android abre o Dito por um App Link (o link de confirmação de
// e-mail), a WebView carrega o bundle local normalmente — a URL clicada não
// aparece em window.location. Ela chega por este evento, e é aqui que a
// traduzimos para a rota interna correspondente.
export default function useDeepLinks() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNative()) return

    const handle = App.addListener('appUrlOpen', ({ url }) => {
      try {
        const parsed = new URL(url)
        // Só /confirm.html é declarado no manifesto, mas conferimos mesmo assim
        // para não navegar por engano se outro link chegar aqui um dia.
        if (!parsed.pathname.startsWith('/confirm')) return
        navigate(`/confirm${parsed.search}`, { replace: true })
      } catch {
        // URL malformada: não há o que fazer além de ignorar.
      }
    })

    return () => { handle.then(h => h.remove()).catch(() => {}) }
  }, [navigate])
}
