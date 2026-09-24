-- Celulares que recebem notificação do Dito (24/09/2026).
--
-- Hoje o único aviso é o do convite premiado: quando um amigo completa as 3
-- transcrições, quem convidou recebe a notificação no celular. No computador
-- não há notificação; lá o aviso aparece ao abrir o app.
--
-- Rode no Supabase: SQL Editor → New query → Run. Pode rodar antes ou depois
-- do deploy: sem a tabela, o app só não consegue se cadastrar para avisos.

-- Uma linha por aparelho (a chave é o token que o Google ou a Apple dão ao
-- app). O mesmo celular com outra conta passa a ser da conta nova.
create table if not exists public.dispositivos (
  token         text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  plataforma    text not null check (plataforma in ('android', 'ios')),
  atualizado_em timestamptz not null default now()
);
create index if not exists dispositivos_user_idx on public.dispositivos (user_id);

-- Fechada como as do convite: só o backend, com a service role, lê e escreve.
alter table public.dispositivos enable row level security;

-- Conferência: deve devolver  1 | true
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'dispositivos') as tabela,
  (select relrowsecurity from pg_class where oid = 'public.dispositivos'::regclass) as fechada;
