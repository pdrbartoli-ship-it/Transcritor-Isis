import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconDownload, IconShield, IconMic, IconFile, IconCheck,
  IconArrowRight, IconStopCircle, IconPlay,
} from '../components/Icons'
import InstalarModal from '../components/InstalarModal'
import { INSTALLER_URL } from '../lib/instalar'

// PREÇOS PROVISÓRIOS — nada aqui está cobrado ainda. Os valores e os limites
// existem para a página ter uma aba de preço de verdade e para medirmos quem
// clica em quê antes de haver cobrança. Trocar aqui e no PlanModal (a mesma
// tabela aparece dentro do app) quando o plano for definido.
const PLANOS = [
  {
    id: 'gratuito',
    nome: 'Gratuito',
    preco: 'R$ 0',
    periodo: 'para sempre',
    resumo: 'Para experimentar sem compromisso.',
    itens: [
      '2 horas de transcrição por mês',
      'Resumo automático de tudo que você grava',
      'Perguntas sobre a própria conversa',
      'Cifrado no seu aparelho',
    ],
    cta: 'Começar grátis',
  },
  {
    id: 'plus',
    nome: 'Plus',
    preco: 'R$ 39',
    periodo: 'por mês',
    destaque: true,
    resumo: 'Para quem grava toda semana.',
    itens: [
      '20 horas de transcrição por mês',
      'Documento final pronto para baixar',
      'App de Windows: grava as duas vozes',
      'Arquivos e reuniões longas sem corte',
    ],
    cta: 'Assinar Plus',
  },
  {
    id: 'ultra',
    nome: 'Ultra',
    preco: 'R$ 89',
    periodo: 'por mês',
    resumo: 'Para quem vive dentro de conversas.',
    itens: [
      'Transcrição sem limite de horas',
      'Resumos mais profundos, com mais contexto',
      'Prioridade no processamento',
      'Suporte direto com quem faz o Dito',
    ],
    cta: 'Assinar Ultra',
  },
]

// A demonstração roda sozinha em cinco tempos, na ordem em que a pessoa vive o
// produto: já está gravando, finaliza, sobe, vira texto, vira resumo. O último
// tempo passeia pelos pontos do resumo — é ali que o valor aparece, e é o único
// que não dá para entender por um print parado.
const PASSOS = [
  { rotulo: 'Gravando a reunião', ms: 2600 },
  { rotulo: 'Você aperta finalizar', ms: 1400 },
  { rotulo: 'Transcrevendo', ms: 2400 },
  { rotulo: 'Resumo pronto', ms: 2600 },
  { rotulo: 'Você navega pelo que importa', ms: 3600 },
]

const PONTOS = [
  'Prazo de entrega remarcado para a sexta seguinte.',
  'Orçamento aprovado; falta o aceite formal por e-mail.',
  'Ficou combinado: enviar a proposta revisada até quarta.',
]

// Alturas da onda depois que a gravação para. Precisam ser irregulares: com
// todas as barras na mesma altura o bloco vira um tracejado, e some justamente
// a leitura de "isto aqui é áudio". Fixas e determinísticas para o desenho não
// dançar a cada render.
const ALTURAS = Array.from({ length: 40 }, (_, i) =>
  `${28 + Math.round(Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.53) * 0.4) * 60)}%`,
)

// Quem prefere menos movimento no sistema recebe a tela final direto, parada.
const semMovimento = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Demo() {
  const [passo, setPasso] = useState(semMovimento() ? 4 : 0)
  const [ponto, setPonto] = useState(0)
  const [rodando, setRodando] = useState(!semMovimento())
  const alvo = useRef(null)

  // Só começa quando a seção entra na tela: rodar escondido gasta o efeito e
  // a pessoa chega no meio da animação sem entender o que perdeu.
  useEffect(() => {
    if (semMovimento() || !alvo.current) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setRodando(true); io.disconnect() } },
      { threshold: 0.35 },
    )
    io.observe(alvo.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!rodando || semMovimento()) return
    const t = setTimeout(() => setPasso(p => (p + 1) % PASSOS.length), PASSOS[passo].ms)
    return () => clearTimeout(t)
  }, [passo, rodando])

  // O passeio pelos pontos do resumo acontece dentro do último tempo.
  useEffect(() => {
    if (passo !== 4) { setPonto(0); return }
    const t = setInterval(() => setPonto(p => (p + 1) % PONTOS.length), 1100)
    return () => clearInterval(t)
  }, [passo])

  const gravando = passo === 0
  const finalizando = passo === 1
  const processando = passo <= 2
  const temResumo = passo >= 3

  return (
    <div className="lp-demo" ref={alvo}>
      <div className="lp-shot lp-shot-wide">
        <div className="lp-shot-bar">
          <span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" />
          <span className="lp-shot-url">dito.albiecloud.com</span>
        </div>

        <div className="lp-shot-body">
          <div className="lp-shot-head">
            <IconMic width={14} height={14} />
            <span>Reunião de 12/09</span>
            <span className={`lp-timer${gravando ? ' on' : ''}`}>
              {gravando ? '48:12' : '48 min'}
            </span>
            <button
              className={`lp-stop${finalizando ? ' press' : ''}`}
              type="button" tabIndex={-1} aria-hidden="true"
            >
              <IconStopCircle width={13} height={13} />
              Finalizar
            </button>
          </div>

          <div className={`lp-wave${gravando ? ' live' : ''}`}>
            {ALTURAS.map((h, i) => <i key={i} style={{ '--i': i, height: h }} />)}
          </div>

          {processando && (
            <div className="lp-progress">
              <span className={`lp-progress-bar${passo === 2 ? ' run' : ''}`} />
            </div>
          )}

          <div className={`lp-card lp-card-anim${temResumo ? ' on' : ''}`}>
            <h4>Resumo</h4>
            <ul>
              {PONTOS.map((p, i) => (
                <li key={i} className={passo === 4 && ponto === i ? 'foco' : ''}>{p}</li>
              ))}
            </ul>
          </div>

          <div className="lp-lines">
            {[92, 78, 85, 54].map((w, i) => (
              <span
                key={i}
                style={{ width: `${w}%` }}
                className={passo >= 2 ? 'on' : ''}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="lp-demo-steps" role="presentation">
        {PASSOS.map((p, i) => (
          <span key={p.rotulo} className={i === passo ? 'on' : ''}>
            <i /> {p.rotulo}
          </span>
        ))}
      </div>
    </div>
  )
}

// Os âncoras da barra não podem ser <a href="#produto">: o app roda em
// HashRouter, e mexer no hash faz o roteador trocar de rota. Rolamos na mão.
function irPara(id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: semMovimento() ? 'auto' : 'smooth',
    block: 'start',
  })
}

export default function Landing() {
  const navigate = useNavigate()
  const entrar = () => navigate('/auth')

  // "Entrar" e "Instalar grátis" são duas promessas diferentes, e por muito
  // tempo os dois botões faziam a mesma coisa: abrir o login no navegador.
  // Instalar abre o fluxo de download; entrar continua indo direto para o app.
  const [instalando, setInstalando] = useState(false)
  const instalar = () => setInstalando(true)

  // O plano escolhido na landing viaja com a pessoa até depois do login, que é
  // onde o checkout vai existir. Enquanto não há cobrança, o app lê isto no
  // "Meu plano" e já mostra o plano certo em destaque.
  const escolherPlano = id => {
    try { localStorage.setItem('dito-plano-escolhido', id) } catch { /* modo anônimo */ }
    entrar()
  }

  return (
    <div className="lp">
      {/* ── Barra: só Produto e Preços, como no Notion ─────── */}
      <header className="lp-nav">
        <span className="brand">Dito<span className="dot">.</span></span>
        <nav className="lp-nav-links">
          <button type="button" onClick={() => irPara('produto')}>Produto</button>
          <button type="button" onClick={() => irPara('precos')}>Preços</button>
        </nav>
        <div className="lp-nav-acoes">
          <button className="lp-nav-login" onClick={entrar}>Entrar</button>
          <button className="btn-primary lp-nav-btn" onClick={instalar}>Instalar grátis</button>
        </div>
      </header>

      <main>
        {/* ── Hero: punchline + prova visual ───────────────── */}
        <section className="lp-hero">
          <h1>
            Não anote.
            <em>Esteja presente.</em>
          </h1>
          <p className="lp-sub">
            O Dito escuta a reunião, a consulta ou a aula por você — e devolve a transcrição
            e um resumo do que ficou combinado. Você só participa da conversa.
          </p>
          <div className="lp-cta">
            <button className="btn-primary lp-btn-lg" onClick={instalar}>
              Instalar grátis
              <IconArrowRight width={16} height={16} />
            </button>
            <span className="lp-cta-note">
              Grátis. Abre no navegador, no celular e no Windows — sem cartão.
            </span>
          </div>

          <div className="lp-hero-shot">
            <Demo />
          </div>
        </section>

        {/* Fatos verificáveis, não elogios. Depoimentos entram aqui assim que
            houver autorização dos testadores — nome e profissão de verdade. */}
        <div className="lp-strip">
          <span><IconShield width={14} height={14} /> Cifrado no seu aparelho</span>
          <span><IconFile width={14} height={14} /> Áudio, vídeo ou link</span>
          <span><IconCheck width={14} height={14} /> Documento pronto para baixar</span>
        </div>

        {/* ── Produto: capturar e perguntar, em prints reais do app ── */}
        <section className="lp-section" id="produto">
          <h2>Grave qualquer coisa. Pergunte qualquer coisa.</h2>
          <div className="lp-feats">
            <article className="lp-feat">
              <span className="lp-feat-tag">Registrar</span>
              <h3>Três jeitos de começar. Uma lista só.</h3>
              <p>
                Grave, envie um arquivo ou cole um link — na mesma tela. As conversas mais
                importantes ficam fixadas no topo; as outras se organizam sozinhas por data.
              </p>
              <div className="lp-feat-shot">
                <img
                  src="/landing/captura.png"
                  alt="Tela inicial do Dito com uma gravação em andamento e a lista de conversas anteriores na barra lateral"
                  loading="lazy"
                />
              </div>
              <button className="lp-feat-link" onClick={entrar}>
                Testar agora <IconArrowRight width={14} height={14} />
              </button>
            </article>

            <article className="lp-feat">
              <span className="lp-feat-tag">Perguntar</span>
              <h3>Não é só um resumo — é uma conversa que dá para interrogar.</h3>
              <p>
                O Dito separa os tópicos, lista o que ficou combinado e monta um resumo
                minuto a minuto que você navega clicando. Faltou um detalhe? É só perguntar.
              </p>
              <div className="lp-feat-shot">
                <img
                  src="/landing/resultado.png"
                  alt="Página de uma conversa processada pelo Dito, com os tópicos principais, um trecho da transcrição e a barra para perguntar sobre a conversa"
                  loading="lazy"
                />
              </div>
              <button className="lp-feat-link" onClick={entrar}>
                Testar agora <IconArrowRight width={14} height={14} />
              </button>
            </article>
          </div>
        </section>

        {/* ── Privacidade: o diferencial ───────────────────── */}
        <section className="lp-section lp-privacy">
          <div className="lp-privacy-inner">
            <IconShield width={26} height={26} />
            <h2>O que você grava sai embaralhado daqui.</h2>
            <p>
              O conteúdo das suas conversas é cifrado dentro do seu próprio aparelho, antes de
              subir. A chave que abre nasce e fica com você — ela nunca chega ao nosso servidor.
              Na prática: nem nós conseguimos ler o que você guarda no Dito.
            </p>
            <p className="lp-privacy-foot">
              Feito para quem tem sigilo a cumprir.{' '}
              <a href="/privacidade.html">Política de privacidade</a>
            </p>
          </div>
        </section>

        {/* ── Desktop: público que se auto-seleciona ───────── */}
        <section className="lp-section lp-desktop">
          <div>
            <span className="lp-tag">App para Windows</span>
            <h2>Reunião por chamada? Grave as duas vozes.</h2>
            <p>
              O navegador só escuta o seu microfone. O app do Dito para Windows grava
              <strong> os dois lados</strong> da chamada — você e quem está do outro lado — com uma
              janelinha flutuante que fica por cima de tudo enquanto você conversa.
            </p>
            <a className="btn-ghost lp-btn-lg" href={INSTALLER_URL}>
              <IconDownload width={16} height={16} />
              Baixar para Windows
            </a>
          </div>
        </section>

        {/* ── Para quem é ──────────────────────────────────── */}
        <section className="lp-section">
          <h2>Feito para quem vive de escutar.</h2>
          <div className="lp-who">
            <div><h3>Reuniões de trabalho</h3><p>Ninguém precisa ser o secretário da sala. O combinado sai escrito para todo mundo.</p></div>
            <div><h3>Atendimentos e consultas</h3><p>O registro fica pronto sem quebrar o contato visual com quem está na sua frente.</p></div>
            <div><h3>Aulas e entrevistas</h3><p>Horas de gravação viram minutos de leitura, com o trecho exato quando você precisar.</p></div>
          </div>
        </section>

        {/* ── Preços ───────────────────────────────────────── */}
        <section className="lp-section lp-precos" id="precos">
          <h2>Preço simples.</h2>
          <div className="lp-planos">
            {PLANOS.map(p => (
              <article key={p.id} className={`lp-plano${p.destaque ? ' destaque' : ''}`}>
                {p.destaque && <span className="lp-plano-selo">Mais escolhido</span>}
                <h3>{p.nome}</h3>
                <div className="lp-plano-preco">
                  <strong>{p.preco}</strong>
                  <span>{p.periodo}</span>
                </div>
                <p className="lp-plano-resumo">{p.resumo}</p>
                <ul>
                  {p.itens.map(i => (
                    <li key={i}><IconCheck width={13} height={13} /> {i}</li>
                  ))}
                </ul>
                <button
                  className={p.destaque ? 'btn-primary lp-plano-btn' : 'btn-ghost lp-plano-btn'}
                  onClick={() => escolherPlano(p.id)}
                >
                  {p.cta}
                </button>
              </article>
            ))}
          </div>
          <p className="lp-precos-nota">
            Enquanto o Dito está em construção, tudo funciona sem cobrança — e você continua
            com o que já gravou quando os planos entrarem no ar.
          </p>
        </section>

        {/* ── CTA final ────────────────────────────────────── */}
        <section className="lp-final">
          <h2>Comece hoje.</h2>
          <div className="lp-final-btns">
            <button className="btn-primary lp-btn-lg" onClick={instalar}>
              Instalar grátis
              <IconArrowRight width={16} height={16} />
            </button>
            <button className="btn-ghost lp-btn-lg" onClick={() => irPara('produto')}>
              <IconPlay width={15} height={15} />
              Ver funcionando
            </button>
          </div>
          <span className="lp-cta-note">Grátis. Leva menos de um minuto.</span>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand">Dito<span className="dot">.</span></span>
        <span>
          <button type="button" onClick={() => irPara('produto')}>Produto</button>
          <button type="button" onClick={() => irPara('precos')}>Preços</button>
          <a href="/privacidade.html">Privacidade</a>
          <a href="mailto:pdrbartoli@gmail.com">Fale com a gente</a>
        </span>
      </footer>

      {instalando && (
        <InstalarModal
          onClose={() => setInstalando(false)}
          onUsarNavegador={entrar}
        />
      )}
    </div>
  )
}
