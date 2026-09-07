// As duas profundidades de análise que o app oferece, e a regra que escolhe
// qual delas vem pré-selecionada. Fica fora dos componentes porque a mesma
// decisão é tomada em três lugares — gravação, arquivo e link — e ainda uma
// quarta vez no compartilhamento de outro app, que processa sozinho.

export const MODO_SIMPLES = 'simples'
export const MODO_COMPLETA = 'completa'

// Rótulos e explicação de cada modo. A explicação não é enfeite: "simples" e
// "completa" não dizem, sozinhas, que uma entrega tópicos e tarefas e a outra
// um parágrafo — e essa é justamente a escolha que o usuário está fazendo.
export const MODOS = {
  [MODO_SIMPLES]: {
    label: 'Transcrição simples',
    hint: 'Um resumo curto e o chat aberto para perguntar o resto.',
  },
  [MODO_COMPLETA]: {
    label: 'Transcrição completa',
    hint: '4 tópicos, lista de próximos passos e resumo minuto a minuto.',
  },
}

// A partir de quanto tempo uma gravação deixa de caber num parágrafo. Quinze
// minutos é onde uma conversa passa a ter assuntos separados, coisas
// combinadas e uma ordem que vale a pena reconstruir — abaixo disso, o resumo
// completo entrega estrutura para um conteúdo que não tem estrutura.
export const LONGA_S = 15 * 60

// Qual modo vem selecionado, dado o que está para ser enviado.
//
// A duração manda em tudo que tem duração conhecida: uma reunião de uma hora
// pede a análise completa, tenha ela vindo do gravador ou do seletor de
// arquivos. Só quando não dá para ler a duração é que a origem decide — e aí
// um áudio (o do WhatsApp, o caso comum) vale como conteúdo curto, enquanto um
// link do YouTube vale como conteúdo longo.
export function modoRecomendado({ origem, durationSec = null }) {
  if (durationSec) return durationSec >= LONGA_S ? MODO_COMPLETA : MODO_SIMPLES
  return origem === 'url' ? MODO_COMPLETA : MODO_SIMPLES
}
