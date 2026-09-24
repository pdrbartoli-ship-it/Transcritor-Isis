# Convite premiado e régua nova

**Decidido em 24/09/2026.** Preços não mudam.

## Planos

| | Grátis | Iniciante | Avançado |
|---|---|---|---|
| Minutos/mês | 100 | 250 | ilimitados |
| Perguntas/mês | 5 | 60 | ilimitadas |
| Selo | | | Recomendado |

O Iniciante é âncora de preço; o destino é o Avançado.

## Convite

| Plano de quem convida | Ganha, por amigo |
|---|---|
| Grátis e Iniciante | +25 minutos e +2 perguntas, valendo no mês em curso |
| Avançado | com 5 amigos, selo de apoiador e acesso antecipado às novidades |

Vale quando o amigo entra pelo link, cria a conta e faz 3 transcrições.

Travas: só conta criada há até 7 dias entra por convite; o próprio código e o
mesmo e-mail com `+` ou ponto não valem; cada amigo conta uma vez.

## Onde aparece

- **Landing:** faixa "Um amigo convidou você" para quem chega pelo link, seção
  "Convide amigos" e o Avançado como recomendado.
- **App (web, Android, Windows, iPhone):** "Convidar amigos" na barra lateral,
  aviso no canto quando o prêmio chega, "+25" ao lado do relógio de minutos e
  selo "Apoiador" ao lado do e-mail.
- **E-mail:** aviso a quem ganhou, com o app fechado (precisa da `RESEND_API_KEY`
  no Render).

## Onde mora

- Regras: `backend/main.py` (`LIMITES_PLANO`, `CONVITE_*`).
- Banco: `supabase/convites.sql`.
- App: `frontend/src/lib/convite.js`, `ConviteModal.jsx`, `PremioAviso.jsx`.
- Testes: `backend/teste-convite.py`, `frontend/e2e-convite-local.mjs`.

## Acesso antecipado

O app recebe `apoiador` no contexto das telas. Função nova em teste aparece
primeiro para quem tem o selo. Ainda não há nenhuma função nessa situação.
