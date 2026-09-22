// Pub/sub minúsculo para abrir o "Meu plano" de fora do Layout, no mesmo molde
// do toast. Existe porque o convite de reunião vive acima das rotas (a
// gravação não pode depender de qual tela está aberta), e o modal de planos
// vive dentro do Layout, que é remontado a cada troca de ramo do roteador.
let ouvintes = []

export function pedirPlano(plano = null) {
  ouvintes.forEach(fn => fn(plano))
}

export function aoPedirPlano(fn) {
  ouvintes.push(fn)
  return () => { ouvintes = ouvintes.filter(o => o !== fn) }
}
