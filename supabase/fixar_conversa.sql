-- Fixar conversa no topo da barra lateral.
-- Rode no SQL Editor do Supabase: Dashboard → SQL Editor → New query → Run.
--
-- Enquanto este script não roda, o app continua de pé: a listagem cai para as
-- colunas antigas (mesmo padrão de conversas.sql) e o menu do botão direito
-- avisa que fixar ainda não está disponível. Renomear e apagar não dependem
-- daqui — usam `sessions.title` e o delete comum.

alter table public.sessions
  add column if not exists pinned boolean not null default false;

-- A barra lateral lista as fixadas primeiro, dentro do acervo do usuário.
create index if not exists sessions_user_pinned
  on public.sessions (user_id, pinned desc, created_at desc);
