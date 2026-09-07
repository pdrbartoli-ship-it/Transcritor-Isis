-- Consumo do ciclo corrente de cada usuário, mantido pelo backend
-- (backend/main.py: registrar_uso). Uma linha por usuário, não uma por mês: o
-- histórico já vive em `events`, aqui só interessa o ciclo em curso.
create table public.uso_mensal (
  user_id uuid primary key references auth.users(id) on delete cascade,
  periodo_inicio timestamptz not null default now(),
  periodo_fim timestamptz not null,
  minutos_usados numeric not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table public.uso_mensal enable row level security;

-- O app lê o próprio saldo para mostrar no "Meu plano"; escrever, só o backend
-- com a service role — senão o saldo seria editável por quem ele limita.
create policy uso_mensal_select_own on public.uso_mensal
  for select using (auth.uid() = user_id);

-- Virada de ciclo e incremento na mesma transação. Duas capturas em paralelo
-- fazendo ler-somar-escrever pelo backend se sobrescreveriam; aqui não.
-- p_periodo_fim vem do current_period_end do Stripe quando o usuário paga, e
-- é nulo para quem é gratuito — daí o mês cheio a partir de agora.
create function public.registrar_uso(
  p_user_id uuid,
  p_minutos numeric,
  p_periodo_fim timestamptz default null
) returns public.uso_mensal
language plpgsql
as $$
declare
  linha public.uso_mensal;
  -- Um p_periodo_fim no passado (webhook do Stripe atrasado, assinatura
  -- vencida) faria o ciclo virar a cada captura, e aí o teto nunca valeria.
  fim timestamptz := case
    when p_periodo_fim is not null and p_periodo_fim > now() then p_periodo_fim
    else now() + interval '1 month'
  end;
begin
  insert into public.uso_mensal (user_id, periodo_inicio, periodo_fim, minutos_usados)
  values (p_user_id, now(), fim, p_minutos)
  on conflict (user_id) do update set
    periodo_inicio = case when now() > uso_mensal.periodo_fim then now() else uso_mensal.periodo_inicio end,
    periodo_fim    = case when now() > uso_mensal.periodo_fim then fim else uso_mensal.periodo_fim end,
    minutos_usados = case when now() > uso_mensal.periodo_fim then p_minutos else uso_mensal.minutos_usados + p_minutos end,
    atualizado_em  = now()
  returning * into linha;
  return linha;
end;
$$;

-- Sem isto, um usuário logado poderia chamar a função com o id de outro e
-- queimar o saldo alheio.
revoke all on function public.registrar_uso(uuid, numeric, timestamptz) from anon, authenticated;
