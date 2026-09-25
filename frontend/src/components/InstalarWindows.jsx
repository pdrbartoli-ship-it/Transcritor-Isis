import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconArrowRight, IconCheck, IconClose, IconDownload, IconLock, IconMic, IconShield,
} from './Icons'
import { STORE_URL, baixarInstaladorWindows, baixarInstaladorDito } from '../lib/instalar'

// A tela que cobre a landing assim que a pessoa clica em instalar no Windows.
// O clique já disparou o download, então aqui só resta mostrar o que fazer com
// o arquivo. Ela ocupa a tela inteira porque, nesse momento, é a única coisa
// que importa.
//
// Dois caminhos, na ordem em que a pessoa os vive:
// - `loja`: o instalador da Microsoft, que instala sem aviso nenhum. Serve a
//   quase todo mundo e é o que já está baixando.
// - `direto`: o instalador do próprio Dito, para quando o da Microsoft dá erro
//   (computador de empresa ou de escola). A tela não conta essa história: quem
//   viu o erro se reconhece em "Deu erro ou abriu a Microsoft Store?", e quem
//   não viu não precisa saber que ele existe. Este instalador não tem
//   assinatura digital e o Windows avisa antes de abrir, então o caminho
//   mostra onde clicar e explica, com fatos, por que o aviso não é vírus.
//
// À direita, uma encenação desenhada em HTML (como a demonstração da landing)
// mostra cada passo acontecendo, com o cursor clicando onde a pessoa vai
// clicar. O passo da vez acende na lista.
const CAMINHOS = {
  loja: {
    titulo: 'Abra o arquivo para instalar o Dito',
    passos: [
      {
        titulo: 'Abra o arquivo baixado',
        detalhe: 'Dito. Installer.exe, na lista de downloads do navegador.',
      },
      {
        titulo: 'Espere a instalação',
        detalhe: 'O instalador é da própria Microsoft e termina em menos de um minuto.',
      },
      {
        titulo: 'Entre com seu e-mail',
        detalhe: 'O Dito abre sozinho quando a instalação acaba.',
      },
    ],
  },
  direto: {
    titulo: 'O Windows vai pedir sua confirmação',
    passos: [
      {
        titulo: 'Mantenha o arquivo',
        detalhe:
          'Se o navegador avisar que ele não é baixado com frequência, confirme que quer manter. ' +
          'No Edge: ⋯, Manter, Mostrar mais e Manter assim mesmo.',
      },
      {
        titulo: 'Abra o arquivo e clique em Mais informações',
        detalhe: 'Fica na tela azul “O Windows protegeu o computador”.',
      },
      {
        titulo: 'Clique em Executar assim mesmo',
        detalhe: 'Depois é só avançar no instalador. O Dito abre no final.',
      },
    ],
  },
}

// Cada cena é um roteiro: em que milissegundo o cursor vai a que alvo, quando
// clica, quando a tela muda de fase e o que a legenda diz. Os alvos são os
// elementos com `data-alvo`, e a posição deles é medida na hora, então mexer
// no desenho não desalinha o cursor. A legenda narra o clique da vez, como a
// legenda de um vídeo: quem olha a encenação não precisa voltar à lista para
// saber o que está vendo. `parado` é o quadro de quem pede menos movimento no
// sistema: a fase, o alvo e a legenda que explicam a cena sem animação.
const ROTEIROS = {
  loja: [
    {
      ms: 3800,
      parado: { fase: 0, alvo: 'abrir', legenda: 'Clique em Abrir arquivo' },
      acoes: [
        [0, 'legenda', 'Clique em Abrir arquivo'],
        [300, 'mostrar'], [450, 'ir', 'abrir'], [1600, 'clicar'], [1750, 'fase', 1],
      ],
    },
    {
      ms: 3800,
      parado: { fase: 0, legenda: 'O Dito é instalado sozinho' },
      acoes: [[0, 'legenda', 'O Dito é instalado sozinho']],
    },
    {
      ms: 4800,
      parado: { fase: 0, legenda: 'Pronto: é só entrar com seu e-mail' },
      acoes: [
        [0, 'legenda', 'Pronto: é só entrar com seu e-mail'],
        [2500, 'mostrar'], [2600, 'ir', 'criar'], [3700, 'clicar'],
      ],
    },
  ],
  direto: [
    {
      ms: 6800,
      parado: { fase: 2, alvo: 'manter-mesmo', legenda: 'Clique em Manter assim mesmo' },
      acoes: [
        [0, 'legenda', 'No menu ⋯, clique em Manter'],
        [300, 'mostrar'], [400, 'ir', 'manter'], [1500, 'clicar'], [1650, 'fase', 1],
        [1650, 'legenda', 'Clique em Mostrar mais'],
        [2000, 'ir', 'mostrar-mais'], [3100, 'clicar'], [3250, 'fase', 2],
        [3250, 'legenda', 'Clique em Manter assim mesmo'],
        [3600, 'ir', 'manter-mesmo'], [4700, 'clicar'], [4850, 'fase', 3], [5000, 'esconder'],
        [4850, 'legenda', 'Pronto: agora é só abrir o arquivo'],
      ],
    },
    {
      ms: 4000,
      parado: { fase: 0, alvo: 'mais-info', legenda: 'Clique em Mais informações' },
      acoes: [
        [0, 'legenda', 'Clique em Mais informações'],
        [300, 'mostrar'], [450, 'ir', 'mais-info'], [1600, 'clicar'], [1750, 'fase', 1],
        [1750, 'legenda', 'Aparece o botão Executar assim mesmo'],
      ],
    },
    {
      ms: 5800,
      parado: { fase: 0, alvo: 'executar', legenda: 'Clique em Executar assim mesmo' },
      acoes: [
        [0, 'legenda', 'Clique em Executar assim mesmo'],
        [300, 'mostrar'], [400, 'ir', 'executar'], [1500, 'clicar'], [1650, 'fase', 1],
        [1650, 'legenda', 'Avance no instalador até o fim'],
        [2100, 'ir', 'avancar'], [3200, 'clicar'], [3350, 'fase', 2], [3400, 'esconder'],
        [3350, 'legenda', 'Pronto: o Dito abre sozinho'],
      ],
    },
  ],
}

// De onde o cursor parte em toda cena, em em do palco (ver .iw-mundo).
const INICIO = { x: 12, y: 21 }

const semMovimento = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function InstalarWindows({ onFechar, onUsarNavegador }) {
  const [caminho, setCaminho] = useState('loja')
  const [cena, setCena] = useState(0)
  // Muda a cada cena que começa, inclusive quando a mesma cena se repete: é a
  // chave que faz o palco recomeçar do zero.
  const [rodada, setRodada] = useState(0)
  // A lista anda sozinha até a pessoa escolher um passo. Daí em diante o palco
  // repete o passo escolhido, no ritmo de quem está lendo.
  const [automatico, setAutomatico] = useState(() => !semMovimento())
  const titulo = useRef(null)
  const fechar = useRef(onFechar)
  fechar.current = onFechar

  const { titulo: textoTitulo, passos } = CAMINHOS[caminho]
  const { ms } = ROTEIROS[caminho][cena]

  // Enquanto a tela está aberta, a landing por trás não rola, não recebe foco
  // e sai da árvore de acessibilidade. Ao fechar, o foco volta ao botão que
  // abriu a tela.
  useEffect(() => {
    const raiz = document.getElementById('root')
    const html = document.documentElement
    const rolagemAntes = html.style.overflow
    const focoAntes = document.activeElement
    html.style.overflow = 'hidden'
    if (raiz) raiz.inert = true
    const porTecla = e => { if (e.key === 'Escape') fechar.current() }
    window.addEventListener('keydown', porTecla)
    return () => {
      window.removeEventListener('keydown', porTecla)
      html.style.overflow = rolagemAntes
      if (raiz) raiz.inert = false
      focoAntes?.focus?.()
    }
  }, [])

  // O título ganha o foco ao abrir e ao trocar de caminho: é o que o leitor de
  // tela anuncia primeiro.
  useEffect(() => { titulo.current?.focus() }, [caminho])

  function fimDaCena() {
    if (automatico) setCena(c => (c + 1) % passos.length)
    setRodada(r => r + 1)
  }

  function escolherPasso(i) {
    setAutomatico(false)
    setCena(i)
    setRodada(r => r + 1)
  }

  function usarInstaladorDito() {
    baixarInstaladorDito()
    setCaminho('direto')
    setCena(0)
    setRodada(r => r + 1)
    setAutomatico(!semMovimento())
  }

  function baixarDeNovo() {
    if (caminho === 'loja') baixarInstaladorWindows('guia')
    else baixarInstaladorDito()
  }

  return createPortal(
    <div className="iw" role="dialog" aria-modal="true" aria-labelledby="iw-titulo">
      <header className="iw-topo">
        <span className="brand">Dito<span className="dot">.</span></span>
        <button type="button" className="iw-fechar" onClick={onFechar}>
          <IconClose width={16} height={16} /> Fechar
        </button>
      </header>

      <div className="iw-corpo">
        <div className="iw-cabeca">
          <p className="iw-status"><IconCheck width={14} height={14} /> O download começou</p>
          <h1 id="iw-titulo" ref={titulo} tabIndex={-1}>{textoTitulo}</h1>
        </div>

        <ol className={`iw-passos${automatico ? ' auto' : ''}`} style={{ '--dur': `${ms}ms` }}>
          {passos.map((p, i) => (
            <li key={p.titulo} className={i === cena ? 'on' : undefined}>
              <button
                type="button"
                onClick={() => escolherPasso(i)}
                aria-current={i === cena ? 'step' : undefined}
              >
                <span className="iw-num">{i + 1}</span>
                <span className="iw-passo-texto">
                  <strong>{p.titulo}</strong>
                  <span>{p.detalhe}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="iw-extra">
          <p className="iw-denovo">
            O download não começou?{' '}
            <button type="button" onClick={baixarDeNovo}>Baixar de novo</button>
          </p>

          {caminho === 'loja' ? (
            <section className="iw-cartao">
              <h2>Deu erro ou abriu a Microsoft Store?</h2>
              <p>
                Acontece em alguns computadores. Nesse caso, use o instalador do próprio Dito,
                que não depende da loja.
              </p>
              <button type="button" className="btn-ghost iw-cartao-btn" onClick={usarInstaladorDito}>
                <IconDownload width={16} height={16} /> Baixar o instalador do Dito
              </button>
            </section>
          ) : (
            <section className="iw-cartao">
              <h2>Por que o Windows avisa?</h2>
              <p>
                O Windows mostra esse aviso para todo programa novo, que ele ainda não conhece.
                O aviso não quer dizer que o Windows encontrou vírus no Dito.
              </p>
              <ul className="iw-provas">
                <li>
                  <IconShield width={16} height={16} />
                  <span>
                    É o mesmo app que está na Microsoft Store, onde passou pela análise da
                    Microsoft.{' '}
                    <a href={STORE_URL} target="_blank" rel="noopener noreferrer">Ver na Microsoft Store</a>
                  </span>
                </li>
                <li>
                  <IconLock width={16} height={16} />
                  <span>Instala só no seu usuário, sem pedir senha de administrador.</span>
                </li>
                <li>
                  <IconMic width={16} height={16} />
                  <span>Só grava quando você manda.</span>
                </li>
              </ul>
            </section>
          )}

          <button type="button" className="iw-navegador" onClick={onUsarNavegador}>
            {caminho === 'loja'
              ? 'Prefiro usar no navegador'
              : 'O computador não deixou instalar? Use o Dito no navegador'}
            <IconArrowRight width={14} height={14} />
          </button>
        </div>

        <div className="iw-palco" aria-hidden="true">
          <Palco key={`${caminho}-${cena}-${rodada}`} caminho={caminho} cena={cena} onFim={fimDaCena} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Onde fica o centro de um alvo, em em do palco. Em em, e não em pixels, para o
// cursor continuar no lugar se a janela mudar de tamanho no meio da cena.
function medir(mundo, nome) {
  const alvo = mundo?.querySelector(`[data-alvo="${nome}"]`)
  if (!alvo) return null
  const a = alvo.getBoundingClientRect()
  const m = mundo.getBoundingClientRect()
  const em = parseFloat(getComputedStyle(mundo).fontSize) || 16
  return { x: (a.left + a.width / 2 - m.left) / em, y: (a.top + a.height / 2 - m.top) / em }
}

function Palco({ caminho, cena, onFim }) {
  const roteiro = ROTEIROS[caminho][cena]
  const mundo = useRef(null)
  const fim = useRef(onFim)
  fim.current = onFim
  const posicao = useRef({ ...INICIO, alvo: null })
  const [fase, setFase] = useState(0)
  const [cursor, setCursor] = useState({ ...INICIO, visivel: false, apertado: false })
  const [clicado, setClicado] = useState(null)
  const [cliques, setCliques] = useState([])
  const [legenda, setLegenda] = useState('')

  useEffect(() => {
    const timers = []
    const depois = (ms, fn) => timers.push(setTimeout(fn, ms))

    function ir(nome) {
      const pos = medir(mundo.current, nome)
      if (!pos) return
      posicao.current = { ...pos, alvo: nome }
      setCursor(c => ({ ...c, x: pos.x, y: pos.y }))
    }

    if (semMovimento()) {
      const { fase: f, alvo, legenda: texto } = roteiro.parado
      setFase(f)
      setLegenda(texto)
      // Espera o quadro com a fase nova existir para medir o alvo dentro dela.
      if (alvo) depois(60, () => { ir(alvo); setCursor(c => ({ ...c, visivel: true })) })
      return () => timers.forEach(clearTimeout)
    }

    for (const [ms, acao, arg] of roteiro.acoes) {
      depois(ms, () => {
        if (acao === 'mostrar') setCursor(c => ({ ...c, visivel: true }))
        else if (acao === 'esconder') setCursor(c => ({ ...c, visivel: false }))
        else if (acao === 'fase') setFase(arg)
        else if (acao === 'legenda') setLegenda(arg)
        else if (acao === 'ir') ir(arg)
        else if (acao === 'clicar') {
          const { x, y, alvo } = posicao.current
          setCliques(lista => [...lista, { id: ms, x, y }])
          setClicado(alvo)
          setCursor(c => ({ ...c, apertado: true }))
          depois(140, () => setCursor(c => ({ ...c, apertado: false })))
        }
      })
    }
    depois(roteiro.ms, () => fim.current())
    return () => timers.forEach(clearTimeout)
  }, [roteiro])

  return (
    <div className="iw-mundo" ref={mundo} style={{ '--dur': `${roteiro.ms}ms` }}>
      <Cena caminho={caminho} cena={cena} fase={fase} clicado={clicado} />
      {/* A chave recria a legenda a cada frase nova, e é isso que a faz
          aparecer de novo em vez de só trocar de texto. */}
      <p className="iw-legenda"><span key={legenda}>{legenda}</span></p>
      {cliques.map(c => (
        <span key={c.id} className="iw-clique" style={{ left: `${c.x}em`, top: `${c.y}em` }} />
      ))}
      <span
        className={`iw-cursor${cursor.visivel ? ' on' : ''}`}
        style={{ transform: `translate(${cursor.x}em, ${cursor.y}em)` }}
      >
        <svg className={cursor.apertado ? 'apertado' : undefined} viewBox="0 0 16 24">
          <path
            d="M1.5 1.5v17.2l4.3-4.2 3 6.9 3-1.3-3-6.8h6z"
            fill="#fff" stroke="#1b1f1d" strokeWidth="1.3" strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  )
}

function Cena({ caminho, cena, fase, clicado }) {
  // O alvo recém-clicado fica marcado, como um botão de verdade que afunda.
  const tocado = nome => (clicado === nome ? ' tocado' : '')

  if (caminho === 'loja') {
    if (cena === 0) {
      return (
        <Navegador>
          <Baixados>
            <div className={`iw-baix-item${fase >= 1 ? ' ativo' : ''}`}>
              <IconeExe />
              <div>
                <p className="iw-baix-nome">Dito. Installer.exe</p>
                <span className={`iw-baix-link${tocado('abrir')}`} data-alvo="abrir">Abrir arquivo</span>
              </div>
            </div>
          </Baixados>
        </Navegador>
      )
    }
    if (cena === 1) {
      return (
        <>
          <Navegador apagado />
          <InstaladorDaLoja />
        </>
      )
    }
    return (
      <>
        <Navegador apagado />
        <JanelaDito botao={tocado('criar')} />
      </>
    )
  }

  if (cena === 0) {
    return (
      <Navegador>
        <Baixados>
          <div className="iw-baix-item">
            {fase < 3 ? <IconeAlerta /> : <IconeExe />}
            <div>
              {fase < 3 ? (
                <p className="iw-baix-aviso">
                  <b>Dito-setup.exe</b> não é baixado com frequência.
                </p>
              ) : (
                <>
                  <p className="iw-baix-nome">Dito-setup.exe</p>
                  <span className="iw-baix-link">Abrir arquivo</span>
                </>
              )}
            </div>
            {fase < 3 && <span className={`iw-baix-mais${fase === 0 ? ' on' : ''}`}>⋯</span>}
          </div>
          {fase === 0 && (
            <div className="iw-menu iw-entra">
              <span className={tocado('manter')} data-alvo="manter">Manter</span>
              <span>Denunciar como seguro</span>
              <span>Saiba mais</span>
            </div>
          )}
        </Baixados>
        {(fase === 1 || fase === 2) && (
          <div className="iw-jan iw-confirma iw-entra">
            <p className="iw-confirma-titulo">Verifique se você confia em Dito-setup.exe antes de abri-lo</p>
            <p className="iw-confirma-texto">
              O Microsoft Defender SmartScreen não conseguiu verificar se este arquivo é seguro,
              porque ele não é baixado com frequência.
            </p>
            <span className={`iw-confirma-link${tocado('mostrar-mais')}`} data-alvo="mostrar-mais">
              {fase === 2 ? 'Mostrar menos' : 'Mostrar mais'}
            </span>
            {fase === 2 && (
              <span className={`iw-confirma-link sub${tocado('manter-mesmo')}`} data-alvo="manter-mesmo">
                Manter assim mesmo
              </span>
            )}
            <div className="iw-confirma-botoes">
              <span className="primario">Excluir</span>
              <span>Cancelar</span>
            </div>
          </div>
        )}
      </Navegador>
    )
  }

  if (cena === 1) {
    return (
      <>
        <Navegador apagado />
        <SmartScreen aberto={fase >= 1} tocado={tocado} />
      </>
    )
  }

  return (
    <>
      <Navegador apagado />
      {/* Sem a entrada animada: a cena anterior terminou com esta mesma tela
          aberta, e ela piscaria ao recomeçar. */}
      {fase === 0 && <SmartScreen aberto tocado={tocado} parada />}
      {fase === 1 && <InstaladorDoDito tocado={tocado} />}
      {fase === 2 && <JanelaDito />}
    </>
  )
}

// ── As peças do palco ────────────────────────────────────────────────────
// Desenhos, não capturas de tela: a interface do navegador e do Windows muda
// de versão para versão, e o que precisa bater com a tela de verdade são só os
// nomes dos botões.

function Navegador({ apagado = false, children }) {
  return (
    <div className={`iw-jan iw-nav${apagado ? ' apagado' : ''}`}>
      <div className="iw-nav-barra">
        <span className="iw-nav-setas"><i /><i /><i /></span>
        <span className="iw-nav-end"><span>dito.albiecloud.com</span></span>
        <span className="iw-nav-baixar"><IconDownload width="1em" height="1em" /></span>
      </div>
      <div className="iw-nav-pagina">
        <span className="iw-pg-h">Não anote.</span>
        <span className="iw-pg-h em">Esteja presente.</span>
        <span className="iw-pg-linha" style={{ width: '58%' }} />
        <span className="iw-pg-linha" style={{ width: '44%' }} />
        <span className="iw-pg-botao" />
      </div>
      {children}
    </div>
  )
}

function Baixados({ children }) {
  return (
    <div className="iw-baix">
      <p className="iw-baix-titulo">Downloads</p>
      {children}
    </div>
  )
}

function InstaladorDaLoja() {
  return (
    <div className="iw-jan iw-loja iw-entra">
      <div className="iw-loja-barra"><span>Microsoft Store</span><span>✕</span></div>
      <div className="iw-loja-corpo">
        <IconeDito />
        <p className="iw-loja-nome">Dito.</p>
      </div>
      <div className="iw-loja-progresso">
        <p>Instalando…</p>
        <span className="iw-barra"><i /></span>
      </div>
      <div className="iw-loja-rodape"><span className="iw-botao-win">Cancelar</span></div>
    </div>
  )
}

function SmartScreen({ aberto, tocado, parada = false }) {
  return (
    <div className={`iw-jan iw-smart${parada ? '' : ' iw-entra'}`}>
      <p className="iw-smart-titulo">O Windows protegeu o computador</p>
      <p className="iw-smart-texto">
        O Microsoft Defender SmartScreen impediu a inicialização de um aplicativo não
        reconhecido. A execução desse aplicativo pode colocar seu computador em risco.
      </p>
      {aberto ? (
        <p className="iw-smart-info">Aplicativo: Dito-setup.exe<br />Editor: Editor desconhecido</p>
      ) : (
        <span className={`iw-smart-link${tocado('mais-info')}`} data-alvo="mais-info">Mais informações</span>
      )}
      <div className="iw-smart-botoes">
        {aberto && (
          <span className={`iw-smart-botao${tocado('executar')}`} data-alvo="executar">
            Executar assim mesmo
          </span>
        )}
        <span className="iw-smart-botao">Não executar</span>
      </div>
    </div>
  )
}

function InstaladorDoDito({ tocado }) {
  return (
    <div className="iw-jan iw-nsis iw-entra">
      <div className="iw-nsis-barra"><IconeDito mini /><span>Instalação do Dito</span></div>
      <div className="iw-nsis-corpo">
        <span className="iw-nsis-lado" />
        <div className="iw-nsis-texto">
          <p>Bem-vindo ao Assistente de Instalação do Dito</p>
          <span style={{ width: '94%' }} />
          <span style={{ width: '82%' }} />
          <span style={{ width: '88%' }} />
        </div>
      </div>
      <div className="iw-nsis-rodape">
        <span className={`principal${tocado('avancar')}`} data-alvo="avancar">Avançar &gt;</span>
        <span>Cancelar</span>
      </div>
    </div>
  )
}

function JanelaDito({ botao = '' }) {
  return (
    <div className="iw-jan iw-app iw-entra">
      <div className="iw-app-barra">
        <IconeDito mini />
        <span className="iw-app-nome">Dito</span>
        <span className="iw-app-ctrl"><i className="min" /><i className="max" /><i className="fechar">✕</i></span>
      </div>
      <div className="iw-app-corpo">
        <p className="iw-app-marca">Dito<span>.</span></p>
        <p className="iw-app-sub">Transcreve e resume qualquer conversa</p>
        <div className="iw-app-abas"><span className="on">Criar conta</span><span>Acessar</span></div>
        <p className="iw-app-rotulo">E-mail</p>
        <div className="iw-app-campo"><span className="iw-digita">voce@email.com</span><i className="iw-caret" /></div>
        <p className="iw-app-rotulo">Senha</p>
        <div className="iw-app-campo"><span className="iw-senha">••••••••</span></div>
        <span className={`iw-app-botao${botao}`} data-alvo="criar">Criar conta</span>
      </div>
    </div>
  )
}

function IconeDito({ mini = false }) {
  return <span className={`iw-icone-dito${mini ? ' mini' : ''}`}>D<i>.</i></span>
}

function IconeExe() {
  return <span className="iw-icone-exe" />
}

function IconeAlerta() {
  return (
    <svg className="iw-icone-alerta" viewBox="0 0 24 24">
      <path d="M12 3 2.5 20h19z" fill="#f2b705" stroke="#b98900" strokeWidth="1" strokeLinejoin="round" />
      <path d="M12 9.5v5" stroke="#3b2f00" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.1" fill="#3b2f00" />
    </svg>
  )
}
