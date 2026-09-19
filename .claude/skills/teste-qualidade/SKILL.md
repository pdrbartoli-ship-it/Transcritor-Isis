---
name: teste-qualidade
description: Compara a qualidade da extração de insights (tópicos, tarefas, capítulos, locutores) e do chat do Dito entre diferentes modelos de IA — Claude, GPT, Gemini — usando o prompt e o schema reais de produção contra uma referência lida à mão. Use quando o usuário quiser testar/comparar modelos de IA para o Dito, decidir se dá pra trocar ou baratear o modelo sem perder qualidade, ou pedir "teste de qualidade" dos modelos.
---

Testa se um modelo de IA mais barato entrega a mesma qualidade que o Claude
Sonnet 5 (hoje, na extração completa) ou o Haiku 4.5 (hoje, no resumo simples
e no chat) — com o prompt, o schema e as funções de produção reais, não uma
aproximação. Já foi rodado uma vez, em 2026-09-18/19, contra uma teleconferência
de resultados; `casos/slc-2t26/` guarda a referência, as perguntas e os preços
daquele teste como exemplo preenchido (a transcrição em si não foi versionada —
rode `buscar` de novo se quiser reproduzir). Ver [[dito-troca-de-modelo]] na
memória para o resultado.

**Por que não dá pra confiar num teste aproximado:** um prompt "parecido" ou um
schema "resumido" muda o que sai, e aí a comparação não vale nada. Este teste
sempre importa `INSIGHTS_INSTRUCTIONS`, `INSIGHTS_SCHEMA`,
`format_timed_transcript`, `instrucoes_insights` e `call_insights` direto de
`backend/main.py` — o Claude é testado passando pela própria `call_insights` de
produção (mesmo `cache_control`, mesmo `output_config`); os outros fornecedores
recebem exatamente o mesmo texto de sistema e de usuário que o Claude recebeu.

## Antes de começar

1. **Confirme o escopo com o usuário**: quantos vídeos (o ideal é cobrir o mix
   real do Dito — um áudio curto tipo WhatsApp, uma reunião informal, um vídeo
   de YouTube longo, não só um tipo de conteúdo), quais modelos, e se o chat
   também entra no teste.
2. **Peça as chaves de API** dos fornecedores que faltam (ver `dito-troca-de-modelo`
   e a conversa em que isso foi pedido pela primeira vez para o texto exato de
   como orientar o usuário a criar uma chave curta, restrita e com teto de gasto):
   - **Anthropic** — testa `claude-sonnet-5` e `claude-haiku-4-5` direto, sem
     precisar mexer no plano da conta de teste (ver "Uma armadilha evitada" abaixo).
   - **OpenAI** — para candidatos `gpt-*`.
   - **Google AI Studio (Gemini)** — para candidatos `gemini-*`.
   Guarde as chaves em `casos/<slug>/keys.env` (formato `NOME=valor`, uma por
   linha) — **nunca** no `.env` do projeto, nunca commitado (o `.gitignore` da
   skill já cobre `casos/*/keys.env`).
3. **Confira o saldo da conta de teste.** `buscar` (abaixo) passa pela rota real
   `/process-url` do Dito, que desconta minutos do plano de verdade do usuário
   — ver [[e2e-test-harness]]. Antes de rodar vários vídeos, confira quanto
   sobra:
   ```python
   import sys; sys.path.insert(0, ".claude/skills/teste-qualidade/scripts")
   from sessao import login
   import httpx
   url, key, H = login()
   print(httpx.get(f"{url}/rest/v1/uso_mensal?select=minutos_usados,periodo_fim", headers={"apikey": key, **H}).json())
   print(httpx.get(f"{url}/rest/v1/subscriptions?select=plano", headers={"apikey": key, **H}).json())
   ```
   Se não sobrar minutos pros vídeos planejados, peça ao usuário para rodar o
   SQL que restaura `uso_mensal.minutos_usados` (ver
   [[dito-supabase-acesso]] para o padrão de "imprimir o SQL e pedir para
   colar"), ou topar gastar o saldo de verdade.

**Uma armadilha evitada:** numa sessão anterior eu pedi pro usuário mudar o
plano da conta de teste para Avançado, achando que precisava disso para testar
o Sonnet. Não precisa — `harness.rodar_claude` chama `call_insights` (a função
real) direto com a `ANTHROPIC_API_KEY`, então `claude-sonnet-5` e
`claude-haiku-4-5` são só mais dois "modelos" na lista de `extrair`, do mesmo
jeito que os `gpt-*` e `gemini-*`. O plano só importa se você quiser também
conferir a saída de `/process-url` em modo completo como checagem cruzada — ver
`buscar` abaixo.

## Passo 1 — buscar a transcrição de cada vídeo

```bash
cd /workspaces/Transcritor-Isis
python3 .claude/skills/teste-qualidade/scripts/harness.py buscar <slug> <url-do-youtube>
```

Isso cria `casos/<slug>/` com `url.txt` e `transcricao_backend.json` (a
transcrição real, com segmentos e tempo, do jeito que o Dito recebe). Use um
`slug` curto e descritivo (`reuniao-equipe`, `aula-financas`, `zap-cliente`).
Por padrão roda em `mode=simples` (mais barato — só gasta um Haiku pequeno
além dos minutos). Só use `mode=completa` como terceiro parâmetro se quiser
também a saída real do Sonnet em produção como conferência cruzada; isso exige
o plano Avançado na conta de teste.

## Passo 2 — escrever a referência (o passo que mais importa)

Copie `referencia.exemplo.py` para `casos/<slug>/referencia.py` e preencha
**lendo a transcrição inteira** (`transcricao_backend.json` → `transcript`, ou
assista ao vídeo se o áudio for difícil de seguir só em texto). São duas
listas:

- `GT_TURNOS`: quem fala, a cada troca de locutor — não a cada frase.
- `GT_SECOES`: qual assunto está em discussão a cada trecho, cobrindo o vídeo
  inteiro sem buraco, com palavras-chave (sem acento) que um capítulo certo
  citaria.

Isto é lento de propósito. Um erro aqui pontua **todos** os modelos errado do
mesmo jeito — é a única parte do teste que não tem como automatizar sem perder
a confiança no resultado. Depois de escrever, é comum encontrar um erro na
primeira versão (aconteceu no teste da SLC: um bloco de pergunta começava
antes do que eu tinha marcado) — se isso acontecer, corrija e re-rode `score.py`
em cima dos resultados já salvos, não precisa gastar API de novo.

Se o teste também vai cobrir o chat, copie `perguntas.exemplo.json` para
`casos/<slug>/perguntas.json` com 5-8 perguntas cuja resposta você já sabe pela
transcrição — inclua pelo menos uma pegadinha (algo que **não** foi dito) para
ver se o modelo inventa em vez de admitir que não sabe.

## Passo 3 — conferir e gravar os preços

Copie `precos.exemplo.json` para `casos/<slug>/precos.json`. **Confira o preço
de cada modelo candidato na página oficial do fornecedor no dia do teste**
(WebFetch nas páginas de pricing — preço muda com frequência e um agregador de
terceiros já mostrou número desatualizado ou por hora, e não por token). Guarde
US$ por milhão de tokens: `[entrada, saída, leitura_de_cache]`.

## Passo 4 — rodar a extração

```bash
python3 .claude/skills/teste-qualidade/scripts/harness.py extrair <slug> claude-sonnet-5 claude-haiku-4-5 gpt-5.4-mini gemini-3.8-flash
```

Roda todos os modelos passados em paralelo, cada um recebendo o texto
idêntico. Salva um JSON por modelo em `casos/<slug>/out/`. **Rode pelo menos
duas vezes** (chamando de novo com uma tag, ou salvando a saída antes de
rodar de novo) — no teste da SLC, um candidato foi de 94% pra 62% de acerto
de capítulo entre a 1ª e a 2ª rodada, e isso só apareceu rodando duas vezes.

Pra estressar o custo fixo do prompt (o cenário que mais preocupa no plano
Avançado: áudio curto no modo completo), rode também:

```bash
python3 .claude/skills/teste-qualidade/scripts/harness.py curto <slug> 30 claude-sonnet-5 gpt-5.4-mini
```

## Passo 5 — pontuar

```bash
python3 .claude/skills/teste-qualidade/scripts/score.py <slug> casos/<slug>/out/*.json
```

Dá a nota automática (capítulo certo, locutor certo, tempos fora do áudio).
**Não pare na nota automática** — abra os JSONs (`insights.summary_bullets`,
`.todos`, `.speakers`) e leia de verdade: a nota automática não pega tarefa
inventada, nome de empresa errado, ou uma resposta tecnicamente dentro do
capítulo certo mas rasa. O teste da SLC achou "SLC Seeds" no lugar de
"Sierentz" desse jeito, não pela nota.

## Passo 6 — chat (se estiver no escopo)

```bash
python3 .claude/skills/teste-qualidade/scripts/harness.py chat <slug> claude-haiku-4-5 gpt-5.6-luna gemini-3.8-flash
```

Faz as perguntas de `perguntas.json` em sequência (como uma conversa real) e
mostra o custo total e quantos tokens vieram de cache em cada pergunta.
**Atenção**: no teste da SLC, os modelos OpenAI cachearam a transcrição
sozinhos a partir da 2ª pergunta; o Gemini não cacheou nenhuma vez (não tem
cache automático — precisa de um objeto de cache explícito, que o harness não
cria). Se o Gemini estiver no escopo do chat, isso pesa contra ele: sem cache
explícito, ele cobra a transcrição inteira em toda pergunta.

## Passo 7 — montar o relatório

Publique como Artifact (ver `feedback_md_vira_artifact` e `artifact-design`),
seguindo o padrão que funcionou no teste da SLC
(https://claude.ai/artifact/EYck1hoMup5KmCNHymEdEw): veredito em 4-5 linhas no
topo, placar em tabela com barra de progresso por métrica, um cartão por
modelo com os erros reais encontrados na leitura manual (não só a nota),
gráfico de custo por hora, tabela do chat com a resposta certa ao lado de
quantos acertaram, e uma seção "como foi feito" com o material testado, os
preços conferidos e as limitações honestas (quantos vídeos, quantas rodadas).

## Depois do teste

- Se a conta de teste foi ao Avançado por causa do `mode=completa` no passo 1,
  lembre o usuário de voltar pro plano e restaurar `uso_mensal.minutos_usados`
  (imprima o SQL, ele roda).
- Apague as chaves de API dos fornecedores testados (não são mais necessárias
  depois do teste) e confirme que `casos/<slug>/keys.env` não foi commitado
  (`git status` — o `.gitignore` da skill já cobre isso, mas confira).
- Atualize [[dito-troca-de-modelo]] com o resultado novo, e a linha em
  `MEMORY.md`.
