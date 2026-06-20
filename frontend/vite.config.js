import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Dentro do app (Capacitor) os arquivos são servidos da raiz local,
  // então usamos base relativa. No GitHub Pages mantemos o subcaminho.
  base: process.env.CAPACITOR ? './' : '/Transcritor-Isis/',
  plugins: [react()],
})
