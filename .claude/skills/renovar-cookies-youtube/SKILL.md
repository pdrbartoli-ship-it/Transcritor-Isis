---
name: renovar-cookies-youtube
description: Protocolo para quando os cookies do YouTube do Dito expiram e links do YouTube param de funcionar. Guia o usuário a exportar cookies novos (do jeito que duram mais), trocar a variável YOUTUBE_COOKIES no Render e confirma em produção que voltou a funcionar. Use quando aparecer "The provided YouTube account cookies are no longer valid", "Sign in to confirm you're not a bot", "Não foi possível baixar o vídeo" em link do YouTube, ou quando o usuário disser que os cookies expiraram.
---

Protocolo de renovação dos cookies do YouTube do Dito.

O usuário **não é técnico**. Fale em português claro, um passo por vez, e diga exatamente onde clicar.

## Por que isso acontece

Link do YouTube passa por uma cascata em `build_url_result` ([backend/main.py](../../../backend/main.py)):

1. **Supadata** (`SUPADATA_API_KEY`) — pega a legenda pronta. Resolve a maioria dos vídeos.
2. **yt-dlp com cookies** (`YOUTUBE_COOKIES`) — só entra quando o Supadata não devolve nada (vídeo sem legenda, ou Supadata fora do ar / sem crédito). Baixa o áudio logado numa conta Google, porque o YouTube bloqueia download anônimo vindo de servidor.

O Google troca ("rotaciona") os cookies de uma sessão que continua aberta no navegador. Se os cookies foram exportados de uma janela que o usuário continuou usando, eles morrem em dias. Por isso o jeito de exportar importa.

## Passo 0 — Confirmar o diagnóstico

A mensagem precisa falar de cookies (`cookies are no longer valid`, `Sign in to confirm`). Se for outra coisa (`Tempo esgotado`, `Video unavailable`, vídeo privado), não é este protocolo.

Vale lembrar o usuário: se **vários** vídeos com legenda também estão caindo no erro, o Supadata pode estar sem crédito — conferir o painel em supadata.ai além de trocar os cookies.

## Passo 1 — Exportar cookies novos (usuário faz, no computador dele)

Não dá para fazer daqui: exige o navegador e a conta Google do usuário. Passe estas instruções:

1. **Use uma conta Google secundária**, não a pessoal. O YouTube pode bloquear a conta usada por robôs.
2. Instale a extensão **"Get cookies.txt LOCALLY"** (Chrome) ou **"cookies.txt"** (Firefox). Atenção: a extensão antiga chamada só "Get cookies.txt", sem LOCALLY, foi removida por roubar dados — não usar.
3. Nas configurações da extensão, permita que ela rode em **janela anônima**.
4. Abra uma **janela anônima nova** e entre no YouTube com a conta secundária.
5. **Na mesma aba**, abra o endereço `https://www.youtube.com/robots.txt`.
6. Clique na extensão e exporte os cookies (formato Netscape, só do youtube.com). Sai um arquivo `.txt`.
7. **Feche a janela anônima imediatamente**, sem voltar ao YouTube nela. É isso que impede o Google de rotacionar os cookies — eles passam a durar semanas ou meses.

## Passo 2 — Trocar no Render (usuário faz)

1. Abrir dashboard.render.com → serviço **transcritor-backend** → menu **Environment**.
2. Achar `YOUTUBE_COOKIES` → **Edit**.
3. Abrir o `.txt` exportado num editor de texto, copiar **tudo** (Ctrl+A, Ctrl+C) e colar no lugar do valor antigo, apagando o antigo por completo.
4. **Save, rebuild, and deploy** (ou "Save changes" e depois o deploy que o Render oferece). Esperar o deploy terminar (~3–5 min).
5. **Apagar o `.txt` do computador** e esvaziar a lixeira: aquele arquivo é o login da conta Google.

Nunca peça para o usuário colar o conteúdo dos cookies no chat, e nunca grave o arquivo dentro do repositório.

## Passo 3 — Verificar em produção (você faz)

Não entregue sem este passo (ver memória de testar em produção).

1. Espere o deploy: `curl -s -o /dev/null -w "%{http_code}" https://transcritor-backend.onrender.com/` até responder. O Render não avisa quando o deploy novo entra; conte ~6–7 min depois do push ou do "Save".
2. Faça login com a conta de teste de `e2e/credentials.json` (POST em `{SUPABASE_URL}/auth/v1/token?grant_type=password` com a anon key de `frontend/src/lib/supabase.js`) e mande um link do YouTube **sem legenda** para `/process-url` com `mode=simples` e o token no `Authorization: Bearer`. Só vídeo sem legenda cai no yt-dlp e testa os cookies de verdade — um vídeo com legenda passa pelo Supadata e não prova nada.
   - Vídeo sem legenda que já funcionou como teste: `VKDa227lMr0` (12 s, só som de alarme). A transcrição volta como alucinação do Whisper (texto aleatório) — o que importa é status 200 e `duration_s` ≈ 11.
   - Vídeo com legenda para conferir o Supadata: `jNQXAC9IVRw`.
   - Não dá para testar o yt-dlp daqui do Codespace: o YouTube pede "Sign in to confirm you're not a bot" para o IP dele.
3. Resultado certo: status 200. Se voltar o mesmo erro de cookies, a exportação rotacionou — repetir o Passo 1 com atenção ao item 7.

## Se os cookies estão bons e ainda falha

Em 2026-09-16, depois de trocar os cookies, apareceram mais duas falhas em sequência que não eram de cookie. Leia a linha `ERROR` do detalhe (o `erro_do_ytdlp` a destaca) e compare:

- **`The page needs to be reloaded`** — o YouTube recusa o cliente `tv_downgraded`, que o yt-dlp usa quando está logado (yt-dlp#17389). Contorno já aplicado: `--extractor-args youtube:player_client=default,-tv_downgraded,web_embedded`.
- **`n challenge solving failed`** seguido de **`Requested format is not available`** — o yt-dlp não achou runtime JS. O deno vem do pacote `deno` no `requirements.txt` (achado por `deno.find_deno_bin()`); confirmar que ele continua lá.
- Coisa nova: pesquisar as issues recentes do yt-dlp (`gh api -X GET search/issues -f q='repo:yt-dlp/yt-dlp is:issue "<trecho do erro>"'`). Para enxergar versões e runtime em produção, pôr `-v` no comando e anexar ao erro as linhas `[debug] yt-dlp version`, `[debug] JS runtimes` e `[debug] Optional libraries` — só temporariamente, e tirar depois.
