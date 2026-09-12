import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hgmwngasnltlrqlwimdj.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXduZ2Fzbmx0bHJxbHdpbWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTU0NTcsImV4cCI6MjA5NTk5MTQ1N30.d936pnaq2YLJ54NvNNKddUP62TPJhtbUMz2PdbSi6Sc'

// A janelinha flutuante do app nativo é uma segunda janela do sistema na MESMA
// origem, e este módulo cria o cliente no import — ou seja, ela ganhava um
// cliente próprio mesmo sem montar o AuthProvider (ver App.jsx). Dois clientes
// renovando o mesmo refresh token se atropelam: com a rotação ligada, o token
// que um usa já foi trocado pelo outro, a renovação falha e a janela principal
// caía sozinha no login no meio do uso. A janelinha não lê nada do banco, então
// aqui ela fica sem sessão e sem renovação — o dono do token é quem grava.
const ehJanelinha = typeof window !== 'undefined'
  && window.location.hash.startsWith('#/mini')

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: !ehJanelinha,
    autoRefreshToken: !ehJanelinha,
    detectSessionInUrl: !ehJanelinha,
  },
})
