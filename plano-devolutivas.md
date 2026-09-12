# Plano faseado — 10 devolutivas

Levantamento feito direto no código em 12/09/2026. Cada item abaixo tem causa
raiz identificada, arquivo e linha.

---

## Como eu li as devolutivas

As dez devolutivas não são dez tarefas soltas. Elas caem em dois funis, que são
exatamente a estratégia do Dito:

**Funil 1 — a landing faz o usuário usar e gostar.** Aqui todo atrito é morte:
tema que pisca (1), download que confunde (2), erro de login numa transcrição
que deveria simplesmente funcionar (3).

**Funil 2 — o app faz o usuário querer pagar.** Aqui o limite precisa ser
*sentido* antes de ser *batido*: a régua dos planos (7, 8, 4), o contador
visível (10) e a compra fácil (6). Um limite invisível não converte — ele só
frustra quando estoura.

E atravessando os dois, um item que não é de funil nenhum: o logout
inesperado (9). Esse é o único que destrói confiança em vez de só criar atrito.
Por isso ele entra na primeira fase.

---

## O que a investigação encontrou

Três descobertas mudam o plano em relação ao que as devolutivas sugeriam.

### Os itens 3 e 9 são o mesmo bug

O erro *"Entre na sua conta do Dito para usar este recurso"* nasce em
`backend/main.py:158`, dentro de `guarda_de_uso`. Ele dispara quando
`validar_token` devolve `None` — e ela devolve `None` em **dois** casos
diferentes:

1. o usuário realmente não está logado;
2. o Supabase não respondeu em 10 segundos (`backend/main.py:122-127`), ou o
   token expirou antes de o frontend renová-lo.

O caso 2 é o seu. O frontend **manda** o token corretamente
(`frontend/src/lib/api.js:14-17` → `postWithRetry` → `authHeaders`), mas se o
`access_token` guardado já venceu, o backend recusa e mostra uma mensagem que
mente para o usuário.

O logout do item 9 é a mesma fragilidade um passo adiante: o
`AuthContext` (`frontend/src/contexts/AuthContext.jsx:20-22`) confia
cegamente no `onAuthStateChange` e zera o usuário em qualquer `SIGNED_OUT` —
inclusive quando ele vem de uma renovação de token que falhou por rede, e não
de uma sessão de fato revogada. O cliente Supabase é criado sem nenhuma opção
explícita (`frontend/src/lib/supabase.js:6`).

**Consequência prática: um conserto resolve os dois.**

### O item 5 tem uma causa só, não duas

Você descreveu dois sintomas — o retângulo que expande e o círculo que "caminha
do grátis para o iniciante". É o mesmo defeito: o `PlanModal` **renderiza antes
de ter os dados**.

- `frontend/src/components/PlanModal.jsx:41` — `planoAtual` nasce como
  `'gratuito'` e só depois vira `'iniciante'` quando o Supabase responde. Daí o
  círculo andar.
- `frontend/src/components/PlanModal.jsx:96-101` — o bloco de saldo só existe
  depois que `lerSaldo` volta, e ao aparecer **empurra o card para baixo**. Daí
  o retângulo expandir.

### O aviso do Windows tem, sim, saída de custo zero — mas não é a óbvia

Pesquisa fechada. Três fatos:

1. **O certificado EV não resolve mais.** A Microsoft removeu o bypass
   automático do SmartScreen para EV. Gastar R$ 3 mil/ano não garante sumir com
   o aviso.
2. **Conta de desenvolvedor da Microsoft Store é grátis** desde setembro de
   2025 para pessoa física (e desde maio de 2026 para empresa).
3. **Mas o tipo de listagem importa muito.** Se publicarmos como "EXE/MSI app",
   a Store **não assina** o instalador — exige que a gente assine, ou seja,
   volta a custar. Se publicarmos como **MSIX**, a Microsoft fornece
   *complimentary code signing* e hospedagem: sem certificado, sem custo, **sem
   SmartScreen**.

O app do Dito é Tauri (`frontend/src-tauri/tauri.conf.json`), e o Tauri ainda
não gera MSIX nativamente. Existem dois caminhos para converter: o **winapp
CLI** da própria Microsoft (tem guia específico para Tauri) e o pacote
comunitário `@choochmeque/tauri-windows-bundle`.

Ou seja: dá para sumir com o aviso sem pagar nada — mas é trabalho de dias, não
de horas. Por isso ele vira uma trilha paralela, e não um bloqueio.

---

## Fase 1 — Parar de perder o usuário (bugs de confiança)

> Nada aqui adiciona funcionalidade. Tudo aqui impede alguém de desistir do
> produto por achar que ele está quebrado.

### 1.1 · Sessão que não cai mais sozinha — itens 3 e 9

- Criar o cliente Supabase com opções explícitas (`autoRefreshToken`,
  `persistSession`) em `frontend/src/lib/supabase.js`.
- Em `authHeaders()` (`frontend/src/lib/api.js:14`): se o token vence em menos
  de 60s, renovar **antes** de mandar a requisição.
- Em qualquer 401 vindo do backend: renovar a sessão e repetir a chamada **uma
  vez** antes de mostrar erro. Só depois disso a mensagem de "entre na sua
  conta" é honesta.
- No `AuthContext`: não derrubar o usuário num `SIGNED_OUT` que veio de falha de
  rede. Só deslogar quando a sessão foi de fato revogada.
- No backend (`main.py:122-158`): separar os dois casos. "Não consegui confirmar
  seu login, tente de novo" (503) é diferente de "você não está logado" (401).
  Uma tentativa extra na chamada ao Supabase, também.

### 1.2 · Landing sempre clara — item 1

O tema é global: `frontend/index.html:27-38` aplica o `dito-theme` salvo no
`localStorage` ao documento inteiro, e a landing herda. Quem ligou o escuro
dentro do app vê a landing escura.

Forçar `data-theme="light"` enquanto a rota for pública (Landing, Auth,
ConfirmEmail) e devolver a preferência do usuário ao entrar no app. O botão de
tema do app continua intacto.

### 1.3 · "Meu Plano" que não treme — item 5

Segurar o render até os dados chegarem: `planoAtual` começa `null` (não
`'gratuito'`), e o card reserva a altura da linha de saldo desde o primeiro
frame. Sem card crescendo, sem círculo andando.

### 1.4 · Download que não convida a clicar de novo — item 2, parte rápida

Hoje `InstalarModal.jsx:22-26` já baixa sozinho ao abrir, e logo abaixo aparece
um botão primário escrito **"Baixar de novo"** (`linha 56`). É literalmente um
botão grande pedindo o clique errado.

- O passo-a-passo vira o protagonista do modal.
- Incluir a imagem da tela do SmartScreen, para a pessoa **reconhecer** o aviso
  quando ele aparecer em vez de se assustar.
- "Baixar de novo" vira link discreto: *"O download não começou? Baixar de
  novo."*

---

## Fase 2 — A régua certa (backend manda)

> O frontend pode mostrar cadeado, mas quem **decide** é o backend. Senão o
> limite é decorativo.

### 2.1 · Limites novos — item 8

`backend/main.py:224` hoje:

```python
LIMITES_PLANO = {"gratuito": 120, "iniciante": 600, "avancado": 2000}
```

Passa a `{"gratuito": 100, "iniciante": 1000, "avancado": 2000}`, aplicado a
todos de imediato (sua decisão).

### 2.2 · Transcrição completa só no pago — item 4

Não existe hoje nenhuma checagem de plano em volta do modo. Criar:

- **Backend:** `/transcribe` e `/process-url` recusam `modo=completa` para quem
  é gratuito, com mensagem de upgrade (402), não erro seco.
- **Frontend:** no seletor de modo, "Transcrição completa" aparece com cadeado
  para o gratuito. Clicar abre o convite do Iniciante explicando o que ela faz —
  é gatilho de upgrade, não parede.

Detalhe importante do fluxo atual: hoje o botão do YouTube já vem escrito
**"Transcrição completa"** como padrão. Para o gratuito, o padrão passa a ser
"Transcrição simples", com a completa ao lado, travada.

### 2.3 · Limite de perguntas por transcrição — itens 7 e 8

Isso **não existe em lugar nenhum** hoje — nem banco, nem backend, nem tela. É o
item mais pesado da fase.

- Migração SQL: contador de perguntas por conversa (em `public.sessions`) mais
  uma função que incrementa de forma atômica. **Precisa ser rodada por você no
  SQL Editor do Supabase** — eu não tenho service role aqui.
- `/chat` (`backend/main.py:1825`) passa a receber a conversa, conferir o limite
  do plano e recusar a pergunta excedente com o convite de upgrade.
- Limites: 2 (gratuito), 10 (iniciante), sem limite (avançado). Sem reset — a
  conversa nasce com o saldo dela (sua decisão).

### 2.4 · Textos dos planos — item 7

Os textos vivem **duplicados**: `PlanModal.jsx:11-36` e a lista gêmea em
`Landing.jsx:12`. O próprio código já reclama disso num comentário. Aproveito
para criar um `frontend/src/lib/planos.js` único, que passa a alimentar os dois
— senão o próximo ajuste de preço volta a sair errado num dos lados.

Textos conforme você mandou:

| Plano | Texto |
|---|---|
| **Grátis** | 100 minutos por mês · Transcrição simples · Limite de 2 perguntas por transcrição · Criptografia de ponta a ponta |
| **Iniciante** | 1000 minutos por mês · Transcrição simples e completa · Limite de 10 perguntas por transcrição · Criptografia de ponta a ponta |
| **Avançado** | 2000 minutos por mês · Transcrição simples e completa · Criptografia de ponta a ponta |

---

## Fase 3 — O limite visível (o motor de upgrade)

> Esta é a fase que mais converte. Limite que não se vê não vende plano — só
> irrita quando estoura.

### 3.1 · Contador de minutos na home — item 10

Relógio laranja que se preenche conforme os minutos acabam, com o texto ao lado
em fonte clara, discreta. Alinhado à direita, como você pediu.

O dado já existe: `lerSaldo` (`frontend/src/lib/api.js:163`) lê `uso_mensal`. O
limite do plano vem do `planos.js` novo da fase 2.

Um detalhe de texto: seu exemplo foi *"100/100 minutos usados"*, que é o estado
de saldo esgotado. Para o caso normal fica **"12/100 minutos usados"** — o
primeiro número é o consumo.

### 3.2 · "Consumir X minutos?" antes de gastar — item 10

Metade já está pronta: `readMediaDuration`
(`frontend/src/components/capture/estimate.js:21`) lê a duração de qualquer
arquivo local sem enviá-lo, e a gravação já conhece o próprio tempo.

Falta o YouTube, que não revela duração sem consulta. Novo endpoint no backend
que devolve só a duração do link (o `yt-dlp` já está lá e faz isso sem baixar o
vídeo).

**Ponto que eu quero discutir com você:** um modal de confirmação adiciona um
clique a um fluxo que hoje tem um só — o oposto de "passear no parque". A
alternativa que mantém a informação e não cobra o clique é o botão dizer
**"Transcrever · 12 min"** com a linha discreta *"restam 88 dos seus 100"*
embaixo. Mesma transparência, zero atrito. Faço do jeito que você decidir.

### 3.3 · Perguntas restantes na conversa — item 10

Depende do contador da fase 2.3. Linha discreta perto do campo de pergunta:
*"restam 2 perguntas"*. Na última, o texto vira o convite de upgrade.

---

## Fase 4 — A compra fácil (padrão Notion)

### 4.1 · Fim do seletor mensal/anual — item 6

Sai o toggle `planos-ciclo` (`PlanModal.jsx:79-82`). Entra o padrão das suas
imagens:

**No card:** o preço anual como manchete, o mensal em cinza embaixo.

```
Iniciante
R$ 11,25 por mês
com cobrança anual
R$ 14,99 cobrado mensalmente
[ Fazer upgrade ]
```

**No clique:** modal com as duas opções de faturamento como rádio — "Pagar por
mês · R$ 14,99" e "Pagar por ano · R$ 11,25/mês" com o selo **Economize 25%** —
e só então o checkout do Stripe.

Confirmei a matemática nos preços atuais: Iniciante R$ 135/ano = R$ 11,25/mês, e
Avançado R$ 180/ano = R$ 15,00/mês. **25% de desconto nos dois**, número redondo
e bom de comunicar.

---

## Fase 5 — Download sem susto (trilha paralela, mais longa)

### 5.1 · MSIX + Microsoft Store — item 2, parte definitiva

1. Abrir conta de desenvolvedor (grátis) e reservar o nome "Dito".
2. Empacotar o Tauri como MSIX (winapp CLI da Microsoft, ou o pacote
   comunitário).
3. Publicar como MSIX — **não** como EXE/MSI, que exigiria certificado pago.
4. Na landing, o botão do Windows passa a apontar para a Store.

**Três riscos a verificar antes de comemorar:**

- A gravação das duas vozes (WASAPI, `src-tauri/src/audio`) precisa continuar
  funcionando dentro do pacote MSIX. É o diferencial do app de Windows — se
  quebrar, a Store não vale a pena.
- O auto-update do Tauri não funciona dentro da Store: quem atualiza passa a ser
  a Store. Precisa ser desligado no pacote.
- A certificação da Store leva dias e pode voltar com exigências.

Enquanto isso não fica de pé, a Fase 1.4 já removeu o pior do atrito.

---

## Decisões tomadas

**1. Confirmação de consumo — botão, não modal.**
"Transcrever · 12 min" com a linha discreta "restam 88 dos seus 100" embaixo.
Sem clique extra de confirmação.

**2. Iniciante vai para 1000 minutos, sem teto de capturas.**
Seguir e monitorar via eventos. Se a cauda de custo aparecer na prática (muitas
capturas curtas concentradas num usuário), revisitar com piso por captura ou
teto de capturas.

**3. App de Windows sai da lista de benefícios dos planos pagos — é
intencional.**
"Ter app de Windows é nossa obrigação, não é diferencial." O que diferencia os
planos pagos é minutos, modo de transcrição e limite de perguntas — não
recursos de plataforma. Isso vale para qualquer texto futuro de plano, landing
ou comparativo.

---

## Ordem sugerida

Fase 1 primeiro porque bug de confiança contamina tudo o que vier depois: não
adianta um contador bonito num app que desloga sozinho.

Fase 2 antes da 3 por dependência real — o contador de perguntas da tela
precisa do contador do banco.

Fase 4 é independente e pode entrar a qualquer momento.

Fase 5 corre em paralelo desde já, porque a parte lenta dela é espera (conta,
certificação), não trabalho.
