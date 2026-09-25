// As transcrições que o servidor termina sozinho (tabela `transcricoes`, ver
// supabase/transcricoes.sql). O servidor cria e atualiza as linhas; o app só
// lê as próprias e apaga depois de guardar a conversa.

import { supabase } from './supabase'

const TABELA = 'transcricoes'
const CAMPOS = 'id, estado, origem, modo, duracao_s, erro, erro_status, criada_em'

// Todas as desta conta, das mais antigas para as mais novas. Null quando não
// deu para ler (sem rede, ou a tabela ainda não existe): quem chama não pode
// confundir "não sei" com "não há nenhuma".
export async function listarNoServidor() {
  const { data, error } = await supabase.from(TABELA).select(CAMPOS).order('criada_em')
  if (error) return null
  return data || []
}

export async function resultadoNoServidor(id) {
  const { data, error } = await supabase.from(TABELA).select('resultado').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Não foi possível buscar a transcrição.')
  return data?.resultado || null
}

// Apagar é também "pegar para si": com o Dito aberto no celular e no
// computador, os dois veem a mesma transcrição pronta no mesmo instante. Só
// quem de fato apagou a linha (e recebeu ela de volta) guarda a conversa; o
// outro desiste, e a conversa não nasce duas vezes.
export async function reivindicarNoServidor(id) {
  const { data, error } = await supabase.from(TABELA).delete().eq('id', id).select('id')
  if (error) throw new Error(error.message || 'Não foi possível buscar a transcrição.')
  return (data || []).length > 0
}

export async function apagarNoServidor(id) {
  await supabase.from(TABELA).delete().eq('id', id)
}
