# Teste de recall — "Perguntar ao acervo"

Mede se a busca acha o trecho que responde a uma pergunta, antes de construir a
feature. Foi o que decidiu, em 20/09/2026, usar embeddings do Gemini em vez de
só busca por palavra (ver `plano-busca-geral.md` na raiz do projeto).

- `recall.py` — o piso: BM25 sozinho sobre as 3 conversas de `casos/`. Não gasta API.
- `recall2.py` — o teste que decide: soma as 2 conversas da conta de teste, a IA
  que "entende a pergunta" (Luna) e os embeddings dos dois fornecedores.

**O que mora fora do repositório** (nunca versionar):

- `~/teste-recall/acervo.json` — o acervo da conta de teste, decifrado. Sai do
  app pelo navegador; o script está em `frontend/e2e-extrair-acervo.mjs`.
- `~/teste-recall/keys.env` — `OPEN_AI_KEY` e `GEMINI_API_KEY`, de chaves
  temporárias com teto de gasto, revogadas ao fim do teste.
- `~/teste-recall/cache/` — respostas das APIs, para repetir sem pagar de novo.

O gabarito (os intervalos de tempo onde está a resposta) foi lido à mão em cada
transcrição e mora dentro dos próprios scripts.
