-- Exclusão de conta pelo próprio usuário, de dentro do app.
--
-- Exigência da App Store (e da Play Store): todo app que deixa criar conta
-- precisa deixar apagar, sem pedir para falar com o suporte. Até aqui isso era
-- feito à mão, pela skill `deletauser`.
--
-- Por que uma função no banco em vez de uma sequência de DELETEs no backend:
-- a exclusão precisa ser atômica. Apagar metade das tabelas e falhar na outra
-- metade deixa a pessoa com uma conta que existe mas não abre — e sem jeito de
-- tentar de novo. Aqui é uma transação só; qualquer erro desfaz tudo.
--
-- A lista de tabelas é descoberta na hora, não escrita a mão: toda tabela nova
-- com uma coluna `user_id` entra sozinha. Uma tabela esquecida numa lista fixa
-- seria pior que um erro — seria dado de uma pessoa que pediu para sumir
-- continuando no banco sem ninguém notar.
--
-- Rodar no SQL Editor do Supabase antes de publicar a versão que chama isto.

create or replace function public.apagar_conta(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  t      record;
  n      integer;
  saldo  jsonb := '{}'::jsonb;
begin
  if p_user_id is null then
    raise exception 'apagar_conta: user_id é obrigatório';
  end if;

  -- Ordem não importa: todo vínculo entre tabelas públicas é `on delete
  -- cascade`, então apagar qualquer uma delas primeiro é seguro.
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema
       and tb.table_name   = c.table_name
     where c.table_schema = 'public'
       and c.column_name  = 'user_id'
       and tb.table_type  = 'BASE TABLE'
     order by c.table_name
  loop
    execute format('delete from public.%I where user_id = $1', t.table_name)
      using p_user_id;
    get diagnostics n = row_count;
    if n > 0 then
      saldo := saldo || jsonb_build_object(t.table_name, n);
    end if;
  end loop;

  -- Por último o cadastro. O Supabase apaga em cascata o que é dele (sessões,
  -- identidades, tokens), então depois disto o e-mail fica livre para um
  -- cadastro novo.
  delete from auth.users where id = p_user_id;
  get diagnostics n = row_count;
  saldo := saldo || jsonb_build_object('auth_users', n);

  return saldo;
end;
$$;

-- Ninguém chama isto com o token do próprio usuário: só o backend, com a
-- service role, e só depois de conferir de quem é o token. Sem este revoke,
-- um usuário logado poderia apagar a conta de outro passando outro id.
revoke all on function public.apagar_conta(uuid) from public;
revoke all on function public.apagar_conta(uuid) from anon;
revoke all on function public.apagar_conta(uuid) from authenticated;
