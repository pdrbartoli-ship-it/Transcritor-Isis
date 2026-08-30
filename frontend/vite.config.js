import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// Sem isto não havia como saber qual build está rodando: o instalador tem nome
// e URL fixos, então uma cópia velha no cache do navegador se instala sem
// nenhum sinal de que é velha. O commit no rodapé responde isso de relance.
// No CI o SHA vem do ambiente; na máquina de quem desenvolve, do próprio git.
function buildSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch {
    return 'local'
  }
}

export default defineConfig({
  // Dentro do app (Capacitor) os arquivos são servidos da raiz local, então
  // usamos base relativa. Na web o site vive na raiz de dito.albiecloud.com.
  base: process.env.CAPACITOR ? './' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
})
