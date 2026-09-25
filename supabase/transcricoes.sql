-- Transcrição que continua no servidor com o app fechado (25/09/2026).
--
-- O app manda o arquivo (ou o link), o servidor devolve um número e segue
-- sozinho. O resultado fica guardado aqui, cifrado com a chave pública da
-- pessoa, até um aparelho dela buscar; o aparelho decifra, guarda a conversa
-- como sempre e apaga a linha.
--
-- Rode no Supabase: SQL Editor → New query → Run. Pode rodar antes ou depois
-- do deploy: sem as tabelas, o app segue pelo caminho de antes (a transcrição
-- inteira com o app aberto).

-- 1. A chave de cada conta. O servidor só usa a parte pública, que fecha e não
--    abre. A privada chega aqui já cifrada no aparelho com a chave das
--    conversas, e só um aparelho da própria pessoa a abre.
create table if not exists public.chaves_transcricao (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  publica         jsonb not null,
  privada_cifrada text not null,
  criada_em       timestamptz not null default now()
);
alter table public.chaves_transcricao enable row level security;

drop policy if exists "dono le a chave" on public.chaves_transcricao;
create policy "dono le a chave" on public.chaves_transcricao
  for select using (auth.uid() = user_id);
drop policy if exists "dono cria a chave" on public.chaves_transcricao;
create policy "dono cria a chave" on public.chaves_transcricao
  for insert with check (auth.uid() = user_id);
-- Trocar o par: acontece quando a chave das conversas muda (senha redefinida
-- em outro aparelho) e a privada antiga fica ilegível.
drop policy if exists "dono troca a chave" on public.chaves_transcricao;
create policy "dono troca a chave" on public.chaves_transcricao
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. As transcrições em andamento ou prontas para buscar. Nada aqui diz o que
--    foi falado: o nome do arquivo e o link não são guardados, e o resultado
--    só existe cifrado.
create table if not exists public.transcricoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  estado        text not null default 'processando' check (estado in ('processando', 'pronta', 'erro')),
  origem        text not null check (origem in ('record', 'file', 'url')),
  modo          text not null,
  duracao_s     integer,
  resultado     text,
  erro          text,
  erro_status   integer,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists transcricoes_user_idx on public.transcricoes (user_id, criada_em);
alter table public.transcricoes enable row level security;

-- O dono lê e apaga as suas. Criar e atualizar é só do servidor (service role,
-- que passa por cima da RLS).
drop policy if exists "dono le as transcricoes" on public.transcricoes;
create policy "dono le as transcricoes" on public.transcricoes
  for select using (auth.uid() = user_id);
drop policy if exists "dono apaga as transcricoes" on public.transcricoes;
create policy "dono apaga as transcricoes" on public.transcricoes
  for delete using (auth.uid() = user_id);

-- Conferência: deve devolver  2 | true | true
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('chaves_transcricao', 'transcricoes')) as tabelas,
  (select relrowsecurity from pg_class where oid = 'public.chaves_transcricao'::regclass) as chaves_fechada,
  (select relrowsecurity from pg_class where oid = 'public.transcricoes'::regclass) as transcricoes_fechada;
