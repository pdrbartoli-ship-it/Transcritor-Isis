import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { suggestFolder, folderBriefing } from '../lib/api'
import CapturePanel from '../components/CapturePanel'
import FolderSuggestionModal from '../components/FolderSuggestionModal'

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { folders, refreshFolders } = useOutletContext()

  const [pending, setPending] = useState(null)      // { result, sourceType, sourceName }
  const [suggestion, setSuggestion] = useState(null) // { folder_id, suggested_new_name, reason }
  const [saving, setSaving] = useState(false)

  // After a capture finishes, ask the backend which folder it belongs to.
  async function handleResult(result, sourceType, sourceName) {
    setPending({ result, sourceType, sourceName })
    try {
      const s = await suggestFolder(result.transcript, folders)
      setSuggestion(s)
    } catch {
      // If suggestion fails, still let the user pick a folder manually.
      setSuggestion({ folder_id: null, suggested_new_name: null, reason: '' })
    }
  }

  // The chat name chosen in the modal titles both the source and the
  // conversation the user lands on, so they read as one thing across the app.
  async function createSession(folderId, chatName) {
    const { result, sourceType, sourceName } = pending
    const title = chatName?.trim() || sourceName || `Sessão ${new Date().toLocaleDateString('pt-BR')}`
    const { data, error } = await supabase.from('sessions').insert({
      client_id: folderId,
      user_id: user.id,
      title,
      source_type: sourceType,
      transcript: result.transcript,
      summary: result.summary,
    }).select().single()
    if (error) throw error
    return data
  }

  // Descrição curta da pasta, usada como contexto do assistente no chat.
  // Best-effort: sem ela o chat ainda funciona com as transcrições.
  async function saveBriefing(folderId, folderName, transcript) {
    try {
      const { description } = await folderBriefing(folderName, [transcript.slice(0, 1500)])
      if (description) await supabase.from('clients').update({ description }).eq('id', folderId)
    } catch {}
  }

  // Best-effort: a failure here shouldn't block the capture from being saved.
  async function createChat(folderId, chatName, fallbackTitle) {
    const { data } = await supabase.from('chats').insert({
      client_id: folderId,
      user_id: user.id,
      title: chatName?.trim() || fallbackTitle,
    }).select().single()
    return data || null
  }

  async function handleConfirm(folderId, chatName) {
    setSaving(true)
    try {
      const session = await createSession(folderId, chatName)
      const chat = await createChat(folderId, chatName, session.title)
      // Só na primeira fonte: depois disso o FolderView mantém o briefing em dia.
      const target = folders.find(f => f.id === folderId)
      if (target && !target.description) {
        await saveBriefing(folderId, target.name, pending.result.transcript)
      }
      await refreshFolders()
      navigate(`/folders/${folderId}`, { state: { newSession: session, openChat: chat } })
    } catch (err) {
      alert(`Erro ao salvar: ${err.message}`)
      setSaving(false)
    }
  }

  async function handleCreateNew(name, chatName) {
    setSaving(true)
    try {
      const { data: folder, error } = await supabase.from('clients').insert({
        user_id: user.id,
        name: name.trim() || `Pasta ${new Date().toLocaleDateString('pt-BR')}`,
      }).select().single()
      if (error) throw error
      const session = await createSession(folder.id, chatName)
      const chat = await createChat(folder.id, chatName, session.title)
      await saveBriefing(folder.id, folder.name, pending.result.transcript)
      await refreshFolders()
      navigate(`/folders/${folder.id}`, { state: { newSession: session, openChat: chat } })
    } catch (err) {
      alert(`Erro ao criar pasta: ${err.message}`)
      setSaving(false)
    }
  }

  function closeSuggestion() {
    setSuggestion(null)
    setPending(null)
  }

  return (
    <div className="home">
      <div className="home-greeting">
        <h1>O que vamos registrar hoje?</h1>
        <p className="text-muted">Grave uma conversa ou envie um arquivo — a gente organiza pra você.</p>
      </div>

      {folders.length === 0 && (
        <div className="onboarding">
          <h3>Como funciona</h3>
          <ol>
            <li>Grave uma conversa, envie um arquivo de áudio/vídeo ou cole um link.</li>
            <li>O Dito transcreve e cria um resumo automaticamente.</li>
            <li>Sugerimos uma pasta para guardar e você conversa com o conteúdo por ali.</li>
          </ol>
        </div>
      )}

      <CapturePanel onResult={handleResult} variant="hero" />

      {suggestion && pending && (
        <FolderSuggestionModal
          suggestion={suggestion}
          folders={folders}
          sourceName={pending.sourceName}
          saving={saving}
          onConfirm={handleConfirm}
          onCreateNew={handleCreateNew}
          onClose={closeSuggestion}
        />
      )}
    </div>
  )
}
