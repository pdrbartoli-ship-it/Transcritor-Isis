# Auditoria de UX do Dito — landing, aplicativo e ciclo completo

**Data:** 09/09/2026 · **Alvo:** produção (`https://dito.albiecloud.com` + backend no Render) · **Build:** `v0.1.0 · bfc3e6b`

**Método.** Três frentes: leitura integral do código do frontend e das partes relevantes do `backend/main.py`; testes ao vivo em produção com Playwright/Chromium (5 viewports, temas claro e escuro, offline, CPU e rede degradadas, sessão expirada, duas abas, microfone falso); e uma jornada ponta a ponta pelas quatro fases (descobrir → experimentar → aprimorar → usar para valer).

**Resultado bruto:** 46 achados na landing, 63 no app, mais os da jornada. Este documento é a síntese. Os catálogos completos, achado por achado, estão em `/home/codespace/dito-auditoria/` (ver a última seção).

**Nenhuma compra foi concluída** em nenhum momento da auditoria.

---

## Como ler este relatório

A seção **0** é diferente das outras: não é uma questão de UX, é uma parada de produção. Ela invalida na prática tudo que vem depois enquanto não for resolvida — por isso vem primeiro e fora da contagem.

Depois vêm as listas que você pediu: 5 da landing e 5 do app que **dão para resolver agora**, e em seguida as que **não dão**, com o motivo.

---

# 0. Antes de tudo: ninguém consegue criar conta hoje

**Gravidade: bloqueante.** Isto foi descoberto pelo agente da jornada e depois confirmado por mim, por quatro caminhos independentes, chamando a API do Supabase Auth em produção:

| Operação | Resultado real, hoje |
|---|---|
| Criar conta | **HTTP 500** — `"Error sending confirmation email"` (reproduzido 2×, e-mails diferentes) |
| Recuperar senha | **HTTP 500** — `"Error sending recovery email"` |
| Reenviar confirmação | **HTTP 200 `{}`** — responde sucesso e **não envia nada** |
| Login de quem já tem conta | 200 OK — quem já está dentro continua funcionando |

O canal de e-mail do Supabase Auth está fora do ar. As consequências:

1. **O funil está fechado.** Nenhum usuário novo consegue entrar. Cada real gasto em divulgação hoje é perdido no último metro.
2. **Quem esquece a senha fica trancado para sempre.** Não existe outro caminho de volta à conta — o próprio código diz isso (`Auth.jsx:147-148`).
3. **A mensagem que a pessoa vê é a frase crua em inglês.** `translateError()` (`Auth.jsx:24-28`) devolve a mensagem original quando ela não está no dicionário `ERROR_PT`, e `"Error sending confirmation email"` não está. O visitante recebe um erro de servidor em inglês numa caixa vermelha.
4. **O reenvio mente.** Como a API devolve 200, o app faz `setResent(true)` (`Auth.jsx:183`) e diz que reenviou. A pessoa espera um e-mail que nunca foi despachado.

### Como resolver

Não consigo fazer isto por você: exige o painel do Supabase, ao qual não tenho acesso.

- **Agora (1 minuto), para reabrir o funil:** Supabase → Authentication → Providers → Email → desligar **"Confirm email"**. O cadastro volta a funcionar na hora, ao custo de aceitar e-mails não verificados. É a medida de emergência.
- **Certo (30 minutos):** Supabase → Project Settings → Authentication → **SMTP Settings**, e configurar um provedor próprio (Resend, Brevo, SendGrid — todos têm faixa gratuita suficiente). O serviço de e-mail embutido do Supabase é limitado a poucos envios por hora e não serve para produção; é a causa provável do 500.
- **No código (5 minutos), enquanto isso:** adicionar ao `ERROR_PT` em `frontend/src/pages/Auth.jsx:15-22`:
  ```js
  'Error sending confirmation email': 'Não conseguimos enviar o e-mail de confirmação agora. Tente de novo em alguns minutos.',
  'Error sending recovery email': 'Não conseguimos enviar o e-mail de recuperação agora. Tente de novo em alguns minutos.',
  ```
  E, no reenvio (`Auth.jsx:178-189`), não declarar sucesso sem confirmação real do envio.

> **Não é um pico passageiro — eu verifiquei.** Repeti o teste quatro horas depois da primeira detecção, com e-mails novos e intervalo entre as tentativas: o 500 se repete igual. Isso descarta limite de envio momentâneo e aponta para configuração do canal de e-mail. Ou seja: o funil está fechado desde pelo menos hoje de manhã e não vai se destravar sozinho.

---

# 1. As 5 principais falhas da landing (resolvíveis agora)

### L-1. A promessa de sigilo contradiz a sua própria política de privacidade

**Onde:** `frontend/src/pages/Landing.jsx:315-320` e `:262` · `frontend/public/privacidade.html` §4 · `frontend/src/lib/api.js:137-141`

A página afirma que o conteúdo é *"cifrado dentro do seu próprio aparelho, **antes de subir**"* e que *"**nem nós conseguimos ler** o que você guarda no Dito"*. O código faz outra coisa: `api.js:137` sobe o arquivo cru (`formData.append('file', file)`), e `cofre.js:24-26` cifra apenas os campos de texto **no momento de gravar no Supabase** — é cifragem em repouso no banco, não ponta a ponta. A própria política linkada logo abaixo lista **Groq** e **Anthropic** recebendo o conteúdo.

**Por que importa mais do que parece:** o seu público-alvo é exatamente quem tem sigilo profissional legal a cumprir. "Nem nós conseguimos ler" é o argumento que um advogado manda o jurídico conferir — e ele encontra a contradição em dois cliques, na sua própria página.

**Como resolver (hoje, é texto):** trocar por uma promessa que é verdadeira e continua forte:

> "Seu conteúdo é guardado cifrado, com uma chave que nasce no seu aparelho — nem nós conseguimos abrir o que está salvo. Para transcrever e resumir, o áudio passa por dois parceiros (Groq e Anthropic), que o processam e não o usam para treinar modelos."

Ajustar também a faixa (`:262`) e os itens de plano (`:23`) de "Cifrado no seu aparelho" para "Guardado cifrado". Confirmar e **citar** os compromissos de não-treinamento da Groq e da Anthropic: isso vira prova a favor, não desculpa.

---

### L-2. No celular, a CTA principal é um beco sem saída

**Onde:** `frontend/src/components/InstalarModal.jsx:85-95` (Android) e `:73-83` (iOS)

"Instalar grátis" é a chamada primária, repetida 3× na página. Com user-agent Android, clicá-la abre um modal cujos únicos botões são, literalmente: `["Fechar [32x32]", "Prefiro usar agora no navegador [308x32]"]`. **Nenhuma ação de instalar.** O texto ensina a pessoa a usar o menu ⋮ do Chrome. O `beforeinstallprompt` não dispara em visita nova, então esse é o caminho padrão de quem chega pela primeira vez pelo celular — a maior parte do tráfego.

O agente da jornada chegou ao mesmo lugar por outro caminho e classificou como **crítico**: *"o botão principal da página não leva ao produto, leva a um tutorial de instalação"*.

**Como resolver:** inverter a hierarquia no mobile. O botão primário do modal passa a ser **"Começar agora no navegador"** → `/auth` (que é o que a pessoa quer: usar o produto), e a instrução de instalar vira linha secundária: *"Prefere um ícone na tela inicial? Menu ⋮ → Instalar app"*. Em `InstalarModal.jsx`, promover `.instalar-web` a `btn-primary instalar-btn` quando `aparelho` for `android`/`ios` e `!podeInstalarPwa`.

---

### L-3. O plano escolhido se perde no caminho até o pagamento

**Onde:** `Landing.jsx:213-216` · `Layout.jsx:124-130` · `PlanModal.jsx:40, 72, 105-114`

Testado ponta a ponta com login real. Mecanicamente funciona, mas perde a decisão em quatro pontos:

1. Clico em "Assinar Iniciante" → grava `localStorage['dito-plano-escolhido']` → vou para `#/auth`.
2. **A tela de login não diz uma palavra sobre o plano escolhido.** A pessoa que acabou de decidir comprar vê um formulário genérico.
3. Depois de logar, o modal abre — e **nada nele diz "Iniciante"**. É a tabela genérica dos três planos, e os três botões dizem só "Assinar". Escolher de novo, com menos informação do que havia na landing.
4. **O ciclo anual evapora.** O card vende "Ou R$ 135 por ano", mas o modal abre com `ciclo = 'mensal'` fixo (`PlanModal.jsx:40`). Quem clicou pelo preço anual precisa descobrir sozinho o seletor.
5. **A intenção é destruída antes da compra.** `Layout.jsx:127-129` faz `removeItem` no mesmo efeito que abre o modal — e o overlay fecha com qualquer clique fora (`PlanModal.jsx:72`). Um clique acidental e a intenção some para sempre; não há nada que traga a pessoa de volta.

**Como resolver:**
1. Passar o plano ao modal: `<PlanModal planoPreSelecionado={escolhido} cicloPreSelecionado={ciclo} />`, destacando o card e trocando o rótulo do botão para "Assinar Iniciante — R$ 14,99/mês".
2. Guardar também o ciclo (uma chave `dito-ciclo-escolhido`, ou dois pontos de entrada por plano na landing).
3. Só apagar o `localStorage` **depois** que o checkout abrir, dentro do `assinar()` — assim um fechamento acidental não queima a venda.
4. Na tela de login, uma linha: *"Você escolheu o plano Iniciante. Crie sua conta para continuar."*

---

### L-4. Quem já é cliente cai na aba errada e toma um erro

**Onde:** `frontend/src/pages/Auth.jsx:37` (`useState('signup')`)

A tela de autenticação abre sempre na aba **"Criar conta"**, inclusive para quem clicou em "Entrar" na landing. Quem já tem conta preenche, envia, e recebe *"Já existe uma conta com este e-mail. Use 'Acessar'"*. É um erro auto-infligido no caminho do cliente que volta — e o "Esqueci minha senha" também fica escondido atrás da aba que não está aberta.

**Como resolver:** fazer o destino depender da origem. O link "Entrar" da landing aponta para `#/auth?modo=login`, e o `Auth` inicializa `mode` a partir do parâmetro. Duas linhas.

---

### L-5. No celular não há como chegar aos preços

**Onde:** estrutura da `Landing.jsx` + ausência de âncora no cabeçalho mobile

Medido: são **4.019 px de rolagem** até a seção de preços no celular, e o cabeçalho mobile não tem link para ela. Numa página cujo objetivo é vender assinatura, o preço está inalcançável para quem não rola a página inteira — e o público-alvo lê isso entre um atendimento e outro.

**Como resolver:** um link "Preços" no cabeçalho mobile (âncora para `#precos`), e/ou subir um resumo de preço ("a partir de R$ 14,99/mês") para logo abaixo da dobra.

---

# 2. As 5 principais falhas do app (resolvíveis agora)

### A-1. Uma gravação em andamento se perde num F5, sem nenhum aviso

**Onde:** `frontend/src/components/capture/useCapture.js:150-155`

O `beforeunload` que protege o trabalho só é registrado **quando `loading` é `true`** — ou seja, durante o processamento, depois que o áudio já subiu. Durante a **gravação** não há proteção nenhuma. Verificado ao vivo: gravação rodando há 3,5 s, reload, e o resultado foi `aviso do navegador? NENHUM · perdeu a gravação? SIM`.

**Por que importa mais do que parece:** o app existe para gravar consultas, reuniões e audiências de 30 a 90 minutos. Uma hora de trabalho evapora num toque acidental, sem uma linha de aviso, e é irrecuperável — o áudio nunca chegou ao servidor.

**Como resolver (uma linha):**
```js
useEffect(() => {
  if (!loading && !isRecording) return          // ← era: if (!loading) return
  const warn = e => { e.preventDefault(); e.returnValue = '' }
  window.addEventListener('beforeunload', warn)
  return () => window.removeEventListener('beforeunload', warn)
}, [loading, isRecording])
```

---

### A-2. Áudio sem fala vira uma conversa "de verdade", com resumo inventado — e cobra minutos

**Onde:** `frontend/src/components/capture/useCapture.js:331-335` (`isEmpty`)

O único filtro de áudio vazio é `transcript.trim().length < 5`. O Whisper, em silêncio ou ruído, **alucina** frases curtas — e elas passam. Uma gravação de 4 segundos sem nenhuma fala produziu uma conversa completa, com título *"Agradecimento breve"* e resumo *"Mensagem de agradecimento sem contexto adicional"*. Noutra tentativa a API devolveu `{"transcript":"Woo!","title":"Exclamação sem contexto"}` e **cobrou 6 segundos do plano**.

**Isto já está na sua conta real:** a barra lateral tem sete conversas-fantasma — "Agradecimento simples", "Agradecimento breve", "Brief acknowledgment", "Agradecimento e despedida", "Agradecimento final", entre outras.

**Por que importa mais do que parece:** um app que promete "o combinado sai escrito" devolvendo um resumo fabricado é pior do que um app que devolve erro. Para médico ou advogado, um registro inventado num prontuário ou dossiê é risco material.

**Como resolver:**
1. Endurecer o critério: exigir mínimo de **palavras** e de densidade — `transcript.split(/\s+/).length < 8 || transcript.length / duracao_s < 0.5` — e barrar a lista conhecida de alucinações do Whisper em silêncio ("Obrigado", "Thank you", "Woo", "Legendas pela comunidade…").
2. Usar o `levelRef` que já existe (`useCapture.js:70`) para avisar durante a gravação: *"não estamos captando som — confira o microfone"*.

---

### A-3. O limite do plano só é checado **depois** da transcrição

**Onde:** `backend/main.py:1481-1492`, dentro de `analisar_transcricao` · `frontend/src/lib/api.js:129-142`

A validação de saldo roda depois de o áudio ter sido enviado inteiro, convertido pelo ffmpeg e transcrito pelo Whisper. O frontend não faz checagem prévia nenhuma, embora `pendingFile.durationSec` esteja em mãos desde a escolha do arquivo (`useCapture.js:363-370`).

Na prática: a pessoa sobe uma reunião de 3 horas, olha o círculo girando por vários minutos, e no fim recebe *"Esta captura tem 180 min e restam 12 min no seu plano neste mês"*. **A transcrição pronta é descartada.**

**Por que importa mais do que parece:** é o pior momento possível para um erro de cobrança — depois do investimento de tempo e no instante exato em que a pessoa esperava o resultado. Converte um momento de intenção de compra num momento de raiva. Esta é a fase "aprimorar" da jornada falhando no ponto mais caro.

**Como resolver:** no frontend, antes de enviar, comparar `durationSec / 60` com o saldo restante e abrir a caixa de planos **antes do upload**, com o número exato: *"este arquivo tem 3 h 12 min e restam 12 min"*. Os dois dados já estão no cliente. No backend, checar o saldo logo após o `ffprobe`, antes de chamar o Whisper.

---

### A-4. O conteúdo não sai do app: não dá para ler a transcrição nem copiar nada

**Onde:** `Conversa.jsx:79-101`, `Timeline.jsx`, `Todos.jsx`, `Topico.jsx`, `Chat.jsx`

Dois defeitos que juntos impedem a fase "usar para valer":

- **Não existe botão de copiar em lugar nenhum.** Confirmei com uma varredura no código: `grep` por `clipboard|copiar` em todo o `frontend/src` devolve apenas um comentário. (O `README.md` ainda promete "botões de copiar" — está desatualizado.)
- **Numa captura em "Transcrição simples"** — que é o modo recomendado por padrão para áudios curtos — a conversa nasce sem `insights`, e **nenhuma tela mostra a transcrição**. As quatro abas dizem "não tem os 4 tópicos", "0 ações", "0 intervalos", "este tópico não existe mais". O texto está no banco; o único acesso é baixar um `.txt`.

**Por que importa mais do que parece:** o gesto que fecha o ciclo de valor é *colar o resumo no prontuário, no e-mail para o cliente ou na petição*. Hoje isso exige selecionar texto com o mouse — inviável no celular, e o app é vendido como app de celular. É a diferença entre "o Dito me poupou tempo" e "o Dito me deu mais um lugar de onde copiar à mão".

**Como resolver:**
1. Um componente `<BotaoCopiar texto={...} />` de ~12 linhas, usado no resumo, em cada resposta do chat, na lista de to-dos e em cada trecho — com `showToast('Copiado')`, que já está montado no Layout.
2. Um bloco "Transcrição" na visão geral, recolhido por padrão, usando `groupBySpeaker` (já existe em `shared.js:42`). A classe CSS `.conversa-transcript` já está escrita em `index.css:1210` e não é usada por nenhum JSX.

---

### A-5. Quem assina o mensal não consegue migrar para o anual — nem cancelar

**Onde:** `frontend/src/components/PlanModal.jsx:91` (`const ativo = planoAtual === p.id`), usado em `:109` e `:112`

O "plano atual" é comparado **só pelo id do plano, ignorando o ciclo**. Ao trocar o seletor para "Anual", o card do Iniciante passa a mostrar `R$ 135 por ano` — mas o botão continua `disabled` com o rótulo "Plano atual". O anual, que é o produto de maior valor por cliente e está anunciado na landing, é **literalmente inclicável** para quem já assina.

No mesmo modal: **não há nenhuma forma de cancelar, pausar ou rebaixar**. O card "Gratuito" não tem botão (`{pago && (...)}` em `:106`), e não existe link para o portal de faturamento do Stripe.

**Por que importa mais do que parece:** a ausência de "cancelar" empurra o cliente insatisfeito para o chargeback ou para o seu WhatsApp, em vez do autoatendimento — e chargeback em volume põe a conta Stripe em risco. Com cobrança real ativa, isso deixou de ser detalhe.

**Como resolver:**
1. `const ativo = planoAtual === p.id && cicloAtual === ciclo` (ler o ciclo junto do plano em `subscriptions`).
2. Quando o plano é o mesmo e o ciclo é outro, o botão vira "Mudar para anual".
3. Adicionar "Gerenciar assinatura" apontando para o Billing Portal do Stripe (rota nova `/billing/portal` no backend, ~30 min).

---

## Bônus: correções de 5 minutos que vale fazer no mesmo passe

| # | O quê | Onde |
|---|---|---|
| 1 | **O desconto anual está errado — e para menos.** "2 meses de graça" sobre R$ 14,99 daria R$ 149,90; você cobra R$ 135, que são **3 meses**. Idem no Avançado (R$ 239,88 → R$ 180). Ou anuncie "3 meses de graça" e ganhe o argumento que já está pagando, ou suba o anual. | `Landing.jsx:38` e `PlanModal.jsx:25,32` |
| 2 | **Erro 404 mostra a página do GitHub Pages**, não a sua. Confirmei: `<title>Page not found · GitHub Pages</title>`. | criar `public/404.html` |
| 3 | **Falta `apple-touch-icon`** — justamente o que o modal manda o usuário de iPhone usar. Confirmei ausente no HTML. | `index.html` |
| 4 | **`theme-color` fixo em `#ffffff`** — confirmei cravado; no tema escuro a barra do navegador fica branca. | `index.html` |
| 5 | **Sem `robots.txt` e sem `sitemap.xml`** — confirmei, os dois devolvem 404. | `public/` |
| 6 | **Um Enter perdido apaga a conversa para sempre.** O modal de exclusão abre com o foco **no botão vermelho** (`ref={confirmRef}` está no `btn-danger`), e Esc não fecha. Mover o foco para "Cancelar" é uma linha. | `ConversaMenu.jsx:260,278` |
| 7 | **Erro cru do Postgres em inglês na tela:** abrir uma conversa apagada — ou ter a sessão expirada — mostra `Cannot coerce the result to a single JSON object`, sem cabeçalho, sem botão, sem saída. | `ConversaLayout.jsx:39` |

---

# 3. Falhas relevantes da landing que **não** dá para resolver agora

### 3.1 Não existe Termos de Uso, e a cobrança recorrente é real — *o item mais urgente do relatório depois da seção 0*

Confirmei: `https://dito.albiecloud.com/termos.html` → **404**. O rodapé tem quatro itens e nenhum é "Termos de uso". Não há checkbox de aceite no cadastro. Enquanto isso, o checkout está em modo **LIVE** (você confirmou que é intencional): há assinatura recorrente sendo vendida e cobrada hoje, sem nenhum instrumento contratual publicado.

O que isso expõe: o art. 49 do CDC dá 7 dias de arrependimento em compra fora do estabelecimento — sem política publicada, quem define os termos é o consumidor na reclamação. Renovação automática sem termos aceitos é o cenário clássico de chargeback. E os próprios termos do Stripe exigem que o vendedor publique os seus.

**Por que não dá para resolver agora:** o arquivo, o link e o checkbox ficam prontos em minutos — mas o *conteúdo* é decisão sua e jurídica: política de reembolso, prazo de cancelamento, limitação de responsabilidade, foro. Não posso escrever isso no seu lugar.

**O que dá para fazer agora:** me diga as quatro decisões (reembolso, cancelamento, responsabilidade, foro) e eu escrevo o `termos.html` no mesmo estilo do `privacidade.html` e ligo no rodapé e no cadastro.

### 3.2 A política de privacidade não sustenta uma análise de compliance do público que a landing mira

Falta encarregado/DPO nomeado, menção a transferência internacional de dados (os dados vão para EUA), contrato de operador com Supabase/Groq/Anthropic, e o controlador é pessoa física com e-mail no Gmail.

**Por que não dá:** depende de abrir CNPJ, nomear encarregado, contratar e-mail no domínio e assinar os DPAs com os três fornecedores. São decisões de negócio e contas externas.

### 3.3 O checkout exibe a marca "Albie", não "Dito"

Confirmei nas duas execuções: quem clicou em "Assinar Dito" vê "Albie" na hora de digitar o cartão. Agravante que descobri depois: **esse nome também aparece na fatura do cartão**, então o descasamento volta 30 dias depois como pedido de estorno de alguém que não reconhece a cobrança.

**Por que não dá:** é configuração no dashboard do Stripe (Settings → Business → Public business name), conta externa à qual não tenho acesso. **Para você é alteração de dois minutos** — e vale fazer hoje, dado que já há cobrança real.

### 3.4 Adaptive Pricing converte o preço para quem não tem o navegador em português

Com `pt-BR` o checkout mostra "R$ 14,99 por mês" corretamente. Com `en-US`, mostra "$3.06 per month USD" mais o aviso "Charges will vary based on exchange rates" — no meio da compra, o que assusta e ainda embute IOF.

**Por que não dá integralmente:** passar `locale: "pt-BR"` na criação da sessão é uma linha de código (essa eu faço); desligar o Adaptive Pricing é configuração no dashboard do Stripe.

> **Nota de honestidade.** Este item chegou a ser reportado pelo primeiro agente como "o checkout cobra em dólar enquanto a landing anuncia reais". Isso estava errado e eu verifiquei antes de te repassar: o agente rodou com o Chromium no padrão `en-US` e leu a conversão como se fosse o preço. O preço-base está correto em reais.

### 3.5 Zero prova social

Nenhum cliente citado, nenhum número, nenhum depoimento — numa página que pede a um profissional que confie dados sigilosos a um desconhecido.

**Por que não dá:** depende de conseguir autorização dos seus testadores e de ter números reais para mostrar. É decisão de negócio e dado que não existe aqui. Você tem 10 usuários reais no histórico (`precificacao.md`) — pedir dois depoimentos é a ação de maior retorno por esforço em toda a landing.

### 3.6 Outros que dependem de você

| Achado | Por que não dá agora |
|---|---|
| Clicar em "Instalar grátis" no Windows baixa um `.exe` **não assinado**, e o modal manda ignorar o aviso do SmartScreen | Tirar o download automático dá; **assinar** exige certificado OV, que custa e exige validação de identidade |
| Único canal de contato é um `mailto:` para um Gmail pessoal | Depende de configurar e-mail no domínio |
| A landing nunca menciona o app Android que existe no repositório | Depende do status na Play Store, que eu não sei daqui |
| Não há FAQ respondendo a nenhuma objeção | A estrutura é trivial, mas as respostas dependem de dados que não tenho (acerto real do Whisper em português, tempo médio de processamento) e de decidir o que acontece ao estourar o limite |
| O botão laranja principal não passa no contraste mínimo (WCAG AA) | A correção muda o laranja da marca — decisão sua, não minha |
| Sem JS a página é uma folha em branco (sem SSR, sem `<noscript>`) | O `<noscript>` dá agora; o pré-render é meia jornada de trabalho, não cinco minutos |

---

# 4. Falhas relevantes do app que **não** dá para resolver agora

### 4.1 Redefinir a senha em outro aparelho apaga o acervo inteiro, em silêncio

**Onde:** `frontend/src/lib/chaves.js:82-88` e `:126-146` · `ConfirmEmail.jsx:75-90` · `cofre.js:80-90`

O conteúdo é cifrado com uma chave guardada no IndexedDB e trancada num cofre derivado da senha. No "esqueci minha senha", o app tenta refechar o cofre com a chave **local** — o que só funciona no mesmo aparelho e navegador. Redefinindo a senha pelo celular, de outro computador, numa janela anônima ou depois de limpar os dados do navegador, a função retorna `false` **em silêncio** e o cofre fica trancado por uma senha que não existe mais. A pessoa passa a ver a lista inteira como `(conteúdo bloqueado)`, sem explicação, sem aviso prévio e sem recuperação. O próprio código admite: *"Quem cair nesse caso perde o conteúdo cifrado"*.

**Isto está acoplado à seção 0:** enquanto o e-mail de recuperação está quebrado, ninguém chega nesse fluxo — mas no dia em que você consertar o SMTP, essa armadilha passa a ser alcançável por qualquer usuário.

**O que dá agora:** dizer a verdade no cadastro e na tela de "esqueci a senha", e **bloquear** o fluxo com aviso explícito quando `refecharCofreComChaveLocal` devolver `false` (hoje só faz `console.error`). Trocar `(conteúdo bloqueado)` por um estado explicado com link.

**Por que o conserto de verdade não dá agora:** exige implementar a chave de recuperação que o banco já prevê (`user_keys.recuperacao_salt`/`recuperacao_cofre`, hoje preenchidas com um segredo descartável), desenhar o fluxo de exibi-la e confirmar que foi guardada, e **migrar quem já tem conta**. É projeto, não correção.

### 4.2 Não dá para corrigir uma transcrição

O Whisper erra nomes próprios, termos técnicos e jargão jurídico/médico — exatamente o vocabulário do seu público. Não existe nenhuma forma de editar o texto.

**Por que não dá:** exige desenhar o fluxo de edição, decidir se o chat passa a usar o texto corrigido, e tratar o conflito entre `transcript` e `segments` (que precisam continuar alinhados para a timeline). São dias de trabalho.

### 4.3 Uma transcrição já paga é jogada fora quando o limite estoura

Ligado ao **A-3** da seção 2. A correção completa é guardar a transcrição e liberá-la na renovação ou na assinatura, em vez de descartar.

**Por que não dá:** exige decidir política de retenção — por quanto tempo guardar algo que o usuário não pode ver, e o que acontece se ele nunca assinar. É decisão sua, com implicação de custo e de privacidade.

### 4.4 Não há como cancelar um processamento em andamento

Começou a subir um arquivo errado de 2 GB? Não há botão de cancelar. Só fechando a aba — e aí cai no A-1.

**Por que não dá integralmente:** o cancelamento no cliente depende de introduzir um `AbortController` no caminho de upload; interromper o trabalho que já começou no servidor exige mudança no backend.

### 4.5 Apagar uma conversa não tem desfazer

Ligado ao item 6 do bônus. Mover o foco e fazer Esc funcionar são minutos; o **desfazer** exige uma coluna `deleted_at`, um filtro em toda a listagem e uma política de expurgo. O `Toast` já suporta `actionLabel`/`onAction` e essa peça está sem uso — a metade difícil é o banco.

### 4.6 A padronização visual exige uma revisão tela a tela

O catálogo registra inconsistências reais (dois anéis de foco diferentes na mesma lista, contraste insuficiente no seletor Mensal/Anual do tema escuro, `100vh` em duas telas cortando conteúdo no celular, 60 alvos de toque abaixo de 44 px, dois toasts que se sobrepõem, e ~330 linhas de CSS morto). Cada um isolado é pequeno.

**Por que não dá "agora":** fazer isso direito é uma passada de design system tela a tela, não uma correção pontual — e mexer no CSS compartilhado sem essa revisão tende a quebrar outra tela.

---

# 5. Método, cobertura e limites desta auditoria

**O que foi realmente exercitado em produção:** carga e Core Web Vitals; 5 viewports; clique em todos os CTAs da landing; fluxo de assinatura até a tela do Stripe com login real; instalação em 5 user-agents; teclado, foco e contraste; tema escuro; rede e CPU degradadas; login, gravação com microfone falso, upload de arquivo, as cinco telas de conversa, os cinco modais, sessão expirada, offline, duas abas simultâneas.

**O que eu verifiquei pessoalmente** (não confiei só nos agentes): o modo LIVE do Stripe e a moeda em dois idiomas; o cadastro, a recuperação de senha, o reenvio e o login pela API do Supabase; a existência do instalador de Windows (2,5 MB reais); `robots.txt`, `sitemap.xml`, `termos.html`, a página de 404, `apple-touch-icon`, `theme-color`, `<noscript>`; e no código: o `beforeunload`, o `.single()`, o `isEmpty`, o foco no botão destrutivo, o `ativo` do PlanModal e a ausência total de botão de copiar.

**Uma correção que fiz no meio do caminho.** O primeiro agente reportou como crítico que o checkout cobrava em dólar divergindo da landing. Verifiquei antes de te repassar e estava errado — era o Adaptive Pricing convertendo para um navegador `en-US`. O achado virou o item 3.4, com gravidade média. O restante da amostragem que fiz nos dois catálogos conferiu em todos os pontos testados.

**O que não foi coberto:**
- **A fase "usar para valer" da jornada não foi percorrida inteira.** Os agentes que fariam isso foram cortados por limite de API. O que existe sobre ela vem da auditoria do app (que cobriu as telas) e não de uma simulação de uso continuado ao longo de semanas.
- **O app Android empacotado não foi testado** — só a versão web em user-agent móvel.
- **Nenhuma compra foi concluída**, então o pós-pagamento (webhook, desbloqueio de limite, tela de sucesso) não foi observado de ponta a ponta.
- **A qualidade do resumo com áudio real não foi avaliada.** O microfone falso produz um tom, não fala — o que revelou o A-2, mas não diz nada sobre o acerto do Whisper e do Claude em português com fala de verdade.

**Rastros deixados na sua conta:**
- 1 conversa de teste criada e **já apagada** (a faxina confirmou).
- Duas conversas tiveram o estado "fixada" alterado durante os testes de menu e **não foram restauradas**: **"Alinhamento 2°Tri"** e **"Fechamento Abril"**. Refixar à mão (botão direito → Fixar) devolve a conta ao estado original.
- ~4 minutos do plano consumidos pelas capturas de teste.
- 2 tentativas de cadastro com aliases `pdrbartoli+audit…@gmail.com` e `pdrbartoli+t…@gmail.com`, ambas **falharam** (seção 0), então provavelmente nenhum usuário foi criado — vale conferir no painel do Supabase e, se aparecerem, apagar.

**Catálogos completos**, achado por achado, com evidência e trecho de código:
- `/home/codespace/dito-auditoria/catalogo-landing.md` — 46 achados (L01–L46), 544 linhas
- `/home/codespace/dito-auditoria/catalogo-app.md` — 63 achados (A01–A63), 963 linhas
- `/home/codespace/dito-auditoria/ciclo-ponta-a-ponta.md` — jornada, fase 1 completa (C01–C06)
- `/home/codespace/dito-auditoria/shots-app/` — 81 screenshots · `shots-ciclo/` — 18 screenshots

---

# 6. Se você só tiver uma tarde

Nesta ordem, por retorno sobre esforço:

1. **Religar o e-mail do Supabase** (seção 0). Sem isso, nada mais importa: não entra ninguém.
2. **Trocar a marca "Albie" para "Dito" no Stripe** (2 minutos, painel). Há cobrança real acontecendo.
3. **Corrigir o texto da promessa de sigilo** (L-1). É o argumento central e está falso.
4. **O `beforeunload` da gravação** (A-1). Uma linha, evita perda irrecuperável de uma hora de trabalho.
5. **Endurecer o filtro de áudio vazio** (A-2). Impede resumo inventado e cobrança indevida.
6. **Botão de copiar** (A-4). É o gesto que fecha o ciclo de valor, e são 12 linhas.
7. **CTA do celular apontando para o produto** (L-2). Destrava o maior vazamento de conversão da landing.

Os itens 3 a 7 eu posso fazer agora, se você quiser — são todos de código e todos verificáveis em produção depois do push.
