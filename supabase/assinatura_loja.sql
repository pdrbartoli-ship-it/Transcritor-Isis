-- De onde veio cada assinatura. Rodar no SQL Editor do Supabase.
--
-- Até aqui a tabela `subscriptions` só sabia falar Stripe. Com a compra dentro
-- do app de iPhone (e, em seguida, do Android), a mesma linha passa a poder ter
-- nascido numa loja — e isso muda duas decisões do servidor:
--
--   1. Quem assinou pela loja não pode ser mandado para o Portal do Stripe:
--      não existe cliente do Stripe por trás dessa assinatura.
--   2. Apagar a conta não cancela uma assinatura de loja. Só quem comprou pode
--      cancelar, nos ajustes do aparelho. O servidor não tem esse poder, e
--      fingir que tem deixaria a pessoa sem conta e ainda pagando.
--
-- `origem` nasce com 'stripe' para que toda linha que já existe continue
-- valendo exatamente o que valia — ninguém precisa ser migrado.
alter table public.subscriptions
  add column if not exists origem text not null default 'stripe',
  add column if not exists loja_assinatura_id text;

-- A restrição vem depois das colunas e com `not valid` desligado de propósito:
-- as linhas antigas já satisfazem o default, então não há nada a validar à
-- parte. Se um dia entrar uma loja nova, é aqui que ela é reconhecida.
do $$
begin
  alter table public.subscriptions
    add constraint subscriptions_origem_check
    check (origem in ('stripe', 'apple', 'google'));
exception
  when duplicate_object then null;
end $$;

-- O webhook das lojas acha o dono pelo id da compra, como o do Stripe já acha
-- pela `stripe_subscription_id`. Sem o índice, essa busca é varredura de tabela
-- em cada evento de renovação.
create unique index if not exists subscriptions_loja_assinatura_id_idx
  on public.subscriptions (loja_assinatura_id)
  where loja_assinatura_id is not null;

-- O "Meu plano" precisa saber a origem para escolher entre o Portal do Stripe e
-- a tela de assinaturas do aparelho. A policy de leitura da própria linha já
-- cobre as colunas novas (supabase/subscriptions.sql), então não há policy nova.
