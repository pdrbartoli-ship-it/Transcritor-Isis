import { useState } from 'react'
import { getPrefs, setPrefs, getTheme, setTheme } from '../lib/prefs'
import { IconClose, IconSun, IconMoon } from './Icons'

const TONE_HINTS = {
  Formal: 'Formal: frases completas, vocabulário preciso, sem gírias.',
  Casual: 'Casual: linguagem do dia a dia, frases curtas, sem jargão.',
  'Técnico': 'Técnico: preserva os termos exatos da fonte e é específico com dados e definições.',
}

// Theme + summarization preferences. Theme applies instantly; preferences are
// read at capture time (CapturePanel) and at chat time (FolderView), e enviadas
// ao backend nas duas rotas.
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
          <label>Profundidade</label>
          <p className="hint">
            {prefs.detailed
              ? 'Detalhado: usa um modelo mais forte, respostas e resumos mais completos — leva um pouco mais de tempo.'
              : 'Rápido: respostas e resumos enxutos, gerados em menos tempo.'}
          </p>
          <div className="seg">
            <button className={!prefs.detailed ? 'on' : ''} onClick={() => change({ detailed: false })}>Rápido</button>
            <button className={prefs.detailed ? 'on' : ''} onClick={() => change({ detailed: true })}>Detalhado</button>
          </div>
        </div>

        <div className="settings-group">
          <label>Formato</label>
          <p className="hint">
            {prefs.style === 'Tópicos'
              ? 'Tópicos: tudo em listas com marcadores curtos.'
              : 'Parágrafos: texto corrido, sem listas.'}
          </p>
          <div className="seg">
            <button className={prefs.style === 'Tópicos' ? 'on' : ''} onClick={() => change({ style: 'Tópicos' })}>Tópicos</button>
            <button className={prefs.style === 'Parágrafos' ? 'on' : ''} onClick={() => change({ style: 'Parágrafos' })}>Parágrafos</button>
          </div>
        </div>

        <div className="settings-group" style={{ marginBottom: 0 }}>
          <label>Tom</label>
          <p className="hint">{TONE_HINTS[prefs.tone] || ''}</p>
          <div className="seg">
            {['Formal', 'Casual', 'Técnico'].map(t => (
              <button key={t} className={prefs.tone === t ? 'on' : ''} onClick={() => change({ tone: t })}>{t}</button>
            ))}
          </div>
        </div>

        <p className="hint" style={{ marginTop: 16 }}>
          Estas preferências valem para os resumos das capturas e também para as respostas do chat.
        </p>

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>Concluído</button>
        </div>
      </div>
    </div>
  )
}
