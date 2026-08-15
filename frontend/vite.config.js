import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Dentro do app (Capacitor) os arquivos são servidos da raiz local, então
  // usamos base relativa. Na web o site vive na raiz de dito.albiecloud.com.
  base: process.env.CAPACITOR ? './' : '/',
  plugins: [react()],
})
