-- Plano de assinatura de cada usuário, mantido pelo webhook do Stripe
-- (backend/main.py: /billing/webhook). Só a service role escreve aqui — o
-- usuário só lê a própria linha.
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plano text not null default 'gratuito', -- 'gratuito' | 'iniciante' | 'avancado'
  ciclo text,                              -- 'mensal' | 'anual'
  status text,                             -- status bruto do Stripe: active, past_due, canceled...
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);
