# Dito — Perguntar a todo o acervo (busca geral com IA)

**Data:** 19/09/2026 · **Pergunta que a feature responde:** "o que foi dito nas últimas 2 reuniões de sprint sobre a UX do produto ABC?" / "o que a professora explicou sobre nematoide?"

---

## 1. Resposta curta

**Dá, e custa quase nada.** Uma pergunta ao acervo inteiro custa **cerca de R$ 0,02** (pior caso R$ 0,03). Não precisa de servidor novo, de banco de vetores nem de plano pago de nenhum serviço.

**RAG é o caminho certo, mas com uma adaptação obrigatória:** a busca tem de acontecer **no aparelho do usuário**, não no servidor. O motivo é que o Dito cifra as conversas no navegador (é o diferencial da landing: "cifradas antes de sair do seu aparelho"). O servidor só guarda ruído. O RAG de manual (guardar vetores no Postgres com pgvector e buscar lá) exigiria texto ou vetores em claro no servidor e quebraria essa promessa.

**Recomendação (a mais simples que funciona):**

1. **Fase 1 (MVP):** busca por palavra no aparelho + uma chamada barata de IA que "entende a pergunta" (sinônimos, datas, "últimas 2") + uma chamada que responde só com os trechos achados, com fontes clicáveis. Custo de indexação: **R$ 0**.
2. **Fase 2 (só se o teste mostrar que a Fase 1 erra demais):** somar **embeddings** (busca por significado). Custo: **R$ 0,001 a R$ 0,012 por hora de conversa**, uma vez.

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

- **Entrada 1, sempre visível:** botão fixo no topo da barra lateral, logo abaixo de "Nova conversa" (`components/Layout.jsx`).
- **Entrada 2:** na busca da barra lateral, quando o texto digitado parece uma pergunta, o primeiro resultado vira "Perguntar ao acervo: '...'".
- **Tela vazia:** três exemplos clicáveis ("O que ficou decidido nas últimas reuniões?", "O que a aula X explicou sobre Y?", "Quais tarefas ficaram pendentes esta semana?").
- **Resposta:** texto curto e direto, com **fontes em chips clicáveis** ("Sprint 14 · 12 set · 14:32"). Clicar abre a conversa no minuto exato.
- **Transparência:** uma linha discreta abaixo da resposta: "Procurei em 47 conversas e usei 6 trechos de 3 delas". Quando não achar, diz que não achou (nada de inventar).
- **Reaproveita** o botão "Reportar conteúdo da IA" que já existe nas telas de conversa.
- **Histórico:** as perguntas ao acervo ficam salvas, cifradas, na tabela `chats` que já existe. A coluna `session_id` já aceita vazio, então **não precisa de SQL** para isso. Vale uma lista simples de perguntas anteriores dentro da própria tela.
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

### Passo 1: indexar (no aparelho, grátis)

- Cada conversa é quebrada em **trechos de ~1,5 minuto de fala (300 a 400 tokens)**, usando os `segments` com tempo que já existem. Cada trecho guarda conversa, início e fim, e por isso a citação sabe o minuto.
- Além disso, **cada capítulo, tópico e tarefa** dos `insights` vira um trecho extra. São resumos prontos e acertam bem perguntas do tipo "o que foi decidido sobre...".
- O título e a data entram como campos do trecho (achar "sprint" no título ajuda).
- Índice de palavras (BM25, biblioteca de ~10 KB) **na memória**, refeito ao abrir o acervo. Para 100 horas (~3.000 trechos) leva milissegundos.
- Conversas antigas sem tempo (legenda de YouTube sem marcação): quebram por parágrafo, sem minuto na citação.

### Passo 2: entender a pergunta (1 chamada barata)

O modelo recebe a pergunta, o histórico e **só a lista de títulos e datas** das conversas (~25 tokens cada; nunca o conteúdo). Devolve um JSON curto:

- **palavras e sinônimos**: "UX" vira "experiência do usuário, usabilidade, interface, design";
- **filtro de tempo**: "últimas 2" vira recência = 2; "mês passado" vira um intervalo de datas;
- **conversas candidatas** por título ("reuniões de sprint" aponta as que têm sprint no nome);
- **pergunta reescrita** sem depender do histórico ("e o que ele disse sobre prazo?" vira uma pergunta completa).

É isso que compensa a falta de embeddings na Fase 1: o modelo faz o trabalho de "achar palavras parecidas".

### Passo 3: buscar (no aparelho, grátis)

1. Ranking dos trechos por BM25 com as palavras expandidas.
2. Agrupa por conversa; a nota da conversa é a do melhor trecho.
3. Aplica o filtro de tempo/recência ("as 2 mais recentes entre as relevantes").
4. Pega **~8 trechos, no máximo 3 por conversa** (para não responder só com uma reunião).

### Passo 4: responder (servidor, endpoint novo `/chat-acervo`)

Mesmo padrão do `/chat`: **Luna primeiro, Claude de reserva**, mesma autenticação e mesmo registro de fallback. Recebe só os trechos escolhidos, rotulados `[C1 · Sprint 14 · 12/09 · 14:32]`, e a regra é: responder **só** com o que está nos trechos, citar `[C1]`, e dizer "não encontrei" se não estiver lá. O app troca `[C1]` por chip clicável.

### Passo 5: mostrar e salvar

Resposta salva cifrada em `chats` / `chat_messages` (sem `session_id`), como qualquer chat.

### Privacidade: o que sai do aparelho

| | Sai do aparelho | Fica no servidor |
|---|---|---|
| Passo 2 | pergunta + títulos/datas | nada |
| Passo 4 | pergunta + ~8 trechos | nada |
| Vetores (Fase 2) | trechos, só para virar vetor | nada; vetores ficam no aparelho |

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

| | Fase 1 | Fase 2 (embeddings) |
|---|---|---|
| Indexar 1 hora | **R$ 0** | R$ 0,0012 (OpenAI 3-small) ou R$ 0,012 (Gemini Embedding 2) |
| Acervo de 100 h, uma vez | R$ 0 | R$ 0,12 ou R$ 1,23 |
| Comparação | | a extração já custa R$ 0,23 a R$ 0,43 por hora: soma de 0,3% a 5% |
| Servidor / banco novo | R$ 0 | R$ 0 (vetores ficam no aparelho) |
| Espaço no banco | só as mensagens do chat | nada no banco |

Sobre o plano gratuito do Gemini Embedding 2: existe, mas **não contar com ele**. Além dos limites de uso, o nível gratuito costuma permitir que o provedor use o conteúdo para melhorar produtos, o que não combina com a promessa de privacidade (conferir os termos antes de qualquer decisão).

**Conclusão de custo: dá.** O custo real da feature é dominado por perguntas (centavos), não por indexação nem por infraestrutura.

---

## 6. Fase 2: embeddings, se for preciso

Busca por palavra + sinônimos da IA resolve a maioria, mas pode falhar em transcrição falada (erros de reconhecimento, "buzocor" em vez de Buscopan) e em perguntas muito abstratas. Se falhar:

- Cada trecho vira um vetor (768 dimensões; o Gemini Embedding 2 permite reduzir sem perder muito). Um `/embeddar` no backend recebe trechos e **devolve os vetores sem guardar nada**.
- Vetores ficam **no aparelho** (IndexedDB): ~90 KB por hora de conversa, ~9 MB para 100 horas. Cada aparelho indexa o seu, por R$ 0,001/h, e isso evita mexer no banco.
- Busca **híbrida**: BM25 + similaridade de cosseno, fundidos por RRF. Comparar de 3 mil trechos leva milissegundos, sem índice especial.
- Testar no teste de recall os dois provedores (OpenAI 3-small e Gemini Embedding 2) em português falado; escolher pelo resultado.

---

## 7. Alternativas consideradas

| Alternativa | Veredito |
|---|---|
| **pgvector no Supabase** (o RAG clássico) | Descartada. Exige conteúdo/vetores em claro no servidor e quebra a promessa de cifra. Custo também seria ~0; o problema é a privacidade. |
| **"Cartões" sem busca**: mandar título + resumo + capítulos de todas as conversas para o modelo escolher | Simples e ótima para "últimas 2 reuniões de sprint", mas o custo cresce com o acervo: 100 conversas ≈ 40 mil tokens ≈ R$ 0,04/pergunta, 1.000 conversas inviável. Reaproveitamos só a ideia leve: a lista de **títulos e datas** vai no Passo 2. |
| **Modelo de embeddings rodando no aparelho** (transformers.js) | Custo por token zero, mas download de ~100 MB e lento no celular. Não vale para poupar R$ 0,001/h. |
| **Só melhorar a busca de texto** (sem IA) | Não responde pergunta, só lista. Continua existindo como está. |

---

## 8. Riscos e limites

- **Recall da busca por palavra** em fala transcrita. Mitigação: sinônimos do Passo 2 e o teste de recall antes de decidir pela Fase 2.
- **Perguntas de agregação** ("quantas vezes falamos de X?", "resuma todas as aulas do semestre") não funcionam bem com "8 melhores trechos". Fora do MVP; a saída depois é um modo "resumo por período" que junta os resumos já prontos.
- **Escala do acervo no aparelho:** 50 KB por hora, então 100 h = 5 MB, 500 h = 25 MB. Bom no computador; no celular passar de ~300 h pede índice persistido no aparelho. A busca da barra lateral já tem essa característica hoje.
- **Sem chave no aparelho** (`SemChaveError`, sessão restaurada em aparelho novo): mesmo tratamento de hoje, "saia e entre de novo".
- **Alucinação:** só responde com os trechos, obriga citação, mostra o trecho ao clicar, e reaproveita o botão de reportar.
- **Citação com tempo:** a timeline hoje não aceita minuto na URL (a confirmar); é uma adaptação pequena.

---

## 9. Etapas e próximos passos

| Etapa | O que entrega | Tamanho |
|---|---|---|
| **0. Teste de recall** | Mede se o trecho certo aparece entre os 10 primeiros. **Regra: ≥ 90% segue na Fase 1; abaixo disso, entra a Fase 2.** A parte da busca por palavra é local e grátis; a parte que testa a IA de "entender a pergunta" e os embeddings precisa de uma chave de API (centavos). **Parte 1 feita, resultado abaixo.** | pequeno |
| **1. MVP** | índice + entender a pergunta + `/chat-acervo` + tela `/perguntar` + chips de fonte + cota mensal | médio |
| **2. Embeddings** | só se a Etapa 0 mandar | pequeno |
| **3. Acabamento** | filtros manuais (período, conversas), histórico, resumo por período | pequeno |

### Etapa 0, parte 1: busca por palavra sozinha (19/09/2026)

Acervo: as 3 conversas reais do teste de qualidade (áudio de WhatsApp, consulta médica, teleconferência de 72 min), 52 trechos, 23 perguntas com o trecho certo marcado à mão. Sem a IA de sinônimos (é o cenário pessimista). Script e gabarito em `~/teste-recall/recall.py`.

| Métrica (busca por palavra, sem IA) | Resultado |
|---|---|
| Trecho certo em 1º lugar | 17 de 23 (74%) |
| Entre os 3 primeiros | 20 de 23 (87%) |
| Entre os 10 primeiros | 22 de 23 (96%) |
| Conversa certa em 1º | 20 de 23 |

**Não dá para dizer que passou o critério de 90%:** com só 52 trechos, "os 10 primeiros" já cobre 19% do acervo. O número que importa é o dos 3 a 5 primeiros (87%), e o acervo real terá milhares de trechos. O teste mostra, por outro lado, **onde a busca por palavra falha**, e é o que o plano previa:

- **Erros de transcrição:** "El Niño" saiu como "Ainho", "Elonim", "deinho" e "ninho" (quatro grafias); a pergunta sobre El Niño só achou o trecho em 4º. "Receita líquida" saiu como "receita lita".
- **Vocabulário diferente:** "qual foi a pressão medida?" não acha o trecho que diz só "então são 12 por 8" (a única falha nos 10 primeiros).
- Funciona bem com nomes, números e termos raros ("gambate", "hipoglicemia reativa", "projeto piloto", "nitrogênio").

**Conclusão parcial: inconclusiva, mas encorajadora.** Falta a parte 2, que decide de verdade: rodar a IA de "entender a pergunta" e os embeddings (OpenAI 3-small e Gemini Embedding 2) sobre um acervo maior, com o acervo real da conta de teste. Isso pede uma chave de API temporária com teto de gasto (o teste inteiro deve custar cerca de R$ 1). Correção a algo que escrevi antes: "sem gastar API" só vale para a parte 1.

**O que falta de você:**

1. **Rodar o SQL** `supabase/perguntas_mes.sql` (o resultado esperado da conferência é `1 | 3 | false | false | true`). Depois disso eu troco o backend e a tela para o saldo mensal.
2. **Chaves de API temporárias com teto** (OpenAI e Gemini), para a parte 2 da Etapa 0.
3. **Autorização para ler o acervo da conta de teste** no navegador (decifrado só na máquina de desenvolvimento, fora do repositório, e apagado ao final) para montar as perguntas reais.

**Fontes dos preços:** [Gemini API](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), `.claude/skills/teste-qualidade/casos/slc-2t26/precos.json` (Luna e Gemini 3.8 Flash, conferidos em 18 e 19/09/2026).
