import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

// Quando o app cai sozinho no login, a pergunta que importa é por quê — e o
// recarregamento levava junto qualquer rastro. Guardar os últimos eventos de
// autenticação em disco deixa o próprio app responder isso depois, em vez de
// dependermos de reproduzir o problema.
const CHAVE_RASTRO = 'dito-rastro-auth'
const MAX_RASTRO = 5

function registrarEvento(evento) {
  try {
    const antes = JSON.parse(localStorage.getItem(CHAVE_RASTRO) || '[]')
    const agora = `${evento} ${new Date().toLocaleString('pt-BR')}`
    localStorage.setItem(CHAVE_RASTRO, JSON.stringify([...antes, agora].slice(-MAX_RASTRO)))
  } catch {
    // Sem localStorage (janela privada) só perdemos o diagnóstico; o login
    // não pode quebrar por causa disso.
  }
}

export function rastroAuth() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_RASTRO) || '[]').join(' · ')
  } catch {
    return ''
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // Depois do cadastro a sessão nasce na hora e o PublicRoute redirecionaria
  // antes de o usuário ver que a conta foi criada. A tela de cadastro segura o
  // redirecionamento por alguns instantes para mostrar a confirmação.
  const [holdRedirect, setHoldRedirect] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, session) => {
      registrarEvento(evento)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, holdRedirect, setHoldRedirect }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
