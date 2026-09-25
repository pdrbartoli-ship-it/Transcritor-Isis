// Relógio de minutos da home: um anel que se preenche conforme o mês é gasto,
// e o número ao lado em tom apagado. É informação ambiente, não alerta — o
// aviso de saldo baixo continua sendo o do Layout.
const RAIO = 8
const CIRCUNFERENCIA = 2 * Math.PI * RAIO

//
// O convidado não tem minutos por mês: tem uma gravação só (até 90 min), e o
// backend a dá por gasta assim que qualquer minuto foi usado. Contar minutos
// para ele prometia uma franquia que não existe.
//
// `limite` nulo é o plano sem limite: sem anel para encher, só o que já foi
// usado no mês. `extra` são os minutos ganhos com convites, já somados ao
// limite; o "+25" ao lado é o que diz à pessoa que o limite mudou e por quê.
// `compacto` é a versão do topo do celular: o anel e o número, sem a frase.
// Ao lado do botão da lateral não cabe "minutos usados", e o anel já diz o
// que o número é.
export default function ContadorMinutos({ usados, limite, extra = 0, convidado = false, compacto = false }) {
  if (!convidado && limite == null) {
    return (
      <div className={`contador-minutos ${compacto ? 'compacto' : ''}`} title="Seu plano não tem limite de minutos">
        <IconInfinito />
        {!compacto && <span>Minutos ilimitados</span>}
      </div>
    )
  }

  const gravacoes = usados > 0 ? 1 : 0
  const fracao = convidado ? gravacoes : Math.min(1, Math.max(0, usados / limite))
  const usadosInteiros = Math.min(limite, Math.round(usados))

  return (
    <div
      className={`contador-minutos ${compacto ? 'compacto' : ''}`}
      title={convidado
        ? 'Sem conta, o Dito faz uma gravação'
        : extra > 0
          ? `Minutos do seu plano neste mês, com ${extra} ganhos por convites`
          : 'Minutos do seu plano neste mês'}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r={RAIO} className="contador-trilho" />
        {/* Sem consumo nenhum, a ponta arredondada desenharia um pontinho
            como se algo já tivesse sido gasto. */}
        {fracao > 0 && (
          <circle
            cx="10" cy="10" r={RAIO}
            className="contador-arco"
            strokeDasharray={`${fracao * CIRCUNFERENCIA} ${CIRCUNFERENCIA}`}
            transform="rotate(-90 10 10)"
          />
        )}
      </svg>
      <span>
        {convidado
          ? `${gravacoes}/1${compacto ? '' : ' gravação'}`
          : `${usadosInteiros}/${limite}${compacto ? ' min' : ' minutos usados'}`}
      </span>
      {!convidado && extra > 0 && !compacto && <span className="contador-bonus">+{extra}</span>}
    </div>
  )
}

function IconInfinito() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="contador-infinito">
      <path d="M12 12c-2-2.7-3.6-4-5.3-4a4 4 0 0 0 0 8c1.7 0 3.3-1.3 5.3-4zm0 0c2 2.7 3.6 4 5.3 4a4 4 0 0 0 0-8c-1.7 0-3.3 1.3-5.3 4z" />
    </svg>
  )
}
