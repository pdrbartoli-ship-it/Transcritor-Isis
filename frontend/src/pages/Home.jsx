import { useState } from 'react'
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { suggestFolder } from '../lib/api'
import CapturePanel from '../components/CapturePanel'
import FolderSuggestionModal from '../components/FolderSuggestionModal'

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
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

  async function createSession(folderId) {
    const { result, sourceType, sourceName } = pending
    const title = sourceName || `Sessão ${new Date().toLocaleDateString('pt-BR')}`
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

  async function handleConfirm(folderId) {
    setSaving(true)
    try {
      await createSession(folderId)
      await refreshFolders()
      navigate(`/folders/${folderId}`)
    } catch (err) {
      alert(`Erro ao salvar: ${err.message}`)
      setSaving(false)
    }
  }

  async function handleCreateNew(name) {
    setSaving(true)
    try {
      const { data: folder, error } = await supabase.from('clients').insert({
        user_id: user.id,
        name: name.trim() || `Pasta ${new Date().toLocaleDateString('pt-BR')}`,
      }).select().single()
      if (error) throw error
      await createSession(folder.id)
      await refreshFolders()
      navigate(`/folders/${folder.id}`)
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

      <CapturePanel onResult={handleResult} variant="hero" autoStart={location.state?.autoRecord} />

      {suggestion && pending && (
        <FolderSuggestionModal
          suggestion={suggestion}
          folders={folders}
          saving={saving}
          onConfirm={handleConfirm}
          onCreateNew={handleCreateNew}
          onClose={closeSuggestion}
        />
      )}
    </div>
  )
}
