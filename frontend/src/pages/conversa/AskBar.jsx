import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatTextarea from '../../components/chat/ChatTextarea'
import { IconSend } from '../../components/Icons'
import { track } from '../../lib/analytics'
import { textoPerguntasRestantes } from './perguntas'

// Perguntar era o último bloco da página: numa conversa de dois minutos já
// caía abaixo da dobra, e nas telas de tópico, timeline e tarefas não existia.
// Aqui vira a ação ambiente da conversa — um campo aberto, sempre à mão, em
// qualquer uma dessas telas.
//
// `restantes` é null quando o plano não tem limite (ou a contagem não chegou):
// aí não se mostra número nenhum.
export default function AskBar({ restantes = null, onVerPlanos }) {
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

  // Acabaram as perguntas desta transcrição: o campo vira o convite. Deixar
  // digitar para só depois recusar gastaria a vontade da pessoa num erro.
  if (restantes === 0) {
    return (
      <div className="ask-bar ask-esgotado">
        <span>Você usou todas as perguntas desta transcrição.</span>
        {onVerPlanos && <button type="button" className="btn-primary btn-sm" onClick={onVerPlanos}>Ver planos</button>}
      </div>
    )
  }

  return (
    <>
      <form className="ask-bar" onSubmit={enviar}>
        <ChatTextarea
          value={texto}
          onChange={setTexto}
          onSubmit={enviar}
          placeholder="Pergunte sobre esta conversa"
        />
        <button type="submit" className="btn-icon ask-send" aria-label="Perguntar">
          <IconSend width={18} height={18} />
        </button>
      </form>
      {restantes != null && <p className="ask-restantes">{textoPerguntasRestantes(restantes)}</p>}
    </>
  )
}
