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

Vale quando o amigo entra pelo link, cria a conta e faz a primeira
transcrição (eram 3 até 25/09/2026).

Travas: só conta criada há até 7 dias entra por convite; o próprio código e o
mesmo e-mail com `+` ou ponto não valem; cada amigo conta uma vez.

## Onde aparece

- **Landing:** faixa "Um amigo convidou você" para quem chega pelo link, seção
  "Convide amigos" e o Avançado como recomendado.
- **App (web, Android, Windows, iPhone):** "Convidar amigos" na barra lateral,
  aviso no canto quando o prêmio chega, "+25" ao lado do relógio de minutos e
  selo "Apoiador" ao lado do e-mail.
- **Notificação:** no celular (Android e iPhone), quando o prêmio chega. O
  pedido de permissão sai quando a pessoa compartilha o link. No computador não
  há notificação: o aviso aparece ao abrir o app. Sem e-mail.

## Onde mora

- Regras: `backend/main.py` (`LIMITES_PLANO`, `CONVITE_*`).
- Banco: `supabase/convites.sql` e `supabase/dispositivos.sql`.
- Notificação: `frontend/src/lib/notificacoes.js`; credenciais no Render
  (`FCM_SERVICE_ACCOUNT` para o Android, `APNS_KEY`, `APNS_KEY_ID` e
  `APNS_TEAM_ID` para o iPhone) e `google-services.json` no app Android.
- App: `frontend/src/lib/convite.js`, `ConviteModal.jsx`, `PremioAviso.jsx`.
- Testes: `backend/teste-convite.py`, `frontend/e2e-convite-local.mjs`.

## Acesso antecipado

O app recebe `apoiador` no contexto das telas. Função nova em teste aparece
primeiro para quem tem o selo. Ainda não há nenhuma função nessa situação.
