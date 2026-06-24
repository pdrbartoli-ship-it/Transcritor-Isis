-- Tabela de sugestões/feedback dos usuários do Dito.
-- Rode este SQL no Supabase: Dashboard → SQL Editor → New query → Run.
-- (A feature "Enviar sugestão" insere aqui; sem esta tabela, o envio falha com aviso.)

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  email text,
  message text not null,
  category text,
  context jsonb,
  created_at timestamptz default now()
);

-- Índice para listar os mais recentes primeiro, sem ficar lento.
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Usuários autenticados só podem INSERIR o próprio feedback (não leem o dos outros).
-- Você lê tudo pelo painel do Supabase (Table editor) ou via service role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback' and policyname = 'feedback_insert_own'
  ) then
    create policy feedback_insert_own on public.feedback
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- COMO VER OS FEEDBACKS (sem dar trabalho)
-- ─────────────────────────────────────────────────────────────
-- Opção 1 — Table editor (clicando):
--   Supabase → Table editor → tabela "feedback".
--   Clique no cabeçalho da coluna "created_at" → "Sort descending"
--   para ver os mais novos no topo.
--
-- Opção 2 — SQL pronto (cole no SQL Editor e dê Run):
--
--   select
--     to_char(created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
--     category as tipo,
--     email,
--     message as mensagem
--   from public.feedback
--   order by created_at desc;
--
-- Dica: troque o "select ..." acima por
--   where category = 'Problema'
-- logo antes do "order by" para ver só reclamações/problemas.
