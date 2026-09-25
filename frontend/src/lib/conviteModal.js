// Pub/sub minúsculo para abrir o "Convidar amigos" de fora do Layout, no mesmo
// molde do planoModal. Existe pelo mesmo motivo: o aviso de reunião vive acima
// das rotas (a detecção não pode depender de qual tela está aberta), e o modal
// do convite vive dentro do Layout, que é remontado a cada troca de ramo do
// roteador.
let ouvintes = []

export function pedirConvite() {
  ouvintes.forEach(fn => fn())
}

export function aoPedirConvite(fn) {
  ouvintes.push(fn)
  return () => { ouvintes = ouvintes.filter(o => o !== fn) }
}
