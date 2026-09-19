-- Perguntas por mês, um valor único por usuário (Grátis 5, Iniciante 60,
-- Avançado sem limite), valendo para o chat de cada conversa e para o chat
-- geral "Perguntar ao acervo". Substitui o contador por transcrição
-- (perguntas_transcricao.sql), que fica no banco sem uso — nada é apagado.
-- Rode no Supabase: SQL Editor → New query → Run.
--
-- É seguro rodar ANTES do deploy do backend: só acrescenta uma coluna e duas
-- funções, e recria registrar_uso com a mesma assinatura. O backend atual
-- continua usando o contador antigo até o deploy da versão nova.
--
-- O contador mora em `uso_mensal`, ao lado dos minutos, de propósito: os dois
-- seguem o mesmo ciclo (o do Stripe para quem paga, o mês corrido para o
-- gratuito) e viram juntos. Duas tabelas teriam dois "meses" diferentes e a
-- tela mostraria saldos que renovam em dias distintos.

alter table public.uso_mensal
  add column if not exists perguntas_usadas int not null default 0;

-- registrar_uso ganha uma linha: na virada de ciclo as perguntas também
-- zeram. Fora isso é idêntica à de uso_mensal.sql.
create or replace function public.registrar_uso(
  p_user_id uuid,
  p_minutos numeric,
  p_periodo_fim timestamptz default null
) returns public.uso_mensal
language plpgsql
as $$
declare
  linha public.uso_mensal;
  fim timestamptz := case
    when p_periodo_fim is not null and p_periodo_fim > now() then p_periodo_fim
    else now() + interval '1 month'
  end;
begin
  insert into public.uso_mensal (user_id, periodo_inicio, periodo_fim, minutos_usados)
  values (p_user_id, now(), fim, p_minutos)
  on conflict (user_id) do update set
    periodo_inicio   = case when now() > uso_mensal.periodo_fim then now() else uso_mensal.periodo_inicio end,
    periodo_fim      = case when now() > uso_mensal.periodo_fim then fim else uso_mensal.periodo_fim end,
    minutos_usados   = case when now() > uso_mensal.periodo_fim then p_minutos else uso_mensal.minutos_usados + p_minutos end,
    perguntas_usadas = case when now() > uso_mensal.periodo_fim then 0 else uso_mensal.perguntas_usadas end,
    atualizado_em    = now()
  returning * into linha;
  return linha;
end;
$$;

-- Gasta uma pergunta do mês. Devolve quantas já foram usadas contando esta,
-- ou NULL quando o limite já tinha sido atingido. p_limite NULL é "sem
-- limite": só conta (o Avançado é contado do mesmo jeito, e é isso que deixa
-- ligar um teto de uso justo depois sem migrar nada).
--
-- Conferir e somar na mesma instrução é o que impede duas perguntas
-- simultâneas de passarem juntas do limite. A virada de ciclo também
-- acontece aqui: quem pergunta antes de capturar no mês novo não pode ficar
-- preso ao saldo do mês velho.
create or replace function public.consumir_pergunta_mes(
  p_user_id uuid,
  p_limite int default null,
  p_periodo_fim timestamptz default null
) returns int
language plpgsql
as $$
declare
  usadas int;
  fim timestamptz := case
    when p_periodo_fim is not null and p_periodo_fim > now() then p_periodo_fim
    else now() + interval '1 month'
  end;
begin
  if p_limite is not null and p_limite <= 0 then
    return null;
  end if;

  insert into public.uso_mensal (user_id, periodo_inicio, periodo_fim, minutos_usados, perguntas_usadas)
  values (p_user_id, now(), fim, 0, 1)
  on conflict (user_id) do update set
    periodo_inicio   = case when now() > uso_mensal.periodo_fim then now() else uso_mensal.periodo_inicio end,
    periodo_fim      = case when now() > uso_mensal.periodo_fim then fim else uso_mensal.periodo_fim end,
    minutos_usados   = case when now() > uso_mensal.periodo_fim then 0 else uso_mensal.minutos_usados end,
    perguntas_usadas = case when now() > uso_mensal.periodo_fim then 1 else uso_mensal.perguntas_usadas + 1 end,
    atualizado_em    = now()
  where p_limite is null
     or now() > uso_mensal.periodo_fim
     or uso_mensal.perguntas_usadas < p_limite
  returning perguntas_usadas into usadas;

  return usadas;
end;
$$;

-- Devolve a pergunta quando a IA falhou: quem recebeu um erro não perdeu nada.
create or replace function public.devolver_pergunta_mes(p_user_id uuid)
returns void
language sql
as $$
  update public.uso_mensal
     set perguntas_usadas = greatest(0, perguntas_usadas - 1),
         atualizado_em = now()
   where user_id = p_user_id;
$$;

-- Sem isto, um usuário logado chamaria as funções direto, com o id de outro,
-- e gastaria ou zeraria o contador alheio pelo navegador. Funções novas no
-- Supabase nascem executáveis por anon/authenticated, por isso o revoke.
revoke all on function public.consumir_pergunta_mes(uuid, int, timestamptz) from public, anon, authenticated;
revoke all on function public.devolver_pergunta_mes(uuid) from public, anon, authenticated;
grant execute on function public.consumir_pergunta_mes(uuid, int, timestamptz) to service_role;
grant execute on function public.devolver_pergunta_mes(uuid) to service_role;

-- Conferência: deve devolver  1 | 3 | false | false | true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'uso_mensal'
      and column_name = 'perguntas_usadas')                                  as coluna_criada,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_uso', 'consumir_pergunta_mes', 'devolver_pergunta_mes')) as funcoes,
  has_function_privilege('anon',         'public.consumir_pergunta_mes(uuid,int,timestamptz)', 'execute') as anon_pode,
  has_function_privilege('authenticated','public.consumir_pergunta_mes(uuid,int,timestamptz)', 'execute') as logado_pode,
  has_function_privilege('service_role', 'public.consumir_pergunta_mes(uuid,int,timestamptz)', 'execute') as backend_pode;
