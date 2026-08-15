-- Medição de uso do Dito pelos testadores.
-- Rode este SQL no Supabase: Dashboard → SQL Editor → New query → Run.
--
-- PRIVACIDADE: guardamos apenas contagens e metadados (tipo de captura,
-- duração, tokens). Nunca transcrição, nome de arquivo ou URL. Isso mantém a
-- declaração de "Segurança dos dados" da Play Store simples e verdadeira, e é
-- suficiente para responder quanto cada pessoa usa e quanto custa.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  name text not null,                       -- 'app_open' | 'captura' | 'chat'
  props jsonb not null default '{}',        -- origem, midia, duracao_s, usage
  created_at timestamptz not null default now()
);

create index if not exists events_user_idx on public.events (user_id, created_at desc);
create index if not exists events_name_idx on public.events (name, created_at desc);

alter table public.events enable row level security;

-- Mesmo padrão do feedback: cada um só insere as próprias linhas e ninguém lê
-- as dos outros pelo app. A leitura é sua, pelo painel do Supabase.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'events' and policyname = 'events_insert_own'
  ) then
    create policy events_insert_own on public.events
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- COMO LER (Table editor → "uso_por_usuario")
-- ─────────────────────────────────────────────────────────────
create or replace view public.uso_por_usuario as
select
  u.email,
  count(*) filter (where e.name = 'app_open')                                            as aberturas,
  count(*) filter (where e.name = 'captura' and e.props->>'origem' = 'gravacao')         as audios_gravados,
  count(*) filter (where e.name = 'captura' and e.props->>'origem' = 'arquivo')          as arquivos_enviados,
  count(*) filter (where e.name = 'captura' and e.props->>'origem' = 'link')             as links,
  count(*) filter (where e.name = 'chat')                                                as perguntas_no_chat,
  coalesce(sum((e.props->'usage'->>'input_tokens')::bigint), 0)                          as tokens_entrada,
  coalesce(sum((e.props->'usage'->>'output_tokens')::bigint), 0)                         as tokens_saida,
  round(coalesce(sum((e.props->'usage'->>'audio_seconds')::numeric), 0) / 60, 1)         as minutos_audio,
  max(e.created_at)                                                                      as ultimo_uso
from public.events e
join auth.users u on u.id = e.user_id
group by u.email
order by aberturas desc;

-- A view cruza com auth.users (e-mails), então NÃO pode ficar acessível ao app:
-- views não herdam a RLS da tabela, e sem isto um usuário logado leria o uso
-- dos outros. Assim ela fica só para você, pelo painel.
revoke all on public.uso_por_usuario from anon, authenticated;

-- Detalhe por captura, quando quiser investigar um caso específico.
create or replace view public.capturas_recentes as
select
  to_char(e.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
  u.email,
  e.props->>'origem'                        as origem,   -- gravacao | arquivo | link
  e.props->>'midia'                          as midia,    -- audio | video | texto
  round((e.props->>'duracao_s')::numeric)    as duracao_s,
  e.props->'usage'->>'input_tokens'          as tokens_entrada,
  e.props->'usage'->>'output_tokens'         as tokens_saida,
  round((e.props->'usage'->>'audio_seconds')::numeric) as segundos_audio,
  e.created_at
from public.events e
join auth.users u on u.id = e.user_id
where e.name = 'captura'
order by e.created_at desc;

revoke all on public.capturas_recentes from anon, authenticated;
