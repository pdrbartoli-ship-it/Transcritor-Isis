import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { isNative } from './lib/platform'

// Live update (OTA): o app baixa versões novas do site em segundo plano, para
// que correções de tela e de lógica não dependam de reinstalar o APK. Só
// mudanças nativas (microfone, compartilhamento) exigem app novo.
//
// notifyAppReady() é obrigatório: se o bundle recém-baixado não avisar que
// subiu bem, o plugin desfaz a atualização na próxima abertura. É a rede de
// segurança contra publicar um bundle quebrado — por isso fica aqui, no boot,
// antes de qualquer coisa que possa falhar.
if (isNative()) {
  CapacitorUpdater.notifyAppReady().catch(() => {
    // Sem o aviso o plugin faz rollback sozinho; nada a fazer aqui.
  })
}

// Só no site: o app empacotado já se atualiza sozinho via CapacitorUpdater, e
// um service worker ali serviria só pra atrapalhar esse mecanismo. No site,
// o Chrome/Edge exige um service worker registrado para oferecer instalação.
if (!isNative() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
