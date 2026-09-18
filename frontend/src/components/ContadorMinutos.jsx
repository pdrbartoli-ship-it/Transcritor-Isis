// Relógio de minutos da home: um anel laranja que se preenche conforme o mês é
// gasto, e o número ao lado em tom apagado. É informação ambiente, não alerta —
// o aviso de saldo baixo continua sendo o do Layout.
const RAIO = 8
const CIRCUNFERENCIA = 2 * Math.PI * RAIO

//
// O convidado não tem minutos por mês: tem uma gravação só (até 90 min), e o
// backend a dá por gasta assim que qualquer minuto foi usado. Contar minutos
// para ele prometia uma franquia que não existe.
export default function ContadorMinutos({ usados, limite, convidado = false }) {
  const gravacoes = usados > 0 ? 1 : 0
  const fracao = convidado ? gravacoes : Math.min(1, Math.max(0, usados / limite))
  const usadosInteiros = Math.min(limite, Math.round(usados))

  return (
    <div
      className="contador-minutos"
      title={convidado ? 'Sem conta, o Dito faz uma gravação' : 'Minutos do seu plano neste mês'}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r={RAIO} className="contador-trilho" />
        {/* Sem consumo nenhum, a ponta arredondada desenharia um pontinho
            laranja como se algo já tivesse sido gasto. */}
        {fracao > 0 && (
          <circle
            cx="10" cy="10" r={RAIO}
            className="contador-arco"
            strokeDasharray={`${fracao * CIRCUNFERENCIA} ${CIRCUNFERENCIA}`}
            transform="rotate(-90 10 10)"
          />
        )}
      </svg>
      <span>{convidado ? `${gravacoes}/1 gravação` : `${usadosInteiros}/${limite} minutos usados`}</span>
    </div>
  )
}
