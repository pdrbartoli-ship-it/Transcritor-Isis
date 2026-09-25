// No celular, as opções de uma conversa (baixar, sinalizar, renomear, apagar)
// abrem pelo título no topo da tela, como no Claude. Só que o título mora no
// cabeçalho da casca do app e as opções moram no cabeçalho da conversa, que é
// quem tem a conversa em mãos. Este recado liga os dois sem que um precise
// conhecer o outro, do mesmo jeito que o toast.
let ouvinte = null

export function aoPedirAcoesDaConversa(fn) {
  ouvinte = fn
  return () => { if (ouvinte === fn) ouvinte = null }
}

export function pedirAcoesDaConversa() {
  ouvinte?.()
}
