-- Convite premiado (24/09/2026).
--
-- Quem convida ganha quando o amigo entra pelo link, cria a conta e faz a
-- primeira transcrição (eram 3 até 25/09/2026):
--   · Grátis e Iniciante: +25 minutos e +2 perguntas, valendo no ciclo em curso.
--   · Avançado (já ilimitado): cada amigo conta para os 5 que tornam a pessoa
--     apoiadora, com acesso antecipado às novidades.
--
-- Rode no Supabase: SQL Editor → New query → Run.
--
-- Precisa rodar ANTES do deploy do backend e do app: a versão nova lê as
-- colunas novas de `uso_mensal`. Rodar antes não quebra nada da versão atual,
-- que não conhece nem pede essas colunas.

-- ── 1. Bônus do ciclo, ao lado do saldo ──────────────────────────────────
-- O bônus soma ao limite do plano e vale até `extra_ate`, que é o fim do ciclo
-- em que ele foi ganho. Na virada do ciclo ele simplesmente deixa de valer:
-- ninguém precisa zerá-lo, e as funções de consumo (registrar_uso,
-- consumir_pergunta_mes) continuam exatamente como estão.
alter table public.uso_mensal
  add column if not exists minutos_extra   numeric not null default 0,
  add column if not exists perguntas_extra int     not null default 0,
  add column if not exists extra_ate       timestamptz;

-- ── 2. O código de convite de cada pessoa ────────────────────────────────
-- `apoiador_desde` mora aqui porque é uma conquista do programa de convite:
-- uma vez ganha, fica, mesmo que a pessoa troque de plano depois.
create table if not exists public.convite_codigos (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  codigo         text not null unique,
  apoiador_desde timestamptz,
  criado_em      timestamptz not null default now()
);

-- ── 3. Quem entrou pelo convite de quem ──────────────────────────────────
-- Uma linha por amigo (a chave é o amigo): ninguém entra por dois convites.
-- `premio` diz o que a validação rendeu a quem convidou ('minutos' ou
-- 'progresso', no Avançado), e `visto_em` é quando o app mostrou isso a ele.
create table if not exists public.convites (
  convidado_id uuid primary key references auth.users(id) on delete cascade,
  dono_id      uuid not null references auth.users(id) on delete cascade,
  capturas     int  not null default 0,
  criado_em    timestamptz not null default now(),
  valido_em    timestamptz,
  premio       text,
  visto_em     timestamptz
);
create index if not exists convites_dono_idx on public.convites (dono_id);

-- As duas tabelas ficam fechadas: RLS ligada e nenhuma policy. Só o backend,
-- com a service role, lê e escreve. Assim ninguém forja um convite válido nem
-- descobre quem entrou pelo link de outra pessoa.
alter table public.convite_codigos enable row level security;
alter table public.convites        enable row level security;

-- ── 4. Contar a transcrição do amigo ─────────────────────────────────────
-- Chamada a cada captura que deu certo. Devolve o id de quem convidou só na
-- captura que completa a meta; em qualquer outra, null. Conferir e marcar na
-- mesma instrução impede duas capturas simultâneas de premiarem duas vezes.
create or replace function public.contar_captura_convite(
  p_convidado uuid,
  p_meta int default 1
) returns uuid
language plpgsql
as $$
declare
  dono uuid;
begin
  update public.convites
     set capturas  = capturas + 1,
         valido_em = case when capturas + 1 >= p_meta then now() else null end
   where convidado_id = p_convidado
     and valido_em is null
  returning case when valido_em is not null then dono_id end into dono;
  return dono;
end;
$$;

-- ── 5. Dar o bônus do mês a quem convidou ────────────────────────────────
-- Soma ao bônus do ciclo em curso, virando o ciclo se ele já venceu (o mesmo
-- cálculo de registrar_uso). Bônus de um ciclo passado é descartado, não
-- somado: o que vale é o do mês.
create or replace function public.premiar_convite_minutos(
  p_user_id uuid,
  p_minutos numeric,
  p_perguntas int,
  p_periodo_fim timestamptz default null
) returns void
language plpgsql
as $$
declare
  fim timestamptz := case
    when p_periodo_fim is not null and p_periodo_fim > now() then p_periodo_fim
    else now() + interval '1 month'
  end;
begin
  insert into public.uso_mensal (
    user_id, periodo_inicio, periodo_fim, minutos_usados, perguntas_usadas,
    minutos_extra, perguntas_extra, extra_ate
  )
  values (p_user_id, now(), fim, 0, 0, p_minutos, p_perguntas, fim)
  on conflict (user_id) do update set
    periodo_inicio   = case when now() > uso_mensal.periodo_fim then now() else uso_mensal.periodo_inicio end,
    periodo_fim      = case when now() > uso_mensal.periodo_fim then fim else uso_mensal.periodo_fim end,
    minutos_usados   = case when now() > uso_mensal.periodo_fim then 0 else uso_mensal.minutos_usados end,
    perguntas_usadas = case when now() > uso_mensal.periodo_fim then 0 else uso_mensal.perguntas_usadas end,
    minutos_extra    = case when uso_mensal.extra_ate is null or uso_mensal.extra_ate <= now()
                             then p_minutos else uso_mensal.minutos_extra + p_minutos end,
    perguntas_extra  = case when uso_mensal.extra_ate is null or uso_mensal.extra_ate <= now()
                             then p_perguntas else uso_mensal.perguntas_extra + p_perguntas end,
    extra_ate        = case when now() > uso_mensal.periodo_fim then fim else uso_mensal.periodo_fim end,
    atualizado_em    = now();
end;
$$;

-- Funções novas nascem executáveis por anon/authenticated. Sem o revoke, um
-- usuário logado daria bônus a si mesmo pelo navegador.
revoke all on function public.contar_captura_convite(uuid, int) from public, anon, authenticated;
revoke all on function public.premiar_convite_minutos(uuid, numeric, int, timestamptz) from public, anon, authenticated;
grant execute on function public.contar_captura_convite(uuid, int) to service_role;
grant execute on function public.premiar_convite_minutos(uuid, numeric, int, timestamptz) to service_role;

-- Conferência: deve devolver  3 | 2 | 2 | false | true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'uso_mensal'
      and column_name in ('minutos_extra', 'perguntas_extra', 'extra_ate'))       as colunas_bonus,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('convite_codigos', 'convites')) as tabelas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('contar_captura_convite', 'premiar_convite_minutos'))       as funcoes,
  has_function_privilege('authenticated', 'public.premiar_convite_minutos(uuid,numeric,int,timestamptz)', 'execute') as logado_pode,
  has_function_privilege('service_role',  'public.premiar_convite_minutos(uuid,numeric,int,timestamptz)', 'execute') as backend_pode;
