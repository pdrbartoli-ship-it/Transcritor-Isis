-- Cofres da chave de criptografia de cada usuário.
-- Rode no Supabase: SQL Editor → New query → Run.
--
-- O que fica AQUI é só o cofre: a chave de dados (DEK) embrulhada por um
-- segredo que só o usuário tem. Quem levar esta tabela embora leva cadeados
-- fechados — sem a senha ou a chave de recuperação, cada linha é ruído.
--
-- A DEK em si nunca chega ao servidor em claro. Ela é criada no navegador,
-- embrulhada no navegador, e desembrulhada no navegador.

create table if not exists public.user_keys (
  user_id uuid primary key references auth.users on delete cascade,

  -- Cofre 1: aberto pela senha do usuário.
  senha_salt   text not null,
  senha_cofre  text not null,

  -- Cofre 2: aberto pela chave de recuperação, que o usuário guardou no
  -- primeiro login. É a única porta que sobra quando a senha é resetada por
  -- e-mail — o reset do Supabase troca a senha SEM saber a antiga, e por isso
  -- a senha nova não abriria o cofre 1 sozinha.
  recuperacao_salt  text not null,
  recuperacao_cofre text not null,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.user_keys enable row level security;

-- Mesmo padrão das outras tabelas: cada um só enxerga a própria linha. Vale
-- lembrar que isto é defesa em profundidade, não a proteção principal — a
-- proteção principal é o conteúdo ser ilegível mesmo para quem furar a RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_keys' and policyname = 'user_keys_own'
  ) then
    create policy user_keys_own on public.user_keys for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Marca de qual versão de criptografia cada conversa está usando.
--   null = texto puro (como está hoje)
--   1    = campos cifrados com a DEK do usuário
-- Ter a marca por linha é o que permite a migração acontecer aos poucos e ser
-- retomada de onde parou, em vez de ser um salto de tudo ou nada.
alter table public.sessions
  add column if not exists enc_version int;

alter table public.chat_messages
  add column if not exists enc_version int;

-- ── Atualização: chave de recuperação passa a ser OPCIONAL ──
-- Rode este bloco também (ele é seguro de rodar mais de uma vez).
--
-- A chave de recuperação deixou de ser obrigatória no primeiro login: o caso
-- comum de "esqueci a senha" é resolvido pelo próprio aparelho, que já tem a
-- chave guardada e só precisa refechar o cofre com a senha nova. A chave de
-- recuperação vira seguro opcional, gerado em "Meus dados" por quem quiser —
-- e por isso estas duas colunas podem ficar vazias.
alter table public.user_keys alter column recuperacao_salt  drop not null;
alter table public.user_keys alter column recuperacao_cofre drop not null;
