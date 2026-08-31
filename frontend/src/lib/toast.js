// Pub/sub minúsculo: qualquer componente chama showToast() sem precisar de
// Context/Provider — só o ToastHost, montado uma vez no Layout, escuta.
let listeners = []

export function showToast(message, opts = {}) {
  const toast = { id: `${Date.now()}-${Math.random()}`, message, ...opts }
  listeners.forEach(fn => fn(toast))
}

export function onToast(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}
