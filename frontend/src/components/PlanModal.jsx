import { useEffect, useState } from 'react'
import { IconClose, IconCheck } from './Icons'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { criarCheckout, lerSaldo, wakeBackend, abrirPortalAssinatura } from '../lib/api'
import { PLANOS, formatarPreco, economiaAnual, minutosDoPlano } from '../lib/planos'
import { SITE_URL, platformName } from '../lib/platform'
import {
  lojaDisponivel, nomeDaLoja, configurarLoja, lerProdutos, comprar, restaurar,
  urlDeGerenciamento, esperarPlanoChegar, CompraCancelada, PRODUTOS_PADRAO,
} from '../lib/compraLoja'

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
//
// Esta tela tem dois caminhos de pagamento. No site e no app de Windows, o
// Checkout do Stripe, como sempre. No app de celular, a compra da própria loja
// (lib/compraLoja.js): a Apple e o Google exigem que os mesmos planos possam
// ser comprados por dentro do app, e cobram uma comissão por isso — é por isso
// que o preço que aparece aqui no iPhone é mais alto, e é a LOJA quem diz qual
// ele é. O desenho da tela é o mesmo nos dois casos.
export default function PlanModal({ onClose, inicial = null }) {
  const { user } = useAuth()
  const naLoja = lojaDisponivel()
  // Nasce sem resposta, não como 'gratuito': assumir o gratuito fazia a marca
  // de "plano atual" aparecer no primeiro card e depois pular para o certo
  // quando o Supabase respondia. Sem palpite, ela aparece uma vez só, no lugar
  // certo.
  const [planoAtual, setPlanoAtual] = useState(null)
  // De onde veio a assinatura: 'stripe', 'apple' ou 'google'. É o que decide
  // entre o Portal do Stripe e a tela de assinaturas do aparelho — mandar quem
  // comprou na Apple para o Portal é mandá-lo a um lugar que não conhece a
  // assinatura dele.
  const [origem, setOrigem] = useState('stripe')
  const [saldo, setSaldo] = useState(null)
  // O que a loja respondeu sobre cada produto: identificador → produto, com o
  // preço já com imposto e câmbio. Vazio enquanto ela não responde, e aí a tela
  // mostra o desenho que veio do servidor.
  const [produtos, setProdutos] = useState({})
  const [escolhido, setEscolhido] = useState(() => PLANOS.find(p => p.id === inicial && p.anual) || null)
  // O anual vem marcado porque é o preço que o card acabou de mostrar: abrir
  // as opções no mensal pareceria o preço subir na hora de pagar.
  const [ciclo, setCiclo] = useState('anual')
  const [assinando, setAssinando] = useState(false)
  // Depois de alguns segundos o texto do botão muda: uma espera explicada é
  // uma espera que a pessoa aguenta. Sem isto, "Abrindo pagamento…" parado por
  // 30s parece travamento, e quem acha que travou recarrega a página.
  const [demorando, setDemorando] = useState(false)
  const [abrindoPortal, setAbrindoPortal] = useState(false)
  const [restaurando, setRestaurando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  // `planoAtual` nulo é "ainda não sei", não "nenhum": enquanto o Supabase não
  // responde, nenhum card sabe se é o plano vigente, e deixar os botões vivos
  // nessa janela permitia comprar de novo o plano que a pessoa já assina.
  const carregandoPlano = planoAtual === null
  const jaAssinante = !carregandoPlano && planoAtual !== 'gratuito'
  // Assinatura comprada numa loja só é trocada e cancelada na loja.
  const assinaturaDeLoja = origem !== 'stripe'
  // Quem já paga algo não cria assinatura nova clicando num outro card — isso
  // é a troca de plano de verdade, que vive no Portal do Stripe.
  //
  // Na loja é diferente, e de propósito: dentro de um mesmo grupo de
  // assinaturas, comprar o outro plano É a troca — a Apple e o Google
  // substituem a assinatura em vez de abrir uma segunda, e fazem a proporção do
  // que já foi pago. Então lá os botões continuam vivos para quem já assina
  // pela loja. Quem assina pelo site e está no celular é o único caso em que
  // não há o que clicar: essa assinatura é gerenciada onde foi feita.
  const podeComprarAqui = naLoja ? !(jaAssinante && !assinaturaDeLoja) : !jaAssinante

  // O plano ativo vem direto do Supabase — quem escreve ali é só o webhook do
  // Stripe ou o das lojas, então esta leitura reflete a cobrança real, não uma
  // intenção.
  useEffect(() => {
    if (!user) return
    let ativo = true
    // `select('*')`, e não a lista de colunas, por uma razão de ordem: a coluna
    // `origem` chega ao banco por um SQL rodado à mão
    // (supabase/assinatura_loja.sql), enquanto o push na main publica o app
    // sozinho — existe uma janela em que o app novo fala com o banco antigo.
    // Pedir uma coluna que ainda não existe faz o Supabase recusar a consulta
    // INTEIRA com 400, e aí nem o plano chega: quem paga veria "Fazer upgrade"
    // no lugar de "Plano atual". Com `*` vem o que houver, e nessa janela o app
    // trata tudo como Stripe — que é o que ele fazia até esta versão. A linha é
    // a da própria pessoa (a RLS não libera outra) e nada dela aparece na tela
    // além do plano.
    supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!ativo) return
        setPlanoAtual(data?.plano || 'gratuito')
        setOrigem(data?.origem || 'stripe')
      })
      // Falhar a leitura não pode deixar os botões travados para sempre — eles
      // nascem desabilitados justamente porque `planoAtual` nulo é "ainda não
      // sei". Sem resposta, tratamos como gratuito, e quem barra de verdade a
      // compra repetida é o backend (409 em /billing/create-checkout-session e,
      // na loja, o próprio grupo de assinaturas).
      .catch(() => { if (ativo) setPlanoAtual('gratuito') })
    lerSaldo(user.id).then(setSaldo).catch(() => setSaldo(null))
    return () => { ativo = false }
  }, [user])

  // O preço que a tela mostra no celular é o da loja, perguntado agora, e não o
  // que está escrito no nosso código: é a Apple que aplica imposto e câmbio, e
  // mostrar outro número seria mostrar um preço que não é o da cobrança.
  useEffect(() => {
    if (!naLoja || !user?.id) return
    let ativo = true
    ;(async () => {
      if (!(await configurarLoja(user.id))) return
      const ids = PLANOS.flatMap(p => ['mensal', 'anual'].map(c => idDoProduto(p, c)))
      const lidos = await lerProdutos(ids)
      if (ativo) setProdutos(lidos)
    })()
    return () => { ativo = false }
  }, [naLoja, user?.id])

  // O Render hiberna, e a primeira chamada depois disso leva dezenas de
  // segundos. Acordar quando "Meu plano" abre — e não quando o botão de pagar
  // ou de gerenciar é clicado — faz a espera acontecer enquanto a pessoa ainda
  // lê a tela, não depois que ela já decidiu.
  useEffect(() => {
    wakeBackend()
  }, [])

  // Os preços de um plano, e o texto de cada um. No celular vale o que a loja
  // respondeu; sem resposta ainda, vale o desenho que veio do servidor, que
  // precisa bater com os degraus cadastrados lá. A manchete "por mês" é sempre
  // derivada do anual, e nunca escrita, para não poder divergir da cobrança.
  function precos(plano) {
    const daLoja = ciclo => produtos[idDoProduto(plano, ciclo)]
    const mensal = daLoja('mensal')?.price ?? plano.mensal
    const anual = daLoja('anual')?.price ?? plano.anual
    return {
      mensal,
      anual,
      // O texto da loja já vem com o símbolo da moeda do país de quem compra.
      mensalTexto: daLoja('mensal')?.priceString || formatarPreco(mensal),
      anualTexto: daLoja('anual')?.priceString || (anual == null ? '' : formatarPreco(anual)),
      porMes: anual == null ? null : anual / 12,
    }
  }

  function escolher(plano) {
    setErro('')
    setAviso('')
    setCiclo('anual')
    setEscolhido(plano)
  }

  async function assinar() {
    setErro('')
    setAviso('')
    setAssinando(true)
    setDemorando(false)
    const avisoLento = setTimeout(() => setDemorando(true), 3000)
    try {
      if (naLoja) await assinarNaLoja()
      else {
        const { url } = await criarCheckout(escolhido.id, ciclo)
        window.location.href = url
      }
    } catch (err) {
      // Desistir no meio da tela da Apple não é falha: fecha e volta ao que
      // estava, sem faixa vermelha por ter mudado de ideia.
      if (!(err instanceof CompraCancelada)) {
        setErro(err.message || 'Não foi possível iniciar o pagamento. Tente de novo.')
      }
      setAssinando(false)
    } finally {
      clearTimeout(avisoLento)
    }
  }

  async function assinarNaLoja() {
    const produto = produtos[idDoProduto(escolhido, ciclo)]
    if (!produto) {
      throw new Error(`O ${nomeDaLoja()} não respondeu o preço deste plano. Confira sua conexão e tente de novo.`)
    }
    const anterior = planoAtual
    await comprar(produto)
    // A compra terminou na loja, mas o plano ainda não está na conta: a loja
    // avisa o RevenueCat, que avisa o nosso servidor, que grava no Supabase.
    // São segundos, e dizer "pronto" antes disso é prometer o que a próxima
    // tela ainda não vai cumprir.
    const plano = await esperarPlanoChegar(user.id, anterior)
    setAssinando(false)
    if (plano) {
      setPlanoAtual(plano)
      setOrigem(platformName() === 'ios' ? 'apple' : 'google')
      setEscolhido(null)
      setAviso('Pagamento confirmado. Seu plano novo já está valendo.')
      lerSaldo(user.id).then(setSaldo).catch(() => {})
    } else {
      // O pagamento foi feito — isso a loja já confirmou. O que não chegou é o
      // aviso dela ao nosso servidor, e ele chega sozinho. Dizer isso é melhor
      // do que um erro que faria a pessoa comprar de novo.
      setEscolhido(null)
      setAviso('Pagamento concluído. Seu plano deve aparecer aqui em alguns minutos — não é preciso comprar de novo.')
    }
  }

  // Exigência da Apple, e uma necessidade de verdade: quem trocou de aparelho,
  // reinstalou o app ou entrou com outra conta precisa recuperar o que já pagou
  // sem pagar de novo.
  async function restaurarCompras() {
    setErro('')
    setAviso('')
    setRestaurando(true)
    try {
      const anterior = planoAtual
      const ativas = await restaurar()
      if (!ativas) {
        setAviso('Não encontramos nenhuma assinatura ativa nesta conta da loja.')
        return
      }
      const plano = await esperarPlanoChegar(user.id, anterior)
      if (plano) {
        setPlanoAtual(plano)
        setAviso('Assinatura restaurada.')
      } else {
        setAviso('Assinatura encontrada. Seu plano deve aparecer aqui em alguns minutos.')
      }
    } catch (err) {
      setErro(err.message || 'Não foi possível restaurar suas compras. Tente de novo.')
    } finally {
      setRestaurando(false)
    }
  }

  async function gerenciarAssinatura() {
    setErro('')
    setAviso('')
    setAbrindoPortal(true)
    try {
      if (assinaturaDeLoja) {
        // A tela de assinaturas do próprio aparelho é o único lugar onde uma
        // assinatura de loja pode ser trocada ou cancelada. Quem informa o
        // endereço é a loja, não nós.
        const url = await urlDeGerenciamento()
        if (!url) throw new Error(`Abra os ajustes do aparelho para gerenciar sua assinatura do ${nomeDaLoja()}.`)
        window.open(url, '_blank', 'noopener')
        setAbrindoPortal(false)
        return
      }
      const { url } = await abrirPortalAssinatura()
      window.location.href = url
    } catch (err) {
      setErro(err.message || 'Não foi possível abrir o gerenciamento da assinatura.')
      setAbrindoPortal(false)
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
        {aviso && <div className="alert alert-success">{aviso}</div>}

        {escolhido ? (
          <Faturamento
            plano={escolhido}
            precos={precos(escolhido)}
            ciclo={ciclo}
            setCiclo={setCiclo}
            assinando={assinando}
            demorando={demorando}
            naLoja={naLoja}
            onAssinar={assinar}
            onVoltar={() => { setErro(''); setAviso(''); setEscolhido(null) }}
          />
        ) : (
          <div className="planos">
            {PLANOS.map(p => {
              const pago = p.mensal > 0
              const ativo = planoAtual === p.id
              const preco = precos(p)
              return (
                <div key={p.id} className={`plano${ativo ? ' on' : ''}${p.destaque ? ' destaque' : ''}`}>
                  <span className="plano-nome">{p.nome}</span>
                  {/* O bloco de preço tem a mesma altura nos três cards (o
                      grátis tem uma linha, os pagos três): sem isso as listas
                      de benefícios começariam em alturas diferentes. */}
                  <div className="plano-preco-bloco">
                    {pago ? (
                      <>
                        <span className="plano-preco">{formatarPreco(preco.porMes)} <i>por mês</i></span>
                        <span className="plano-preco-nota">com cobrança anual</span>
                        <span className="plano-preco-nota">{preco.mensalTexto} cobrado mensalmente</span>
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
                        <span>
                          {minutosDoPlano(p) == null
                            ? `${Math.round(saldo.minutosUsados)} min usados`
                            : `${Math.round(saldo.minutosUsados)} de ${minutosDoPlano(p) + saldo.minutosExtra} min usados`}
                        </span>
                        {saldo.periodoFim && (
                          <span>renova em {new Date(saldo.periodoFim).toLocaleDateString('pt-BR')}</span>
                        )}
                      </>
                    )}
                  </span>
                  <ul>
                    {p.itens.map(i => <li key={i}><IconCheck width={12} height={12} /> {i}</li>)}
                  </ul>
                  {pago && (ativo ? (
                    <button type="button" className="btn-primary plano-btn" disabled>
                      Plano atual
                    </button>
                  ) : podeComprarAqui ? (
                    <button
                      type="button"
                      className="btn-primary plano-btn"
                      disabled={carregandoPlano}
                      onClick={() => escolher(p)}
                    >
                      {jaAssinante ? 'Trocar para este plano' : 'Fazer upgrade'}
                    </button>
                  ) : null)}
                </div>
              )
            })}
          </div>
        )}

        {!escolhido && (jaAssinante ? (
          <div className="planos-gerenciar">
            <button type="button" className="btn-ghost" onClick={gerenciarAssinatura} disabled={abrindoPortal}>
              {abrindoPortal ? (
                <>
                  <span className="spinner spinner-sm" />
                  Abrindo…
                </>
              ) : assinaturaDeLoja
                ? `Trocar de plano ou cancelar no ${nomeDaLoja()}`
                : 'Trocar de plano, forma de pagamento ou cancelar'}
            </button>
            {/* Quem assinou pelo site e está no celular não tem o que clicar
                aqui: apontar para uma compra de fora do app é recusa na revisão
                da Apple, mesmo quando é só para gerenciar. Texto sem link é
                permitido, e resolve a dúvida de quem procura o cancelamento. */}
            {naLoja && !assinaturaDeLoja && (
              <p className="planos-legal">
                Sua assinatura foi feita pelo site do Dito e é gerenciada por lá, no computador.
              </p>
            )}
          </div>
        ) : null)}

        {/* Tela de assinatura sem estas três coisas — a frase da renovação
            automática, os termos de uso e a política de privacidade — é recusa
            na revisão da Apple, independentemente de todo o resto. Elas ficam
            na MESMA tela onde o plano é oferecido, que é a exigência. */}
        {naLoja && (
          <div className="planos-legal">
            <p>
              A assinatura renova sozinha ao fim de cada período, pelo mesmo valor, até
              você cancelar. O cancelamento é feito nos ajustes do seu aparelho, no
              {' '}{nomeDaLoja()}, até 24 horas antes da renovação.
            </p>
            <p className="planos-legal-links">
              <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noreferrer">
                Termos de uso
              </a>
              {' · '}
              <a href={`${SITE_URL}/privacidade.html`} target="_blank" rel="noreferrer">
                Política de privacidade
              </a>
              {' · '}
              <button type="button" className="planos-legal-link" onClick={restaurarCompras} disabled={restaurando}>
                {restaurando ? 'Restaurando…' : 'Restaurar compras'}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// O identificador do produto na loja. Vem do servidor (GET /planos), para o
// nome existir num lugar só; o mapa local é o desenho inicial, para a tela
// funcionar antes da primeira resposta.
function idDoProduto(plano, ciclo) {
  return plano.produtos?.[ciclo] || PRODUTOS_PADRAO[plano.id]?.[ciclo] || ''
}

function Faturamento({ plano, precos, ciclo, setCiclo, assinando, demorando, naLoja, onAssinar, onVoltar }) {
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
            <span>{precos.mensalTexto} / mês</span>
          </span>
        </label>
        <label className={`faturamento-opcao${anual ? ' on' : ''}`}>
          <input
            type="radio" name="ciclo" value="anual" id="ciclo-anual"
            checked={anual} onChange={() => setCiclo('anual')} disabled={assinando}
          />
          <span className="faturamento-texto">
            <strong>Pagar por ano</strong>
            <span>{formatarPreco(precos.porMes)} / mês</span>
          </span>
          <span className="faturamento-selo">
            Economize {economiaAnual({ mensal: precos.mensal, anual: precos.anual })}%
          </span>
        </label>
      </div>

      <div className="faturamento-total">
        <span className="faturamento-valor">
          {anual ? precos.anualTexto : precos.mensalTexto} <i>{anual ? '/ ano' : '/ mês'}</i>
        </span>
        <span className="faturamento-renova">
          {anual ? 'Cobrado hoje e renovado a cada ano.' : 'Cobrado hoje e renovado a cada mês.'}{' '}
          {naLoja
            ? 'Cancele quando quiser, nos ajustes do seu aparelho.'
            : 'Cancele quando quiser, direto no seu plano.'}
        </span>
      </div>

      <button type="button" className="btn-primary faturamento-btn" onClick={onAssinar} disabled={assinando}>
        {assinando ? (
          <>
            <span className="spinner spinner-sm" />
            {naLoja
              ? (demorando ? 'Confirmando o pagamento…' : 'Abrindo o pagamento…')
              : (demorando ? 'Ainda abrindo. O servidor está acordando…' : 'Abrindo pagamento…')}
          </>
        ) : 'Continuar para o pagamento'}
      </button>
      <button type="button" className="faturamento-voltar" onClick={onVoltar} disabled={assinando}>
        Ver todos os planos
      </button>
    </div>
  )
}
