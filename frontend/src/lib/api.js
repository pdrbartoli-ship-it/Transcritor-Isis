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

export async function chatWithSessions(question, clientName, sessions) {
  return handleResponse(await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, client_name: clientName, sessions }),
  }))
}
