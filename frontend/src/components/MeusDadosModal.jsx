import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchEverything, toMarkdown, toJson, deleteEverything } from '../lib/meusDados'
import { downloadText, safeFilename } from '../pages/conversa/shared'
import { showToast } from '../lib/toast'
import { track } from '../lib/analytics'
import { IconClose, IconDownload, IconTrash, IconShield } from './Icons'
import { gerarChaveRecuperacao, temChaveRecuperacao } from '../lib/chaves'
import ChaveRecuperacaoModal from './ChaveRecuperacaoModal'

// Confirmação por digitação, e não por "tem certeza?": apagar tudo é a única
// ação do Dito que não tem volta nenhuma. Um clique a mais num diálogo de sim/
// não é fácil demais de dar por engano.
const PALAVRA = 'APAGAR TUDO'

export default function MeusDadosModal({ onClose }) {
  const { user } = useAuth()
  const [exportando, setExportando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [texto, setTexto] = useState('')
  const [apagando, setApagando] = useState(false)
  const [erro, setErro] = useState(null)
  const [temChaveRec, setTemChaveRec] = useState(null)
  const [chaveGerada, setChaveGerada] = useState(null)
  const [gerando, setGerando] = useState(false)

  useEffect(() => {
    temChaveRecuperacao(user.id).then(setTemChaveRec).catch(() => setTemChaveRec(false))
  }, [user.id])

  async function gerarChave() {
    setGerando(true)
    setErro(null)
    try {
      setChaveGerada(await gerarChaveRecuperacao(user.id))
      setTemChaveRec(true)
    } catch (err) {
      setErro(err.message)
    } finally {
      setGerando(false)
    }
  }

  async function exportar() {
    setExportando(true)
    setErro(null)
    try {
      const conversas = await fetchEverything(user.id)
      if (!conversas.length) {
        showToast('Não há nada para exportar ainda')
        return
      }
      const dia = new Date().toISOString().slice(0, 10)
      // Dois arquivos: o .md para ler, o .json para reimportar um dia.
      downloadText(safeFilename(`dito-${dia}`), toMarkdown(conversas))
      downloadText(`dito-${dia}.json`, toJson(conversas))
      track('exportar_dados', { conversas: conversas.length })
      showToast(`${conversas.length} conversa(s) exportada(s)`)
    } catch (err) {
      setErro(`Não foi possível exportar: ${err.message}`)
    } finally {
      setExportando(false)
    }
  }

  async function apagar() {
    setApagando(true)
    setErro(null)
    try {
      await deleteEverything(user.id)
      track('apagar_dados')
      // Recarrega em vez de tentar remendar o estado da tela: a barra lateral,
      // a home e a conversa aberta acabaram de ficar todas inválidas.
      window.location.reload()
    } catch (err) {
      setErro(`Não foi possível apagar: ${err.message}`)
      setApagando(false)
    }
  }

  if (chaveGerada) {
    return <ChaveRecuperacaoModal chave={chaveGerada} onConfirmado={() => setChaveGerada(null)} />
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Meus dados</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>

        <div className="dados-bloco">
          <h4>Chave de recuperação</h4>
          <p className="text-muted text-sm">
            Suas conversas são cifradas com a sua senha — nem nós conseguimos abri-las.
            Trocar de senha pelo seu aparelho de sempre funciona sozinho, sem chave nenhuma.
            Ela só é necessária se você esquecer a senha <strong>e</strong> estiver num
            aparelho novo. É um seguro: guarde num lugar seguro e esqueça que existe.
          </p>
          {temChaveRec === true && (
            <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
              Você já tem uma chave. Gerar outra <strong>invalida a anterior</strong>.
            </p>
          )}
          <button className="btn-secondary" onClick={gerarChave} disabled={gerando}>
            {gerando
              ? <><span className="spinner spinner-sm" /> Gerando…</>
              : <><IconShield width={15} height={15} /> {temChaveRec ? 'Gerar uma nova chave' : 'Gerar minha chave'}</>}
          </button>
        </div>

        <div className="dados-bloco">
          <h4>Levar tudo embora</h4>
          <p className="text-muted text-sm">
            Baixa todas as suas conversas — transcrições, resumos, tarefas e as perguntas
            que você fez — num arquivo de texto que abre em qualquer lugar, sem depender do Dito.
          </p>
          <button className="btn-secondary" onClick={exportar} disabled={exportando}>
            {exportando
              ? <><span className="spinner spinner-sm" /> Reunindo tudo…</>
              : <><IconDownload width={15} height={15} /> Exportar tudo</>}
          </button>
        </div>

        <div className="dados-bloco perigo">
          <h4>Apagar tudo</h4>
          <p className="text-muted text-sm">
            Remove todas as conversas e perguntas desta conta, de vez. Não dá para desfazer,
            e nós não guardamos cópia. Exporte antes, se quiser guardar.
          </p>

          {!confirmando ? (
            <button className="btn-danger" onClick={() => setConfirmando(true)}>
              <IconTrash width={15} height={15} /> Apagar tudo
            </button>
          ) : (
            <>
              <label className="dados-confirm-label">
                Digite <strong>{PALAVRA}</strong> para confirmar:
              </label>
              <input
                className="dados-confirm-input"
                value={texto}
                onChange={e => setTexto(e.target.value)}
                placeholder={PALAVRA}
                autoFocus
                disabled={apagando}
              />
              <div className="dados-confirm-acoes">
                <button
                  className="btn-danger"
                  onClick={apagar}
                  disabled={texto.trim() !== PALAVRA || apagando}
                >
                  {apagando ? <><span className="spinner spinner-sm" /> Apagando…</> : 'Apagar para sempre'}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => { setConfirmando(false); setTexto('') }}
                  disabled={apagando}
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}
      </div>
    </div>
  )
}
