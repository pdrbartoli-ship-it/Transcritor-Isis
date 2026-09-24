import { IconClose, IconGift, IconSelo } from './Icons'

// O aviso de que um convite rendeu algo. Um cartão pequeno no canto, que não
// cobre o que a pessoa está fazendo e fica até ela fechar: some sozinho, ele
// podia passar sem ser visto, e a notícia é justamente o que se quer que ela
// veja. Um por vez, na ordem do que mais importa.
export function avisoDoConvite(convite, seloNovo) {
  const novidade = convite?.novidade
  const amigos = novidade?.amigos || 0
  const quem = amigos > 1
    ? `${amigos} amigos começaram a usar o Dito pelo seu convite.`
    : 'Um amigo começou a usar o Dito pelo seu convite.'

  if (novidade?.minutos > 0) {
    return {
      tipo: 'minutos',
      titulo: `Você ganhou ${novidade.minutos} minutos e ${novidade.perguntas} perguntas`,
      texto: quem,
    }
  }
  if (seloNovo) {
    return {
      tipo: 'selo',
      titulo: 'Você ganhou o selo de apoiador',
      texto: 'Você usa as novidades do Dito antes de todo mundo. Obrigado.',
    }
  }
  if (novidade) {
    const faltam = Math.max(0, convite.regras.apoiador - convite.validos)
    return {
      tipo: 'progresso',
      titulo: amigos > 1 ? `${amigos} amigos entraram pelo seu convite` : 'Um amigo entrou pelo seu convite',
      texto: convite.apoiador || faltam === 0
        ? 'Obrigado por levar o Dito adiante.'
        : faltam === 1 ? 'Falta 1 para o selo de apoiador.' : `Faltam ${faltam} para o selo de apoiador.`,
    }
  }
  return null
}

export default function PremioAviso({ aviso, onFechar, onAbrir }) {
  if (!aviso) return null
  const Icone = aviso.tipo === 'selo' ? IconSelo : IconGift
  return (
    <div className="premio-aviso" role="status">
      <span className="premio-aviso-icone"><Icone width={18} height={18} /></span>
      <div className="premio-aviso-texto">
        <strong>{aviso.titulo}</strong>
        <span>{aviso.texto}</span>
        <button type="button" className="premio-aviso-link" onClick={onAbrir}>Convidar mais</button>
      </div>
      <button type="button" className="btn-icon premio-aviso-fechar" onClick={onFechar} aria-label="Fechar">
        <IconClose width={14} height={14} />
      </button>
    </div>
  )
}
