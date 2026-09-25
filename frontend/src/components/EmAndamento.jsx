import { useNavigate } from 'react-router-dom'
import { useTranscricoes, estadoDoItem } from '../contexts/TranscricoesContext'
import { IconMic, IconWhatsapp, IconYoutube } from './Icons'

// As transcrições que ainda não viraram conversa, em dois lugares: no topo da
// lista da lateral, e embaixo do painel de captura da home (no celular a
// lateral fica escondida, e quem acabou de tocar em "Transcrever" precisa ver
// que o pedido foi aceito sem abrir menu nenhum).
const ICONE = { record: IconMic, file: IconWhatsapp, url: IconYoutube }

function Marca({ item }) {
  if (item.estado === 'erro') return <span className="andamento-marca erro" aria-hidden="true">!</span>
  if (item.estado === 'fila') {
    const Icone = ICONE[item.origem] || IconWhatsapp
    return <Icone className="kind-icon" width={14} height={14} />
  }
  return <span className="spinner spinner-sm andamento-spinner" aria-hidden="true" />
}

// Linhas da lateral, com a mesma casca das conversas logo abaixo.
export function LinhasEmAndamento({ ativa, onAbrir }) {
  const { itens } = useTranscricoes()
  if (!itens.length) return null
  return (
    <div className="andamento-grupo">
      <div className="sidebar-group-label">Em andamento</div>
      {itens.map(item => (
        <button
          key={item.id}
          className={`sidebar-item andamento ${item.estado} ${ativa === item.id ? 'active' : ''}`}
          onClick={() => onAbrir(item.id)}
          title={item.rotulo}
        >
          <Marca item={item} />
          <span className="sidebar-item-text">{item.rotulo}</span>
          <span className="andamento-estado">{estadoDoItem(item)}</span>
        </button>
      ))}
    </div>
  )
}

// A lista embaixo da captura, na home.
export function PainelEmAndamento() {
  const { itens, tentarDeNovo, dispensar } = useTranscricoes()
  const navigate = useNavigate()
  if (!itens.length) return null
  return (
    <section className="andamento-painel" aria-label="Transcrições em andamento">
      {itens.map(item => {
        const podeRetentar = item.estado === 'erro' && (item.arquivo || item.url) && !item.semRetentar && item.erroStatus !== 402
        return (
          <div key={item.id} className={`andamento-cartao ${item.estado}`}>
            <button className="andamento-abrir" onClick={() => navigate(`/transcrevendo/${item.id}`)}>
              <Marca item={item} />
              <span className="andamento-texto">
                <span className="andamento-rotulo">{item.rotulo}</span>
                <span className="andamento-sub">
                  {item.estado === 'erro' ? item.erro : estadoDoItem(item)}
                </span>
              </span>
            </button>
            {item.estado === 'erro' && (
              <div className="andamento-acoes">
                {podeRetentar && (
                  <button className="btn-link" onClick={() => tentarDeNovo(item.id)}>Tentar de novo</button>
                )}
                <button className="btn-link discreto" onClick={() => dispensar(item.id)}>Dispensar</button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
