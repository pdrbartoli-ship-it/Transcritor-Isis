// Detecção de reunião: constantes e textos, num arquivo só.
//
// O detector em si mora no Rust (src-tauri/src/meeting): ele percebe que um
// Zoom, Teams ou Meet abriu o microfone e emite `meeting-started`. Daqui para
// frente é decisão de produto — se vale interromper a pessoa, com que texto, e
// por quanto tempo a janelinha fica na tela.
//
// As constantes ficam juntas porque são o que o Pedro vai querer ajustar
// depois de usar: nenhuma delas está enterrada no meio de um componente.

// Sem resposta, a janelinha some sozinha e vale como "Agora não". Interromper
// é aceitável; ficar na frente do que a pessoa está fazendo, não.
export const PROMPT_TIMEOUT_S = 30

// Abaixo disto o saldo não dá para uma reunião, e sugerir gravar seria
// prometer o que não cabe.
export const MIN_PARA_SUGERIR_MIN = 5

// Acima disto a linha "Restam X min" só faria a pessoa pensar em cota quando
// não precisa.
export const MOSTRAR_SALDO_ATE_MIN = 90

// A gravação para antes do fim do saldo: o backend mede a duração do arquivo,
// e arredondamento para cima com o saldo no talo devolveria 402 depois do
// upload — quando o áudio já foi gravado e a pessoa já esperou.
export const MARGEM_PARADA_S = 30

// Vezes por dia que o aviso de "sem saldo" pode aparecer. É um bom momento de
// venda, mas repetir a cada reunião vira barulho.
export const SEM_SALDO_POR_DIA = 1

// Quanto tempo os avisos sem botão (saldo acabando) ficam na tela.
export const AVISO_PASSAGEM_S = 10

// O nome que aparece no título. Vem do evento do Rust, que só classifica em
// três; qualquer outra coisa não vira reunião.
export const NOME_APP = { zoom: 'Zoom', teams: 'Teams', meet: 'Google Meet' }

export function nomeDoApp(app) {
  return NOME_APP[app] || 'reunião'
}

const ACOES_CONVITE = [
  { id: 'nao', rotulo: 'Agora não' },
  { id: 'gravar', rotulo: 'Gravar', primaria: true },
]

// Sem saldo, o convite premiado vem na frente: ele devolve minutos na hora e
// de graça, e quem está entrando numa reunião não vai parar para assinar.
// Cabem dois botões na janelinha, então "Fechar" sai: o × do canto e os 30 s
// de prazo já a fazem sumir.
const ACOES_SEM_SALDO = [
  { id: 'planos', rotulo: 'Ver planos' },
  { id: 'convite', rotulo: 'Convidar amigos', primaria: true },
]

// Qual das três variantes de convite cabe para este saldo. `restanteMin` nulo
// (saldo ilegível) não vira variante nenhuma: quem chama decide não sugerir.
export function variantePorSaldo(restanteMin) {
  if (restanteMin == null) return null
  if (restanteMin < MIN_PARA_SUGERIR_MIN) return 'sem-saldo'
  if (restanteMin <= MOSTRAR_SALDO_ATE_MIN) return 'convite-saldo-curto'
  return 'convite'
}

// Monta o que a janelinha desenha. Ela é burra de propósito: recebe título,
// corpo e botões prontos, e devolve o id do que foi clicado.
export function montarConvite({ variante, app, restanteMin }) {
  const titulo = `Reunião no ${nomeDoApp(app)}`
  const minutos = Math.floor(restanteMin ?? 0)

  if (variante === 'sem-saldo') {
    return {
      variante,
      titulo,
      corpo: minutos > 0
        ? `Restam só ${minutos} min no seu plano, pouco para uma reunião. Cada amigo convidado vale mais minutos.`
        : 'Seus minutos deste mês acabaram. Cada amigo convidado vale mais minutos.',
      acoes: ACOES_SEM_SALDO,
      timeoutS: PROMPT_TIMEOUT_S,
    }
  }

  return {
    variante,
    titulo,
    corpo: variante === 'convite-saldo-curto'
      ? `Quer gravar com o Dito? Restam ${minutos} min do seu plano. A gravação para antes de acabar.`
      : 'Quer gravar com o Dito?',
    acoes: ACOES_CONVITE,
    timeoutS: PROMPT_TIMEOUT_S,
  }
}

// Aviso de passagem durante a gravação: sem botão, some sozinho. Não é uma
// pergunta, é uma informação — quem quiser parar antes tem a janelinha de
// gravação do lado.
export function montarAvisoSaldo(restantesS) {
  const minutos = Math.max(1, Math.round(restantesS / 60))
  return {
    variante: restantesS <= 60 ? 'aviso-1min' : 'aviso-5min',
    titulo: 'Saldo acabando',
    corpo: minutos === 1
      ? 'Resta 1 minuto do seu plano.'
      : `Restam ${minutos} minutos do seu plano. A gravação para quando eles acabarem.`,
    acoes: [],
    timeoutS: AVISO_PASSAGEM_S,
  }
}

export function montarParouPorSaldo() {
  return {
    variante: 'parou-saldo',
    titulo: 'Gravação parada',
    corpo: 'Seus minutos do mês estavam acabando. O áudio foi guardado e está pronto para transcrever.',
    acoes: [{ id: 'abrir', rotulo: 'Abrir o Dito', primaria: true }],
    timeoutS: null,
  }
}

// Teto da gravação, em segundos, a partir do saldo restante. Sem saldo legível
// devolve null, que no Rust vale como "sem teto": falha de leitura não pode
// virar gravação que não acontece.
export function tetoPorSaldo(restanteMin) {
  // Plano sem limite (Infinity) grava sem teto, como o saldo ilegível.
  if (restanteMin == null || !Number.isFinite(restanteMin)) return null
  const segundos = Math.floor(restanteMin * 60) - MARGEM_PARADA_S
  return segundos > 0 ? segundos : 1
}
