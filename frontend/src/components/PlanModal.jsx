import { useEffect, useState } from 'react'
import { IconClose, IconCheck } from './Icons'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { criarCheckout, lerSaldo, wakeBackend, abrirPortalAssinatura, sincronizarLoja } from '../lib/api'
import { PLANOS, formatarPreco, economiaAnual, minutosDoPlano } from '../lib/planos'
import { SITE_URL } from '../lib/platform'
import {
  lojaDisponivel, nomeDaLoja, naLojaTexto, aLojaTexto, nesteIdTexto, configurarLoja, lerProdutos, comprar,
  restaurar, gerenciarNaLoja, confirmarNaLoja, CompraCancelada, PRODUTOS_PADRAO,
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
//
// Para quem já assina, cada botão diz a direção (subir ou descer de plano), e a
// confirmação diz o que acontece com o dinheiro: subir vale na hora, descer só
// no fim do período que já foi pago, e cancelar mantém o plano até lá. São as
// regras da Apple, do Google e do Stripe, e foi o que o teste de 05/10 pediu
// (plano-checkout-05.10.md).

// A ordem dos planos, para saber se uma troca é para cima ou para baixo.
const NIVEL = { gratuito: 0, iniciante: 1, avancado: 2 }

// O último plano lido, guardado no aparelho. Sem ele a tela abria sem nenhum
// card marcado e com os botões desbotados até o banco responder, cerca de um
// segundo depois, e parecia que o Dito não sabia o plano da pessoa. Com ele a
// marca aparece no primeiro quadro, e o banco só corrige se algo mudou.
const chaveGuardada = userId => `dito:plano:${userId}`
function lerPlanoGuardado(userId) {
  try {
    return JSON.parse(localStorage.getItem(chaveGuardada(userId)) || 'null')
  } catch {
    return null
  }
}
function guardarPlano(userId, plano, origem) {
  try {
    localStorage.setItem(chaveGuardada(userId), JSON.stringify({ plano, origem }))
  } catch {
    // Aparelho sem armazenamento: a tela só volta a esperar o banco.
  }
}

const dataCurta = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null)
export default function PlanModal({ onClose, inicial = null }) {
  const { user } = useAuth()
  const naLoja = lojaDisponivel()
  const guardado = user ? lerPlanoGuardado(user.id) : null
  // `null` é "ainda não sei", não "nenhum". O que estava guardado no aparelho
  // vale como primeira resposta; sem nada guardado, nenhum card é marcado até
  // o banco responder (assumir o gratuito fazia a marca pular de card).
  const [planoAtual, setPlanoAtual] = useState(guardado?.plano ?? null)
  // De onde veio a assinatura: 'stripe', 'apple' ou 'google'. É o que decide
  // entre o Portal do Stripe e a tela de assinaturas do aparelho — mandar quem
  // comprou na Apple para o Portal é mandá-lo a um lugar que não conhece a
  // assinatura dele.
  const [origem, setOrigem] = useState(guardado?.origem || 'stripe')
  // Até quando a assinatura está paga, e se ela renova. `renova` só é conhecido
  // para assinatura de loja, que o servidor pergunta à loja quando a tela abre.
  const [fimAssinatura, setFimAssinatura] = useState(null)
  const [renova, setRenova] = useState(null)
  const [saldo, setSaldo] = useState(null)
  // O que a loja respondeu sobre cada produto: identificador → produto, com o
  // preço já com imposto e câmbio. Vazio enquanto ela não responde, e aí a tela
  // mostra o desenho que veio do servidor.
  const [produtos, setProdutos] = useState({})
  const [escolhido, setEscolhido] = useState(() => PLANOS.find(p => p.id === inicial && p.anual) || null)
  // O anual vem marcado porque é o preço que o card acabou de mostrar: abrir
  // as opções no mensal pareceria o preço subir na hora de pagar.
  const [ciclo, setCiclo] = useState('anual')
  // A tela antes de mandar para o cancelamento da loja.
  const [cancelando, setCancelando] = useState(false)
  const [assinando, setAssinando] = useState(false)
  // Depois de alguns segundos o texto do botão muda: uma espera explicada é
  // uma espera que a pessoa aguenta. Sem isto, "Abrindo pagamento…" parado por
  // 30s parece travamento, e quem acha que travou recarrega a página.
  const [demorando, setDemorando] = useState(false)
  const [abrindoPortal, setAbrindoPortal] = useState(false)
  const [restaurando, setRestaurando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const carregandoPlano = planoAtual === null
  const jaAssinante = !carregandoPlano && planoAtual !== 'gratuito'
  const planoAtualObj = PLANOS.find(p => p.id === planoAtual) || PLANOS[0]
  // Assinatura comprada numa loja só é trocada e cancelada na loja.
  const assinaturaDeLoja = origem !== 'stripe'
  // Quem já paga algo pelo site não cria assinatura nova clicando num outro
  // card — isso é a troca de plano de verdade, que vive no Portal do Stripe.
  //
  // Na loja é diferente, e de propósito: dentro de um mesmo grupo de
  // assinaturas, comprar o outro plano É a troca — a Apple e o Google
  // substituem a assinatura em vez de abrir uma segunda, e fazem a proporção do
  // que já foi pago. Então lá os botões continuam vivos para quem já assina
  // pela loja. Quem assina pelo site e está no celular é o único caso em que
  // não há o que clicar: essa assinatura é gerenciada onde foi feita.
  const podeComprarAqui = naLoja ? !(jaAssinante && !assinaturaDeLoja) : !jaAssinante
  const fimTexto = dataCurta(fimAssinatura)

  // Tudo o que a tela sabe da assinatura passa por aqui, venha do banco ou da
  // loja, para o aparelho guardar sempre a última versão.
  function aplicarEstado({ plano, origem: de, current_period_end: fim, renova: renovaAgora }) {
    const p = plano || 'gratuito'
    const o = de || 'stripe'
    setPlanoAtual(p)
    setOrigem(o)
    setFimAssinatura(fim || null)
    if (renovaAgora !== undefined) setRenova(renovaAgora)
    if (user) guardarPlano(user.id, p, o)
  }

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
        const vale = data && !['canceled', 'incomplete_expired', 'unpaid'].includes(data.status)
        aplicarEstado({
          plano: vale ? data.plano : 'gratuito',
          origem: data?.origem,
          current_period_end: vale ? data.current_period_end : null,
        })
      })
      // Falhar a leitura não pode deixar os botões travados para sempre — eles
      // nascem desabilitados justamente porque `planoAtual` nulo é "ainda não
      // sei". Sem resposta, tratamos como gratuito, e quem barra de verdade a
      // compra repetida é o backend (409 em /billing/create-checkout-session e,
      // na loja, o próprio grupo de assinaturas).
      .catch(() => { if (ativo) setPlanoAtual(p => p ?? 'gratuito') })
    lerSaldo(user.id).then(setSaldo).catch(() => setSaldo(null))
    return () => { ativo = false }
  }, [user])

  // No celular, o preço que a tela mostra é o da loja, perguntado agora, e não
  // o que está escrito no nosso código: é a Apple que aplica imposto e câmbio.
  //
  // Na mesma abertura, o servidor confere com a loja o estado da assinatura.
  // É o que traz o "cancelada, vale até" (que só a loja sabe) e o que corrige o
  // plano se algum aviso da loja se perdeu no caminho.
  useEffect(() => {
    if (!naLoja || !user?.id) return
    let ativo = true
    ;(async () => {
      if (!(await configurarLoja(user.id))) return
      const ids = PLANOS.flatMap(p => ['mensal', 'anual'].map(c => idDoProduto(p, c)))
      const lidos = await lerProdutos(ids)
      if (ativo) setProdutos(lidos)
      try {
        const estado = await sincronizarLoja()
        if (ativo && estado) aplicarEstado(estado)
      } catch {
        // Sem resposta, vale o que o banco disse.
      }
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
    const moeda = daLoja('anual')?.currencyCode || daLoja('mensal')?.currencyCode || 'BRL'
    const mensal = daLoja('mensal')?.price ?? plano.mensal
    const anual = daLoja('anual')?.price ?? plano.anual
    return {
      mensal,
      anual,
      // O texto da loja já vem com o símbolo da moeda do país de quem compra.
      mensalTexto: daLoja('mensal')?.priceString || formatarPreco(mensal),
      anualTexto: daLoja('anual')?.priceString || (anual == null ? '' : formatarPreco(anual)),
      // A manchete "por mês" é derivada do anual, e por isso precisa sair na
      // MESMA moeda que a loja respondeu. Formatar em reais um valor que veio em
      // dólar (a loja de quem vê pode ser outra) mostrava "R$ 4,17" ao lado de
      // "$4.99" na mesma tela: um número de uma moeda com o símbolo de outra.
      porMesTexto: anual == null ? '' : formatarNaMoeda(anual / 12, moeda),
    }
  }

  // Para quem já assina, toda troca tem uma direção, e é ela que decide o texto
  // do botão e da confirmação.
  function direcaoPara(plano) {
    if (!jaAssinante) return 'nova'
    return NIVEL[plano.id] > NIVEL[planoAtual] ? 'upgrade' : 'downgrade'
  }

  function limparMensagens() {
    setErro('')
    setAviso('')
  }

  function escolher(plano) {
    limparMensagens()
    setCancelando(false)
    setCiclo('anual')
    setEscolhido(plano)
  }

  async function assinar() {
    limparMensagens()
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
      throw new Error(`${nomeDaLoja() === 'App Store' ? 'A App Store' : 'O Google Play'} não respondeu o preço deste plano. Confira sua conexão e tente de novo.`)
    }
    const direcao = direcaoPara(escolhido)
    const anterior = planoAtualObj
    const novo = escolhido
    await comprar(produto)
    // A loja já cobrou (ou agendou). O servidor pergunta a ela o que vale agora
    // e grava, e a tela diz o que aconteceu, sem esperar o aviso da loja.
    const estado = await confirmarNaLoja()
    setAssinando(false)
    setEscolhido(null)
    if (estado) {
      aplicarEstado(estado)
      lerSaldo(user.id).then(setSaldo).catch(() => {})
    }
    if (estado?.plano === novo.id) {
      setAviso(`Pronto. O plano ${novo.nome} já está valendo.`)
    } else if (direcao === 'downgrade') {
      const ate = dataCurta(estado?.current_period_end)
      setAviso(`Mudança agendada. Você continua no ${anterior.nome}${ate ? ` até ${ate}` : ''}, e o ${novo.nome} começa depois. Nada foi cobrado hoje.`)
    } else {
      // A compra foi feita, isso a loja já confirmou. O que não respondeu foi o
      // nosso servidor, e o aviso da loja chega sozinho. Dizer isso é melhor do
      // que um erro que faria a pessoa comprar de novo.
      setAviso('Compra confirmada. O plano novo aparece aqui em instantes, sem precisar comprar de novo.')
    }
  }

  // Exigência da Apple, e uma necessidade de verdade: quem trocou de aparelho,
  // reinstalou o app ou comprou logado em outra conta do Dito precisa recuperar
  // o que já pagou sem pagar de novo.
  async function restaurarCompras() {
    limparMensagens()
    setRestaurando(true)
    try {
      const ativas = await restaurar()
      const estado = await confirmarNaLoja()
      if (estado) aplicarEstado(estado)
      const plano = PLANOS.find(p => p.id === estado?.plano)
      if (estado && plano && plano.id !== 'gratuito') {
        setAviso(estado.antes === plano.id
          ? `Sua assinatura do ${plano.nome} já está ativa nesta conta.`
          : `Assinatura restaurada. O ${plano.nome} já está valendo.`)
      } else if (!ativas) {
        setAviso(`Não encontramos assinatura ativa ${nesteIdTexto()}.`)
      } else {
        setAviso('Encontramos sua assinatura. O plano aparece aqui em instantes, sem precisar comprar de novo.')
      }
    } catch (err) {
      setErro(err.message || 'Não foi possível restaurar suas compras. Tente de novo.')
    } finally {
      setRestaurando(false)
    }
  }

  // A tela da loja (no iPhone, a da Apple por cima do app). Quando ela fecha, o
  // servidor confere com a loja o que mudou: cancelar ou reativar aparece aqui
  // na hora.
  async function abrirNaLoja() {
    limparMensagens()
    setAbrindoPortal(true)
    try {
      await gerenciarNaLoja()
      const estado = await confirmarNaLoja()
      if (estado) {
        aplicarEstado(estado)
        setCancelando(false)
        if (estado.renova === false && estado.plano !== 'gratuito') {
          const ate = dataCurta(estado.current_period_end)
          setAviso(`Assinatura cancelada. O ${planoAtualObj.nome} continua valendo${ate ? ` até ${ate}` : ''}.`)
        }
      }
    } catch (err) {
      setErro(err.message || 'Não foi possível abrir as assinaturas agora.')
    } finally {
      setAbrindoPortal(false)
    }
  }

  async function abrirPortal() {
    limparMensagens()
    setAbrindoPortal(true)
    try {
      const { url } = await abrirPortalAssinatura()
      window.location.href = url
    } catch (err) {
      setErro(err.message || 'Não foi possível abrir o gerenciamento da assinatura.')
      setAbrindoPortal(false)
    }
  }

  const titulo = escolhido
    ? (direcaoPara(escolhido) === 'nova' ? `Assinar o plano ${escolhido.nome}` : `Mudar para o ${escolhido.nome}`)
    : cancelando ? 'Cancelar assinatura' : 'Meu plano'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{titulo}</h3>
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
            direcao={direcaoPara(escolhido)}
            atual={planoAtualObj}
            fimTexto={fimTexto}
            onAssinar={assinar}
            onVoltar={() => { limparMensagens(); setEscolhido(null) }}
          />
        ) : cancelando ? (
          <Cancelamento
            atual={planoAtualObj}
            fimTexto={fimTexto}
            abrindo={abrindoPortal}
            onManter={() => { limparMensagens(); setCancelando(false) }}
            onMudarParaIniciante={() => escolher(PLANOS.find(p => p.id === 'iniciante'))}
            onContinuar={abrirNaLoja}
          />
        ) : (
          <>
            {/* O estado da assinatura, numa linha, para quem assina pela loja:
                é o que a loja diz que vai acontecer em seguida. */}
            {naLoja && jaAssinante && assinaturaDeLoja && fimTexto && (
              <p className="planos-estado">
                {renova === false
                  ? `${planoAtualObj.nome} até ${fimTexto}. A assinatura foi cancelada e não renova.`
                  : `${planoAtualObj.nome} · renova em ${fimTexto}`}
              </p>
            )}
            <div className="planos">
              {PLANOS.map(p => {
                const pago = p.mensal > 0
                const ativo = planoAtual === p.id
                const preco = precos(p)
                const direcao = direcaoPara(p)
                return (
                  <div key={p.id} className={`plano${ativo ? ' on' : ''}${p.destaque ? ' destaque' : ''}`}>
                    <span className="plano-nome">{p.nome}</span>
                    {/* O bloco de preço tem a mesma altura nos três cards (o
                        grátis tem uma linha, os pagos três): sem isso as listas
                        de benefícios começariam em alturas diferentes. */}
                    <div className="plano-preco-bloco">
                      {pago ? (
                        <>
                          <span className="plano-preco">{preco.porMesTexto} <i>por mês</i></span>
                          <span className="plano-preco-nota">com cobrança anual</span>
                          <span className="plano-preco-nota">{preco.mensalTexto} cobrado mensalmente</span>
                        </>
                      ) : (
                        <>
                          <span className="plano-preco">{formatarPreco(0)} <i>para sempre</i></span>
                          {/* As duas notas vazias guardam a altura das notas dos
                              pagos no computador, onde os cards ficam lado a
                              lado. No celular, um embaixo do outro, elas somem
                              (index.css): ali o espaço virava buraco. */}
                          <span className="plano-preco-nota" aria-hidden="true">&nbsp;</span>
                          <span className="plano-preco-nota" aria-hidden="true">&nbsp;</span>
                        </>
                      )}
                    </div>
                    {/* A linha de saldo ocupa lugar em todos os cards desde o
                        primeiro quadro, mesmo vazia. Ela só tem texto no plano
                        ativo, e como os três cards da grade crescem juntos, era o
                        texto chegando depois que fazia o modal inteiro se esticar
                        sozinho na frente do usuário. No celular, vazia, ela some. */}
                    <span className="plano-saldo">
                      {ativo && saldo && (
                        <>
                          <span>
                            {minutosDoPlano(p) == null
                              ? `${Math.round(saldo.minutosUsados)} min usados`
                              : `${Math.round(saldo.minutosUsados)} de ${minutosDoPlano(p) + saldo.minutosExtra} min usados`}
                          </span>
                          {saldo.periodoFim && (
                            <span>minutos renovam em {dataCurta(saldo.periodoFim)}</span>
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
                        className={`plano-btn ${direcao === 'downgrade' ? 'btn-secondary' : 'btn-primary'}`}
                        disabled={carregandoPlano}
                        onClick={() => escolher(p)}
                      >
                        {direcao === 'downgrade' ? `Mudar para o ${p.nome}` : 'Fazer upgrade'}
                      </button>
                    ) : null)}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!escolhido && !cancelando && jaAssinante && (
          <div className="planos-gerenciar">
            {naLoja && assinaturaDeLoja ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={renova === false ? abrirNaLoja : () => { limparMensagens(); setCancelando(true) }}
                disabled={abrindoPortal}
              >
                {abrindoPortal ? (
                  <>
                    <span className="spinner spinner-sm" />
                    Abrindo…
                  </>
                ) : renova === false ? 'Reativar assinatura' : 'Cancelar assinatura'}
              </button>
            ) : assinaturaDeLoja ? (
              // Assinou no celular e está no site ou no Windows: daqui não há
              // como mexer nessa assinatura, e um botão que dá erro é pior do
              // que dizer onde ela mora.
              <p className="planos-legal">
                {origem === 'apple'
                  ? 'Assinatura feita pela App Store. Para trocar ou cancelar, use o iPhone: Ajustes, seu nome, Assinaturas.'
                  : 'Assinatura feita pelo Google Play. Para trocar ou cancelar, use o celular: Play Store, Pagamentos e assinaturas.'}
              </p>
            ) : naLoja ? (
              // Quem assinou pelo site e está no celular não tem o que clicar
              // aqui: apontar para uma compra de fora do app é recusa na revisão
              // da Apple, mesmo quando é só para gerenciar. Texto sem link é
              // permitido, e resolve a dúvida de quem procura o cancelamento.
              <p className="planos-legal">
                Sua assinatura foi feita pelo site do Dito e é gerenciada por lá, no computador.
              </p>
            ) : (
              <button type="button" className="btn-ghost" onClick={abrirPortal} disabled={abrindoPortal}>
                {abrindoPortal ? (
                  <>
                    <span className="spinner spinner-sm" />
                    Abrindo…
                  </>
                ) : 'Trocar de plano, forma de pagamento ou cancelar'}
              </button>
            )}
          </div>
        )}

        {/* Tela de assinatura sem estas três coisas — a frase da renovação
            automática, os termos de uso e a política de privacidade — é recusa
            na revisão da Apple, independentemente de todo o resto. Elas ficam
            na MESMA tela onde o plano é oferecido, que é a exigência. */}
        {naLoja && (
          <div className="planos-legal">
            <p>
              A assinatura renova sozinha ao fim de cada período, pelo mesmo valor, até
              você cancelar. Cancele quando quiser, até 24 horas antes da renovação,
              aqui em Meu plano ou nos ajustes do aparelho.
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

// Valor na moeda que a loja informou. Reais saem como no resto do app (R$ 18,
// R$ 24,99); outra moeda sai com o símbolo certo (US$ 4,17).
function formatarNaMoeda(valor, moeda) {
  if (moeda === 'BRL') return formatarPreco(valor)
  try {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: moeda })
  } catch {
    return `${valor.toFixed(2)} ${moeda}`
  }
}

// O identificador do produto na loja. Vem do servidor (GET /planos), para o
// nome existir num lugar só; o mapa local é o desenho inicial, para a tela
// funcionar antes da primeira resposta.
function idDoProduto(plano, ciclo) {
  return plano.produtos?.[ciclo] || PRODUTOS_PADRAO[plano.id]?.[ciclo] || ''
}

function Faturamento({
  plano, precos, ciclo, setCiclo, assinando, demorando, naLoja, direcao, atual, fimTexto, onAssinar, onVoltar,
}) {
  const anual = ciclo === 'anual'
  const valor = anual ? precos.anualTexto : precos.mensalTexto
  const porCiclo = anual ? 'por ano' : 'por mês'
  // O que acontece com o dinheiro, que muda com a direção. Descer de plano não
  // cobra nada hoje e não tira o que já foi pago: a loja só troca na renovação.
  let explicacao
  if (direcao === 'upgrade') {
    explicacao = naLoja
      ? `O ${plano.nome} começa agora. Hoje ${aLojaTexto()} cobra ${valor} e devolve a parte do ${atual.nome} que você não usou.`
      : `O ${plano.nome} começa agora, e você paga hoje só a diferença proporcional.`
  } else if (direcao === 'downgrade') {
    explicacao = `Você continua no ${atual.nome} ${fimTexto ? `até ${fimTexto}` : 'até o fim do período'}, que já está pago. Depois, ${plano.nome} por ${valor} ${porCiclo}. Nada é cobrado hoje.`
  } else {
    explicacao = `${anual ? 'Cobrado hoje e renovado a cada ano.' : 'Cobrado hoje e renovado a cada mês.'} ${
      naLoja ? 'Cancele quando quiser, aqui em Meu plano.' : 'Cancele quando quiser, direto no seu plano.'}`
  }
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
            <span>{precos.porMesTexto} / mês</span>
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
        <span className="faturamento-renova">{explicacao}</span>
      </div>

      {/* Quem desce de plano precisa ver o que deixa de ter, antes de agendar. */}
      {direcao === 'downgrade' && (
        <div className="faturamento-muda">
          <p className="faturamento-rotulo">No {plano.nome}</p>
          <ul>
            {plano.itens.map(i => <li key={i}><IconCheck width={12} height={12} /> {i}</li>)}
          </ul>
        </div>
      )}

      <button type="button" className="btn-primary faturamento-btn" onClick={onAssinar} disabled={assinando}>
        {assinando ? (
          <>
            <span className="spinner spinner-sm" />
            {naLoja
              ? (demorando ? 'Confirmando o pagamento…' : 'Abrindo o pagamento…')
              : (demorando ? 'Ainda abrindo. O servidor está acordando…' : 'Abrindo pagamento…')}
          </>
        ) : direcao === 'downgrade' ? `Agendar a mudança para o ${plano.nome}` : 'Continuar para o pagamento'}
      </button>
      <button type="button" className="faturamento-voltar" onClick={onVoltar} disabled={assinando}>
        {direcao === 'downgrade' ? `Continuar no ${atual.nome}` : 'Ver todos os planos'}
      </button>
    </div>
  )
}

// Antes de mandar para o cancelamento da loja, o que acontece: o plano vale até
// o fim do que já foi pago, e depois a conta volta para o Grátis. Quem só quer
// pagar menos tem o Iniciante a um toque, sem precisar sair.
function Cancelamento({ atual, fimTexto, abrindo, onManter, onMudarParaIniciante, onContinuar }) {
  const gratis = PLANOS[0]
  return (
    <div className="faturamento">
      <p className="faturamento-renova cancelamento-texto">
        Seu {atual.nome} continua valendo {fimTexto ? `até ${fimTexto}` : 'até o fim do período'}, que já está
        pago. Depois, a conta volta para o Grátis: {gratis.minutos} minutos e {gratis.perguntas} perguntas por
        mês, só com a transcrição simples.
      </p>
      <button type="button" className="btn-primary faturamento-btn" onClick={onManter} disabled={abrindo}>
        Manter o {atual.nome}
      </button>
      {atual.id === 'avancado' && (
        <button type="button" className="btn-secondary faturamento-btn" onClick={onMudarParaIniciante} disabled={abrindo}>
          Mudar para o Iniciante
        </button>
      )}
      <button type="button" className="faturamento-voltar" onClick={onContinuar} disabled={abrindo}>
        {abrindo ? 'Abrindo…' : `Continuar ${naLojaTexto()}`}
      </button>
    </div>
  )
}
