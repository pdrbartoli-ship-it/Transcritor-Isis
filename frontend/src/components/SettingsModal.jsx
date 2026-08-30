import { useState } from 'react'
import { getTheme, setTheme } from '../lib/prefs'
import { IconClose, IconSun, IconMoon } from './Icons'

// Só tema. Os ajustes de tom, formato e profundidade saíram: eram quatro
// controles que quase ninguém tocava e que faziam a mesma captura render
// resumos diferentes. O resumo agora é sempre neutro e em bullets.
export default function SettingsModal({ onClose }) {
  const [theme, setThemeState] = useState(getTheme())

  function changeTheme(t) { setThemeState(t); setTheme(t) }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Tema</h3>
          <button className="btn-icon" onClick={onClose}><IconClose /></button>
        </div>

        <div className="settings-group" style={{ marginBottom: 0 }}>
          <div className="seg">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => changeTheme('light')}>
              <IconSun width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Claro
            </button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => changeTheme('dark')}>
              <IconMoon width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Escuro
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>Concluído</button>
        </div>
      </div>
    </div>
  )
}
