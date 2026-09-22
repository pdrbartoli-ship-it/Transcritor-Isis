import { createContext, useContext, useState } from 'react'
import { useAuth } from './AuthContext'
import { useDeteccaoReuniao } from '../components/reuniao/useDeteccaoReuniao'
import { getAvisarReuniao, setAvisarReuniao } from '../lib/prefs'
import { pedirPlano } from '../lib/planoModal'

// O detector de reunião, montado acima das rotas pelo mesmo motivo que a
// gravação (ver GravacaoContext): a home e as conversas estão em ramos
// diferentes do roteador, e um detector dentro do Layout perderia os ouvintes
// e a memória de "esta reunião já foi perguntada" a cada troca de tela.
//
// O que o Layout consome daqui é só o interruptor das Configurações.
const ReuniaoContext = createContext(null)

// Sem provedor (uma tela montada fora do app), o interruptor simplesmente não
// aparece. É melhor do que derrubar a tela por causa de um ajuste.
const PADRAO = { disponivel: false, avisar: false, definirAvisar: () => {} }

export function useReuniao() {
  return useContext(ReuniaoContext) || PADRAO
}

export function ReuniaoProvider({ children }) {
  const { user } = useAuth()
  const [avisar, setAvisarState] = useState(getAvisarReuniao)

  const { disponivel } = useDeteccaoReuniao({
    userId: user?.id,
    convidado: !!user?.is_anonymous,
    avisar,
    abrirPlano: pedirPlano,
  })

  function definirAvisar(ligado) {
    setAvisarState(ligado)
    setAvisarReuniao(ligado)
  }

  return (
    <ReuniaoContext.Provider value={{ disponivel, avisar, definirAvisar }}>
      {children}
    </ReuniaoContext.Provider>
  )
}
