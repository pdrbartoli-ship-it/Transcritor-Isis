import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { temChave, criarChave, abrirComSenha } from '../lib/chaves'
import { temChaveNoAparelho } from '../lib/cofre'
import ChaveRecuperacaoModal from './ChaveRecuperacaoModal'
import { IconShield } from './Icons'

// Garante que existe uma chave utilizável NESTE aparelho antes de deixar o app
// funcionar. O login já cuida do caso normal, mas ele não cobre os três casos
// em que a sessão existe e a chave não:
//
//   • quem já estava logado quando esta versão subiu;
//   • quem limpou os dados do navegador;
//   • quem voltou num perfil/aparelho onde a sessão sobreviveu e a chave não.
//
// Nesses casos o app não pode simplesmente seguir: sem chave, gravar uma
// conversa nova falharia e as antigas apareceriam bloqueadas. Pedir a senha uma
// vez resolve, e é muito melhor do que descobrir o problema no meio de uma
// gravação.
export default function ChaveGate({ children }) {
  const { user } = useAuth()
  const [estado, setEstado] = useState('checando')  // checando | ok | desbloquear | criando
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [chaveNova, setChaveNova] = useState(null)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      if (!user?.id) return
      try {
        if (await temChaveNoAparelho()) { if (!cancelado) setEstado('ok'); return }
        // Há cofre no banco? Então é caso de desbloquear. Se não há, esta conta
        // ainda não tem chave e precisa criar uma.
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

  async function desbloquear(e) {
    e.preventDefault()
    setOcupado(true)
    setErro(null)
    try {
      const dek = await abrirComSenha(user.id, senha)
      if (!dek) throw new Error('sem cofre')
      setSenha('')
      setEstado('ok')
    } catch {
      // A decifragem é autenticada: senha errada FALHA, não devolve lixo. Por
      // isso dá para afirmar isto sem guardar hash de senha em lugar nenhum.
      setErro('Senha incorreta.')
    } finally {
      setOcupado(false)
    }
  }

  async function criar(e) {
    e.preventDefault()
    setOcupado(true)
    setErro(null)
    try {
      setChaveNova(await criarChave(user.id, senha))
      setSenha('')
    } catch {
      setErro('Não foi possível preparar sua chave. Confira a senha e tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  async function sair() {
    await supabase.auth.signOut()
    window.location.reload()
  }

  if (chaveNova) {
    return (
      <ChaveRecuperacaoModal
        chave={chaveNova}
        onConfirmado={() => { setChaveNova(null); setEstado('ok') }}
      />
    )
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
              ? 'Vamos criar sua chave de criptografia. A partir daí, suas conversas ficam ilegíveis para qualquer um que não seja você — nós inclusive.'
              : 'Suas conversas são guardadas cifradas. Digite sua senha para abrir seu conteúdo neste aparelho.'}
          </p>
        </div>

        <form onSubmit={criandoAgora ? criar : desbloquear}>
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
              : (criandoAgora ? 'Criar minha chave' : 'Desbloquear')}
          </button>
        </form>

        <button className="btn-ghost btn-full" style={{ marginTop: 10 }} onClick={sair} disabled={ocupado}>
          Sair da conta
        </button>
      </div>
    </div>
  )
}
