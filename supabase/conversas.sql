-- Nova UX: toda captura vira uma "conversa" autossuficiente.
-- Rode no SQL Editor do Supabase ANTES de publicar esta versão.
--
-- Nada é destrutivo: `clients` (pastas) continua existindo e as conversas
-- antigas seguem apontando para as pastas em que estão. As pastas saíram da
-- interface, não do banco — conversas novas vão para uma pasta técnica por
-- usuário chamada '__inbox', que a interface nunca mostra.

-- Trechos com tempo vindos do Whisper, e o resultado da análise do Claude
-- (título, resumo, 4 tópicos, tarefas, capítulos e locutores).
alter table public.sessions
  add column if not exists segments   jsonb,
  add column if not exists insights   jsonb,
  add column if not exists duration_s int,
  add column if not exists language   text;

-- O chat passa a pertencer a uma conversa, não a uma pasta. `client_id` fica
-- nullable para os chats novos, que não têm pasta nenhuma.
alter table public.chats
  add column if not exists session_id uuid references public.sessions(id) on delete cascade;

alter table public.chats
  alter column client_id drop not null;

-- A home lista as conversas do usuário por data, e é a consulta mais frequente
-- do app.
create index if not exists sessions_user_recent
  on public.sessions (user_id, created_at desc);

create index if not exists chats_session
  on public.chats (session_id);

-- Busca por palavra no título. `gin_trgm_ops` faz o ilike '%termo%' usar índice
-- em vez de varrer a tabela inteira.
create extension if not exists pg_trgm;

create index if not exists sessions_title_trgm
  on public.sessions using gin (title gin_trgm_ops);

-- A busca no corpo da transcrição também é ilike; sem este índice ela degrada
-- assim que uma conta acumula algumas dezenas de horas de áudio.
create index if not exists sessions_transcript_trgm
  on public.sessions using gin (transcript gin_trgm_ops);
