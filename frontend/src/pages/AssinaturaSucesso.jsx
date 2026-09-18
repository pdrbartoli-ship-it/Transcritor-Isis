import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { IconCheck } from '../components/Icons'

const NOME_PLANO = { iniciante: 'Iniciante', avancado: 'Avançado' }

// O webhook do Stripe grava o plano alguns instantes depois do redirect —
// por isso espiamos a tabela algumas vezes em vez de confiar que já chegou.
export default function AssinaturaSucesso() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [plano, setPlano] = useState(null)
  const [tentando, setTentando] = useState(true)
  // null enquanto não sabemos: até lá o botão fica no texto neutro, porque
  // convidar alguém a "gravar a primeira" quem já gravou dez seria pior do que
  // não convidar nada.
  const [temConversa, setTemConversa] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelado = false

    async function checar(tentativa) {
      const { data } = await supabase
        .from('subscriptions')
        .select('plano')
        .eq('user_id', user.id)
        .maybeSingle()

      if (cancelado) return
      if (data?.plano && data.plano !== 'gratuito') {
        setPlano(data.plano)
        setTentando(false)
        return
      }
      if (tentativa >= 5) { setTentando(false); return }
      setTimeout(() => checar(tentativa + 1), 1500)
    }

    checar(0)
    return () => { cancelado = true }
  }, [user?.id])

  // Só o suficiente para saber se existe alguma: nada é decifrado aqui.
  useEffect(() => {
    if (!user?.id) return
    let cancelado = false
    supabase
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .then(({ data }) => {
        if (!cancelado) setTemConversa((data?.length ?? 0) > 0)
      })
    return () => { cancelado = true }
  }, [user?.id])

  // O instante seguinte ao pagamento é o de maior disposição do funil, e um
  // "Voltar para o Dito" genérico desperdiçava ele. Quem ainda não gravou é
  // convidado a gravar; quem já gravou vai para o que já tem.
  const acao = temConversa === null
    ? 'Voltar para o Dito'
    : temConversa ? 'Ver minhas conversas' : 'Gravar minha primeira conversa'

  return (
    <div className="auth-page">
      <div className="auth-card auth-created">
        <div className="feedback-check"><IconCheck width={26} height={26} /></div>
        {plano ? (
          <>
            <h3>Plano {NOME_PLANO[plano] || plano} ativado</h3>
            <p className="text-muted">Seu pagamento foi confirmado. Aproveite o Dito.</p>
          </>
        ) : tentando ? (
          <>
            <h3>Pagamento recebido</h3>
            <p className="text-muted">Estamos ativando seu plano — isso leva só um instante…</p>
            <div className="spinner" style={{ margin: '18px auto 0' }} />
          </>
        ) : (
          <>
            <h3>Pagamento recebido</h3>
            <p className="text-muted">
              Seu plano deve aparecer em instantes. Se ele não atualizar, confira em "Meu plano".
            </p>
          </>
        )}
        <button className="btn-primary btn-full" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
          {acao}
        </button>
      </div>
    </div>
  )
}
