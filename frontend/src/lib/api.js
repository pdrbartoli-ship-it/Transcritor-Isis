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

export async function chatWithSessions(question, clientName, sessions, { history = [], makeTitle = false } = {}) {
  return handleResponse(await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, client_name: clientName, sessions, history, make_title: makeTitle }),
  }))
}

// Given a transcript and the list of existing folders, asks the backend to
// suggest which folder it belongs to (or propose a new folder name).
// Returns { folder_id, suggested_new_name, reason }.
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
