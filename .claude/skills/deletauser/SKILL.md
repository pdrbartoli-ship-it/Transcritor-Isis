---
name: deletauser
description: Apaga um usuário de teste do Dito por completo — todos os dados relacionados nas tabelas públicas e o cadastro em auth.users. Use quando o usuário pedir para "deletar", "apagar" ou "excluir" um usuário/conta de teste do app pelo e-mail.
---

Apaga um usuário do Dito (dados + cadastro) no Supabase de produção, pelo e-mail.

## 1. Pedir o e-mail

Se o e-mail do usuário a apagar não veio junto no comando, pergunte antes de continuar. Nunca rode isso "no escuro" — a ação é destrutiva e irreversível.

## 2. Conectar no banco

O `DATABASE_URL` do `.env` do projeto aponta pro host direto do Postgres (`db.<ref>.supabase.co:5432`), que só tem endereço IPv6 — inacessível a partir deste sandbox. Use o **pooler** (IPv4) já conhecido deste projeto:

- host: `aws-1-us-west-2.pooler.supabase.com`
- port: `6543`
- user: `postgres.<project-ref>` (o `<project-ref>` é o subdomínio do host original, ex: `hgmwngasnltlrqlwimdj`)
- password: a mesma senha do `DATABASE_URL` do `.env`
- dbname: `postgres`

Se esse host/porta não responder (projeto pode ter mudado de região), peça ao usuário a connection string do "Transaction pooler" em Supabase → botão **Connect** (topo do dashboard) → aba de connection string, e use a que ele mandar.

Use `psycopg2` (já disponível no ambiente) para conectar.

## 3. Encontrar o usuário

```sql
select id, email, created_at from auth.users where email ilike '<email>';
```

- Se **0 resultados**: avise que não achou ninguém com esse e-mail e pare — não invente nada.
- Se **mais de 1 resultado**: mostre a lista e peça ao usuário para confirmar qual `id` apagar.
- Se **exatamente 1 resultado**: siga para o passo 4, mostrando ao usuário o e-mail/id encontrado antes de apagar (para ele saber que é o usuário certo).

## 4. Descobrir quais tabelas têm dado desse usuário

Não assuma a lista de tabelas de cabeça — o schema pode mudar. Descubra dinamicamente:

```sql
select table_name from information_schema.columns
where table_schema = 'public' and column_name = 'user_id'
order by table_name;
```

## 5. Apagar tudo numa transação

Para cada tabela encontrada no passo 4, apague as linhas do `user_id` em questão, e por último apague o próprio cadastro em `auth.users`. Tudo dentro de uma única transação (autocommit desligado), com rollback automático se algo falhar:

```python
import psycopg2, re

url = [l.split('=',1)[1].strip() for l in open('.env') if l.startswith('DATABASE_URL')][0]
m = re.match(r'postgresql://postgres:(.+)@db\.([^.]+)\.supabase\.co:5432/postgres', url)
pw, ref = m.group(1), m.group(2)

uid = '<uuid-encontrado-no-passo-3>'

conn = psycopg2.connect(host="aws-1-us-west-2.pooler.supabase.com", port=6543,
                         user=f"postgres.{ref}", password=pw, dbname="postgres", connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

try:
    for t in tabelas_do_passo_4:
        cur.execute(f"delete from public.{t} where user_id = %s", (uid,))
        print(t, "->", cur.rowcount, "linhas apagadas")

    cur.execute("delete from auth.users where id = %s", (uid,))
    print("auth.users ->", cur.rowcount, "linha apagada")

    conn.commit()
    print("COMMIT ok")
except Exception as e:
    conn.rollback()
    print("ERRO, rollback feito:", e)
finally:
    conn.close()
```

## 6. Reportar

Resuma pro usuário quantas linhas saíram de cada tabela e confirme que o cadastro foi removido. Se o e-mail já estava livre pra recadastro, diga isso também.

## Regras de segurança

- Nunca apague por nome parcial sem confirmar — sempre pelo `id` exato achado no passo 3.
- Nunca apague mais de um usuário na mesma execução, a menos que o usuário peça isso explicitamente.
- Nunca use `%<algo>%` (ILIKE com wildcard) no DELETE — só no SELECT de busca do passo 3. O DELETE é sempre por `id` exato.
