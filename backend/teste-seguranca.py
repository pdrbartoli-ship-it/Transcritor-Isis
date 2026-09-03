# Testa as defesas do backend sozinhas, sem rede e sem gastar crédito de IA.
#
# As chamadas de verdade (Groq, Anthropic, yt-dlp) são substituídas por dublês,
# porque o que está sob teste aqui é o porteiro — quem entra, quem é barrado, e
# o que vaza na resposta —, não a transcrição em si.
#
# Rodar:  cd backend && python teste-seguranca.py

import asyncio
import os
import sys

# Precisa vir antes do import de main: as chaves são lidas na carga do módulo,
# e sem elas os endpoints param no 500 de "chaves não configuradas" antes de
# chegar no que queremos testar.
os.environ.setdefault("GROQ_API_KEY", "chave-de-teste")
os.environ.setdefault("ANTHROPIC_API_KEY", "chave-de-teste")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

ok = 0
falhas = 0


def check(nome, cond):
    global ok, falhas
    if cond:
        ok += 1
        print(f"  OK    {nome}")
    else:
        falhas += 1
        print(f"  FALHA {nome}")


def limpar_estado():
    """Cada bloco começa do zero: o limitador e o cache de token vivem em
    memória e vazariam de um teste para o outro."""
    main._rate_hits.clear()
    main._token_cache.clear()


# Dublês do trabalho caro. O corpo devolvido não importa — importa que o
# endpoint chegue até aqui (ou seja barrado antes).
async def _transcricao_falsa(*args, **kwargs):
    return ("transcrição de teste", [], 1, "1 min", 60.0)


async def _insights_falsos(*args, **kwargs):
    return ({"title": "Título de teste"}, 10, 5)


main.process_audio_bytes = _transcricao_falsa
main.extract_insights = _insights_falsos

client = TestClient(main.app, raise_server_exceptions=False)
TOKEN_BOM = "token-valido-de-teste"
UID = "11111111-2222-3333-4444-555555555555"

# Guardada antes de qualquer dublê: o último bloco testa a função de verdade.
validar_token_real = main.validar_token


def fingir_supabase(validos):
    """Troca a checagem real por uma tabela de tokens conhecidos, para os
    testes não dependerem da rede nem de uma conta de verdade."""
    async def falso(token):
        return validos.get(token)
    main.validar_token = falso


# ─────────────────────────────────────────────────────────────
print("\n== o porteiro: exigência LIGADA ==")
limpar_estado()
main.REQUIRE_AUTH = True
fingir_supabase({TOKEN_BOM: UID})

for rota, payload in [
    ("/insights", {"json": {"transcript": "oi"}}),
    ("/chat", {"json": {"question": "e aí?", "title": "t", "date": "d", "transcript": "oi"}}),
    ("/process-url", {"data": {"url": "https://exemplo.com"}}),
    ("/transcribe", {"files": {"file": ("a.m4a", b"123", "audio/m4a")}}),
]:
    r = client.post(rota, **payload)
    check(f"{rota} sem token → 401", r.status_code == 401)

    r = client.post(rota, headers={"Authorization": "Bearer token-inventado"}, **payload)
    check(f"{rota} com token falso → 401", r.status_code == 401)

limpar_estado()
r = client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": f"Bearer {TOKEN_BOM}"})
check("/insights com token bom → passa do porteiro", r.status_code != 401)

check("a resposta 401 não entrega detalhe interno",
      "Entre na sua conta" in client.post("/insights", json={"transcript": "oi"}).json().get("detail", ""))

# ─────────────────────────────────────────────────────────────
print("\n== formatos de cabeçalho que a vida real manda ==")
limpar_estado()
for cabecalho, esperado, nome in [
    (f"bearer {TOKEN_BOM}", 200, "'bearer' minúsculo é aceito"),
    (f"Bearer  {TOKEN_BOM}", 200, "espaço extra depois de Bearer é tolerado"),
    (TOKEN_BOM, 401, "token cru, sem 'Bearer', é recusado"),
    ("Bearer", 401, "'Bearer' sem token é recusado"),
    ("Basic abc123", 401, "esquema errado (Basic) é recusado"),
    ("", 401, "cabeçalho vazio é recusado"),
]:
    limpar_estado()
    r = client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": cabecalho})
    passou = r.status_code != 401
    check(nome, passou == (esperado == 200))

# ─────────────────────────────────────────────────────────────
print("\n== exigência DESLIGADA: app antigo continua funcionando ==")
limpar_estado()
main.REQUIRE_AUTH = False

r = client.post("/insights", json={"transcript": "oi"})
check("sem token → NÃO é barrado (o app velho segue vivo)", r.status_code != 401)

r = client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": f"Bearer {TOKEN_BOM}"})
check("com token bom → também passa", r.status_code != 401)

limpar_estado()
r = client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": "Bearer lixo"})
check("com token inválido → passa, mas sem identidade", r.status_code != 401)

# ─────────────────────────────────────────────────────────────
print("\n== rotas abertas continuam abertas ==")
limpar_estado()
main.REQUIRE_AUTH = True

check("/ (saúde) responde sem login", client.get("/").status_code == 200)
check("/app-update responde sem login (o app consulta antes de logar)",
      client.post("/app-update", json={"version_name": "builtin"}).status_code == 200)

# ─────────────────────────────────────────────────────────────
print("\n== limite de uso ==")
limpar_estado()
main.REQUIRE_AUTH = False

for _ in range(main.RATE_LIMIT):
    client.post("/insights", json={"transcript": "oi"})
r = client.post("/insights", json={"transcript": "oi"})
check(f"passa {main.RATE_LIMIT} e barra a seguinte com 429", r.status_code == 429)

limpar_estado()
main.REQUIRE_AUTH = True
fingir_supabase({TOKEN_BOM: UID, "token-de-outro": "99999999-8888-7777-6666-555555555555"})
for _ in range(main.RATE_LIMIT):
    client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": f"Bearer {TOKEN_BOM}"})
r = client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": f"Bearer {TOKEN_BOM}"})
check("usuário que estourou a cota é barrado", r.status_code == 429)

r = client.post("/insights", json={"transcript": "oi"}, headers={"Authorization": "Bearer token-de-outro"})
check("o vizinho de cota NÃO é punido junto (conta por usuário, não por IP)", r.status_code != 429)

# ─────────────────────────────────────────────────────────────
print("\n== SSRF: links que apontam para dentro ==")
for url, seguro in [
    ("https://exemplo.com/artigo", True),
    ("http://google.com", True),
    ("http://127.0.0.1:8000/admin", False),
    ("http://localhost/", False),
    ("http://169.254.169.254/latest/meta-data/", False),   # metadados da nuvem
    ("http://10.0.0.5/interno", False),
    ("http://192.168.1.1/", False),
    ("http://172.16.0.1/", False),
    ("http://[::1]/", False),
    ("file:///etc/passwd", False),
    ("ftp://exemplo.com/x", False),
    ("gopher://exemplo.com/", False),
    ("http://0.0.0.0/", False),
    ("não é uma url", False),
    ("", False),
]:
    check(f"{url or '(vazio)'} → {'liberado' if seguro else 'bloqueado'}",
          main.is_safe_public_url(url) == seguro)

limpar_estado()
main.REQUIRE_AUTH = False
r = client.post("/process-url", data={"url": "http://169.254.169.254/latest/meta-data/"})
check("o endpoint recusa o link interno com 400", r.status_code == 400)
check("e a recusa não conta o motivo real",
      "metadata" not in r.text.lower() and "169.254" not in r.text)

# ─────────────────────────────────────────────────────────────
print("\n== teto de tamanho ==")
limpar_estado()

r = client.post("/insights", json={"transcript": "x" * 400_001})
check("transcrição acima do teto é recusada (422)", r.status_code == 422)

r = client.post("/insights", json={"transcript": "x" * 1000})
check("transcrição de tamanho normal passa", r.status_code != 422)

r = client.post("/chat", json={"question": "x" * 4001, "title": "t", "date": "d", "transcript": "oi"})
check("pergunta gigante é recusada (422)", r.status_code == 422)

r = client.post("/chat", json={"question": "tudo bem?", "title": "t", "date": "d", "transcript": "x" * 400_001})
check("transcrição gigante no chat é recusada (422)", r.status_code == 422)

# ─────────────────────────────────────────────────────────────
print("\n== erro interno não vaza detalhe ==")
limpar_estado()


async def _explode(*args, **kwargs):
    raise RuntimeError("senha=hunter2 em /opt/render/project/segredo.py")


main.extract_insights = _explode
r = client.post("/insights", json={"transcript": "oi"})
corpo = r.text
check("resposta é 500", r.status_code == 500)
check("não vaza a mensagem da exceção", "hunter2" not in corpo)
check("não vaza o caminho do arquivo", "/opt/render" not in corpo)
check("não vaza o tipo da exceção", "RuntimeError" not in corpo)
check("devolve uma frase genérica", "Erro interno" in corpo)
main.extract_insights = _insights_falsos

# ─────────────────────────────────────────────────────────────
print("\n== cache de token: não martela o Supabase ==")
# Aqui testamos a validar_token DE VERDADE (não o dublê), trocando só a ida de
# rede — é o cache que está sob teste, e ele vive dentro dela.
limpar_estado()
main.validar_token = validar_token_real

idas = {"n": 0}


class RespostaFalsa:
    status_code = 200

    @staticmethod
    def json():
        return {"id": UID}


class ClienteFalso:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, *a, **kw):
        idas["n"] += 1
        return RespostaFalsa()


main.httpx.AsyncClient = ClienteFalso

primeira = asyncio.run(main.validar_token(TOKEN_BOM))
check("primeira checagem consulta o Supabase", primeira == UID and idas["n"] == 1)

for _ in range(9):
    asyncio.run(main.validar_token(TOKEN_BOM))
check("as 9 seguintes saem do cache, sem nova ida à rede", idas["n"] == 1)

asyncio.run(main.validar_token("um-token-diferente"))
check("token diferente força uma consulta nova", idas["n"] == 2)

# Token expirado no cache tem de ser reconsultado, senão uma sessão revogada
# continuaria valendo para sempre.
import hashlib as _h
import time as _t
main._token_cache[_h.sha256(TOKEN_BOM.encode()).hexdigest()] = (_t.time() - 1, UID)
asyncio.run(main.validar_token(TOKEN_BOM))
check("entrada vencida no cache é reconsultada", idas["n"] == 3)

# ─────────────────────────────────────────────────────────────
print(f"\n{'TUDO OK' if falhas == 0 else 'HOUVE FALHAS'} — {ok} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
