-- Conversas salvas por pasta (estilo NotebookLM): cada pergunta vira um chat
-- persistente, com histórico de mensagens. As transcrições continuam em
-- public.sessions ("Fontes"). Rode no Supabase: SQL Editor → New query → Run.

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users,
  title text not null default 'Nova conversa',
  preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chats_client_idx on public.chats (client_id, updated_at desc);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;

-- Mesmo padrão de clients/sessions: o usuário só mexe nas próprias linhas.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='chats' and policyname='chats_own') then
    create policy chats_own on public.chats for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='chat_messages' and policyname='chat_messages_own') then
    create policy chat_messages_own on public.chat_messages for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
