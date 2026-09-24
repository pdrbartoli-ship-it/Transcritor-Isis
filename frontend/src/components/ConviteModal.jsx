import { useEffect, useRef, useState } from 'react'
import { IconClose, IconSelo } from './Icons'
import { TEXTO_CONVITE, linkCurto } from '../lib/convite'

// "Convidar amigos": o que se ganha, o link e o botão de mandar. Lido de cima
// para baixo em poucos segundos, sem parágrafo nenhum.
//
// O que se ganha depende do plano de quem convida, e quem diz é o servidor
// (`convite.regras`): nos planos com limite, minutos e perguntas por amigo; no
// Avançado, que já não tem limite, o caminho até o selo de apoiador.
export default function ConviteModal({ convite, onAtualizar, onClose }) {
  const [carregando, setCarregando] = useState(!convite)
  const [copiado, setCopiado] = useState(false)
  const linkRef = useRef(null)

  // Os números da tela são os de agora, não os da última vez que o app olhou.
  useEffect(() => {
    let ativo = true
    Promise.resolve(onAtualizar?.()).finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [onAtualizar])

  // A folha de compartilhar do sistema (Android, iPhone, Windows) já traz o
  // WhatsApp e o resto. Onde ela não existe, copiar o link basta.
  const podeCompartilhar = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copiar() {
    try {
      await navigator.clipboard.writeText(convite.link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sem acesso à área de transferência: o link fica selecionado, pronto
      // para o Ctrl+C.
      linkRef.current?.select()
    }
  }

  async function compartilhar() {
    try {
      await navigator.share({ title: 'Dito', text: TEXTO_CONVITE, url: convite.link })
    } catch (err) {
      if (err?.name !== 'AbortError') copiar()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal convite-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Convidar amigos</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>

        {!convite ? (
          carregando
            ? <div className="convite-carregando"><span className="spinner" /></div>
            : <div className="alert alert-error">Não foi possível carregar seu link agora. Tente de novo em instantes.</div>
        ) : (
          <>
            <Premio convite={convite} />

            <p className="convite-regra">
              Vale quando o amigo cria a conta pelo seu link e faz {convite.regras.capturas} transcrições.
            </p>

            <div className="convite-link">
              <input
                ref={linkRef}
                readOnly
                value={linkCurto(convite.link)}
                onFocus={e => e.target.select()}
                aria-label="Seu link de convite"
              />
              {/* Sem a folha de compartilhar, copiar é o gesto principal. */}
              <button type="button" className={podeCompartilhar ? 'btn-ghost' : 'btn-primary'} onClick={copiar}>
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            {podeCompartilhar && (
              <button type="button" className="btn-primary convite-enviar" onClick={compartilhar}>
                Compartilhar link
              </button>
            )}

            <Contagem convite={convite} />
          </>
        )}
      </div>
    </div>
  )
}

function Premio({ convite }) {
  const { regras, validos } = convite

  if (convite.apoiador) {
    return (
      <div className="convite-topo">
        <span className="convite-selo"><IconSelo width={26} height={26} /></span>
        <p className="convite-titulo">Você tem o selo de apoiador</p>
        <p className="convite-sub">Você usa as novidades do Dito antes de todo mundo.</p>
      </div>
    )
  }

  if (convite.ilimitado) {
    return (
      <div className="convite-topo">
        <div className="convite-passos" aria-label={`${Math.min(validos, regras.apoiador)} de ${regras.apoiador} amigos`}>
          {Array.from({ length: regras.apoiador }, (_, i) => (
            <span key={i} className={i < validos ? 'on' : ''} />
          ))}
        </div>
        <p className="convite-titulo">{regras.apoiador} amigos e você ganha o selo de apoiador</p>
        <p className="convite-sub">Com o selo, você usa as novidades do Dito antes de todo mundo.</p>
      </div>
    )
  }

  return (
    <div className="convite-topo">
      <div className="convite-ganhos">
        <div><strong>+{regras.minutos}</strong><span>minutos</span></div>
        <div><strong>+{regras.perguntas}</strong><span>perguntas</span></div>
      </div>
      <p className="convite-sub">para você, a cada amigo</p>
    </div>
  )
}

// Uma linha só, e só quando há o que contar: um "0 amigos" logo na primeira
// abertura soaria como cobrança.
function Contagem({ convite }) {
  const { validos, pendentes, regras } = convite
  const partes = []
  if (convite.ilimitado && !convite.apoiador) {
    if (validos > 0) partes.push(`${Math.min(validos, regras.apoiador)} de ${regras.apoiador} amigos`)
  } else if (validos > 0) {
    partes.push(validos === 1 ? '1 amigo já usa o Dito' : `${validos} amigos já usam o Dito`)
  }
  if (pendentes > 0) partes.push(pendentes === 1 ? '1 a caminho' : `${pendentes} a caminho`)
  if (!partes.length) return null
  return <p className="convite-contagem">{partes.join(' · ')}</p>
}
