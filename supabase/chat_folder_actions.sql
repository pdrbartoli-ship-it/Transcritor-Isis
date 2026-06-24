-- Colunas para gerenciar chats (sessões) e pastas no Dito.
-- Rode este SQL no Supabase: Dashboard → SQL Editor → New query → Run.
--
-- Habilita:
--   • Arquivar chats           → sessions.archived
--   • Fixar pastas no topo     → clients.pinned
-- (Renomear / excluir / mover chat já funcionam com as colunas existentes:
--  sessions.title e sessions.client_id.)

alter table public.sessions
  add column if not exists archived boolean not null default false;

alter table public.clients
  add column if not exists pinned boolean not null default false;

-- Índices para listar rápido (pastas fixadas primeiro, chats não-arquivados).
create index if not exists clients_pinned_idx on public.clients (pinned desc, created_at desc);
create index if not exists sessions_archived_idx on public.sessions (archived);
