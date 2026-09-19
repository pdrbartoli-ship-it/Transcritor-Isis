#!/usr/bin/env python3
"""Roda ao abrir uma sessão do Claude Code neste projeto (gancho SessionStart
em .claude/settings.local.json) e conta se a IA de reserva do Dito precisou
entrar nos últimos 7 dias — ou seja, se o Gemini ou o Luna falharam e o Claude
respondeu no lugar deles. Ver "Modelo principal e reserva" em backend/main.py.

O que este script imprime vira contexto da sessão. Por isso ele só fala
quando há algo a contar: com zero fallbacks, fica em silêncio.

Entra com a conta de teste de e2e/credentials.json (fora do git) e chama
GET /ia/fallbacks no backend de produção. Só biblioteca padrão."""

import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND = "https://transcritor-backend.onrender.com"
SUPABASE_URL = "https://hgmwngasnltlrqlwimdj.supabase.co"
# A chave anon é pública por desenho (é a mesma do frontend).
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXduZ2Fzbmx0bHJxbHdpbWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTU0NTcsImV4cCI6MjA5NTk5MTQ1N30."
    "d936pnaq2YLJ54NvNNKddUP62TPJhtbUMz2PdbSi6Sc"
)
DIAS = 7


def pedir(url, dados=None, cabecalhos=None, timeout=25):
    corpo = json.dumps(dados).encode() if dados is not None else None
    req = urllib.request.Request(url, data=corpo, headers={"Content-Type": "application/json", **(cabecalhos or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def main():
    try:
        cred = json.load(open(os.path.join(RAIZ, "e2e", "credentials.json")))
    except OSError:
        return  # sem a conta de teste neste computador, não há como checar

    try:
        sessao = pedir(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            {"email": cred["email"], "password": cred["password"]},
            {"apikey": SUPABASE_ANON_KEY},
        )
        # O Render pode estar dormindo; 25 s cobre o acordar.
        dados = pedir(
            f"{BACKEND}/ia/fallbacks?dias={DIAS}",
            cabecalhos={"Authorization": f"Bearer {sessao['access_token']}"},
        )
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print(f"[Dito · IA de reserva] Não consegui checar os fallbacks agora ({type(e).__name__}: {e}).")
        return

    total = dados.get("total") or 0
    if not total:
        return

    fallbacks = dados.get("fallbacks") or []
    por_caminho = Counter(f"{f.get('uso')}: {f.get('falhou')} → {f.get('assumiu')}" for f in fallbacks)
    por_motivo = Counter(f"{f.get('falhou')}: {f.get('motivo')}" for f in fallbacks)
    linhas = [
        f"[Dito · IA de reserva] {total} fallback(s) nos últimos {DIAS} dias — o modelo principal "
        "falhou e o Claude respondeu no lugar. Conte isso ao usuário na primeira resposta.",
        "Por uso: " + "; ".join(f"{k} ({n}x)" for k, n in por_caminho.most_common()),
        "Motivos: " + "; ".join(f"{k} ({n}x)" for k, n in por_motivo.most_common(5)),
        f"Mais recente: {fallbacks[0].get('quando')}" if fallbacks else "",
        f"Detalhe: GET {BACKEND}/ia/fallbacks?dias=30 com o token da conta de teste.",
    ]
    print("\n".join(l for l in linhas if l))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nunca travar a abertura da sessão
        print(f"[Dito · IA de reserva] O checador de fallbacks quebrou ({type(e).__name__}).", file=sys.stdout)
