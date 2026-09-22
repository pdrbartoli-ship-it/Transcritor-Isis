---
name: teste-qualidade
description: Decide qual modelo de IA o Dito deve usar em cada um dos seus três usos — transcrição simples (resumo curto), transcrição avançada (extração completa de tópicos, tarefas, capítulos e locutores) e resposta às perguntas (chat) — comparando Claude, GPT e Gemini com o prompt, o schema e as funções reais de produção contra uma referência lida à mão, e entrega um relatório que termina respondendo "qual modelo usar em cada um". O material testado pode ser qualquer coisa que o Dito aceita: link de vídeo, gravação ou arquivo de áudio. Use quando o usuário quiser testar/comparar modelos de IA para o Dito, decidir se dá pra trocar ou baratear o modelo sem perder qualidade, ou pedir "teste de qualidade" dos modelos.
---

O teste existe pra responder três perguntas — é isso que o usuário quer saber, e
o relatório **termina** respondendo cada uma (Passo 7):

| Uso no app | Constante em `backend/main.py` | Modelo em 2026-09-19 |
|---|---|---|
| **Transcrição simples** (título + resumo em tópicos) | `SUMMARY_MODEL` → `simple_summary` | `claude-haiku-4-5` |
| **Transcrição avançada** (modo completo: tópicos, tarefas, capítulos, locutores) | `INSIGHTS_MODEL` → `extract_insights` | `claude-sonnet-5` |
| **Resposta às perguntas** (chat sobre a conversa) | `CHAT_MODEL` → rota `/chat` | `claude-haiku-4-5` |

Confira as constantes no dia do teste — se alguma mudou, o "hoje" do relatório
muda junto.

Tudo é testado com o prompt, o schema e as funções de produção reais, não uma
aproximação. Já rodou duas vezes: em 2026-09-18/19 só com os baratos numa
teleconferência, e em 2026-09-19 com 6 modelos × 3 materiais (áudio de
WhatsApp, consulta médica, teleconferência) nos três usos — `casos/` guarda
referências, perguntas e preços desses testes como exemplo preenchido (as
transcrições e saídas não são versionadas — rode `buscar` de novo pra
reproduzir). Ver [[dito-troca-de-modelo]] na memória para o resultado.

**Por que não dá pra confiar num teste aproximado:** um prompt "parecido" ou um
schema "resumido" muda o que sai, e aí a comparação não vale nada. O harness
importa de `backend/main.py` as instruções, os schemas, `format_timed_transcript`,
`instrucoes_insights`, `instrucoes_resumo_simples` e `call_insights` — o Claude é
testado passando pela própria `call_insights` de produção (mesmo `cache_control`,
mesmo `output_config`, mesmo `effort`); os outros fornecedores recebem exatamente
o mesmo texto de sistema e de usuário que o Claude recebeu.

## Antes de começar

1. **Confirme o escopo com o usuário**: quantos materiais e de que tipo (o
   ideal é cobrir o mix real do Dito — um áudio curto tipo WhatsApp, uma
   gravação de conversa ou reunião, um vídeo longo, não só um tipo de
   conteúdo) e quais modelos. **Os três usos entram sempre** — sem um deles o
   relatório não responde a pergunta. Conjunto padrão de modelos: `claude-sonnet-5`,
   `claude-haiku-4-5`, `gpt-5.4-mini`, `gpt-5.6-luna`, `gemini-3.8-flash`,
   `gemini-3.5-flash-lite` (troque por versões mais novas se houver).
2. **Peça as chaves de API** dos três fornecedores — pedindo pra criar uma chave
   só pro teste, com teto de gasto (US$5 sobra: o teste de 6 modelos × 3
   materiais nos três usos custou ~US$1,40):
   - **Anthropic** — testa `claude-sonnet-5` e `claude-haiku-4-5` direto, sem
     precisar mexer no plano da conta de teste (ver "Uma armadilha evitada" abaixo).
   - **OpenAI** — para candidatos `gpt-*`.
   - **Google AI Studio (Gemini)** — para candidatos `gemini-*`.
   Peça pro usuário **não colar a chave no chat** e sim criar
   `casos/<slug>/keys.env` (formato `NOME=valor`, uma por linha) — você copia
   pros outros casos. **Nunca** no `.env` do projeto, nunca commitado (o
   `.gitignore` da skill cobre `casos/*/keys.env`). Se ele colar no chat
   mesmo assim, use e lembre de revogar no fim. Confira que as três funcionam
   listando os modelos de cada fornecedor (chamada grátis) antes de gastar.
3. **Confira o saldo da conta de teste.** `buscar` (abaixo) passa pela rota real
   `/process-url` ou `/transcribe` do Dito (a mesma que o app usa), que desconta
   minutos do plano de verdade do usuário
   — ver [[e2e-test-harness]]. Antes de rodar vários materiais, confira quanto
   sobra:
   ```python
   import sys; sys.path.insert(0, ".claude/skills/teste-qualidade/scripts")
   from sessao import login, user_id
   import httpx
   url, key, H = login()
   print(httpx.get(f"{url}/rest/v1/uso_mensal?select=minutos_usados,periodo_fim", headers={"apikey": key, **H}).json())
   print(httpx.get(f"{url}/rest/v1/subscriptions?select=plano", headers={"apikey": key, **H}).json())
   ```
   Se não sobrar minutos pros materiais planejados, imprima o SQL pro usuário
   colar no Supabase (ver [[dito-supabase-acesso]]). O jeito que não precisa
   de desfazer depois: baixar `minutos_usados` exatamente o que o teste vai
   gastar — o teste consome e a conta termina onde estava:
   ```sql
   update public.uso_mensal set minutos_usados = <atual - minutos_do_teste>
   where user_id = '<user_id()>';
   ```

**Uma armadilha evitada:** numa sessão anterior eu pedi pro usuário mudar o
plano da conta de teste para Avançado, achando que precisava disso para testar
o Sonnet. Não precisa — `harness.rodar_claude` chama `call_insights` (a função
real) direto com a `ANTHROPIC_API_KEY`, então `claude-sonnet-5` e
`claude-haiku-4-5` são só mais dois "modelos" na lista, do mesmo jeito que os
`gpt-*` e `gemini-*`.

## Passo 1 — buscar a transcrição de cada material

```bash
cd /workspaces/Transcritor-Isis
# um link (YouTube e outros — mesma rota de "colar um link" no app):
python3 .claude/skills/teste-qualidade/scripts/harness.py buscar <slug> <url>
# um arquivo local de áudio/vídeo (gravação, WhatsApp, o que for — mesma rota
# de gravar ou enviar um arquivo no app):
python3 .claude/skills/teste-qualidade/scripts/harness.py buscar <slug> <caminho/do/arquivo.m4a>
```

`buscar` detecta sozinho se a origem é um link (`http...`) ou um caminho de
arquivo, e chama a rota certa do backend (`/process-url` ou `/transcribe`).
Isso cria `casos/<slug>/` com `origem.txt` e `transcricao_backend.json` (a
transcrição real, com segmentos e tempo, do jeito que o Dito recebe). Use um
`slug` curto e descritivo (`reuniao-equipe`, `aula-financas`, `zap-cliente`).
Roda em `mode=simples`, então o JSON já traz de brinde o **resumo simples real
de produção** (`title`, `summary`) — leia ele junto com os do Passo 4: é o que
o usuário do app está recebendo hoje. (O `mode=completa` só funciona com a conta
no Avançado e não é necessário.)

## Passo 2 — escrever a referência (o passo que mais importa)

Copie `referencia.exemplo.py` para `casos/<slug>/referencia.py` e preencha
**lendo a transcrição inteira** (`transcricao_backend.json` → `segments`, com os
tempos). São duas listas:

- `GT_TURNOS`: quem fala, a cada troca de locutor — não a cada frase.
- `GT_SECOES`: qual assunto está em discussão a cada trecho, cobrindo o material
  inteiro sem buraco, com palavras-chave (sem acento) que um capítulo certo
  citaria.

Isto é lento de propósito. Um erro aqui pontua **todos** os modelos errado do
mesmo jeito — é a única parte do teste que não tem como automatizar sem perder
a confiança no resultado. Depois de escrever, é comum encontrar um erro na
primeira versão — se isso acontecer, corrija e re-rode `score.py` em cima dos
resultados já salvos, não precisa gastar API de novo. Dois que já aconteceram:

- **Bloco de pergunta começa quando o moderador anuncia o analista**, não quando
  o analista começa a falar (teste da SLC).
- **Pessoa sem nome vira "Locutor N", e o N depende de quem o modelo acha que
  falou primeiro.** Na consulta médica o médico não diz o nome: uns modelos o
  chamaram de "Locutor 1", outros de "Locutor 2". Se as outras pessoas são
  sempre nomeadas, ponha `"locutor"` (sem número) nos `APELIDOS` de quem não tem
  nome. Numa gravação de uma voz só, aceite só `"locutor 1"` — um "Locutor 2" ali
  é locutor inventado e tem que pontuar errado.

Copie `perguntas.exemplo.json` para `casos/<slug>/perguntas.json` com 6-8
perguntas cuja resposta você já sabe pela transcrição. Inclua:
- **duas pegadinhas** (algo que **não** foi dito) para ver se o modelo inventa;
- **uma pergunta sobre um nome próprio mal transcrito** (remédio, empresa,
  pessoa), se o material tiver um. Foi assim que o teste de 2026-09-19 achou o
  padrão mais perigoso: a paciente disse "buzocor" e os dois Claude "corrigiram"
  pra remédios reais e diferentes (Buscopan, Puran/levotiroxina, "buscapina
  para ansiedade") — em conteúdo de saúde isso é o erro que importa.

## Passo 3 — conferir e gravar os preços

Copie `precos.exemplo.json` para `casos/<slug>/precos.json`. **Confira o preço
de cada modelo candidato na página oficial do fornecedor no dia do teste**
(WebFetch nas páginas de pricing — preço muda com frequência e um agregador de
terceiros já mostrou número desatualizado ou por hora, e não por token). Guarde
US$ por milhão de tokens: `[entrada, saída, leitura_de_cache]`. Anote também
preço promocional com data de fim (o Gemini 3.8 Flash dobra em 2027-01-01) — o
relatório precisa mostrar o custo depois da promoção.

## Passo 4 — rodar os três usos

Sempre **duas rodadas** (`--tag=__r1` e `--tag=__r2`) — no teste da SLC um
candidato foi de 94% pra 62% de acerto de capítulo entre a 1ª e a 2ª rodada, e
isso só apareceu rodando duas vezes. Rode a 2ª depois que a 1ª terminar (em
paralelo, o cache de uma contamina o custo da outra).

```bash
H=.claude/skills/teste-qualidade/scripts/harness.py
M="claude-sonnet-5 claude-haiku-4-5 gpt-5.4-mini gpt-5.6-luna gemini-3.8-flash gemini-3.5-flash-lite"
for s in <slug1> <slug2> <slug3>; do
  python3 $H extrair $s $M --tag=__r1   # transcrição avançada
  python3 $H simples $s $M --tag=__r1   # transcrição simples
done
# ...e de novo com --tag=__r2
for s in <slug1> <slug2> <slug3>; do python3 $H chat $s $M; done   # perguntas (uma rodada basta)
python3 $H curto <slug-do-audio-curto> 30 $M                        # pior caso de custo do Avançado
```

- `extrair` — extração completa, com o texto marcado com `[mm:ss]`.
- `simples` — o resumo curto do modo simples: mesmas instruções, schema e teto
  de tokens de `simple_summary`, sobre a transcrição corrida (sem tempos).
- `chat` — as perguntas de `perguntas.json` em sequência, como uma conversa
  real, com o mesmo prompt de sistema da rota `/chat`. Mostra quantos tokens
  vieram de cache em cada pergunta: os modelos OpenAI cacheiam sozinhos a partir
  da 2ª pergunta; o Gemini não cacheia (precisaria de cache explícito, que o
  harness não cria), então cobra a transcrição inteira em toda pergunta — isso
  pesa contra ele no chat de conteúdo longo; o Haiku só cacheia conversa longa.
- `curto` — os primeiros N segundos, pra medir o custo fixo do prompt (o
  cenário que mais preocupa no Avançado: 800 min em áudios curtos no modo
  completo contra R$40 de receita).

## Passo 5 — pontuar e ler

```bash
python3 .claude/skills/teste-qualidade/scripts/score.py <slug> casos/<slug>/out/*.json
```

Dá a nota automática da transcrição avançada (capítulo certo, locutor certo,
tempos fora do áudio) — ignora sozinho os arquivos de `simples`, `chat` e `curto`.
Nos materiais curtos a nota de capítulo tem poucos pontos (5 num áudio de 5 min),
então um capítulo fora do lugar derruba 20 pontos — diga isso no relatório.

**Não pare na nota automática.** A transcrição simples e o chat não têm nota
automática, e mesmo na avançada a nota não pega o que mais importa. Leia todas
as saídas de verdade (`insights.summary_bullets`, `.todos`, `.speakers`,
`.chapters`; `resumo.summary`; as respostas do chat) e confira contra a
transcrição (`grep` no `transcript`) cada número, nome e fato que parecer
suspeito. O que procurar — tudo já aconteceu:
- **número inventado** quando a transcrição perdeu o número (a dívida da SLC
  saiu "R, bilhões" e o Haiku escreveu R$3, R$6,8 e R$9 bi em rodadas diferentes);
- **nome próprio "corrigido"** pra outro nome real (remédio, empresa: "SLC Seeds"
  no lugar de Sierentz);
- **pessoa trocada** (mãe virou "pai"; a fala da mãe atribuída ao filho) e
  **locutor inventado** numa gravação de uma voz só;
- **capítulo que começa depois do fim da gravação** (a produção não descarta);
- **nomes que o modelo identificou mas não usou** nas trocas de voz ("Locutor 3"
  em vez de "Ivo Bruno" — o app mostra o texto do turno como está);
- formato do resumo simples: bullets com "- ", 3 a 6, sem cabeçalho, com acento.

## Passo 6 — calcular os custos

Pra cada uso e cada material, custo por captura e por hora de áudio, em reais,
**sem desconto de cache** (a 2ª rodada reaproveita cache do mesmo texto, o que
não acontece em produção): `entrada × preço_entrada + saída × preço_saída`, média
das duas rodadas, câmbio do dia (o teste de 2026-09-19 usou R$5,14). Mostre
também o custo com o preço pós-promoção. Custo do chat: soma da conversa
inteira, **com** o cache que cada modelo fez sozinho (é o que acontece em
produção). Some quanto o teste gastou em API por fornecedor.

## Passo 7 — montar o relatório

Publique como Artifact (ver `feedback_md_vira_artifact` e `artifact-design`),
seguindo o padrão de https://claude.ai/artifact/UPagWHPmeLJF86X8uEvbou:

1. **Veredito** em 4-5 linhas no topo — já dizendo o modelo recomendado pra cada
   um dos três usos.
2. **Placar** da transcrição avançada: tabela com barra por métrica (capítulo
   certo, quem fala certo, média das rodadas), chat X/N, R$ por hora, e a tabela
   por material com 1ª · 2ª rodada.
3. **Um cartão por modelo** com os erros reais achados na leitura (não só a nota).
4. **Transcrição simples**: o que cada modelo acertou/inventou (incluindo o
   resumo real de produção do Passo 1) e o custo por captura.
5. **Custo**: gráfico de R$ por hora, tabela por captura nos materiais, e o pior
   caso do Avançado (`curto`).
6. **Chat**: tabela com cada pergunta, a resposta certa e quantos acertaram
   (pegadinhas marcadas), mais o custo da conversa e o cache de cada modelo.
7. **Achados de produção** fora da troca de modelo (bugs vistos no caminho).
8. **Como foi feito**: materiais, rodadas, preços conferidos, limitações honestas.
9. **Termine com "Qual modelo usar"** — a seção que responde o que o usuário
   quer saber. Três blocos, um por uso (transcrição simples, transcrição
   avançada, resposta às perguntas), cada um com:
   - o **modelo recomendado** e o **de hoje** (das constantes do `main.py`);
   - **por quê**, em números deste teste: qualidade (acertos, erros graves) e
     custo (R$ por captura/hora hoje e depois de promoção);
   - **particularidades** — quando a recomendação muda (tipo de conteúdo, preço
     que vence, cache, fornecedor novo a integrar);
   - **o que muda no código** pra adotar (trocar a constante, ou uma integração
     nova com outro fornecedor).
   Prefira a opção que dá menos trabalho quando a diferença de qualidade e custo
   for pequena (um fornecedor novo servindo dois usos pesa a favor dele).

## Depois do teste

- Se o saldo da conta de teste foi mexido, confira que terminou onde estava.
- Apague os `casos/*/keys.env` e peça ao usuário para **revogar as chaves** nos
  sites dos fornecedores (principalmente se apareceram no chat).
- Confira com `git status` que nada sensível vai ser commitado: o `.gitignore` da
  skill cobre `keys.env`, `out/` e `transcricao_backend.json` — transcrição e
  referência podem ter dado pessoal ou de saúde (a consulta médica tinha).
- Atualize [[dito-troca-de-modelo]] com o resultado novo, e a linha em
  `MEMORY.md`.
