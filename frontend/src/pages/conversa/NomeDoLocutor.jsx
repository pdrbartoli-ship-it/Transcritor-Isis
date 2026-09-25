import { useState, useRef, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { renomearLocutor } from '../../lib/locutores'
import { track } from '../../lib/analytics'
import { showToast } from '../../lib/toast'

// O nome de quem fala, em cima de cada bloco da transcrição. Clicar nele abre
// um campo, e o que for escrito ali vale para a conversa inteira: a
// transcrição, os responsáveis das tarefas e o arquivo baixado.
//
// A troca é do aparelho da pessoa para o banco, como o renomear da conversa: a
// IA acerta o nome quando alguém o diz em voz alta, e erra quando ninguém diz.
// Corrigir à mão é mais barato que qualquer modelo.
export default function NomeDoLocutor({ nome }) {
  const { conversation, setConversation } = useOutletContext() || {}
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(nome)
  const [salvando, setSalvando] = useState(false)
  const campoRef = useRef(null)

  useEffect(() => { setTexto(nome) }, [nome])
  useEffect(() => { if (editando) campoRef.current?.select() }, [editando])

  // Sem conversa em mãos (a pré-visualização de uma tela solta) o nome fica
  // como está: não há o que gravar.
  if (!conversation) return <span className="fala-speaker">{nome}</span>

  async function salvar() {
    const novo = texto.trim()
    setEditando(false)
    if (!novo || novo === nome) { setTexto(nome); return }
    setSalvando(true)
    try {
      const insights = await renomearLocutor(conversation, nome, novo)
      setConversation?.(atual => ({ ...atual, insights }))
      track('locutor_renomeado')
    } catch {
      setTexto(nome)
      showToast('Não foi possível mudar o nome agora.')
    } finally {
      setSalvando(false)
    }
  }

  if (editando) {
    return (
      <input
        ref={campoRef}
        className="fala-speaker-campo"
        value={texto}
        maxLength={40}
        autoFocus
        onChange={e => setTexto(e.target.value)}
        onBlur={salvar}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); salvar() }
          // Escape desiste: sem isto, sair do campo por engano já gravava.
          if (e.key === 'Escape') { setTexto(nome); setEditando(false) }
        }}
        aria-label={`Nome de ${nome}`}
      />
    )
  }

  return (
    <button
      type="button"
      className="fala-speaker fala-speaker-botao"
      onClick={() => setEditando(true)}
      disabled={salvando}
      title="Mudar o nome desta pessoa em toda a conversa"
    >
      {texto}
    </button>
  )
}
