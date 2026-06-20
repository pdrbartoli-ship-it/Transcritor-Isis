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

- **ID do app:** está como `com.dito.app`. Esse identificador é **permanente**
  na Play Store (não dá pra mudar depois de publicar). Se preferir outro, me
  avise antes de publicarmos.
