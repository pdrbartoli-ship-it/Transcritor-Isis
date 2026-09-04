import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconPin, IconEdit, IconTrash, IconClose } from './Icons'
import { renameConversation, deleteConversation, setPinned, displayTitle } from '../lib/conversas'
import { showToast } from '../lib/toast'

// Menu do botão direito da barra lateral. Antes uma conversa só podia ser
// aberta: renomear e apagar existiam no banco (`sessions.title`, delete) mas
// não tinham nenhum caminho na interface, e um título ruim ficava ruim para
// sempre.

// Largura/altura aproximadas usadas só para não abrir o menu para fora da
// janela quando o clique é perto da borda. A medida real vem depois, do
// próprio elemento.
const MARGEM = 8

// Toque parado que vale como botão direito no celular, onde ele não existe.
const PRESSAO_LONGA_MS = 500
// Quanto o dedo pode oscilar sem que a pressão seja tratada como rolagem.
const TOLERANCIA_PX = 10

export function useConversaMenu() {
  const [menu, setMenu] = useState(null)   // { conversation, x, y }
  const pressRef = useRef(null)
  const abriuPorPressao = useRef(false)
  const origemRef = useRef(null)

  function abrirMenu(event, conversation) {
    event.preventDefault()
    setMenu({ conversation, x: event.clientX, y: event.clientY })
  }

  function cancelarPressao() {
    clearTimeout(pressRef.current)
    pressRef.current = null
    origemRef.current = null
  }

  // Um dedo parado ainda oscila alguns pixels; cancelar no primeiro movimento
  // fazia o toque longo quase nunca completar. Rolar a lista, sim, cancela.
  function aoMover(event) {
    const origem = origemRef.current
    if (!origem) return
    const longe = Math.abs(event.clientX - origem.x) > TOLERANCIA_PX
      || Math.abs(event.clientY - origem.y) > TOLERANCIA_PX
    if (longe) cancelarPressao()
  }

  // No app do celular a barra lateral é a mesma tela, e sem isto fixar,
  // renomear e apagar simplesmente não teriam como ser alcançados.
  function aoTocar(event, conversation) {
    if (event.pointerType === 'mouse') return
    const { clientX, clientY } = event
    cancelarPressao()
    origemRef.current = { x: clientX, y: clientY }
    pressRef.current = setTimeout(() => {
      abriuPorPressao.current = true
      setMenu({ conversation, x: clientX, y: clientY })
    }, PRESSAO_LONGA_MS)
  }

  useEffect(() => cancelarPressao, [])

  return {
    menu,
    abrirMenu,
    fecharMenu: () => setMenu(null),
    // Espalhados no item da lista: contextmenu no desktop, toque longo no
    // celular, e qualquer movimento ou soltura cancela a pressão.
    gestos: conversation => ({
      onContextMenu: e => abrirMenu(e, conversation),
      onPointerDown: e => aoTocar(e, conversation),
      onPointerUp: cancelarPressao,
      onPointerMove: aoMover,
      onPointerCancel: cancelarPressao,
      // Soltar o dedo depois do toque longo ainda dispara o clique do item, que
      // abriria a conversa por baixo do menu recém-aberto.
      onClickCapture: e => {
        if (!abriuPorPressao.current) return
        abriuPorPressao.current = false
        e.preventDefault()
        e.stopPropagation()
      },
    }),
  }
}

export default function ConversaMenu({ menu, onClose, onChanged, onDeleted }) {
  const [renomeando, setRenomeando] = useState(null)  // conversa em edição
  const [apagando, setApagando] = useState(null)      // conversa a confirmar
  const ref = useRef(null)
  const [pos, setPos] = useState({ x: menu?.x ?? 0, y: menu?.y ?? 0 })

  // Depois de montado dá para medir o menu de verdade e puxá-lo para dentro da
  // janela. Clicar numa conversa do fim da lista abria metade do menu fora da
  // tela, sem rolagem que alcançasse.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - MARGEM),
      y: Math.min(menu.y, window.innerHeight - height - MARGEM),
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    // Sem a checagem, o pointerdown do próprio item do menu fechava o menu
    // antes de o clique chegar nele — e nenhuma das três ações funcionava no
    // celular, onde o dedo desce dentro do menu recém-aberto.
    const fechar = e => { if (!ref.current?.contains(e.target)) onClose() }
    const porTecla = e => { if (e.key === 'Escape') onClose() }
    // `true` na captura: sem isso um clique num item da lista abriria a
    // conversa por baixo do menu antes de ele fechar.
    const aoRedimensionar = () => onClose()
    window.addEventListener('pointerdown', fechar, true)
    window.addEventListener('resize', aoRedimensionar)
    window.addEventListener('keydown', porTecla)
    return () => {
      window.removeEventListener('pointerdown', fechar, true)
      window.removeEventListener('resize', aoRedimensionar)
      window.removeEventListener('keydown', porTecla)
    }
  }, [menu, onClose])

  async function fixar() {
    const c = menu.conversation
    onClose()
    try {
      await setPinned(c.id, !c.pinned)
      showToast(c.pinned ? 'Conversa desafixada.' : 'Conversa fixada no topo.')
      onChanged()
    } catch (err) {
      showToast(err.message || 'Não foi possível fixar a conversa.')
    }
  }

  // Apagar é definitivo — a transcrição não volta. O `window.confirm` do
  // navegador servia para isso, mas no app empacotado ele mostra o nome do
  // host interno ("tauri.localhost diz") em vez do Dito, o que parecia um
  // aviso de sistema quebrado. Um modal próprio, no estilo do resto do app.
  async function confirmarApagar() {
    const c = apagando
    setApagando(null)
    try {
      await deleteConversation(c.id)
      showToast('Conversa apagada.')
      onDeleted(c.id)
    } catch (err) {
      showToast(err.message || 'Não foi possível apagar a conversa.')
    }
  }

  return (
    <>
      {menu && (
        <div
          ref={ref}
          className="ctx-menu"
          style={{ left: pos.x, top: pos.y }}
          role="menu"
          onContextMenu={e => e.preventDefault()}
        >
          <button className="ctx-item" role="menuitem" onClick={fixar}>
            <IconPin width={15} height={15} />
            {menu.conversation.pinned ? 'Desafixar' : 'Fixar'}
          </button>
          <button
            className="ctx-item"
            role="menuitem"
            onClick={() => { setRenomeando(menu.conversation); onClose() }}
          >
            <IconEdit width={15} height={15} /> Mudar o nome
          </button>
          <button
            className="ctx-item danger"
            role="menuitem"
            onClick={() => { setApagando(menu.conversation); onClose() }}
          >
            <IconTrash width={15} height={15} /> Apagar
          </button>
        </div>
      )}

      {renomeando && (
        <RenameModal
          conversation={renomeando}
          onClose={() => setRenomeando(null)}
          onSaved={() => { setRenomeando(null); onChanged() }}
        />
      )}

      {apagando && (
        <DeleteModal
          conversation={apagando}
          onClose={() => setApagando(null)}
          onConfirm={confirmarApagar}
        />
      )}
    </>
  )
}

function RenameModal({ conversation, onClose, onSaved }) {
  const [title, setTitle] = useState(displayTitle(conversation))
  const [salvando, setSalvando] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function salvar(e) {
    e.preventDefault()
    const novo = title.trim()
    if (!novo || salvando) return
    setSalvando(true)
    try {
      await renameConversation(conversation.id, novo, conversation.enc_version)
      showToast('Nome atualizado.')
      onSaved()
    } catch (err) {
      showToast(err.message || 'Não foi possível renomear.')
      setSalvando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={salvar}>
        <div className="modal-header">
          <h3>Mudar o nome</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={120}
          aria-label="Novo nome da conversa"
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim() || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteModal({ conversation, onClose, onConfirm }) {
  const [apagando, setApagando] = useState(false)
  const confirmRef = useRef(null)

  useEffect(() => { confirmRef.current?.focus() }, [])

  async function confirmar() {
    if (apagando) return
    setApagando(true)
    await onConfirm()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-confirm" onClick={e => e.stopPropagation()} role="alertdialog" aria-label="Apagar conversa">
        <h3>Apagar conversa?</h3>
        <p>
          Tem certeza que deseja apagar <strong>"{displayTitle(conversation)}"</strong>?
          Essa ação não pode ser desfeita.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={apagando}>Cancelar</button>
          <button
            ref={confirmRef}
            type="button"
            className="btn-danger"
            onClick={confirmar}
            disabled={apagando}
          >
            {apagando ? 'Apagando…' : 'Apagar'}
          </button>
        </div>
      </div>
    </div>
  )
}
