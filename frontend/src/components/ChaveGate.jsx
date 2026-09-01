import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { temChave, criarChave, abrirComSenha, recomecarCofre, recuperarComChave } from '../lib/chaves'
import { temChaveNoAparelho } from '../lib/cofre'
import { apagarInacessiveis } from '../lib/meusDados'
import { showToast } from '../lib/toast'
import { IconShield } from './Icons'

// Garante que existe uma chave utilizável NESTE aparelho antes de o app rodar.
// O login cobre o caso normal; isto cobre os três em que a sessão existe e a
// chave não: quem já estava logado quando a criptografia subiu, quem limpou o
// navegador, e quem voltou num aparelho onde a sessão sobreviveu e a chave não.
//
// A regra que não pode ser quebrada aqui: NUNCA prender o usuário. A primeira
// versão desta tela pedia a senha e, se ela não abrisse o cofre (o que acontece
// depois de um reset por e-mail), não oferecia mais nada — trancava a pessoa
// para fora do app inteiro, inclusive das conversas antigas em texto puro, que
// nem precisam de chave. Daí o "não lembro minha senha antiga": ele custa o
// conteúdo cifrado, mas devolve a conta.
export default function ChaveGate({ children }) {
  const { user } = useAuth()
  const [estado, setEstado] = useState('checando')  // checando | ok | desbloquear | criando
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [oferecerRecomeco, setOferecerRecomeco] = useState(false)
  const [usandoChave, setUsandoChave] = useState(false)
  const [chaveDigitada, setChaveDigitada] = useState('')

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      if (!user?.id) return
      try {
        if (await temChaveNoAparelho()) { if (!cancelado) setEstado('ok'); return }
        const existe = await temChave(user.id)
        if (!cancelado) setEstado(existe ? 'desbloquear' : 'criando')
      } catch {
        // Não conseguir checar (rede, tabela ausente) não pode trancar o app:
        // sem a tabela, nada está cifrado, e o Dito funciona como antes.
        if (!cancelado) setEstado('ok')
      }
    })()
    return () => { cancelado = true }
  }, [user?.id])

  async function enviar(e) {
    e.preventDefault()
    setOcupado(true)
    setErro(null)
    try {
      if (estado === 'criando') {
        await criarChave(user.id, senha)
      } else {
        const dek = await abrirComSenha(user.id, senha)
        if (!dek) throw new Error('sem cofre')
      }
      setSenha('')
      setEstado('ok')
    } catch {
      // A decifragem é autenticada: senha errada FALHA, não devolve lixo. Por
      // isso dá para afirmar isto sem guardar hash de senha em lugar nenhum.
      setErro('Senha incorreta.')
      setOferecerRecomeco(true)
    } finally {
      setOcupado(false)
    }
  }

  // O caminho que SALVA o conteúdo. A chave de recuperação abre o segundo
  // cofre, de onde sai a mesma chave de dados de sempre — então o que estava
  // cifrado continua abrindo. Por isso ele é oferecido antes do recomeço.
  async function usarChaveRecuperacao(e) {
    e.preventDefault()
    setOcupado(true)
    setErro(null)
    try {
      await recuperarComChave(user.id, chaveDigitada, senha)
      setChaveDigitada('')
      setSenha('')
      setEstado('ok')
      showToast('Conteúdo desbloqueado — nada foi perdido')
    } catch {
      setErro('Essa chave de recuperação não confere.')
    } finally {
      setOcupado(false)
    }
  }

  // Cofre novo com a senha atual. O que estava cifrado com a chave antiga não
  // volta — nem para nós — então é removido em vez de ficar de enfeite na
  // lista. O aviso vem depois, não antes: o usuário precisa saber o que
  // aconteceu, mas não precisa de mais um diálogo para atravessar.
  async function recomecar() {
    setOcupado(true)
    setErro(null)
    try {
      await recomecarCofre(user.id, senha)
      const apagadas = await apagarInacessiveis(user.id)
      setSenha('')
      setEstado('ok')
      if (apagadas > 0) {
        showToast(`${apagadas} conversa(s) não podiam mais ser abertas e foram removidas`, { duration: 9000 })
      }
    } catch {
      setErro('Não foi possível recomeçar. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  async function sair() {
    await supabase.auth.signOut()
    window.location.reload()
  }

  if (estado === 'ok' || estado === 'checando') return children

  const criandoAgora = estado === 'criando'

  return (
    <div className="modal-overlay chave-overlay">
      <div className="modal chave-modal">
        <div className="chave-cabeca">
          <span className="chave-escudo"><IconShield width={22} height={22} /></span>
          <h3>{criandoAgora ? 'Proteger suas conversas' : 'Desbloquear neste aparelho'}</h3>
          <p className="text-muted text-sm">
            {criandoAgora
              ? 'Vamos preparar a proteção das suas conversas. A partir daí elas ficam ilegíveis para qualquer um que não seja você — nós inclusive.'
              : 'Suas conversas são guardadas cifradas. Digite sua senha para abrir seu conteúdo neste aparelho.'}
          </p>
        </div>

        <form onSubmit={enviar}>
          <input
            type="password"
            className="chave-senha-input"
            value={senha}
            onChange={e => setSenha(e.target.value)}
            placeholder="Sua senha"
            autoFocus
            disabled={ocupado}
          />
          {erro && <div className="alert alert-error">{erro}</div>}
          <button className="btn-primary btn-full" disabled={ocupado || !senha}>
            {ocupado
              ? <><span className="spinner spinner-sm" /> Um instante…</>
              : (criandoAgora ? 'Continuar' : 'Desbloquear')}
          </button>
        </form>

        {oferecerRecomeco && !criandoAgora && (
          <div className="chave-recomeco">
            <p>
              Trocou de senha por e-mail? Então o conteúdo foi fechado com a senha anterior.
              Se você guardou uma chave de recuperação, ela abre tudo de volta —{' '}
              <strong>sem perder nada</strong>.
            </p>

            {usandoChave ? (
              <form onSubmit={usarChaveRecuperacao}>
                <input
                  className="chave-confirma-input"
                  value={chaveDigitada}
                  onChange={e => setChaveDigitada(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoFocus
                  disabled={ocupado}
                />
                <button className="btn-primary btn-full" disabled={ocupado || !chaveDigitada || !senha}>
                  Desbloquear com a chave
                </button>
              </form>
            ) : (
              <button className="btn-secondary btn-full" onClick={() => setUsandoChave(true)} disabled={ocupado}>
                Tenho uma chave de recuperação
              </button>
            )}

            <p style={{ marginTop: 16 }}>
              Sem a chave, o conteúdo cifrado não pode mais ser aberto — <strong>nem por nós</strong>.
              Dá para recomeçar: sua conta continua, as conversas anteriores são removidas.
            </p>
            <button className="btn-danger btn-full" onClick={recomecar} disabled={ocupado || !senha}>
              Não tenho a chave — recomeçar
            </button>
          </div>
        )}

        <button className="btn-ghost btn-full" style={{ marginTop: 10 }} onClick={sair} disabled={ocupado}>
          Sair da conta
        </button>
      </div>
    </div>
  )
}
