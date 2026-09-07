// Renderizador mínimo: negrito, régua, listas e parágrafos. Basta para o que o
// modelo devolve e evita carregar uma biblioteca de markdown inteira no bundle.

// Um "- " no começo da linha é lista, não travessão. Sem isto o resumo saía com
// o hífen literal em cada linha, que é exatamente a aparência de markdown que
// ninguém renderizou.
const BULLET = /^\s*[-*]\s+/

export default function MarkdownText({ text }) {
  return <div className="md">{blocos(text.split('\n'))}</div>
}

// Agrupa linhas de lista consecutivas num <ul> só; o resto sai linha a linha,
// como antes.
function blocos(lines) {
  const saida = []
  let lista = null

  const fecharLista = () => {
    if (!lista) return
    saida.push(<ul key={`ul-${saida.length}`}>{lista}</ul>)
    lista = null
  }

  lines.forEach((line, i) => {
    if (BULLET.test(line)) {
      lista ??= []
      lista.push(<li key={i}>{inline(line.replace(BULLET, ''))}</li>)
      return
    }
    fecharLista()
    if (line === '---') saida.push(<hr key={i} />)
    else if (line === '') saida.push(<br key={i} />)
    else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      saida.push(<p key={i}><strong>{line.slice(2, -2)}</strong></p>)
    } else saida.push(<p key={i}>{inline(line)}</p>)
  })
  fecharLista()
  return saida
}

function inline(texto) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={j}>{part.slice(2, -2)}</strong>
      : part
  )
}
