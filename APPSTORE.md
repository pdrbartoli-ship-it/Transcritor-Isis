# Dito — caminho até a App Store

Acompanhamento do app de iPhone. O plano em linguagem não técnica está em
[plano-app-store.md](plano-app-store.md); aqui fica o estado da obra.

Decisões tomadas em 22/09/2026: **opção A** (o app de iPhone não vende; quem
quiser plano pago assina pelo site) e conta de desenvolvedor já criada.

## O que já está pronto ✅

### Exclusão de conta dentro do app

A exigência que mais derruba app na revisão: quem cria conta precisa poder
apagar, sem falar com o suporte. Antes isso era feito à mão, pela skill
`deletauser`.

- `supabase/apagar_conta.sql` — função no banco que apaga, numa transação só,
  todas as linhas do usuário em qualquer tabela pública com coluna `user_id`, e
  por último o cadastro em `auth.users`. A lista de tabelas é descoberta na
  hora, então tabela nova entra sozinha. Não é executável pelo usuário comum.
- `backend/main.py` → `POST /conta/apagar` — confere o token, cancela a
  assinatura no Stripe **antes** (na ordem inversa, uma falha deixaria a pessoa
  sem conta e ainda pagando) e chama a função. O id vem sempre do token, nunca
  do corpo.
- `SettingsModal.jsx` — em Configurações, no fim: aviso do que será apagado, a
  palavra `APAGAR` para confirmar, e a limpeza do que ficou neste aparelho
  (chave do cofre e índice do acervo) antes de sair para o login.
- `Auth.jsx` — confirma na tela de login que a conta foi apagada. Sem isso,
  parece que o app deslogou sozinho.

Vale para as duas lojas e para o site: a Play Store exige o mesmo.

### O app de iPhone não vende

- `platform.js` → `podeVender()` — uma chave só, `false` no iOS. É aqui que a
  compra da Apple será ligada no dia em que existir.
- Some no iPhone: "Meu plano" na lateral, o modal de planos, e todo botão "Ver
  planos" (aviso de saldo, chat esgotado, transcrição completa, captura sem
  saldo). Onde o botão sumiu, a mensagem que explica continua.
- `App.jsx` — dentro do app empacotado a landing não abre mais, vai direto ao
  login. A landing traz a tabela de preços, e preço que não passa pela Apple
  não pode aparecer dentro do app. Isso mudou também para o Android, onde a
  landing aparecia sem motivo.

### Projeto iOS

- `frontend/ios/` criado (Capacitor 8, via Swift Package Manager — não precisa
  de CocoaPods). Bundle id `br.com.albiecloud.dito`, o mesmo do Android.
- `Info.plist` — textos de permissão do microfone e da galeria, em português,
  e a declaração de criptografia (`ITSAppUsesNonExemptEncryption`).
- `PrivacyInfo.xcprivacy` — ficha de privacidade obrigatória desde maio de
  2024, já ligada ao projeto do Xcode. O que está nela tem que bater com o
  questionário preenchido na página da loja.
- Ícones e telas de abertura gerados a partir de `frontend/assets/icon.png`.
- `npm run ios:sync` e `npm run ios:open`, irmãos dos comandos do Android.
- Esquema compartilhado (`App.xcscheme`) versionado. O Xcode cria um sozinho,
  mas dentro da pasta pessoal de quem abre o projeto — sem este no repositório,
  a montagem na nuvem não acha o que construir.

### Montagem na nuvem

`codemagic.yaml`, na raiz, já pronto: instala, monta o site, sincroniza o
projeto iOS, aplica certificado e perfil, numera a build perguntando ao
TestFlight qual foi a última, gera o pacote e sobe.

Não dispara a cada push de propósito. Publicar no iPhone é decisão, não
consequência de salvar um arquivo — a build começa quando você aperta.

## O que falta

### Precisa de você

1. ~~Rodar `supabase/apagar_conta.sql` no SQL Editor do Supabase.~~ Feito em
   22/09/2026, e já testado em produção.
2. **Ligar o Codemagic**, que é meia hora de telas, uma vez só:
   1. [codemagic.io](https://codemagic.io) → entrar com o GitHub → adicionar
      este repositório. Ele acha o `codemagic.yaml` sozinho.
   2. Teams → Integrations → Apple Developer Portal → Connect, e criar ali uma
      chave de App Store Connect. **Dê a ela o nome `dito-app-store-connect`**,
      que é o nome usado no arquivo.
   3. App Store Connect → criar o app com o identificador
      `br.com.albiecloud.dito`, o mesmo do Android. Copie o número que aparece
      na barra de endereço e guarde no Codemagic como variável
      `APP_STORE_APPLE_ID`, no grupo `dito`.
   4. "Start new build" e esperar. A primeira leva uns 15 minutos.
3. ~~Um iPhone para o teste pelo TestFlight.~~ Confirmado em 22/09/2026.
4. **Confirmar a declaração de criptografia.** Marcamos que o Dito usa só
   criptografia isenta (AES padrão do sistema e HTTPS). É declaração legal, não
   ajuste técnico.

### Técnico, depois da conta ligada

1. **Compartilhar de outros apps** — no Android o Dito aparece no menu de
   compartilhar. No iPhone isso é uma extensão separada; ficou fora da primeira
   versão.
2. **Capturas de tela** do iPhone para a página da loja
   (`e2e-store-screenshots.mjs` já faz isso para o Android).
3. **Conta de teste para o revisor**, com saldo, e a nota explicando que o Dito
   transcreve conversas com consentimento de quem é gravado.

## Testado até agora

Em produção, em 22/09/2026, depois do deploy:

- **Servidor, conta vazia.** Convidado descartável criado na hora, `POST
  /conta/apagar` respondeu 200 e o token dele parou de valer. Passou.
- **Servidor, conta com dado dentro.** Mesmo teste, com uma linha em `events`
  antes de apagar. Esse vínculo com `auth.users` não tem cascata, então um 200
  aqui prova que o laço que varre as tabelas rodou — sem ele, o banco teria
  barrado a exclusão do cadastro. Passou.
- **Tela**, com a conta de teste da loja: a seção "Conta" aparece, o aviso cita
  o e-mail certo, o botão nasce travado, palavra errada não destrava, "APAGAR"
  destrava, e Cancelar volta ao estado anterior. Passou.

O clique final não foi dado na conta de teste da loja de propósito: é a conta
que vai para o revisor da Apple. O caminho depois do clique é exatamente o que
os dois testes de servidor já percorreram.

Falta testar no aparelho: o app de iPhone ainda não foi montado, então gravar,
enviar arquivo e apagar a conta pelo iPhone só no TestFlight.
