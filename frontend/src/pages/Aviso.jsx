import { useState, useEffect, useRef } from 'react'
import { IconMic, IconClock, IconClose } from '../components/Icons'
import { AVISO_W, ouvirAviso, responderAviso } from '../lib/avisoWindow'
import { getTheme } from '../lib/prefs'
import { montarConvite, montarAvisoSaldo, montarParouPorSaldo } from '../lib/reuniao'

// O que roda DENTRO da janelinha de aviso do app nativo. Como a janelinha de
// gravação, ela é burra: não grava, não lê saldo e não fala com o Supabase.
// Recebe título, corpo e botões prontos e devolve o id do que foi clicado. Por
// isso fica fora das rotas protegidas — não há nada aqui que dependa de sessão.
export default function Aviso() {
  // Sem Windows não há como ver esta janela. Com os parâmetros na URL ela abre
  // como página normal no navegador, e cada variante dá para conferir a olho e
  // por print, nos dois temas. Fora dessa pré-visualização o estado só vem da
  // janela principal.
  const previa = useRef(estadoDaUrl()).current
  const [estado, setEstado] = useState(previa)
  const respondidoRef = useRef(false)

  // A janela nasce com o tema salvo; sem isto ela abriria clara em cima de um
  // app escuro.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', getTheme())
    document.body.classList.add('mini-body')
  }, [])

  useEffect(() => {
    if (previa) return
    let unlisten = null
    let disposed = false
    ;(async () => {
      // O pedido de `sync` só sai depois de o ouvinte estar de pé. Antes os
      // dois corriam juntos, e quando a resposta da principal chegava primeiro
      // a janela ficava em branco para sempre: sem texto, sem botão e sem o
      // prazo que a faz sumir sozinha.
      const un = await ouvirAviso(payload => {
        respondidoRef.current = false
        setEstado(payload)
      })
      if (disposed) { un?.(); return }
      unlisten = un
      responderAviso('sync')
    })()
    return () => { disposed = true; unlisten?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rede lenta ou principal ocupada: o texto pode não vir no primeiro pedido.
  // Pede de novo algumas vezes e, se nada chegar, a janela se fecha sozinha.
  // Um retângulo vazio na frente da tela, sem jeito de tirar, é o pior caso.
  const temEstado = !!estado
  useEffect(() => {
    if (previa || temEstado) return
    let tentativas = 0
    const id = setInterval(() => {
      tentativas += 1
      if (tentativas > VAZIA_TENTATIVAS) {
        clearInterval(id)
        fecharEsta()
        return
      }
      responderAviso('sync')
    }, VAZIA_INTERVALO_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temEstado])

  // A janela nasce com uma altura chutada por quem a abriu (ela não sabe o
  // texto ainda). Aqui o texto já está na tela, então dá para medir e ajustar:
  // o convite curto sobrava fundo branco, e o de saldo curto, com três linhas,
  // ficava apertado contra os botões.
  useEffect(() => {
    if (previa || !estado) return
    let cancelado = false
    ;(async () => {
      try {
        const cartao = document.querySelector('.aviso-card')
        if (!cartao) return
        // O cartão ocupa 100% da janela; para medir o tamanho natural do
        // conteúdo é preciso soltá-lo por um instante.
        cartao.style.height = 'auto'
        const altura = Math.ceil(cartao.getBoundingClientRect().height)
        cartao.style.height = ''
        if (cancelado) return
        const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/dpi'),
        ])
        await getCurrentWindow().setSize(new LogicalSize(AVISO_W, altura))
      } catch {
        // Fora do app nativo, ou sem permissão: fica com a altura de abertura.
      }
    })()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  // Sem resposta, some sozinha. Uma janelinha esquecida na frente da tela de
  // quem está em reunião é pior do que não ter aparecido.
  useEffect(() => {
    // Na pré-visualização a janelinha tem de ficar na tela para ser olhada.
    if (previa || !estado?.timeoutS) return
    const id = setTimeout(() => responder('expirou'), estado.timeoutS * 1000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  function responder(id) {
    if (previa) return
    // Dois cliques rápidos, ou o clique junto com o tempo esgotando, mandariam
    // duas respostas para a mesma pergunta.
    if (respondidoRef.current) return
    respondidoRef.current = true
    responderAviso(id)
  }

  // O × não depende da principal: avisa que foi fechado e fecha a si mesma.
  // Se a principal não estiver ouvindo, a janela não pode ficar presa na tela.
  function dispensar() {
    if (previa) return
    responder('fechar')
    fecharEsta()
  }

  const botaoFechar = (
    <button className="aviso-fechar" onClick={dispensar} aria-label="Fechar" title="Fechar">
      <IconClose width={13} height={13} />
    </button>
  )

  if (!estado) return <div className="aviso-card">{botaoFechar}</div>

  // Duas famílias de aviso, dois ícones: a pergunta sobre gravar (microfone) e
  // o recado sobre o saldo do plano (relógio). É a única coisa que a janelinha
  // decide sozinha, e só porque é desenho — o texto continua vindo pronto.
  const sobreSaldo = ['aviso-5min', 'aviso-1min', 'parou-saldo'].includes(estado.variante)

  return (
    <div className="aviso-card" data-tauri-drag-region>
      {botaoFechar}
      <div className="aviso-linha" data-tauri-drag-region>
        <span className="aviso-selo" aria-hidden="true">
          {sobreSaldo ? <IconClock width={15} height={15} /> : <IconMic width={15} height={15} />}
        </span>
        <div className="aviso-texto" data-tauri-drag-region>
          <p className="aviso-titulo" data-tauri-drag-region>{estado.titulo}</p>
          <p className="aviso-corpo" data-tauri-drag-region>{estado.corpo}</p>
        </div>
      </div>

      {estado.acoes?.length > 0 && (
        <div className="aviso-acoes">
          {estado.acoes.map(acao => (
            <button
              key={acao.id}
              className={acao.primaria ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => responder(acao.id)}
            >
              {acao.id === 'gravar' && <span className="aviso-ponto" aria-hidden="true" />}
              {acao.rotulo}
            </button>
          ))}
        </div>
      )}

      {/* A janelinha some sozinha, e até aqui isso não aparecia em lugar
          nenhum: a pessoa via dois botões e não sabia que existia um relógio
          correndo. O fio embaixo escoa no tempo exato do `timeoutS`. */}
      {estado.timeoutS ? (
        <span
          key={`${estado.variante}-${estado.timeoutS}`}
          className="aviso-tempo"
          style={{ animationDuration: `${estado.timeoutS}s` }}
        />
      ) : null}
    </div>
  )
}

// Janela vazia: quantas vezes pede o texto de novo, e de quanto em quanto.
const VAZIA_TENTATIVAS = 4
const VAZIA_INTERVALO_MS = 1500

async function fecharEsta() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch {
    // Fora do app nativo não há janela para fechar.
  }
}

// #/aviso?variante=convite-saldo-curto&app=teams&restante=42
function estadoDaUrl() {
  try {
    const query = window.location.hash.split('?')[1]
    if (!query) return null
    const p = new URLSearchParams(query)
    const variante = p.get('variante')
    if (!variante) return null
    const app = p.get('app') || 'zoom'
    const restanteMin = Number(p.get('restante') ?? 42)
    if (variante === 'aviso-5min') return montarAvisoSaldo(300)
    if (variante === 'aviso-1min') return montarAvisoSaldo(60)
    if (variante === 'parou-saldo') return montarParouPorSaldo()
    return montarConvite({ variante, app, restanteMin })
  } catch {
    return null
  }
}
