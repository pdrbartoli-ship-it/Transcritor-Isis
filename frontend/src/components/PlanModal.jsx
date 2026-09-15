import { useEffect, useState } from 'react'
import { IconClose, IconCheck } from './Icons'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { criarCheckout, lerSaldo } from '../lib/api'
import { PLANOS, formatarPreco, precoMensalNoAnual, economiaAnual } from '../lib/planos'

// O "Meu plano" em dois tempos, no desenho do Notion.
//
// Primeiro a tabela, com o preço anual por mês como manchete — o menor número
// que é verdade — e o mensal logo abaixo, em cinza. A escolha entre mês e ano
// não fica mais num seletor acima dos cards: ele obrigava a decidir o ciclo
// antes mesmo de escolher o plano, e mudava os três preços de uma vez.
//
// Depois, ao clicar em "Fazer upgrade", as duas formas de pagar aquele plano
// lado a lado, cada uma com o próprio preço, e só então o checkout.
//
// `inicial` abre direto no segundo tempo: é quem escolheu um plano na landing
// antes de entrar, e já tomou a decisão que a tabela serviria para tomar.
export default function PlanModal({ onClose, inicial = null }) {
  const { user } = useAuth()
  // Nasce sem resposta, não como 'gratuito': assumir o gratuito fazia a marca
  // de "plano atual" aparecer no primeiro card e depois pular para o certo
  // quando o Supabase respondia. Sem palpite, ela aparece uma vez só, no lugar
  // certo.
  const [planoAtual, setPlanoAtual] = useState(null)
  const [saldo, setSaldo] = useState(null)
  const [escolhido, setEscolhido] = useState(() => PLANOS.find(p => p.id === inicial && p.anual) || null)
  // O anual vem marcado porque é o preço que o card acabou de mostrar: abrir
  // as opções no mensal pareceria o preço subir na hora de pagar.
  const [ciclo, setCiclo] = useState('anual')
  const [assinando, setAssinando] = useState(false)
  const [erro, setErro] = useState('')

  // O plano ativo vem direto do Supabase — quem escreve ali é só o webhook do
  // Stripe, então esta leitura reflete a cobrança real, não uma intenção.
  useEffect(() => {
    if (!user) return
    supabase
      .from('subscriptions')
      .select('plano')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setPlanoAtual(data?.plano || 'gratuito'))
    lerSaldo(user.id).then(setSaldo).catch(() => setSaldo(null))
  }, [user])

  function escolher(plano) {
    setErro('')
    setCiclo('anual')
    setEscolhido(plano)
  }

  async function assinar() {
    setErro('')
    setAssinando(true)
    try {
      const { url } = await criarCheckout(escolhido.id, ciclo)
      window.location.href = url
    } catch (err) {
      setErro(err.message || 'Não foi possível iniciar o pagamento. Tente de novo.')
      setAssinando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{escolhido ? `Assinar o plano ${escolhido.nome}` : 'Meu plano'}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}

        {escolhido ? (
          <Faturamento
            plano={escolhido}
            ciclo={ciclo}
            setCiclo={setCiclo}
            assinando={assinando}
            onAssinar={assinar}
            onVoltar={() => { setErro(''); setEscolhido(null) }}
          />
        ) : (
          <div className="planos">
            {PLANOS.map(p => {
              const pago = p.mensal > 0
              const ativo = planoAtual === p.id
              return (
                <div key={p.id} className={`plano${ativo ? ' on' : ''}${p.destaque ? ' destaque' : ''}`}>
                  <span className="plano-nome">{p.nome}</span>
                  {/* O bloco de preço tem a mesma altura nos três cards (o
                      grátis tem uma linha, os pagos três): sem isso as listas
                      de benefícios começariam em alturas diferentes. */}
                  <div className="plano-preco-bloco">
                    {pago ? (
                      <>
                        <span className="plano-preco">{formatarPreco(precoMensalNoAnual(p))} <i>por mês</i></span>
                        <span className="plano-preco-nota">com cobrança anual</span>
                        <span className="plano-preco-nota">{formatarPreco(p.mensal)} cobrado mensalmente</span>
                      </>
                    ) : (
                      <>
                        <span className="plano-preco">{formatarPreco(0)} <i>para sempre</i></span>
                        {/* As duas notas vazias guardam a altura das notas dos
                            pagos — igual por construção, e não por um número
                            de pixels que muda com a fonte. */}
                        <span className="plano-preco-nota" aria-hidden="true">&nbsp;</span>
                        <span className="plano-preco-nota" aria-hidden="true">&nbsp;</span>
                      </>
                    )}
                  </div>
                  {/* A linha de saldo ocupa lugar em todos os cards desde o
                      primeiro quadro, mesmo vazia. Ela só tem texto no plano
                      ativo, e como os três cards da grade crescem juntos, era o
                      texto chegando depois que fazia o modal inteiro se esticar
                      sozinho na frente do usuário. */}
                  <span className="plano-saldo">
                    {ativo && saldo && (
                      <>
                        <span>{Math.round(saldo.minutosUsados)} de {p.minutos} min usados</span>
                        {saldo.periodoFim && (
                          <span>renova em {new Date(saldo.periodoFim).toLocaleDateString('pt-BR')}</span>
                        )}
                      </>
                    )}
                  </span>
                  <ul>
                    {p.itens.map(i => <li key={i}><IconCheck width={12} height={12} /> {i}</li>)}
                  </ul>
                  {pago && (
                    <button
                      type="button"
                      className="btn-primary plano-btn"
                      disabled={ativo}
                      onClick={() => escolher(p)}
                    >
                      {ativo ? 'Plano atual' : 'Fazer upgrade'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Faturamento({ plano, ciclo, setCiclo, assinando, onAssinar, onVoltar }) {
  const anual = ciclo === 'anual'
  return (
    <div className="faturamento">
      <p className="faturamento-rotulo" id="faturamento-rotulo">Opções de faturamento</p>
      <div className="faturamento-opcoes" role="radiogroup" aria-labelledby="faturamento-rotulo">
        <label className={`faturamento-opcao${!anual ? ' on' : ''}`}>
          <input
            type="radio" name="ciclo" value="mensal" id="ciclo-mensal"
            checked={!anual} onChange={() => setCiclo('mensal')} disabled={assinando}
          />
          <span className="faturamento-texto">
            <strong>Pagar por mês</strong>
            <span>{formatarPreco(plano.mensal)} / mês</span>
          </span>
        </label>
        <label className={`faturamento-opcao${anual ? ' on' : ''}`}>
          <input
            type="radio" name="ciclo" value="anual" id="ciclo-anual"
            checked={anual} onChange={() => setCiclo('anual')} disabled={assinando}
          />
          <span className="faturamento-texto">
            <strong>Pagar por ano</strong>
            <span>{formatarPreco(precoMensalNoAnual(plano))} / mês</span>
          </span>
          <span className="faturamento-selo">Economize {economiaAnual(plano)}%</span>
        </label>
      </div>

      <div className="faturamento-total">
        <span className="faturamento-valor">
          {formatarPreco(anual ? plano.anual : plano.mensal)} <i>{anual ? '/ ano' : '/ mês'}</i>
        </span>
        <span className="faturamento-renova">
          {anual ? 'Cobrado hoje e renovado a cada ano.' : 'Cobrado hoje e renovado a cada mês.'}{' '}
          Cancele quando quiser, direto no seu plano.
        </span>
      </div>

      <button type="button" className="btn-primary faturamento-btn" onClick={onAssinar} disabled={assinando}>
        {assinando ? 'Abrindo pagamento…' : 'Continuar para o pagamento'}
      </button>
      <button type="button" className="faturamento-voltar" onClick={onVoltar} disabled={assinando}>
        Ver todos os planos
      </button>
    </div>
  )
}
