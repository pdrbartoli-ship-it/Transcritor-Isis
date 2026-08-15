import { supabase } from './supabase'
import { isNative } from './platform'

// Medição de uso para acompanhar os testadores. Grava só contagens e
// metadados — nunca transcrição, nome de arquivo ou URL. Ver supabase/analytics.sql.
//
// Regra de ouro: medir jamais pode atrapalhar o uso. Toda falha aqui é
// engolida, e nada espera por esta escrita.

// getSession lê do armazenamento local, sem ida à rede.
async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id || null
  } catch {
    return null
  }
}

export function track(name, props = {}) {
  // Deliberadamente sem await no chamador: é disparar e esquecer.
  ;(async () => {
    const userId = await currentUserId()
    if (!userId) return
    try {
      await supabase.from('events').insert({
        user_id: userId,
        name,
        props: { ...props, plataforma: isNative() ? 'app' : 'web' },
      })
    } catch {
      // Sem medição a pessoa continua usando o app normalmente.
    }
  })()
}

// Uma abertura por carregamento do app. O módulo guarda o estado porque o
// StrictMode monta os componentes duas vezes em desenvolvimento, e isso
// contaria em dobro.
let openTracked = false

export function trackAppOpen() {
  if (openTracked) return
  openTracked = true
  track('app_open')
}
