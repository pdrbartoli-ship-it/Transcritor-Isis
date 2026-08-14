const API_URL = 'https://transcritor-backend.onrender.com'

async function handleResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Erro desconhecido')
  }
  return res.json()
}

export async function transcribeFile(file, preferences = {}) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('detailed', preferences.detailed ? 'true' : 'false')
  formData.append('preferences', JSON.stringify({
    tone: preferences.tone || 'Formal',
    style: preferences.style || 'Tópicos',
  }))
  return handleResponse(await fetch(`${API_URL}/transcribe`, { method: 'POST', body: formData }))
}

export async function processUrl(url, preferences = {}) {
  const formData = new FormData()
  formData.append('url', url)
  formData.append('detailed', preferences.detailed ? 'true' : 'false')
  formData.append('preferences', JSON.stringify({
    tone: preferences.tone || 'Formal',
    style: preferences.style || 'Tópicos',
  }))
  return handleResponse(await fetch(`${API_URL}/process-url`, { method: 'POST', body: formData }))
}

// As preferências das Configurações (nível, tom, formato) valem tanto no resumo
// da captura quanto aqui: o backend escolhe o modelo pelo `detailed` e aplica
// tom/formato no system prompt.
export async function chatWithSessions(
  question, clientName, sessions,
  { history = [], makeTitle = false, folderDescription = null, preferences = {} } = {},
) {
  return handleResponse(await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      client_name: clientName,
      sessions,
      history,
      make_title: makeTitle,
      folder_description: folderDescription,
      detailed: !!preferences.detailed,
      preferences: {
        tone: preferences.tone || 'Formal',
        style: preferences.style || 'Tópicos',
      },
    }),
  }))
}

// Gera a descrição curta da pasta a partir dos trechos das fontes. Guardada em
// clients.description e reenviada ao /chat como contexto.
export async function folderBriefing(folderName, excerpts) {
  return handleResponse(await fetch(`${API_URL}/folder-briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_name: folderName, excerpts }),
  }))
}

// Given a transcript and the list of existing folders, asks the backend to
// suggest where it belongs, split in two levels: the macro subject names the
// folder and the specific subject names the chat.
// Returns { folder_id, suggested_new_name, suggested_chat_name, reason }.
export async function suggestFolder(transcript, folders) {
  return handleResponse(await fetch(`${API_URL}/suggest-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      folders: folders.map(f => ({ id: f.id, name: f.name, description: f.description || null })),
    }),
  }))
}
