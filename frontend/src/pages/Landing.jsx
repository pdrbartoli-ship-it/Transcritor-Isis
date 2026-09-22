import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconDownload, IconShield, IconMic, IconFile, IconCheck,
  IconArrowRight, IconStopCircle, IconPlay,
} from '../components/Icons'
import InstalarModal from '../components/InstalarModal'
import { INSTALLER_URL, STORE_URL } from '../lib/instalar'
import useTemaClaro from '../lib/useTemaClaro'
import { setTheme } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

import { PLANOS, formatarPreco, precoMensalNoAnual } from '../lib/planos'

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
        {/* Sem a barra de janela falsa (os três pontinhos e o endereço): ela
            fingia um navegador que não é o do visitante e não dizia nada. */}
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
  useTemaClaro()
  const navigate = useNavigate()
  const { user } = useAuth()
  const entrar = () => navigate('/auth')

  // "Entrar" e "Instalar grátis" são duas promessas diferentes, e por muito
  // tempo os dois botões faziam a mesma coisa: abrir o login no navegador.
  // Instalar abre o fluxo de download; entrar continua indo direto para o app.
  const [instalando, setInstalando] = useState(false)
  const instalar = () => setInstalando(true)

  // Sem conta, sem senha, sem chave de criptografia possível — é o
  // `signInAnonymously` do Supabase: nasce um usuário de verdade (o resto do
  // app nem sabe que ele é convidado), só que sem e-mail. O backend é quem
  // aplica o teto de uma captura por essa identidade (main.py: `convidado`).
  // Precisa estar ligado no painel do Supabase (Authentication > Sign In /
  // Providers > Anonymous) — se não estiver, cai no `catch` abaixo.
  const [entrandoConvidado, setEntrandoConvidado] = useState(false)
  const [falhouConvidado, setFalhouConvidado] = useState(false)
  async function usarSemConta() {
    // Já existe sessão: é o convidado que voltou à landing. Ele entra de novo
    // na mesma — um signInAnonymously aqui criaria outro convidado e jogaria
    // fora a gravação dele (e, para quem tem conta, a própria conta).
    if (user) {
      navigate('/')
      return
    }
    setEntrandoConvidado(true)
    setFalhouConvidado(false)
    // Marca esta entrada do histórico como a landing, e o app entra por cima
    // dela depois do login: é o que faz o voltar do navegador trazer a landing
    // de volta. Vem antes do login porque, sem a marca, a sessão nascendo já
    // trocaria a landing pelo app neste mesmo endereço (ver RootRoute).
    navigate('/', { replace: true, state: { vitrine: true } })
    // O convidado começa no tom da landing. O tema guardado neste navegador é
    // de quem já usou o Dito com conta aqui, e sem isto o convidado entrava no
    // escuro escolhido por outra pessoa.
    setTheme('light')
    try {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) throw error
      navigate('/')
    } catch {
      setFalhouConvidado(true)
      setEntrandoConvidado(false)
    }
  }

  // O plano escolhido na landing viaja com a pessoa até depois do login: o
  // Layout lê isto assim que a sessão existe e já abre o "Meu plano" com o
  // checkout pronto para o plano escolhido aqui.
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
          {/* Quem já tem conta continua chegando ao login por "Instalar
              grátis" → "usar no navegador", que abre a tela com as duas abas
              (Criar conta / Acessar). Este lugar na barra virou a porta de
              entrada mais rápida: gravar sem decidir nada antes. */}
          <button
            className="lp-nav-login"
            onClick={usarSemConta}
            disabled={entrandoConvidado}
          >
            {entrandoConvidado ? 'Entrando…' : falhouConvidado ? 'Tentar de novo' : 'Usar o Dito'}
          </button>
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
            O Dito escuta a reunião, a consulta ou a aula por você e devolve a transcrição
            e um resumo do que ficou combinado.
          </p>
          <div className="lp-cta">
            <button className="btn-primary lp-btn-lg" onClick={instalar}>
              Instalar grátis
              <IconArrowRight width={16} height={16} />
            </button>
            <span className="lp-cta-note">
              Grátis e sem cartão. Funciona no navegador, no celular e no Windows.
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
          <h2>Como o Dito funciona</h2>
          <div className="lp-feats">
            <article className="lp-feat">
              <h3>Grave, envie um arquivo ou cole um link.</h3>
              <p>
                Tudo cai na mesma lista de conversas. Fixe as importantes no topo; o resto
                se organiza por data.
              </p>
              <div className="lp-feat-shot">
                <img
                  src="/landing/registrar.png"
                  alt="Janela do Dito com a lista de conversas na barra lateral e a tela de gravação pronta para começar"
                  loading="lazy"
                />
              </div>
              <button className="lp-feat-link" onClick={entrar}>
                Testar agora <IconArrowRight width={14} height={14} />
              </button>
            </article>

            <article className="lp-feat">
              <h3>Tópicos, tarefas e um chat sobre a conversa.</h3>
              <p>
                O Dito separa os tópicos, lista o que ficou combinado e monta um resumo
                minuto a minuto. Faltou um detalhe? Pergunte.
              </p>
              <div className="lp-feat-shot">
                <img
                  src="/landing/perguntar.png"
                  alt="Janela do Dito com uma conversa processada: os tópicos principais, a lista de tarefas e a barra para perguntar sobre a conversa"
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
        <section className="lp-section lp-split">
          <div className="lp-split-titulo">
            <IconShield width={24} height={24} />
            <h2>Suas conversas são cifradas antes de sair do seu aparelho.</h2>
          </div>
          <div className="lp-split-texto">
            <p>
              A chave que abre o conteúdo fica só com você e nunca chega ao nosso servidor.
              Nem nós conseguimos ler o que você guarda no Dito.
            </p>
            <p className="lp-split-foot">
              Feito para quem tem sigilo a cumprir.{' '}
              <a href="/privacidade.html">Política de privacidade</a>
            </p>
          </div>
        </section>

        {/* ── Desktop: público que se auto-seleciona ───────── */}
        <section className="lp-section lp-split">
          <div className="lp-split-titulo">
            <h2>No Windows, grave os dois lados da chamada.</h2>
          </div>
          <div className="lp-split-texto">
            <p>
              O navegador só capta o seu microfone. O app para Windows grava
              <strong> você e quem está do outro lado</strong>, com uma janela flutuante que
              fica por cima de tudo durante a conversa.
            </p>
            {/* Desde 22/09/2026 o caminho é a Microsoft Store: o pacote de
                lá é assinado pela Microsoft e instala sem a tela azul "O
                Windows protegeu seu PC", que o .exe sem assinatura mostrava a
                todo mundo. O .exe continua logo abaixo, em letra miúda, para
                quem tem a Store bloqueada no computador do trabalho. */}
            <a
              className="btn-ghost lp-btn-lg lp-split-btn"
              href={STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconDownload width={16} height={16} />
              Baixar na Microsoft Store
            </a>
            <p className="lp-split-foot">
              Sem acesso à Store? <a href={INSTALLER_URL}>Baixe o instalador direto</a>.
            </p>
          </div>
        </section>

        {/* ── Para quem é ──────────────────────────────────── */}
        <section className="lp-section">
          <h2>Quem usa o Dito</h2>
          <div className="lp-who">
            <div><h3>Reuniões de trabalho</h3><p>Ninguém precisa ser o secretário da sala. O combinado sai escrito para todo mundo.</p></div>
            <div><h3>Atendimentos e consultas</h3><p>O registro fica pronto sem quebrar o contato visual com quem está na sua frente.</p></div>
            <div><h3>Aulas e entrevistas</h3><p>Horas de gravação viram minutos de leitura, com o trecho exato quando você precisar.</p></div>
          </div>
        </section>

        {/* ── Preços ───────────────────────────────────────── */}
        <section className="lp-section lp-precos" id="precos">
          <h2>Planos</h2>
          <div className="lp-planos">
            {PLANOS.map(p => (
              <article key={p.id} className={`lp-plano${p.destaque ? ' destaque' : ''}`}>
                {/* O selo mora na linha do nome: pendurado na borda de cima, ele
                    empurrava o cartão do meio para baixo e desalinhava os três. */}
                <div className="lp-plano-topo">
                  <h3>{p.nome}</h3>
                  {p.destaque && <span className="lp-plano-selo">Recomendado</span>}
                </div>
                {/* Mesma manchete do "Meu plano": o anual por mês na frente, o
                    mensal logo abaixo. A escolha entre os dois é feita só na hora
                    de pagar. */}
                <div className="lp-plano-preco">
                  <strong>{formatarPreco(p.anual ? precoMensalNoAnual(p) : 0)}</strong>
                  <span>{p.anual ? 'por mês' : 'para sempre'}</span>
                </div>
                {/* O lugar da nota existe nos três cartões (vazio no Grátis):
                    sem ele, cada coluna começava a lista numa altura. */}
                <p className="lp-plano-nota">
                  {p.anual
                    ? `com cobrança anual · ${formatarPreco(p.mensal)} cobrado mensalmente`
                    : '\u00a0'}
                </p>
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
            Cancele quando quiser, direto no seu plano. O pagamento é processado pelo Stripe
            e o Dito nunca vê o número do seu cartão.
          </p>
        </section>

        {/* ── CTA final ────────────────────────────────────── */}
        <section className="lp-final">
          <h2>Comece grátis</h2>
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
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand">Dito<span className="dot">.</span></span>
        <span>
          <button type="button" onClick={() => irPara('produto')}>Produto</button>
          <button type="button" onClick={() => irPara('precos')}>Preços</button>
          <a href="/privacidade.html">Privacidade</a>
          <a href="mailto:pdrbartoli@gmail.com">Contato</a>
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
