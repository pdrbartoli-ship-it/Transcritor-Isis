import { useState } from 'react'
import { getPrefs, setPrefs, getTheme, setTheme } from '../lib/prefs'
import { IconClose, IconSun, IconMoon } from './Icons'

// Theme + summarization preferences. Theme applies instantly; preferences are
// read by CapturePanel at capture time and sent to the backend.
export default function SettingsModal({ onClose }) {
  const [theme, setThemeState] = useState(getTheme())
  const [prefs, setPrefsState] = useState(getPrefs())

  function changeTheme(t) { setThemeState(t); setTheme(t) }
  function change(patch) { setPrefsState(setPrefs(patch)) }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Configurações</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>

        <div className="settings-group">
          <label>Tema</label>
          <div className="seg">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => changeTheme('light')}>
              <IconSun width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Claro
            </button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => changeTheme('dark')}>
              <IconMoon width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Escuro
            </button>
          </div>
        </div>

        <div className="settings-group">
          <label>Nível do resumo</label>
          <p className="hint">Quão completo o resumo automático de cada transcrição deve ser.</p>
          <div className="seg">
            <button className={!prefs.detailed ? 'on' : ''} onClick={() => change({ detailed: false })}>Rápido</button>
            <button className={prefs.detailed ? 'on' : ''} onClick={() => change({ detailed: true })}>Detalhado</button>
          </div>
        </div>

        <div className="settings-group">
          <label>Formato do resumo</label>
          <div className="seg">
            <button className={prefs.style === 'Tópicos' ? 'on' : ''} onClick={() => change({ style: 'Tópicos' })}>Tópicos</button>
            <button className={prefs.style === 'Parágrafos' ? 'on' : ''} onClick={() => change({ style: 'Parágrafos' })}>Parágrafos</button>
          </div>
        </div>

        <div className="settings-group" style={{ marginBottom: 0 }}>
          <label>Tom</label>
          <div className="seg">
            {['Formal', 'Casual', 'Técnico'].map(t => (
              <button key={t} className={prefs.tone === t ? 'on' : ''} onClick={() => change({ tone: t })}>{t}</button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>Concluído</button>
        </div>
      </div>
    </div>
  )
}
