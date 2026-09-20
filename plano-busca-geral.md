# Dito — Perguntar a todo o acervo (busca geral com IA)

**Data:** 19/09/2026, atualizado em 20/09 com o MVP no ar · **Pergunta que a feature responde:** "o que foi dito nas últimas 2 reuniões de sprint sobre a UX do produto ABC?" / "o que a professora explicou sobre nematoide?"

---

## 1. Resposta curta

**Está no ar desde 20/09/2026.** A tela `/perguntar` responde perguntas olhando
todas as conversas, com fontes clicáveis que abrem a conversa no minuto. O que
segue descreve o que foi construído e por quê; o que mudou em relação ao plano
original está marcado.

**Dá, e custa quase nada.** Uma pergunta ao acervo inteiro custa **cerca de R$ 0,02** (pior caso R$ 0,03), mais **R$ 0,012 por hora de conversa** para indexar, uma vez só. Não precisa de servidor novo, de banco de vetores nem de plano pago de nenhum serviço.

**RAG é o caminho certo, mas com uma adaptação obrigatória:** a busca tem de acontecer **no aparelho do usuário**, não no servidor. O motivo é que o Dito cifra as conversas no navegador (é o diferencial da landing: "cifradas antes de sair do seu aparelho"). O servidor só guarda ruído. O RAG de manual (guardar vetores no Postgres com pgvector e buscar lá) exigiria texto ou vetores em claro no servidor e quebraria essa promessa.

**Recomendação, corrigida depois do teste (Etapa 0, 19-20/09):** o MVP já nasce **com embeddings**. A ideia original era começar só com busca por palavra e somar embeddings se fosse preciso; o teste mostrou que é preciso. Busca por palavra acerta o trecho em 1º lugar em 63% das perguntas, contra **93% dos embeddings do Gemini** — e, no que de fato importa (o trecho certo estar entre os 8 que vão para a IA), a diferença é 88% contra **100%**. Indexar custa **R$ 0,012 por hora de conversa**, uma vez.

1. **Índice no aparelho:** cada trecho vira um vetor (Gemini Embedding 2) e fica guardado no próprio aparelho.
2. **Entender a pergunta:** uma chamada barata de IA resolve datas e "últimas 2", e ajuda a achar o vocabulário certo.
3. **Buscar e responder:** a busca acontece no aparelho e só os ~8 trechos escolhidos vão para a IA, que responde com fontes clicáveis.

---

## 2. Por que não é o RAG "de manual"

| Como seria o RAG de manual | Problema no Dito |
|---|---|
| Servidor recebe a transcrição, quebra em trechos, gera vetores e guarda no Postgres (pgvector) | O servidor passaria a guardar conteúdo (ou vetores, que vazam o sentido do texto) em claro. Quebra a promessa de cifra. |
| Servidor busca e devolve os trechos | O servidor precisaria ler o acervo do usuário a cada pergunta. |
| Precisa criar tabela/extension no Supabase | Aqui só temos a chave anon: o SQL teria de ser rodado por você (ver `dito-supabase-acesso`). |

**O que já existe e ajuda:**

- O app **já baixa e decifra o acervo inteiro** para a busca da barra lateral (`carregarAcervo` em `frontend/src/lib/conversas.js`), com cache em memória. A base da nossa busca já está no aparelho.
- Cada conversa **já tem estrutura feita pela IA**: resumo, 4 tópicos, capítulos com tempo, tarefas e locutores. Isso é ouro para busca: cada capítulo é um "trecho pré-resumido".
- O `/chat` de hoje **já manda a transcrição inteira** ao servidor a cada pergunta (o servidor não guarda). A pergunta ao acervo mandaria **menos** que isso: só uns 8 trechos escolhidos.

---

## 3. Onde fica na interface

**Uma tela nova: "Perguntar ao acervo"** (rota `/perguntar`), com a mesma cara do chat de conversa.

- **Entrada 1, sempre visível:** ✅ botão fixo na barra lateral, logo abaixo do "Novo" (`components/Layout.jsx`).
- **Entrada 2:** na busca da barra lateral, quando o texto digitado parece uma pergunta, o primeiro resultado vira "Perguntar ao acervo: '...'". **Não foi construída no MVP:** é uma segunda porta para o mesmo lugar, e o botão fixo já dá acesso permanente. Fica para o acabamento.
- **Tela vazia:** ✅ três exemplos clicáveis ("O que ficou decidido nas últimas reuniões?", "Quais tarefas ficaram pendentes?", "Sobre o que eu mais falei este mês?").
- **Resposta:** texto curto e direto, com **fontes em chips clicáveis** ("Sprint 14 · 12 set · 14:32"). Clicar abre a conversa no minuto exato.
- **Transparência:** uma linha discreta abaixo da resposta: "Procurei em 47 conversas e usei 6 trechos de 3 delas". Quando não achar, diz que não achou (nada de inventar).
- **Reaproveita** ✅ o botão "Sinalizar conteúdo da IA" que já existe nas telas de conversa (o mesmo modal, agora sem precisar de uma conversa para apontar).
- **Histórico:** ✅ as perguntas ficam salvas, cifradas, na tabela `chats` que já existe, com `session_id` vazio. **Não precisou de SQL nenhum.** Cada pergunta nova abre uma thread própria, e a tela vazia lista as anteriores.
- **Convidado (sem conta):** funciona igual, só sem cifra.

---

## 4. Como funciona, passo a passo

```
 no aparelho                         servidor (só passa, não guarda)
 ───────────                         ───────────────────────────────
 1. Indexar   (1x por conversa)
        │
 2. Pergunta ──────────────────────▶ 2. Entender a pergunta  (IA barata)
        │ ◀───── palavras, sinônimos, datas, "últimas N" ─────┘
 3. Buscar    (grátis, no aparelho)
        │
        └─── só os ~8 trechos escolhidos ▶ 4. Responder com fontes (Luna)
 5. Mostrar e salvar cifrado  ◀──────────────────────────────────────┘
```

### Passo 1: indexar (no aparelho, R$ 0,012 por hora)

- Cada conversa é quebrada em **trechos de ~1,5 minuto de fala (300 a 400 tokens)**, usando os `segments` com tempo que já existem. Cada trecho guarda conversa, início e fim, e por isso a citação sabe o minuto.
- Além disso, **cada capítulo, tópico e tarefa** dos `insights` vira um trecho extra. São resumos prontos e acertam bem perguntas do tipo "o que foi decidido sobre...".
- O título e a data entram como campos do trecho (achar "sprint" no título ajuda).
- Cada trecho vira um **vetor** (Gemini Embedding 2, 768 dimensões) por um `/embeddar` que só converte e não guarda nada. Os vetores ficam no aparelho (IndexedDB): ~90 KB por hora, ~9 MB para 100 horas.
- Um índice de palavras (BM25, biblioteca de ~10 KB) entra junto, de graça, porque a combinação dos dois deu o melhor resultado no teste.
- Conversas antigas sem tempo (legenda de YouTube sem marcação): quebram por parágrafo, sem minuto na citação.

### Passo 2: entender a pergunta (1 chamada barata)

O modelo recebe a pergunta, o histórico e **só a lista de títulos e datas** das conversas (~25 tokens cada; nunca o conteúdo). Devolve um JSON curto:

- **palavras e sinônimos**: "UX" vira "experiência do usuário, usabilidade, interface, design";
- **filtro de tempo**: "últimas 2" vira recência = 2; "mês passado" vira um intervalo de datas;
- **conversas candidatas** por título ("reuniões de sprint" aponta as que têm sprint no nome);
- **pergunta reescrita** sem depender do histórico ("e o que ele disse sobre prazo?" vira uma pergunta completa).

No teste, é isto que salva conteúdo em outro idioma: perguntas em português sobre um vídeo em inglês saltaram de 40% para 80% de acerto em 1º lugar só com as palavras que o modelo devolveu em inglês.

### Passo 3: buscar (no aparelho, grátis)

1. Ranking por similaridade dos vetores. **Correção medida ao construir:** quando
   todos os trechos têm vetor, o vetor ordena **sozinho** — fundi-lo com a busca
   por palavra piorava (ver "A correção da fusão", abaixo). A busca por palavra
   entra quando algum trecho ainda não tem vetor, que é o caso durante a
   indexação e quando ela falha.
2. Aplica o filtro de tempo/recência ("as 2 mais recentes entre as relevantes")
   e sobe as conversas que a IA apontou pelo título, sem excluir as outras.
3. Pega **~8 trechos, no máximo 3 por conversa** (para não responder só com uma reunião).
4. Sem nenhum trecho casando e com filtro de período ativo ("o que ficou decidido
   esta semana?"), devolve o começo do período pedido em vez de nada.

### Passo 4: responder (servidor, endpoint novo `/chat-acervo`)

Mesmo padrão do `/chat`: **Luna primeiro, Claude de reserva**, mesma autenticação e mesmo registro de fallback. Recebe só os trechos escolhidos, rotulados `[C1 · Sprint 14 · 12/09 · 14:32]`, e a regra é: responder **só** com o que está nos trechos, citar `[C1]`, e dizer "não encontrei" se não estiver lá. O app troca `[C1]` por chip clicável.

### Passo 5: mostrar e salvar

Resposta salva cifrada em `chats` / `chat_messages` (sem `session_id`), como qualquer chat.

### Privacidade: o que sai do aparelho

| | Sai do aparelho | Fica no servidor |
|---|---|---|
| Passo 2 | pergunta + títulos/datas | nada |
| Passo 4 | pergunta + ~8 trechos | nada |
| Passo 1 (indexar) | trechos, só para virar vetor | nada; os vetores voltam e ficam no aparelho |

É a mesma categoria de exposição que o chat atual já tem (hoje ele manda a transcrição inteira), e em volume menor. **A promessa "cifrado no aparelho" continua valendo para o que fica guardado.** Vale ajustar uma frase na política de privacidade dizendo que trechos da conversa são enviados à IA para responder, se ainda não estiver dito.

---

## 5. Custo

**Base:** 1 hora de conversa ≈ 12 mil tokens (198 tokens/min, medido em `precificacao.md`). Câmbio R$ 5,12. Preços conferidos hoje nas páginas oficiais: Luna US$ 0,20 / 1,20 por milhão (entrada/saída), Gemini 3.8 Flash US$ 0,75 / 3,75, OpenAI `text-embedding-3-small` US$ 0,02, Gemini Embedding 2 US$ 0,20.

### 5.1 Uma pergunta ao acervo

| Item | Tokens (entrada / saída) | US$ |
|---|---|---|
| Entender a pergunta (pergunta + ~100 títulos) | 3.000 / 200 | 0,0008 |
| Responder (8 trechos + histórico curto) | 8.000 / 600 | 0,0023 |
| **Total (caso típico)** | | **0,0032 ≈ R$ 0,02** |
| Pior caso (200 títulos, 15 mil tokens de contexto, resposta longa) | | 0,0052 ≈ R$ 0,03 |
| Se cair para o Claude Haiku (reserva) | | ≈ R$ 0,08 a R$ 0,13 |

Para comparar: a pergunta de hoje, dentro de uma conversa de 1 hora, custa a mesma ordem de grandeza (manda ~12 mil tokens de transcrição a cada vez).

### 5.2 Por usuário, por mês

| Uso | Perguntas | Custo (Luna) |
|---|---|---|
| Leve | 5 | R$ 0,10 |
| Típico | 20 | R$ 0,33 |
| Pesado | 100 | R$ 1,63 |

O custo medido de hoje por usuário é R$ 1,38 (Iniciante) e R$ 4,22 (Avançado). A feature soma **R$ 0,3 a R$ 1,6 por mês** de quem realmente usa, contra R$ 19,90 e R$ 39,90 de mensalidade: **cerca de 2% do preço no uso típico e menos de 10% mesmo no uso pesado (100 perguntas).**

### 5.3 Cota decidida: um valor único por mês, para todas as perguntas

**Decisão (19/09/2026):** as perguntas deixam de ser "por conversa" e viram **um saldo mensal único**, que vale para o chat de cada conversa e para o chat geral. **Grátis 5, Iniciante 60, Avançado ilimitado.** O saldo segue o mesmo ciclo dos minutos (o do Stripe para quem paga, o mês corrido para o Grátis) e fica na tabela `uso_mensal`. SQL: `supabase/perguntas_mes.sql`.

| Plano | Perguntas/mês | Custo máximo (Luna, R$ 0,027 no pior caso) |
|---|---|---|
| Grátis | 5 | R$ 0,14 |
| Iniciante | 60 | R$ 1,60 |
| Avançado | ilimitado | sem teto (ver aviso) |

**O que muda para quem já usa:** hoje o Grátis tem 2 perguntas por conversa (com 11 conversas no mês, cerca de 22 perguntas) e o Iniciante 10 por conversa. Com o saldo único, o Grátis cai para 5 no mês inteiro e o Iniciante para 60. É uma restrição real para o Grátis; a primeira conversa já pode gastar o saldo todo.

**Avançado ilimitado não tem teto de custo.** Uma pergunta custa R$ 0,02 a R$ 0,05 (mais nas conversas longas), então um uso automatizado de 3.000 perguntas passaria a receita do plano. O backend já limita a taxa de chamadas, mas vale um teto de "uso justo" invisível (por exemplo 500 por mês). O Avançado **é contado do mesmo jeito**, então ligar um teto depois é uma linha de código, sem migração.

Além do custo, **memória entre conversas é exatamente o tipo de recurso que justifica assinar**: o Grátis com 5 perguntas deixa provar o gosto.

### 5.4 Indexação e infraestrutura

| | Por hora de conversa | Acervo de 100 h, uma vez |
|---|---|---|
| **Gemini Embedding 2** (escolhido) | R$ 0,012 | R$ 1,23 |
| OpenAI `text-embedding-3-small` | R$ 0,0012 | R$ 0,12 |
| Índice de palavras (BM25) | R$ 0 | R$ 0 |
| Servidor ou banco novo | R$ 0 | R$ 0 |

Para comparar: a extração de tópicos que já roda hoje custa de R$ 0,23 a R$ 0,43 por hora. A indexação soma de 3% a 5% a isso, e só uma vez por conversa.

Espaço no aparelho: ~90 KB de vetores por hora de conversa, ou ~9 MB para 100 horas. No banco não entra nada.

Sobre o plano gratuito do Gemini Embedding 2: existe, mas **não contar com ele**. Além dos limites de uso, o nível gratuito costuma permitir que o provedor use o conteúdo para melhorar produtos, o que não combina com a promessa de privacidade (conferir os termos antes de qualquer decisão).

**Conclusão de custo: dá.** O custo é dominado por perguntas (centavos), não por indexação nem por infraestrutura.

---

## 6. Por que os embeddings entraram no MVP

A busca por palavra falha exatamente onde a fala transcrita é traiçoeira, e o teste mostrou os três casos:

- **Erro de transcrição.** "El Niño" virou "Ainho", "Elonim", "deinho" e "ninho". Nenhuma palavra casa, e nem os sinônimos da IA resolvem, porque ela escreve "El Niño" certo. O vetor achou assim mesmo, em 1º lugar.
- **Vocabulário diferente.** "Qual foi a pressão medida?" contra um trecho que só diz "então são 12 por 8": palavra em 10º, vetor em 1º.
- **Outro idioma.** "Quanto os fundadores levantaram no começo?" sobre um vídeo em inglês: palavra em 70º, vetor em 1º.

O Gemini Embedding 2 ganhou do OpenAI `text-embedding-3-small` (93% contra 84% de acerto em 1º lugar) e custa 10× mais (R$ 0,012 contra R$ 0,0012 por hora). Mesmo assim é barato perto dos R$ 0,23 a R$ 0,43 que a extração já custa por hora, então a qualidade vale o preço. Se um dia o custo incomodar, trocar de provedor é mudar uma função.

## 7. Alternativas consideradas

| Alternativa | Veredito |
|---|---|
| **pgvector no Supabase** (o RAG clássico) | Descartada. Exige conteúdo/vetores em claro no servidor e quebra a promessa de cifra. Custo também seria ~0; o problema é a privacidade. |
| **"Cartões" sem busca**: mandar título + resumo + capítulos de todas as conversas para o modelo escolher | Simples e ótima para "últimas 2 reuniões de sprint", mas o custo cresce com o acervo: 100 conversas ≈ 40 mil tokens ≈ R$ 0,04/pergunta, 1.000 conversas inviável. Reaproveitamos só a ideia leve: a lista de **títulos e datas** vai no Passo 2. |
| **Modelo de embeddings rodando no aparelho** (transformers.js) | Custo por token zero, mas download de ~100 MB e lento no celular. Não vale para poupar R$ 0,001/h. |
| **Só melhorar a busca de texto** (sem IA) | Não responde pergunta, só lista. Continua existindo como está. |

---

## 8. Riscos e limites

- **O teste foi num acervo pequeno** (87 trechos). Num acervo grande a ordenação piora, e o jeito de saber é repetir a medição quando houver conta com muitas conversas.
- **Indexar depende de um serviço de fora.** Sem rede, ou com a chave do Gemini fora do ar, a conversa nova fica sem vetor. ✅ Resolvido como planejado: a indexação tem duas fases (texto primeiro, de graça; vetores depois), a busca por palavra responde enquanto isso, e a tela diz "busca por palavra por enquanto". A fase dos vetores para na primeira falha em vez de gastar uma chamada perdida por conversa, e retoma de onde parou na próxima abertura.
- **Perguntas de agregação** ("quantas vezes falamos de X?", "resuma todas as aulas do semestre") não funcionam bem com "8 melhores trechos". Fora do MVP; a saída depois é um modo "resumo por período" que junta os resumos já prontos.
- **Escala do acervo no aparelho:** 50 KB de texto mais 90 KB de vetores por hora, então 100 h = 14 MB, 500 h = 70 MB. Bom no computador; no celular passar de ~300 h pede índice persistido no aparelho. A busca da barra lateral já tem essa característica hoje.
- **Sem chave no aparelho** (`SemChaveError`, sessão restaurada em aparelho novo): mesmo tratamento de hoje, "saia e entre de novo".
- **Alucinação:** só responde com os trechos, obriga citação, mostra o trecho ao clicar, e reaproveita o botão de reportar.
- **Citação com tempo:** ✅ resolvido. A timeline passou a aceitar `?t=segundos`,
  e conversa sem capítulos (legenda de vídeo sem marcação) mostra a transcrição
  em volta do minuto citado, em vez de dizer que não há intervalos.

---

## 9. Etapas e próximos passos

| Etapa | O que entrega | Tamanho |
|---|---|---|
| **0. Teste de recall** | ✅ **Feito** (20/09). Decidiu qual busca usar: embeddings do Gemini. Resultado abaixo. | pequeno |
| **1. MVP** | ✅ **No ar** (20/09). Índice no aparelho + `/embeddar` + `/entender-pergunta` + `/chat-acervo` + tela `/perguntar` + chips de fonte. | médio |
| **2. Acabamento** | filtros manuais (período, conversas), perguntas de agregação, resumo por período | pequeno |

### Etapa 0: o teste de recall (concluído em 20/09/2026)

**Acervo:** 5 conversas reais, 87 trechos, 2 h 20 min no total. As 3 do teste de qualidade (áudio de WhatsApp, consulta médica, teleconferência de 72 min) mais 2 da conta de teste (uma aula de fisiologia do exercício e um documentário sobre o Google, **em inglês**). **43 perguntas**, com o trecho certo marcado à mão em cada transcrição. Script e gabarito em `~/teste-recall/recall2.py`.

"@1" é o trecho certo em 1º lugar. A última coluna é a que decide: **o trecho certo estava entre os 8 que vão para a IA?**

| Método | @1 | @3 | @10 | Trecho certo entre os 8 |
|---|---|---|---|---|
| Busca por palavra (BM25) | 63% | 81% | 95% | 88% |
| \+ sinônimos da IA | 60% | 86% | 100% | 88% |
| Embeddings OpenAI 3-small | 84% | 98% | 100% | 100% |
| **Embeddings Gemini 2** | **93%** | **100%** | 100% | **100%** |
| Gemini + palavra + OpenAI juntos | 93% | 100% | 100% | 100% |

**Decisão: embeddings do Gemini no MVP, com a busca por palavra junto** (ela é de graça e a combinação teve a melhor ordenação média). Passou o critério de 90% com folga.

**O que a IA de "entender a pergunta" resolve, e os embeddings não:** conteúdo em outro idioma. Nas 10 perguntas em português sobre o vídeo em inglês, a busca por palavra sozinha acertou 40% em 1º lugar; com as palavras que o modelo devolveu **em inglês**, 80%. Ela também é quem vai resolver "últimas 2 reuniões", que vetor nenhum faz. Ela acertou a conversa certa em 42 de 43 perguntas.

**Custo do teste inteiro: US$ 0,02.**

**Limites honestos deste resultado:**

- 87 trechos ainda é pouco. Num acervo de mil conversas a concorrência é outra, e estes números tendem a cair.
- O gabarito das 20 perguntas novas fui eu que escrevi, lendo as transcrições. Escrever a pergunta olhando o trecho tende a favorecer quem busca por significado.
- As 5 perguntas "armadilha" (cujo assunto está no áudio mas a resposta não) continuam trazendo trechos plausíveis. Quem precisa dizer "não encontrei" é a IA que responde, e isso é um teste diferente, ainda por fazer.
- Uma marcação de gabarito ficou imprecisa (a pergunta sobre baixa intensidade cai bem na divisa entre dois trechos). Não muda a conclusão.

### A medição repetida, depois de construir (20/09/2026)

O mesmo teste, o mesmo gabarito de 43 perguntas, rodado de novo sobre o acervo
real quando o MVP ficou pronto. **O resultado se manteve.**

| Método | @1 (20/09, antes) | @1 (depois) | Trecho certo entre os 8 (antes → depois) |
|---|---|---|---|
| Busca por palavra (BM25) | 63% | 63% | 88% → 88% |
| \+ sinônimos da IA | 60% | 65% | 88% → 91% |
| Embeddings OpenAI 3-small | 84% | 84% | 100% → 100% |
| **Embeddings Gemini 2** | **93%** | **93%** | **100% → 100%** |

A IA que entende a pergunta apontou a conversa certa em 42 de 43, igual à
primeira vez, e no vídeo em inglês ela levou a busca por palavra de 40% para
90% de acerto em 1º lugar. Custo da rodada: **US$ 0,017**.

#### A correção da fusão

O plano dizia "embeddings do Gemini **com a busca por palavra junto**, porque a
combinação teve a melhor ordenação média". **Isso não se confirmou.** Medindo a
fusão com pesos de 1:1 a 1:5 entre palavra e vetor, sobre as mesmas 43
perguntas:

| Ordenação | Acerto em 1º | MRR | Trecho certo entre os 8 |
|---|---|---|---|
| **Só o vetor** | **93%** | **0,957** | **43/43** |
| Só a palavra | 65% | 0,766 | 39/43 |
| Fusão 1:1 | 86% | 0,919 | 43/43 |
| Fusão 1:3 | 91% | 0,944 | 42/43 |
| Fusão 1:5 | 93% | 0,955 | 42/43 |

O vetor sozinho ganha em tudo, e nenhum peso chega a superá-lo. No que mais
importa (o trecho certo estar entre os 8 que vão para a IA) a fusão 1:1 empata,
então a diferença prática é a ordem dentro dos 8, não o que a IA recebe. Mesmo
assim, ordenar melhor sai de graça: **o app usa o vetor sozinho quando todos os
trechos têm vetor**, e a busca por palavra continua ligada onde ela é de fato
necessária — no trecho que ainda não foi indexado.

---

## 10. O que foi construído

**No servidor** (três rotas, nenhuma guarda nada):

| Rota | O que faz |
|---|---|
| `/embeddar` | Trechos → vetores (Gemini Embedding 2, 768 dimensões). Os vetores voltam para o aparelho e é lá que ficam. |
| `/entender-pergunta` | Pergunta + títulos e datas (**nunca o conteúdo**) → palavras, sinônimos, conversas prováveis, "últimas N" e intervalo de datas. Os dois modelos caindo devolve plano vazio, e não erro: a busca por palavra ainda responde. |
| `/chat-acervo` | Pergunta + os ~8 trechos escolhidos → resposta citando `[C1]`. Gasta 1 do mesmo saldo mensal do chat de conversa. |

As três seguem o padrão do `/chat`: **Luna na frente, Claude de reserva**,
registro de fallback em `events` e o mesmo `guarda_de_uso`. O
`/ia/fallbacks` passou a dizer quem está ligado nos dois usos novos.

**No aparelho:**

- **Índice no IndexedDB**, cifrado com a mesma chave do usuário. Sair da conta
  apaga a chave e o índice junto; apagar uma conversa apaga os trechos dela na
  hora.
- **Indexador em duas fases**, disparado ao abrir a tela (quem nunca perguntar
  ao acervo não paga a indexação dele): o texto primeiro, de graça, e os
  vetores depois, em segundo plano. Reabrir a tela não reindexa nada — a
  impressão digital de cada conversa sai da lista que o app já tem em mãos, e
  renomear não conta como mudança, porque o título não vira vetor.
- **Tela `/perguntar`**, com botão fixo na barra lateral logo abaixo do "Novo",
  três exemplos clicáveis, chips de fonte que abrem a conversa no minuto, a
  linha "Procurei em N conversas e usei M trechos de K delas", o botão de
  sinalizar conteúdo da IA e a lista de perguntas anteriores.
- **Histórico sem SQL novo:** as perguntas ficam em `chats`/`chat_messages` com
  `session_id` nulo, cifradas. As fontes e a contagem da busca viajam num
  marcador no fim do próprio texto da resposta, porque não existe coluna para
  elas e criar uma exigiria uma migração — assim a pergunta reaberta amanhã
  continua com os chips clicáveis.

**Testado:**

- `backend/teste-fallback.py`: **77 → 126 casos**, todos com dublê, sem gastar
  API. Cobre as três rotas novas, os fallbacks, o saldo e os limites.
- `frontend/e2e-perguntar.mjs`: **20 verificações contra o app publicado**, da
  indexação (52 trechos, todos com vetor de 768 dimensões e cifrados) à
  resposta com fontes, ao chip que abre a conversa em `?t=286` e à pergunta
  reaberta. Saldo do mês caiu de 58 para 57 na pergunta, como devia.

**Um achado do caminho:** um `indexedDB.open` sem versão **cria** o banco
vazio. Se algo abrir "dito-acervo" assim antes do app, o app encontra o banco
já na versão dele e sem as prateleiras dentro, e toda transação falha em
silêncio — a busca simplesmente não acha nada. Foi o próprio teste de ponta a
ponta que provocou o estado; o app agora detecta e conserta reabrindo numa
versão acima.

### Feito até aqui

- **Saldo mensal de perguntas no ar** (commit `4290d7b`): 5 / 60 / ilimitado,
  valendo para o chat de qualquer conversa e agora também para o chat geral.
- **Etapa 0 concluída**, com a decisão pelos embeddings do Gemini.
- **Etapa 1 (MVP) no ar** (20/09/2026), com a medição repetida confirmando o
  resultado e corrigindo a decisão sobre a fusão.

### O que ficou para depois

- **Perguntas de agregação** ("quantas vezes falamos de X?", "resuma todas as
  aulas do semestre") continuam fora: elas não se resolvem com "8 melhores
  trechos".
- **Filtros manuais** de período e de conversa. Hoje quem filtra é a IA, a
  partir do texto da pergunta.
- **Teto de uso justo no Avançado** (sugerido ~500/mês). Segue sendo uma linha
  de código, porque ele já é contado.
- **Medir num acervo grande.** As 5 conversas e 87 trechos do teste continuam
  sendo pouco, e num acervo de mil conversas a concorrência é outra. O jeito de
  saber é repetir a medição quando houver conta com muitas conversas.
- **Testar a recusa.** As 5 perguntas "armadilha" continuam trazendo trechos
  plausíveis; quem precisa dizer "não encontrei" é a IA que responde, e isso é
  um teste diferente, ainda por fazer. (No teste de ponta a ponta ela disse
  exatamente isso quando o índice estava vazio, o que é um bom sinal, mas não é
  a medição.)

**Fontes dos preços:** [Gemini API](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), `.claude/skills/teste-qualidade/casos/slc-2t26/precos.json` (Luna e Gemini 3.8 Flash, conferidos em 18 e 19/09/2026).
