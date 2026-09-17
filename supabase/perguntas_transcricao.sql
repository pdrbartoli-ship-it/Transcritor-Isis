-- Limite de perguntas por transcrição (planos Grátis e Iniciante).
-- Rode no Supabase: SQL Editor → New query → Run.
--
-- Pode rodar antes ou depois do deploy do backend: enquanto a função não
-- existir, o backend deixa as perguntas passarem sem contar e registra isso no
-- log — o contador é alavanca de venda, não trava de segurança.
--
-- Tabela própria, e não uma coluna em `sessions`: o usuário edita a própria
-- linha de `sessions` (renomear, fixar), e um contador ali seria zerável por
-- quem ele limita. Aqui o app só lê; escrever, só o backend com a service role.
create table if not exists public.perguntas_transcricao (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  perguntas_usadas int not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table public.perguntas_transcricao enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'perguntas_transcricao'
      and policyname = 'perguntas_transcricao_select_own'
  ) then
    create policy perguntas_transcricao_select_own on public.perguntas_transcricao
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- Gasta uma pergunta, se ainda houver. Devolve quantas já foram usadas
-- contando esta, ou NULL quando o limite já tinha sido atingido. Conferir e
-- somar na mesma instrução é o que impede duas perguntas simultâneas de
-- passarem juntas do limite.
create or replace function public.consumir_pergunta(
  p_user_id uuid,
  p_session_id uuid,
  p_limite int
) returns int
language plpgsql
as $$
declare
  usadas int;
begin
  -- Sem isto, o id de uma conversa alheia gastaria o saldo de outra pessoa.
  if not exists (
    select 1 from public.sessions where id = p_session_id and user_id = p_user_id
  ) then
    raise exception 'conversa não pertence ao usuário';
  end if;

  insert into public.perguntas_transcricao (session_id, user_id, perguntas_usadas)
  values (p_session_id, p_user_id, 1)
  on conflict (session_id) do update
    set perguntas_usadas = perguntas_transcricao.perguntas_usadas + 1,
        atualizado_em = now()
    where perguntas_transcricao.perguntas_usadas < p_limite
  returning perguntas_usadas into usadas;

  return usadas;
end;
$$;

-- Devolve a pergunta quando a IA falhou: quem recebeu um erro não perdeu nada.
create or replace function public.devolver_pergunta(p_session_id uuid)
returns void
language sql
as $$
  update public.perguntas_transcricao
     set perguntas_usadas = greatest(0, perguntas_usadas - 1),
         atualizado_em = now()
   where session_id = p_session_id;
$$;

-- Sem isto, um usuário logado chamaria as funções direto e zeraria ou gastaria
-- o contador pelo navegador.
revoke all on function public.consumir_pergunta(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.devolver_pergunta(uuid) from public, anon, authenticated;
grant execute on function public.consumir_pergunta(uuid, uuid, int) to service_role;
grant execute on function public.devolver_pergunta(uuid) to service_role;
