# Dito — caminho até a Play Store

Documento de acompanhamento do empacotamento do Dito como app Android (via Capacitor).

## O que já está pronto ✅

- O site do Dito foi empacotado como app Android usando **Capacitor**.
- O app carrega a interface de dentro dele mesmo e conversa com o backend
  (Render) e o Supabase pelos endereços já existentes.
- O projeto Android fica em `frontend/android/`.
- Já foi gerado e validado um **APK de teste** (`app-debug.apk`) — o app compila
  e instala. Esse arquivo é só para teste, **não serve para a Play Store**.
- Ícone provisório do Dito (letra "D" no terracota da marca, `#C96442`).

## Compartilhar de outros apps para o Dito

O Dito aparece no menu "Compartilhar" do Android para **áudio, vídeo e links**.
O usuário compartilha um áudio do WhatsApp ou um vídeo do YouTube, o app abre e
processa sozinho, caindo no fluxo normal de sugestão de pasta.

Peças envolvidas:

- `AndroidManifest.xml` — dois `intent-filter` de `ACTION_SEND` na MainActivity:
  `audio/*` + `video/*` (arquivo) e `text/plain` (link).
- `SharedContentPlugin.java` — lê o intent. Arquivo vem como `EXTRA_STREAM`,
  uma Uri `content://` com permissão de leitura **temporária**, por isso é
  copiado para o cache na hora; link vem como `EXTRA_TEXT`, texto puro.
- `src/lib/sharedContent.js` — entrega isso ao JS. Do texto extrai só a URL,
  porque o YouTube compartilha título e link juntos.
- `Layout.jsx` → `Home.jsx` → `CapturePanel` — o conteúdo entra pelo mesmo
  `useCapture` do envio manual, então o fluxo de pasta sai de graça.

Como testar sem aparelho: `?compartilhado=<url>` na URL do site percorre o mesmo
caminho do lado JS. É o que o `frontend/e2e-share.mjs` usa.

Só o intent nativo exige pacote novo — a lógica acima chega por OTA.

## Atualização automática do app (OTA)

O app tem live update via `@capgo/capacitor-updater`. Mudanças de **interface e
lógica** chegam ao celular sozinhas, sem gerar APK nem passar pela Play Store.
Só mudança **nativa** (permissão, plugin, ícone, `versionCode`) exige app novo.

Como funciona, a cada push na `main`:

1. O workflow [pages.yml](.github/workflows/pages.yml) faz dois builds — o do app
   (`build:app`, base relativa) e o do site (`build`, subcaminho do Pages).
2. O bundle do app vira `dist/ota/bundle-1.0.<run>.zip`, com o `index.html` na
   raiz do zip (exigência do plugin), e o SHA-256 vai para `dist/ota/latest.json`.
3. Ao abrir, o app faz POST em `/app-update` no backend, que lê esse
   `latest.json` e responde `{version, url, checksum}`.
4. O app baixa em segundo plano e aplica na abertura seguinte.

O endpoint mora no backend porque o plugin exige POST e o GitHub Pages devolve
405 para POST — o Pages só serve o zip e o manifesto por GET.

Rede de segurança: se o bundle novo não chamar `notifyAppReady()` (em
`frontend/src/main.jsx`), o plugin desfaz a atualização sozinho na próxima
abertura. Um bundle quebrado não deixa o app inutilizável.

### Como gerar o app de novo (técnico)

Pré-requisitos no ambiente: Java 21 e Android SDK (platform 35, build-tools 35).

```bash
cd frontend
npm install
npm run app:sync        # build do site + copia para o projeto Android
cd android
JAVA_HOME=<java21> ANDROID_HOME=<sdk> ./gradlew assembleDebug   # APK de teste
```

O APK de teste sai em `frontend/android/app/build/outputs/apk/debug/`.

## O que falta (técnico)

1. **Ícone definitivo** — trocar o provisório pelo ícone oficial do Dito
   (precisa de uma imagem 1024×1024). Depois é só rodar o gerador de ícones.
2. **Chave de assinatura (keystore)** — todo app na Play Store precisa ser
   "assinado" com uma chave secreta. Ela é gerada uma vez e **tem que ser
   guardada com muito cuidado** (se perder, não dá pra atualizar o app depois).
3. **Gerar o pacote de release (AAB)** — em vez do APK de teste, a Play Store
   pede um arquivo `.aab` assinado:
   ```bash
   cd frontend/android
   ./gradlew bundleRelease
   ```
4. **Permissões** — revisar o `AndroidManifest.xml` para declarar só o que o
   app usa (ex.: internet; microfone/arquivos se formos gravar pelo celular).

## O que falta (não-técnico — com o Pedro)

1. **Conta de desenvolvedor Google Play** — US$ 25, uma vez só. Só você pode
   criar (ligada ao seu documento/cartão). Necessária na hora de enviar.
2. **Política de privacidade** — texto numa página pública explicando que o app
   lida com áudios/conversas e usa IA para transcrever/resumir. (Posso redigir.)
3. **Material da loja** — nome, descrições, capturas de tela, imagem de capa,
   classificação etária e questionário de dados da Google.
4. **Teste fechado** — a Google exige um período de testes com algumas pessoas
   antes de liberar pro público.

## Decisões em aberto

- **ID do app:** está como `br.com.albiecloud.dito` (cadastrado no Play Console em 13/08/2026). Esse identificador é **permanente**
  na Play Store (não dá pra mudar depois de publicar). Se preferir outro, me
  avise antes de publicarmos.
