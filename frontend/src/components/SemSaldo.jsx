import { IconGift } from './Icons'
import { track } from '../lib/analytics'

// O que aparece quando o saldo do mês acaba, em qualquer lugar do app: os
// minutos na home e no painel de captura, as perguntas no Perguntar e no chat
// de uma conversa, e o aviso de reunião sem saldo.
//
// Antes cada um desses lugares oferecia só "Ver planos". Quem não ia assinar
// naquele momento ficava sem saída nenhuma, e o convite premiado (que dá
// minutos de graça) só existia num botão da barra lateral que ninguém procura
// quando está no meio de outra coisa. Aqui os dois caminhos ficam lado a lado,
// com o convite na frente: ele é o que resolve na hora e sem custo.
//
// Um componente só, e não a mesma composição repetida em cinco telas, porque
// cada cópia acabava com um texto e uma ordem de botões diferentes.
//
// `onConvidar` nulo é quem não tem link de convite (a sessão sem conta):
// nesses casos sobra o que já havia. `onVerPlanos` nulo é onde o app não vende
// (iPhone). Com os dois nulos, fica só a frase.
export default function SemSaldo({
  texto, onConvidar, onVerPlanos, premio, origem, compacto = false,
}) {
  function convidar() {
    track('convite_aberto', { origem })
    onConvidar()
  }

  return (
    <div className={`sem-saldo ${compacto ? 'sem-saldo-compacto' : ''}`}>
      <p className="sem-saldo-texto">{texto}</p>
      <div className="sem-saldo-acoes">
        {onConvidar && (
          <button type="button" className="btn-primary btn-sm" onClick={convidar}>
            <IconGift width={15} height={15} /> Convidar amigos
          </button>
        )}
        {onVerPlanos && (
          <button
            type="button"
            className={onConvidar ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
            onClick={onVerPlanos}
          >
            Ver planos
          </button>
        )}
      </div>
      {/* Os números vêm do servidor (as mesmas regras que ele aplica), então a
          frase nunca promete o que a régua não dá. Sem eles, some. */}
      {onConvidar && premio?.minutos > 0 && (
        <p className="sem-saldo-premio">
          Cada amigo que entra pelo seu link vale +{premio.minutos} min
          {premio.perguntas > 0 && <> e +{premio.perguntas} perguntas</>}.
        </p>
      )}
    </div>
  )
}
