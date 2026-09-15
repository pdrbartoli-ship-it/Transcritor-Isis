// O mesmo texto na barra das abas e no campo do chat: são o mesmo número, e
// duas formas de dizê-lo leriam como dois saldos diferentes.
export function textoPerguntasRestantes(restantes) {
  return restantes === 1
    ? 'Resta 1 pergunta nesta transcrição'
    : `Restam ${restantes} perguntas nesta transcrição`
}
