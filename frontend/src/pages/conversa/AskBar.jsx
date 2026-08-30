import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatTextarea from '../../components/chat/ChatTextarea'
import { IconSend } from '../../components/Icons'
import { track } from '../../lib/analytics'

// Perguntar era o último bloco da página: numa conversa de dois minutos já
// caía abaixo da dobra, e nas telas de tópico, timeline e tarefas não existia.
// Aqui vira a ação ambiente da conversa — um campo aberto, sempre à mão, em
// qualquer uma dessas telas.
export default function AskBar() {
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')

  // A pergunta viaja no state da rota; o Chat a envia assim que monta. Assim
  // um único Enter aqui já produz a resposta, sem passo intermediário.
  function enviar(e) {
    e?.preventDefault()
    const pergunta = texto.trim()
    track(pergunta ? 'chat_aberto_com_pergunta' : 'chat_aberto')
    navigate('chat', pergunta ? { state: { ask: pergunta } } : undefined)
  }

  return (
    <form className="ask-bar" onSubmit={enviar}>
      <ChatTextarea
        value={texto}
        onChange={setTexto}
        onSubmit={enviar}
        placeholder="Pergunte qualquer coisa sobre esta conversa"
      />
      <button type="submit" className="btn-icon ask-send" aria-label="Perguntar">
        <IconSend width={18} height={18} />
      </button>
    </form>
  )
}
