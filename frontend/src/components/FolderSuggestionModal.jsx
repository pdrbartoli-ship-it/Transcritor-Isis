import { useState } from 'react'
import { IconFolder, IconPlus, IconClose } from './Icons'

// Shown after a capture on the Home screen. Presents the AI's folder
// suggestion and lets the user confirm, pick another existing folder, or
// create a new one. Calls onConfirm({ folderId }) for an existing folder or
// onCreateNew(name) to open the new-folder flow.
export default function FolderSuggestionModal({
  suggestion, folders, saving, onConfirm, onCreateNew, onClose,
}) {
  const suggestedFolder = suggestion.folder_id
    ? folders.find(f => f.id === suggestion.folder_id)
    : null
  const suggestedName = suggestion.suggested_new_name || 'Nova pasta'

  // Default selection: the suggested existing folder, else the "new folder" option.
  const [selected, setSelected] = useState(
    suggestedFolder ? suggestedFolder.id : '__new__'
  )

  function handleConfirm() {
    if (selected === '__new__') onCreateNew(suggestedName)
    else onConfirm(selected)
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Onde salvar?</h3>
          {!saving && <button className="btn-icon" onClick={onClose}><IconClose /></button>}
        </div>

        {suggestion.reason && (
          <div className="suggestion-reason">{suggestion.reason}</div>
        )}

        <p className="text-muted text-sm">
          {suggestedFolder
            ? 'Sugerimos esta pasta. Confirme ou escolha outra:'
            : 'Não encontramos uma pasta existente. Sugerimos criar:'}
        </p>

        <div className="suggestion-options">
          {/* New-folder option (pre-filled with the AI's proposed name) */}
          <button
            className={`suggestion-option ${selected === '__new__' ? 'selected' : ''}`}
            onClick={() => setSelected('__new__')}
          >
            <IconPlus width={16} height={16} />
            <span>Criar nova pasta: <span className="suggestion-pick">{suggestedName}</span></span>
          </button>

          {folders.length > 0 && <div className="suggestion-sep">ou pasta existente</div>}

          {folders.map(f => (
            <button
              key={f.id}
              className={`suggestion-option ${selected === f.id ? 'selected' : ''}`}
              onClick={() => setSelected(f.id)}
            >
              <IconFolder width={16} height={16} />
              <span>{f.name}{f.id === suggestion.folder_id ? ' · sugerida' : ''}</span>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving ? <><span className="spinner spinner-sm" /> Salvando...</> : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
