# App nativo Windows (Tauri) para gravar reunião — plano exaustivo

## Contexto

O PWA não resolve o problema de verdade: pra gravar áudio do sistema o
Chrome sempre mostra o seletor "compartilhar tela + áudio", toda vez que o
usuário clica em gravar. Isso ficou ruim na prática — o usuário também não
quer dois botões (microfone vs reunião), quer **um botão só** que grave tudo
(sistema + microfone) sempre que apertado.

A solução é sair do navegador pro sistema operacional: empacotar o mesmo
frontend React num app nativo Windows com **Tauri**, e usar a API WASAPI do
próprio Windows (via Rust) pra capturar o áudio do sistema em modo
*loopback* — isso não pede permissão nenhuma, não mostra seletor nenhum, e
funciona por trás do botão único de sempre.

Decisões fechadas com o usuário:
- **Tauri**, não Electron (instalador menor, reaproveita o React atual).
- **Um botão só**, o mesmo que já existia antes do botão de "Reunião" —
  grava sistema + microfone misturados, sempre. Arquivo e link **não mudam**.
- **O app nativo substitui o PWA** como forma de usar o Dito no desktop. A
  caixa "Baixar o app" na landing continua com o mesmo texto — só o que
  acontece por trás do clique muda (baixa o instalador `.exe`, não dispara
  mais o `beforeinstallprompt`).
- Mac/Linux ficam de fora por enquanto (Windows é o alvo).

Design da captura de áudio (pesquisado e validado nesta sessão): crate
`wasapi` (Rust, Windows-only, com suporte documentado a loopback via
`AUDCLNT_STREAMFLAGS_LOOPBACK`) pra **ambos** os streams — microfone e
loopback do dispositivo de saída padrão — cada um em sua própria thread,
normalizados pra 48kHz mono f32, misturados por soma+clamp numa thread
mixer/writer que escreve incrementalmente num `.wav` via `hound` (sem
precisar guardar a gravação inteira em memória). `cpal` foi descartado
porque não expõe loopback capture no Windows.

## Arquitetura geral

```
┌─────────────────────────────┐
│   React (mesmo frontend)     │  ← reaproveitado quase 100%
│   useCapture.js decide:      │
│   dentro do Tauri? → invoke  │
│   senão (web) → mic só, como │
│   sempre funcionou            │
└──────────────┬────────────────┘
               │ tauri invoke('start_recording' / 'stop_recording')
┌──────────────▼────────────────┐
│   Rust (src-tauri)             │
│   thread mic (wasapi capture)  │→┐
│   thread sistema (wasapi       │ ├→ mixer/writer thread → arquivo .wav
│     loopback)                  │→┘
└─────────────────────────────────┘
               │ stop_recording() devolve o caminho do .wav
┌──────────────▼────────────────┐
│ JS lê o arquivo (fs do Tauri)  │
│ vira File → transcribeFile()   │  ← pipeline de upload/transcrição
│ (EXATAMENTE como já funciona)  │     intacto, sem mudança de backend
└─────────────────────────────────┘
```

## Fase 1 — Projeto Tauri

- `npm install -D @tauri-apps/cli` e `@tauri-apps/api` em `frontend/`;
  `cargo install tauri-cli` não é necessário (usa via npx/npm script).
- `frontend/src-tauri/` novo: `tauri.conf.json` apontando
  `frontendDist: "../dist"` e `devUrl: "http://localhost:5173"` (padrão do
  Tauri, equivalente ao `webDir` do Capacitor em `capacitor.config.json`).
- Novo script de build reaproveitando o padrão que já existe pra Capacitor
  em [package.json:10](frontend/package.json#L10)
  (`"build:app": "cross-env CAPACITOR=1 vite build"`): adicionar
  `"build:tauri": "cross-env CAPACITOR=1 vite build"` (mesma base relativa
  `./` já suportada em [vite.config.js:7](frontend/vite.config.js#L7) —
  nenhuma mudança no Vite é necessária, só reaproveitar a env var existente
  ou criar uma nova `TAURI=1` se quiser distinguir os dois builds no futuro).
- `frontend/src-tauri/Cargo.toml`: dependências `tauri`, `wasapi`, `hound`,
  `rubato`, `crossbeam-channel`, `serde`/`serde_json` (padrão Tauri).
- `appId` novo, ex. `br.com.albiecloud.dito.desktop`, nome "Dito", ícone
  reaproveitando `frontend/assets/icon.png` (já existe, mesmo usado no
  Capacitor/manifest).

## Fase 2 — Captura de áudio em Rust

Arquivos novos:
- `frontend/src-tauri/src/audio/mod.rs`: as três threads (mic, loopback,
  mixer/writer) descritas na arquitetura acima.
  - Captura: `IAudioClient::Initialize` em modo evento pra cada
    dispositivo (mic em modo captura normal; saída padrão em modo
    loopback), lendo via `IAudioCaptureClient::GetBuffer`.
  - Normalização: cada stream convertido para 48kHz mono f32 (resample via
    `rubato` quando a taxa nativa do dispositivo for diferente; downmix
    estéreo→mono por média simples).
  - Mixagem: soma amostra-a-amostra dos dois streams normalizados, com
    `clamp(-1.0, 1.0)` antes de converter pra i16 e escrever no `hound::WavWriter`
    (aberto no `start_recording`, com `BufWriter<File>`, finalizado no `stop`).
  - Degradação graciosa: sem microfone → grava só o sistema; sem
    dispositivo de saída padrão → grava só o mic; sem os dois →
    `start_recording()` retorna `Err`. Desconexão/troca de formato no meio
    (ex. headset Bluetooth trocando de perfil HFP/A2DP) tenta uma
    reinicialização automática daquele stream; se falhar de novo, só aquele
    stream para (a gravação continua com o outro), emitindo um evento
    `recording-warning` pro JS avisar o usuário sem abortar tudo.
- `frontend/src-tauri/src/commands.rs`: comandos Tauri expostos ao JS —
  ```rust
  #[tauri::command]
  fn start_recording(state: State<RecordingState>) -> Result<(), String>

  #[tauri::command]
  fn stop_recording(state: State<RecordingState>) -> Result<String, String> // caminho do .wav
  ```
  Superfície mínima de propósito: o Rust só entrega "aqui está o `.wav`";
  todo o resto (estimativa de tempo, upload, erro de transcrição vazia,
  sugestão de pasta) continua no JS, sem duplicar lógica.
- WASAPI loopback não exige nenhuma permissão/manifesto especial no
  Windows (diferente do microfone, que passa pelo toggle de privacidade do
  Windows — tratado com o mesmo padrão de erro que já existe pro mic hoje).

## Fase 3 — Integração no frontend (reaproveitando o que já existe)

- **Reverter o UI de dois botões**: [CaptureWeb.jsx](frontend/src/components/capture/CaptureWeb.jsx)
  volta a ter **um único** `record-btn` (como era antes da feature de
  "Reunião" — remover `record-btn-group`, `IconScreen`, o segundo botão e o
  texto de dica sobre "Tela inteira"). Arquivo/link continuam intocados,
  exatamente como o usuário pediu.
- **`useCapture.js`**: remove `startSystemRecording`/`recordingKind`/
  `systemAudioErrorMessage` (era o modo "dois botões", não serve mais).
  `startRecording()`/`stopRecording()` passam a checar se está rodando
  dentro do Tauri (`window.__TAURI__` ou `import { isTauri } from
  '@tauri-apps/api/core'`):
  - **Dentro do Tauri**: `startRecording` chama
    `invoke('start_recording')`; `stopRecording` chama
    `invoke('stop_recording')`, lê o `.wav` retornado via
    `@tauri-apps/plugin-fs` (`readFile`), monta um `File` (`gravacao.wav`,
    `audio/wav`) e segue pro **mesmo** `submitRecording()`/`transcribeFile()`
    de sempre — nenhuma mudança em `frontend/src/lib/api.js` nem no backend
    (`wav` já está na lista de formatos aceitos direto, ver pesquisa
    anterior desta sessão sobre `DIRECT_CONTAINERS` em `backend/main.py`).
  - **No navegador normal (site, não instalado)**: continua exatamente
    como hoje — `getUserMedia` + `MediaRecorder`, mic apenas. O botão único
    já cobre os dois casos sem branch visível pro usuário — só troca o que
    acontece por trás.
- **`frontend/src/lib/platform.js`**: nova função `isTauriApp()` (padrão de
  `isNative()`/`isStandalonePwa()` já existentes), usada só internamente
  pelo `useCapture.js` — não precisa mudar `usePlatform()`/`CapturePanel.jsx`,
  já que `CaptureWeb` continua sendo a view certa tanto no navegador quanto
  dentro do Tauri (a janela do Tauri roda a mesma resolução/desktop).

## Fase 4 — Descomissionar o PWA no desktop

- **Landing ([Landing.jsx](frontend/src/pages/Landing.jsx))**: mantém a
  mesma caixa "Baixar o app" (texto igual, conforme pedido). O botão troca
  de comportamento: em vez de `useInstallPrompt`/`beforeinstallprompt`,
  vira um link direto pro instalador (`Dito-Setup-x.y.z.exe`, ver Fase 5) —
  ex. `<a className="btn-primary btn-full" href="/download/Dito-Setup-latest.exe">`.
  Remove a checagem `canInstall`/texto de fallback "abra no Chrome ou
  Edge" (não se aplica mais).
- Remove `frontend/src/lib/useInstallPrompt.js` (não usado mais em lugar
  nenhum).
- `frontend/public/manifest.json` e `frontend/public/sw.js`: **removidos**
  — sem eles não haverá mais `beforeinstallprompt`/instalação como PWA
  (intencional: o app nativo é o caminho agora). Tira também a
  `<link rel="manifest">` do `index.html` e o registro do service worker em
  `main.jsx` ([main.jsx](frontend/src/main.jsx), o bloco adicionado na
  sessão anterior).
- `App.jsx`: `isStandalonePwa()`/redirect direto pro `/auth` dentro de
  standalone deixa de fazer sentido (ninguém mais instala como PWA) —
  troca pela checagem `isTauriApp()`: dentro do app nativo, pula a Landing
  e vai direto pro `/auth` (mesmo comportamento de "app já instalado", só
  trocando o critério de detecção).

## Fase 5 — Build, assinatura e distribuição

- **CI**: o workflow atual (`.github/workflows/deploy.yml`) roda só em
  `ubuntu-latest` — build de `.exe` do Tauri **precisa** de um runner
  Windows (`windows-latest`), já que cross-compilar pra `x86_64-pc-windows-msvc`
  a partir do Linux não é viável pra um binário Tauri com WebView2 nativo.
  Novo job separado no mesmo workflow (ou workflow próprio
  `build-desktop.yml`), rodando em `windows-latest`, com
  `tauri-apps/tauri-action` (action oficial) pra gerar o instalador
  (`.msi` ou NSIS `.exe`) e opcionalmente publicar como GitHub Release.
- **Assinatura de código**: instalador não assinado dispara aviso do
  SmartScreen do Windows ("Windows protegeu seu PC") — isto é uma fricção
  real pro usuário final baixar e abrir. Fora do escopo imediato (custa
  dinheiro — certificado de assinatura de código), mas **precisa constar
  como risco conhecido** no rollout inicial; usuário vai precisar clicar em
  "Mais informações → Executar assim mesmo" na primeira instalação.
- **Hospedagem do instalador**: publicar o `.exe`/`.msi` gerado como
  asset de uma GitHub Release, e a landing aponta pra URL da release mais
  recente (ou espelha em `dito.albiecloud.com/download/`, similar ao que já
  existe pra OTA bundle em `dist/ota/`).
- **Auto-update**: Tauri tem um plugin de updater oficial
  (`@tauri-apps/plugin-updater`) que poderia, no futuro, avisar o usuário
  de versão nova dentro do próprio app — fica **fora do escopo desta
  primeira versão** (o app vai precisar ser reinstalado manualmente a cada
  atualização por enquanto); listado como próximo passo natural.

## Fora de escopo (não implementar agora)
- Mac/Linux (sem loopback nativo sem driver virtual).
- Auto-update dentro do app.
- Assinatura de código (certificado pago).
- Compressão client-side do áudio antes do upload (WAV puro por enquanto —
  arquivos de reunião longa ficam grandes, ~5.76MB/minuto, e vão cair no
  caminho de conversão via ffmpeg que o backend já tem hoje; se o upload
  ficar lento na prática, revisitar com um encoder tipo Opus/FLAC).

## Verificação
1. `npm run build:tauri` gera o `dist/` com base relativa, sem quebrar o
   build normal (`npm run build`) nem o de Android (`npm run build:app`).
2. `cargo tauri dev` (Windows real — não dá pra testar WASAPI em
   container/CI Linux) abre o app, botão único grava e para.
3. Cenário principal: tocar áudio de um vídeo/reunião de teste + falar no
   microfone → parar → conferir que a transcrição final contém tanto o que
   tocou quanto o que foi falado.
4. Cenários de degradação: sem microfone conectado (grava só sistema); sem
   áudio tocando (grava só mic, silêncio no restante, sem travar).
5. Sessão aparece na sidebar normalmente, mesmo pipeline de sempre — sem
   nenhuma mudança necessária em `backend/main.py`.
6. Conferir que o site desktop (quem não instalou o nativo) continua
   funcionando exatamente como antes — login, gravação de mic simples,
   upload de arquivo/link — já que a Fase 4 só desliga o *caminho de
   instalação PWA*, não o site em si.
