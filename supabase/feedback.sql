-- Tabela de sugestões/feedback dos usuários do Dito.
-- Rode este SQL no Supabase: Dashboard → SQL Editor → New query → Run.
-- (A feature "Enviar sugestão" insere aqui; sem esta tabela, o envio falha com aviso.)

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  email text,
  message text,
  mood text,            -- 'bad' | 'meh' | 'good' (carinha escolhida; pode vir sem texto)
  category text,
  context jsonb,
  created_at timestamptz default now()
);

-- Migração para tabelas que já existiam antes do feedback rápido (V0):
-- mood passa a existir e o texto deixa de ser obrigatório (carinha sozinha já vale).
alter table public.feedback add column if not exists mood text;
alter table public.feedback alter column message drop not null;

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
