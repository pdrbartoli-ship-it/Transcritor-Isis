import { useParams, Navigate, useNavigate, useOutletContext } from 'react-router-dom'
import { useTranscricoes } from '../contexts/TranscricoesContext'
import { ProcessingBox } from '../components/capture/CaptureShared'

// Uma transcrição em andamento, aberta pela lateral. É a única tela em que a
// fila leva a pessoa sozinha para a conversa quando ela fica pronta: quem
// abriu esta tela está esperando por ela. Em qualquer outra, o aviso é
// discreto e ninguém é arrancado do que estava fazendo.
export default function Transcrevendo() {
  const { id } = useParams()
  const { itens, tentarDeNovo, dispensar } = useTranscricoes()
  const { abrirPlano } = useOutletContext() || {}
  const navigate = useNavigate()
  const item = itens.find(i => i.id === id)

  // Já terminou (a fila levou para a conversa) ou nunca existiu aqui.
  if (!item) return <Navigate to="/" replace />

  if (item.estado === 'erro') {
    const podeRetentar = (item.arquivo || item.url) && !item.semRetentar && item.erroStatus !== 402
    return (
      <div className="transcrevendo">
        <h1 className="transcrevendo-titulo">Esta transcrição não deu certo</h1>
        <p className="transcrevendo-rotulo">{item.rotulo}</p>
        <div className="alert alert-error">{item.erro}</div>
        <div className="transcrevendo-acoes">
          {podeRetentar && (
            <button className="btn-primary" onClick={() => tentarDeNovo(item.id)}>Tentar de novo</button>
          )}
          {item.erroStatus === 402 && abrirPlano && (
            <button className="btn-primary" onClick={abrirPlano}>Ver planos</button>
          )}
          <button className="btn-link" onClick={() => { dispensar(item.id); navigate('/') }}>Dispensar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="transcrevendo">
      <ProcessingBox titulo={item.estado === 'fila' ? 'Na fila' : undefined} />
      <p className="transcrevendo-rotulo">{item.rotulo}</p>
      <p className="transcrevendo-nota">
        {item.estado === 'fila'
          ? 'Começa assim que a anterior terminar de enviar.'
          : item.jobId
            ? 'Pode fechar o Dito: a transcrição continua e aparece aqui quando ficar pronta.'
            : 'Pode continuar usando o Dito. Mantenha o app aberto até terminar.'}
      </p>
    </div>
  )
}
