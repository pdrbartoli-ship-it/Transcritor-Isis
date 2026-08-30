// Renderizador mínimo: negrito, régua e parágrafos. Basta para o que o modelo
// devolve e evita carregar uma biblioteca de markdown inteira no bundle.
export default function MarkdownText({ text }) {
  const lines = text.split('\n')
  return (
    <div className="md">
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4)
          return <p key={i}><strong>{line.slice(2, -2)}</strong></p>
        if (line === '---') return <hr key={i} />
        if (line === '') return <br key={i} />
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        )
      })}
    </div>
  )
}
