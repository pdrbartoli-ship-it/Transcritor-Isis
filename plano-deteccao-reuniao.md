# Dito Desktop: sugerir a gravação quando uma reunião começa

**Data:** 20/09/2026 · **Escopo:** app de Windows (Tauri) · **Quem executa:** outro agente, com o Pedro revisando e testando no Windows dele

Este documento é autossuficiente. Tudo o que está marcado como "verificado no código" foi lido nos arquivos citados. Tudo o que está marcado como "a validar" depende de rodar no Windows e tem uma etapa própria para isso (Etapa 0).

---

## 0. Situação (atualizado em 20/09/2026)

As etapas 1 a 5 estão implementadas. O que falta é o que só existe no Windows.

| Etapa | Situação |
|---|---|
| 0. Validar detecção no registro | **Não feita.** Exige o Windows do Pedro. O detector foi escrito para o registro (`ConsentStore`), como o plano previa; o plano B do WASAPI continua valendo se algum caso falhar, e a máquina de estados não muda |
| 1. Gravação acima das rotas e teto por saldo | Pronta e verificada no navegador (`e2e-gravacao-navegacao.mjs`) |
| 2. Detector em Rust | Escrito, com 11 testes de unidade na lógica pura. **Não compilado**: não há Rust neste ambiente, e o crate só compila no Windows. O `cargo test` entrou no CI |
| 3. Janelinha, decisão e configuração | Pronta. Decisão verificada em `e2e-deteccao-reuniao.mjs`, textos e desenho em `e2e-aviso-reuniao.mjs`, interruptor em `e2e-config-reuniao.mjs` |
| 4. Bandeja e início com o Windows | Escrita. O início automático vale para o instalador NSIS; no MSIX (Store) ele falha em silêncio, como o plano previa. O `StartupTask` da Store fica para a etapa seguinte |
| 5. Verificação e entrega | Parcial: tudo o que roda fora do Windows está verificado; a matriz da seção 9.2 depende do Pedro |

**Uma correção fora do previsto.** O provedor da gravação não podia ficar no `Layout`, como a Etapa 1a dizia: a home e as telas de conversa estão em ramos diferentes do roteador, cada um com o seu próprio `<Layout>`, e ir de uma para a outra desmonta um e monta o outro. O provedor foi para dentro do `HashRouter`, acima das `<Routes>` (ver `App.jsx`), junto com o detector. O `e2e-gravacao-navegacao.mjs` prova o caso que isso corrige.

**Uma correção de tabela.** `lerSaldo` engolia o erro da consulta, então "sem rede" virava "mês zerado, saldo cheio" — e era com esse número que o teto e o convite decidiriam o que prometer. Agora a falha sobe, e quem chama já sabia tratar.

**O que o Pedro precisa fazer:** a Etapa 0 (colar a saída do PowerShell na seção 13) e a matriz da seção 9.2, num build novo gerado pelo CI.

---

## 1. O que vamos construir

1. O Dito percebe que uma reunião do **Zoom, Teams ou Google Meet** começou. Vale para o app instalado e para o navegador (Meet, Teams web, Zoom web).
2. Aparece uma **janelinha limpa** no canto da tela com duas opções: **Gravar** ou **Agora não**.
3. Antes de mostrar a janelinha, o Dito **confere o saldo de minutos** da pessoa e muda o que mostra: convite normal, convite com aviso de saldo curto, ou aviso de que não há saldo.
4. Durante a gravação, o Dito **para sozinho antes de o saldo acabar**, avisando aos 5 min e 1 min, e guarda o áudio para transcrever.

Fora do escopo desta entrega (registrado na seção 12): título da reunião via calendário, extensão do Chrome, Mac, parar a gravação quando a reunião termina.

---

## 2. Como funciona, de ponta a ponta

```
Rust (detector, a cada 2 s)
  lê quais programas estão usando o microfone
  Zoom.exe / ms-teams.exe / navegador com título de reunião
        │  em uso por 8 s seguidos
        ▼
evento "meeting-started" { id, app, titulo }
        │
        ▼
Janela principal (o "cérebro", mesmo padrão da janelinha de gravação)
  hook useDeteccaoReuniao, montado no Layout
  ├─ não faz nada se: recurso desligado, sem login, convidado,
  │   já gravando, ou esta reunião já foi tratada
  ├─ lê o saldo NA HORA (não usa o valor guardado no Layout)
  └─ escolhe a variante e abre a janelinha "aviso"
        │
        ▼
Janelinha "aviso" (burra: só desenha o que recebe e devolve o clique)
        │  Gravar
        ▼
Janela principal: navega para "/", abre a janelinha de gravação,
chama start_recording(maxSeconds = saldo restante - margem)
        │
        ▼
Rust (gravação, dono do teto)
  emite "recording-limit-warning" aos 5 min e 1 min
  emite "recording-limit-reached" e para de escrever no limite
        │
        ▼
Janela principal para a gravação de verdade, guarda o áudio,
mostra a janelinha "parou por saldo". O áudio segue o fluxo normal
(revisão, escolher Simples ou Completa, transcrever).
```

---

## 3. Decisões

### 3.1 Já decididas com o Pedro
- Só Windows nesta etapa. O detector cobre app e navegador com a mesma regra.
- A janelinha tem só duas respostas: sim ou não.
- O saldo é conferido antes de sugerir, e a gravação para antes de o saldo acabar.

### 3.2 Assumidas por padrão (o Pedro pode trocar; cada uma está isolada em uma constante ou em um trecho pequeno)
| # | Decisão assumida | Por quê |
|---|---|---|
| A | O recurso vem **desligado** e o usuário liga em Configurações ("Avisar quando uma reunião começar"). Ligar também faz o Dito ficar na bandeja ao fechar a janela. | Fechar no X hoje encerra o app. Mudar isso sem o usuário pedir é invasivo, e o público (saúde, jurídico) é sensível a gravar sem querer. |
| B | **Sem saldo**, a janelinha aparece uma vez por dia com "Ver planos". | É um bom momento de venda, mas repetir a cada reunião irrita. |
| C | **Convidado** (sem conta) não recebe o aviso. | Ele tem uma gravação só e não tem plano para conversar. |
| D | O teto por saldo vale para **toda gravação nativa**, também a manual. | O erro 402 depois de uma gravação longa existe hoje também sem detector. |
| E | Não há aviso de "reunião terminou" nesta versão. O detector já emite o evento `meeting-ended` para a próxima etapa usar. | Reduz escopo. O teto por saldo já protege o custo. |

---

## 4. O que o código já diz (verificado)

Estes quatro fatos moldam o plano. Não são hipóteses.

1. **A gravação morre ao navegar.** O estado da gravação (`isRecording`, cronômetro, `recordedBlob`) vive em `useCapture`, que é montado por `CapturePanel`, dentro de `Home` (rotas `/`, `/audio`, `/video`). Nada em `Layout.jsx` guarda a navegação durante a gravação. Se a pessoa abre uma conversa da barra lateral, `Home` desmonta: o JS perde o estado, mas o Rust continua gravando (o `RecordingState` em `commands.rs` fica preso) e o próximo `start_recording` falha com "já existe uma gravação em andamento". Com gravação de reunião de uma hora isso passa a acontecer com frequência. **É pré-requisito (Etapa 1).**
2. **O backend só recusa por saldo no fim.** `guarda_de_captura` (backend/main.py) recusa com 402 se `minutos_usados >= minutos_limite` na entrada, e `recusar_se_nao_cabe` recusa no fim se `usados + duração_medida > limite`. A duração medida é a do arquivo (`duracao_cobravel`, `audio_seconds`), e o tempo pausado não entra no WAV. Uma reunião de 2 h com 30 min de saldo termina em 402 depois do upload. Por isso o teto precisa existir **na gravação**, e não só na tela.
3. **Os timers do JS não servem para impor o teto.** O comentário em `useCapture.js` já diz que minimizada a janela tem os timers estrangulados, e o Chromium pode reduzir para um disparo por minuto em página oculta. O teto tem de ser contado **no Rust**, pelas amostras escritas.
4. **Padrão da janelinha, a copiar.** `lib/miniRecorder.js` + `pages/Mini.jsx` + `App.jsx` (rota `#/mini` antes dos provedores) mostram como fazer uma janela "burra": a principal emite estado por evento, a janelinha pede `sync` ao nascer, e devolve cliques por outro evento. A nova janela de aviso segue exatamente isso.

Outros fatos úteis:
- O saldo no frontend vem de `lerSaldo(userId)` em `lib/api.js` (leitura de `uso_mensal` com RLS) somado ao plano da tabela `subscriptions`, com o limite de `planoPorId(plano).minutos` (régua vinda de `GET /planos`). O `Layout.jsx` repete essa consulta em um `useEffect`. Extrair uma função só (Etapa 3).
- O convidado é identificado por `convidado` no contexto do `Layout` (teto de 90 min e uma captura, `LIMITE_CONVIDADO_MIN`).
- O app abre o site remoto (`https://dito.albiecloud.com/`). Mudança só de web chega na próxima abertura. Mudança em Rust, plugin ou permissão exige instalador novo.
- **ACL do Tauri:** todo comando novo entra em `build.rs` (`AppManifest::commands`) **e** como `allow-<comando>` em `capabilities/default.json`. A lista `windows` da capability precisa incluir o rótulo da nova janela (`aviso`). Esquecer isso quebra só o recurso novo, com o app abrindo normal ("not allowed by ACL").
- O binário se chama `Dito.exe` (ver `msix/AppxManifest.xml`). O detector precisa **ignorar o próprio Dito**, que usa o microfone quando grava.
- Há duas formas de distribuição: NSIS (GitHub Releases) e MSIX (Microsoft Store), ambas em `.github/workflows/build-desktop.yml`.

---

## 5. Constantes (um único arquivo de cada lado, fáceis de ajustar)

| Constante | Valor | Onde | Para quê |
|---|---|---|---|
| `POLL_MS` | 2000 | Rust | Intervalo de leitura do detector |
| `START_DEBOUNCE_S` | 8 | Rust | Tempo com o microfone em uso antes de contar como reunião |
| `END_DEBOUNCE_S` | 20 | Rust | Tempo com o microfone livre antes de contar como fim |
| `TITULO_JANELA_S` | 30 | Rust | Janela de tempo para o navegador ter um título de reunião |
| `PROMPT_TIMEOUT_S` | 30 | JS | Sem resposta, a janelinha some e vale como "Agora não" |
| `MIN_PARA_SUGERIR_MIN` | 5 | JS | Abaixo disso, vale como "sem saldo suficiente" |
| `MOSTRAR_SALDO_ATE_MIN` | 90 | JS | A linha "Restam X min" só aparece com saldo até isso |
| `MARGEM_PARADA_S` | 30 | JS | Parar 30 s antes do fim do saldo, por causa de arredondamento e da medição do arquivo |
| `AVISOS_S` | 300 e 60 | Rust | Avisos de saldo acabando |
| `SEM_SALDO_POR_DIA` | 1 | JS | Vezes por dia que o "sem saldo" aparece |

---

## 6. Etapas

### Etapa 0. Validar a detecção no Windows do Pedro (meio dia, o Pedro faz 15 min)

O detector depende de um comportamento do Windows que **não foi testado aqui**. Antes de escrever Rust, o Pedro roda isto no PowerShell **durante uma chamada** e cola o resultado neste arquivo, na seção 13.

```powershell
Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone" -Recurse |
  Where-Object { $_.GetValue("LastUsedTimeStop") -ne $null } |
  Select-Object @{n='app';e={$_.PSChildName}},
                @{n='inicio';e={[datetime]::FromFileTime($_.GetValue("LastUsedTimeStart"))}},
                @{n='parou';e={$_.GetValue("LastUsedTimeStop")}}
```

Um programa está com o microfone em uso quando `parou` vale **0**. Cenários a testar, anotando o que aparece:

1. Zoom (app), na sala de espera, dentro da reunião, com o microfone mudo, e depois de sair.
2. Teams (app novo), reunião e ligação de 1 para 1.
3. Meet no Chrome, e depois no Edge, com outra aba na frente.
4. Chrome com uma aba de WhatsApp Web mandando áudio (falso positivo a descartar).

**Decisão que sai daqui:** se o registro se comporta como esperado, o detector usa o registro (mais simples). Se algum caso importante falhar (por exemplo o Teams novo não aparecer), usar as sessões de áudio do WASAPI (`IAudioSessionManager2`, que dá o PID e o estado ativo de cada programa) como plano B. A máquina de estados da Etapa 2 é a mesma nos dois casos.

**Segunda validação, no navegador:** confirmar que a janela principal do Dito, **escondida** (`hide()`), continua recebendo eventos do Rust e conseguindo chamar o Supabase. É o que a bandeja (Etapa 4) exige. Se o WebView2 suspender a página oculta, a alternativa é manter a janela principal minimizada em vez de oculta.

### Etapa 1. Gravação acima das rotas e teto por saldo (2 dias)

Vale por si só: corrige os dois problemas do item 4 mesmo sem detector.

**1a. Gravação sobe para o `Layout`.**
- Extrair de `components/capture/useCapture.js` a metade que grava (`startRecording`, `stopRecording`, pausar, retomar, cronômetro, `levelRef`, `recordedBlob`, `isFinalizing`, escuta de `recording-warning` e `recording-level`) para um hook `useGravacao` e um contexto `GravacaoProvider` montado em `Layout.jsx`, em volta do `<Outlet>`.
- `useCapture` passa a consumir esse contexto e fica só com a metade de envio (`submitRecording`, `sendFile`, `submitUrl`, erros, `loading`).
- `useMiniRecorder` sai de `CapturePanel.jsx` e passa a ser usado dentro do provedor, para a janelinha de gravação não depender de qual tela está aberta.
- O `useEffect` de limpeza que hoje para o `MediaRecorder` ao desmontar deve valer só para o desmonte do provedor (ou seja, fechar o app).
- Alternativa mais leve, se a extração se mostrar grande: bloquear a navegação enquanto grava, com confirmação. É pior para o usuário e só serve como plano B.

**1b. Teto de gravação no Rust.**
- `commands::start_recording` passa a aceitar `max_seconds: Option<u64>` (no JS o argumento é `maxSeconds`, o Tauri 2 converte para camelCase). Repassar a `audio::start_recording`.
- Na thread de mixagem/escrita de `audio/mod.rs`, contar as amostras **realmente escritas** (pausa não conta, já que o mixer para de escrever). Ao chegar em `max_seconds`: parar de escrever e emitir `recording-limit-reached`. A gravação continua "aberta" até o JS chamar `stop_recording` normalmente, que fecha o WAV.
- Emitir `recording-limit-warning` com `{ remaining_s: 300 }` e `{ remaining_s: 60 }` quando o restante do teto cruzar esses valores. Um aviso não repete.
- Sem `max_seconds`, o comportamento é o de hoje.

**1c. JS liga tudo.**
- Antes de `invoke('start_recording')`, `useGravacao` lê o saldo (função da Etapa 3) e calcula `maxSeconds = floor(restanteMin * 60) - MARGEM_PARADA_S`. Se o saldo não puder ser lido (sem rede, Supabase fora), grava **sem teto**, como o backend faz com o contador de perguntas: falha do contador não pode bloquear o produto.
- Ao receber `recording-limit-reached`, chamar o mesmo caminho de `stopRecording` que o botão de parar usa, com o motivo `saldo`. O áudio vira `recordedBlob` e a tela de revisão mostra o "Simples ou Completa" como sempre.
- Se o saldo restante for menor que `MIN_PARA_SUGERIR_MIN` numa gravação **manual**, opcional: recusar o início com o texto de "sem saldo" e o botão de planos. É pequeno e evita gravar para nada.

**Aceite da Etapa 1:**
- Gravar na tela inicial, abrir uma conversa da barra lateral, voltar: a gravação continua, com o cronômetro certo.
- Gravar com saldo de poucos minutos (usar a simulação da seção 9): a gravação para 30 s antes do fim, o WAV existe, a transcrição é aceita pelo backend sem 402.
- Os testes e2e da web que tocam captura (`frontend/e2e-captura.mjs`, `e2e-modo-transcricao.mjs`, `e2e-modo-simples.mjs`) seguem passando: a web usa o mesmo hook e não pode regredir.

### Etapa 2. Detector em Rust (2 a 3 dias)

Novo módulo `frontend/src-tauri/src/meeting/`, no mesmo tratamento de plataforma que `audio/mod.rs` já usa:
- `estado.rs`: **máquina de estados pura**, sem Windows e sem Tauri. Entrada: a cada ciclo, a lista de "quem está com o microfone" (`exe`, `em_uso`, `titulo_janela`). Saída: eventos `Started { id, app, titulo }` e `Ended { id }`. É aqui que mora a regra, e é o que tem teste automático.
- `registro.rs` (Windows): lê `ConsentStore\microphone` (subchaves `NonPackaged`, com o caminho do executável e `\` trocado por `#`, e as de pacote). Em uso = `LastUsedTimeStop == 0` e `LastUsedTimeStart > 0`.
- `janelas.rs` (Windows): `EnumWindows` para achar o título das janelas visíveis de um processo (PID para nome do executável).
- `mod.rs`: thread que roda a cada `POLL_MS`, alimenta a máquina e emite os eventos para o Tauri (`app.emit`).
- Dependência `windows` no `Cargo.toml` com as features mínimas (`Win32_System_Registry`, `Win32_UI_WindowsAndMessaging`, `Win32_System_Threading`, `Win32_Foundation`). O `wasapi` já traz uma versão da `windows`: alinhar a versão (`cargo tree -d`) para não compilar duas.

**Regras da máquina de estados:**

| Programa com o microfone em uso | O que vale |
|---|---|
| `Zoom.exe` | Reunião, app `zoom` |
| `ms-teams.exe`, `Teams.exe` (e o pacote do Teams novo, conforme o resultado da Etapa 0) | Reunião, app `teams` |
| `chrome.exe`, `msedge.exe`, `firefox.exe`, `brave.exe` | Só vale se, **em até `TITULO_JANELA_S` depois de o microfone abrir**, o título de uma janela do navegador contiver `Meet -` ou `meet.google.com` (app `meet`), `| Microsoft Teams` (app `teams`) ou `Zoom` no domínio de reunião (app `zoom`). Sem título de reunião, é outro uso do microfone (WhatsApp Web, ditado por voz, Discord) e **é ignorado** |
| `Dito.exe` (ou o pacote do Dito) | **Sempre ignorado** |
| Qualquer outro | Ignorado. A lista é uma constante e fácil de estender (Webex, Slack, Discord) |

- Só vira `Started` depois de `START_DEBOUNCE_S` seguidos em uso. A pré-sala do Zoom e do Meet já segura o microfone: contar como início da reunião nesse momento é aceitável e até desejável (a pessoa está entrando).
- O título do navegador só é avaliado na janela de tempo depois de o microfone abrir, porque a janela do Chrome mostra o título da aba **ativa**, e a pessoa acabou de clicar em "Participar" naquela aba. Depois disso o título não importa mais: a reunião fica "presa" até o microfone liberar.
- `Ended` só depois de `END_DEBOUNCE_S` com o microfone livre.
- Cada reunião tem um `id` crescente, para o JS nunca sugerir duas vezes a mesma.

**Comandos novos** (em `commands.rs`, `build.rs` e `capabilities/default.json`, os três):
- `set_meeting_detection(enabled: bool)`: liga ou desliga a thread. Começa **desligado**; quem liga é o JS, lendo a preferência.
- `meeting_detection_available() -> bool`: o JS usa para esconder a opção de Configurações em instaladores antigos que ainda não têm o detector (o site novo chega antes do instalador novo).

**Testes:** testes de unidade na `estado.rs` cobrindo, no mínimo: início após debounce, microfone que pisca (não vira reunião), navegador sem título (ignorado), navegador com título, `Dito.exe` ignorado, fim após debounce, duas reuniões seguidas com ids diferentes. Adicionar `cargo test` ao `build-desktop.yml` (roda em `windows-latest`).

### Etapa 3. Janelinha, decisão e configuração (2 dias)

**3a. Janela "aviso".**
- `lib/avisoWindow.js`: abrir/fechar a janela e trocar mensagens, copiando `lib/miniRecorder.js`. Rótulo `aviso`, 340 x 132 px lógicos, sem decoração, sempre por cima, fora da barra de tarefas, **sem roubar o foco** (`focus: false`), canto inferior direito do monitor atual (reaproveitar `bottomRightPosition`). URL no mesmo padrão: `${origin}/#/aviso`.
- `pages/Aviso.jsx` + rota `#/aviso` tratada em `App.jsx` como `#/mini` (antes dos provedores; não depende de sessão).
- A janela é burra. Recebe `{ variante, titulo, corpo, acoes: [{ id, rotulo, primaria }], expiraEm }` por evento, pede `sync` ao nascer, e devolve `{ id }` do botão clicado. Some sozinha em `expiraEm`, devolvendo `expirou`.
- Adicionar `aviso` à lista `windows` de `capabilities/default.json`.
- Visual: mesmo tema salvo do app (`getTheme()`), Inter, botão primário em verde-pinho `#1a5c4e`, botão secundário neutro, sombra e raio iguais aos da janelinha de gravação. Nada de ícone chamativo. Conferir a classe `mini-body` e o CSS da janelinha existente para não duplicar estilo.

**3b. Textos** (regras do Dito: sem travessão, sem emoji, sem exclamação, voz com "nós" implícito, sem frase de efeito em par):

| Variante | Título | Corpo | Botões |
|---|---|---|---|
| `convite` | Reunião no Zoom | Quer gravar com o Dito? | Agora não, **Gravar** |
| `convite-saldo-curto` (saldo restante até `MOSTRAR_SALDO_ATE_MIN`) | Reunião no Zoom | Quer gravar com o Dito? Restam 42 min do seu plano. A gravação para antes de acabar. | Agora não, **Gravar** |
| `sem-saldo` (restante menor que `MIN_PARA_SUGERIR_MIN`, ou zero) | Reunião no Zoom | Seus minutos deste mês acabaram, então o Dito não vai gravar. (se sobrar pouco: "Restam só 3 min no seu plano, pouco para uma reunião.") | Fechar, **Ver planos** |
| `aviso-5min` | Saldo acabando | Restam 5 minutos do seu plano. A gravação para quando eles acabarem. | sem botões, some em 10 s |
| `aviso-1min` | Saldo acabando | Resta 1 minuto do seu plano. | sem botões, some em 10 s |
| `parou-saldo` | Gravação parada | Seus minutos do mês estavam acabando. O áudio foi guardado e está pronto para transcrever. | **Abrir o Dito** |

O nome do app no título vem do evento: Zoom, Teams ou Google Meet.

**3c. Cérebro: `useDeteccaoReuniao`.** Hook montado em `Layout.jsx`, dentro do `GravacaoProvider`. Só existe no app nativo (`isTauriApp()`).
1. Ao montar, e quando a preferência mudar: `invoke('set_meeting_detection', { enabled })` (se `meeting_detection_available`).
2. Em `meeting-started`, **descartar** se: preferência desligada, sem usuário, `convidado`, gravação em andamento, `aviso` já aberto, ou `id` já tratado.
3. Ler o saldo **na hora** (função `lerSaldoAtual`, abaixo). O valor guardado no `Layout` pode estar velho.
4. Escolher a variante pela tabela acima e abrir a janela `aviso`.
5. Resposta:
   - **Gravar:** fechar o aviso, navegar a janela principal para `/`, abrir a janelinha de gravação de imediato (`openMiniWindow`, porque o `useMiniRecorder` só a abre sozinho ao **minimizar**, e a principal pode já estar minimizada ou oculta), e chamar `startRecording()` com o teto calculado.
   - **Agora não / expirou:** marcar o `id` como tratado. Não perguntar de novo nessa reunião.
   - **Ver planos:** mostrar e focar a janela principal e abrir o `PlanModal` (`abrirPlano` já existe no `Layout`).
   - `sem-saldo` respeita `SEM_SALDO_POR_DIA` (guardar a data em `localStorage`, com try/catch).
6. Durante a gravação, escutar `recording-limit-warning` (abre `aviso-5min` e `aviso-1min`) e `recording-limit-reached` (encerra a gravação como na Etapa 1c e abre `parou-saldo`).
7. Telemetria com o `track` já existente: `reuniao_detectada` (app), `reuniao_aviso` (variante), `reuniao_resposta` (gravar, agora_nao, expirou), `gravacao_parada_saldo`. **Nunca** enviar o título da reunião.

**3d. Saldo numa função só.** Criar `lerSaldoAtual(userId)` em `lib/api.js`, que devolve `{ plano, usados, limite, restanteMin }`, juntando `lerSaldo` com a leitura de `subscriptions` e `planoPorId`. Trocar o `useEffect` do `Layout.jsx` para usá-la. `restanteMin = max(0, limite - usados)`.

**3e. Configuração.** Em `SettingsModal.jsx`, visível **só** no app nativo e só se `meeting_detection_available`: um interruptor "Avisar quando uma reunião começar", com a dica: "O Dito percebe quando você entra numa reunião do Zoom, Teams ou Meet e pergunta se quer gravar. Nada sai do seu computador nessa detecção. Avise os participantes antes de gravar." Guardar em `lib/prefs.js`, como o tema e o idioma.

### Etapa 4. Bandeja e início com o Windows (1 a 2 dias)

Sem isto o detector só funciona com o app aberto na tela.
- Ícone na bandeja (feature `tray-icon` do Tauri) com "Abrir o Dito" e "Sair". Clique no ícone mostra, tira do minimizado e foca a janela (as permissões `allow-show`, `allow-unminimize` e `allow-set-focus` já existem).
- Com o recurso ligado, **fechar a janela esconde em vez de encerrar** (`CloseRequested` + `prevent_close` + `hide`), inclusive durante uma gravação. Comando `set_background_mode(enabled)` para o JS avisar o Rust (mesma regra de ACL).
- `tauri-plugin-single-instance`: abrir o Dito de novo foca a instância que já roda.
- Início com o Windows: `tauri-plugin-autostart` com o argumento `--minimizado`, para abrir sem mostrar a janela. Ligado junto com o recurso.
- **MSIX (Store):** o `plugin-autostart` escreve na chave `Run`, que não vale dentro do pacote. Para a Store é preciso declarar `uap5:StartupTask` no `AppxManifest.xml` e habilitá-la pelo WinRT (`StartupTask`). Se der trabalho demais, **entregar primeiro só o NSIS** e deixar a Store para a etapa seguinte, dizendo isso claramente ao Pedro. Verificar também que a leitura do registro do `ConsentStore` funciona dentro do pacote MSIX (leitura de HKCU costuma passar; escrita é virtualizada).

### Etapa 5. Verificação de ponta a ponta e entrega (1 a 2 dias)

- Backend não muda. Web: push na `main` publica sozinho e chega ao app na próxima abertura.
- O instalador precisa ser refeito (Rust, plugins e permissões novos): subir a versão em `tauri.conf.json`, deixar o CI gerar o NSIS e, se a Etapa 4 cobrir, o MSIX.
- O site novo chega antes do instalador novo: por isso o `meeting_detection_available` esconde a opção em instaladores antigos. Conferir isso.
- Rodar a matriz da seção 9 com o Pedro no Windows dele.
- Atualizar a memória do projeto (`dito-ota-updates` e uma nota nova sobre o detector).

---

## 7. Regras de saldo, em uma tabela

| Situação | Restante | O que o Dito faz |
|---|---|---|
| Logado, saldo folgado | acima de 90 min | `convite`, sem linha de saldo |
| Logado, saldo médio | de 5 a 90 min | `convite-saldo-curto` com o número real. A gravação para a `MARGEM_PARADA_S` do fim |
| Logado, saldo insuficiente | abaixo de 5 min, ou zero | `sem-saldo`, no máximo uma vez por dia. Não grava |
| Convidado | qualquer | Nada |
| Sem login ou saldo ilegível | n/a | Nada (sem saldo lido não sugerimos, para não prometer o que não sabemos). Gravação manual segue sem teto |
| Durante a gravação | 5 min e 1 min restantes | Aviso curto sem botão |
| Durante a gravação | teto atingido | Para, guarda o áudio, mostra `parou-saldo` |

Detalhe de custo: o saldo do mês cobre a **transcrição** do que foi gravado. Como o teto garante que a gravação cabe no saldo, a transcrição dela não é recusada no fim (a menos que a pessoa gaste minutos em outro aparelho durante a reunião, caso raro em que o 402 volta e o áudio continua na tela para tentar de novo depois de assinar).

---

## 8. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Registro do microfone se comporta diferente no Windows do usuário | Detector não vê Teams, ou vê tarde | Etapa 0 antes de codar. Plano B com sessões de áudio do WASAPI |
| Navegador com a aba da reunião em segundo plano | Título não bate | Avaliamos o título só logo depois de o microfone abrir, quando a aba é a ativa |
| WebView2 suspende a janela principal oculta | Nenhum aviso aparece na bandeja | Validar na Etapa 0. Alternativa: manter minimizada em vez de oculta |
| Falso positivo (microfone usado por outro site) | Aviso indevido | Navegador só conta com título de reunião. Lista fixa de programas |
| Refatoração da Etapa 1 mexe na web | Regressão na captura do site | Rodar os e2e de captura antes e depois. Web usa o mesmo hook |
| Gravar reunião sem os outros saberem | Risco ético e legal (LGPD, saúde) | Recurso desligado por padrão. Dica na configuração pedindo para avisar os participantes. Indicador de gravação sempre visível (janelinha) |
| Instalador antigo com site novo | Opção que não funciona | `meeting_detection_available` |
| Não dá para rodar Windows no Codespace | Bugs só aparecem no Windows do Pedro | Lógica pura testável fora do Windows, simulação de eventos (seção 9), teste real na Etapa 5 |

---

## 9. Como testar

### 9.1 Sem Windows (no Codespace)
- **Simular o evento.** Em ambiente de desenvolvimento, expor uma função (por exemplo `window.__simularReuniao({ app: 'zoom' })`) que dispara o mesmo caminho de `meeting-started`. Com isso dá para exercitar hook, decisão, saldo e a tela `#/aviso` no Playwright, sem Rust.
- **Simular saldo.** Interceptar no Playwright a leitura de `uso_mensal` e `subscriptions` para devolver saldos de 500, 12 e 0 minutos. **Isso não gasta os minutos reais da conta de teste** (que é a do próprio Pedro, ver memória `e2e-test-harness`).
- **Rota da janelinha.** `#/aviso` abre como página normal no navegador e dá para conferir cada variante visualmente, claro e escuro, por print.
- **Máquina de estados** com `cargo test` (a lógica pura da Etapa 2).

### 9.2 No Windows do Pedro (Etapa 5)
| Cenário | Esperado |
|---|---|
| Zoom (app), entrar numa reunião | Aparece o `convite` em cerca de 10 s |
| Teams (app novo), entrar | Idem |
| Meet no Chrome, e no Edge | Idem |
| WhatsApp Web mandando áudio no Chrome | **Nada** aparece |
| Clicar em Agora não | Some. Não volta nessa reunião. Volta na reunião seguinte |
| Deixar a janelinha sem resposta | Some em 30 s |
| Clicar em Gravar com o Dito minimizado | Grava, janelinha de gravação aparece |
| Clicar em Gravar com o Dito numa conversa aberta | Vai para a tela inicial, grava, e a gravação **sobrevive** a navegar |
| Já estou gravando e entro numa reunião | Nada aparece |
| Saldo de 12 min | `convite-saldo-curto` com 12. Grava e para 30 s antes do fim, com avisos aos 5 e 1 min |
| Saldo zero | `sem-saldo` com "Ver planos". Na segunda reunião do dia, nada |
| Reunião mais longa que o saldo | Para no teto, `parou-saldo`, áudio guardado, transcrição aceita |
| Conta convidada | Nada |
| Deslogado | Nada |
| Fechar a janela com o recurso ligado | Vai para a bandeja e o detector segue |
| Reiniciar o Windows com o recurso ligado | O Dito volta sozinho, sem janela |

---

## 10. Estimativa

| Etapa | Dias de trabalho |
|---|---|
| 0. Validar detecção | 0,5 |
| 1. Gravação acima das rotas e teto por saldo | 2 |
| 2. Detector em Rust | 2 a 3 |
| 3. Janelinha, decisão, configuração | 2 |
| 4. Bandeja e início com o Windows | 1 a 2 |
| 5. Verificação e entrega | 1 a 2 |
| **Total** | **9 a 12** |

É mais do que a estimativa inicial de uma semana, porque o pré-requisito da gravação (Etapa 1) e o teto por saldo entraram no escopo.

---

## 11. Ordem de commits sugerida

1. Etapa 1a (gravação sobe para o Layout) sozinha, com os e2e da web passando.
2. Etapa 1b e 1c (teto por saldo).
3. Etapa 2 (detector), ainda sem interface.
4. Etapa 3 (janelinha, hook, configuração), atrás da preferência desligada.
5. Etapa 4 (bandeja e início com o Windows).

Cada commit deve deixar o app funcionando. A preferência desligada por padrão permite publicar no meio do caminho sem afetar ninguém.

---

## 12. Fora do escopo (próximas entregas)

- Nomear a conversa pelo título da reunião (o detector já devolve `titulo` no evento, e o calendário pode entrar depois).
- Aviso de "a reunião terminou, parar a gravação?" (o evento `meeting-ended` já existe).
- Extensão do Chrome e detecção no Mac.
- Início automático sem perguntar, pelo calendário.
- Teto por saldo na gravação da web e do Android (o JS lá tem a janela visível e o problema é menor).

---

## 13. Resultado da Etapa 0 (o Pedro preenche)

_Colar aqui a saída do PowerShell e as observações de cada cenário._
