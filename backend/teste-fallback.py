# Testa o modelo principal com a reserva do Claude, sem rede e sem gastar
# crédito de IA: Google, OpenAI, Anthropic e Supabase são dublês. O que está
# sob teste é a decisão — quem responde, quando a reserva entra, o que fica
# registrado e o que volta pro app —, não a qualidade da resposta.
#
# Rodar:  cd backend && python teste-fallback.py

import asyncio
import json
import os
import sys
from types import SimpleNamespace

# As chaves são lidas na carga do módulo.
os.environ["GROQ_API_KEY"] = "chave-de-teste"
os.environ["ANTHROPIC_API_KEY"] = "chave-de-teste"
os.environ["GEMINI_API_KEY"] = "chave-gemini-de-teste"
os.environ["OPENAI_API_KEY"] = "chave-openai-de-teste"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-de-teste"

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

ok = 0
falhas = 0


def check(nome, cond, detalhe=""):
    global ok, falhas
    if cond:
        ok += 1
        print(f"  OK    {nome}")
    else:
        falhas += 1
        print(f"  FALHA {nome} {detalhe}")


UID = "11111111-2222-3333-4444-555555555555"

# ── Dublês ────────────────────────────────────────────────────────────────
# Cada fornecedor tem um "roteiro": "ok", ou o jeito de falhar.
roteiro = {"gemini": "ok", "openai": "ok", "claude": "ok", "plano": "avancado"}
chamadas = {"gemini": [], "openai": [], "claude": [], "events": [], "rpc": []}
linhas_events = []

INSIGHTS_OK = {
    "title": "Reunião de teste", "summary_bullets": ["Um ponto"], "speakers": [],
    "speaker_turns": [], "topics": [], "todos": [],
    "chapters": [{"start": 0, "end": 30, "title": "Abertura", "bullets": ["oi"]}],
}
RESUMO_OK = {"title": "Áudio de teste", "summary": "- Um fato"}


def resposta_gemini(corpo):
    schema = corpo["generationConfig"]["responseJsonSchema"]
    data = RESUMO_OK if "summary" in schema["properties"] else INSIGHTS_OK
    r = roteiro["gemini"]
    if r == "http500":
        return httpx.Response(500, json={"error": {"code": 500, "message": "boom com texto", "status": "INTERNAL"}})
    if r == "safety":
        return httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}]})
    if r == "bloqueio":
        return httpx.Response(200, json={"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}})
    if r == "cortado":
        return httpx.Response(200, json={"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": '{"title": "Reu'}]}}]})
    if r == "lixo":
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "não é json"}]}}]})
    return httpx.Response(200, json={
        "candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": "pensando...", "thought": True},
            {"text": json.dumps(data)},
        ]}}],
        "usageMetadata": {"promptTokenCount": 1000, "cachedContentTokenCount": 400,
                          "candidatesTokenCount": 200, "thoughtsTokenCount": 50},
    })


def resposta_openai(corpo):
    r = roteiro["openai"]
    if r == "chave":
        # A OpenAI de verdade repete um pedaço da chave na mensagem.
        return httpx.Response(401, json={"error": {"message": "Incorrect API key provided: sk-abc***xyz", "type": "invalid_request_error", "code": "invalid_api_key"}})
    if r == "cortado":
        return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": "meia resp"}}]})
    return httpx.Response(200, json={
        "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "Resposta do Luna"}}],
        "usage": {"prompt_tokens": 1500, "completion_tokens": 80, "prompt_tokens_details": {"cached_tokens": 1024}},
    })


async def handler(request: httpx.Request):
    url = str(request.url)
    host = request.url.host
    if host == "generativelanguage.googleapis.com":
        corpo = json.loads(request.content)
        chamadas["gemini"].append({"url": url, "corpo": corpo, "chave": request.headers.get("x-goog-api-key")})
        if roteiro["gemini"] == "lento":
            await asyncio.sleep(5)
        return resposta_gemini(corpo)
    if host == "api.openai.com":
        corpo = json.loads(request.content)
        chamadas["openai"].append(corpo)
        if roteiro["openai"] == "lento":
            await asyncio.sleep(5)
        return resposta_openai(corpo)
    if request.url.path == "/auth/v1/user":
        return httpx.Response(200, json={"id": UID, "email": "teste@exemplo.com", "is_anonymous": False})
    if request.url.path == "/rest/v1/subscriptions":
        return httpx.Response(200, json=[{"plano": roteiro["plano"], "status": "active", "current_period_end": None}])
    if request.url.path == "/rest/v1/events" and request.method == "POST":
        corpo = json.loads(request.content)
        chamadas["events"].append(corpo)
        return httpx.Response(201)
    if request.url.path == "/rest/v1/events" and request.method == "GET":
        chamadas["events_get"] = dict(request.url.params)
        return httpx.Response(200, json=linhas_events)
    if request.url.path.startswith("/rest/v1/rpc/"):
        nome = request.url.path.rsplit("/", 1)[1]
        chamadas["rpc"].append(nome)
        return httpx.Response(200, json=1 if nome == "consumir_pergunta" else None)
    return httpx.Response(404, json={"erro": f"dublê não conhece {url}"})


_AsyncClientReal = httpx.AsyncClient


class AsyncClientDuble(_AsyncClientReal):
    def __init__(self, *a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        super().__init__(*a, **kw)


httpx.AsyncClient = AsyncClientDuble


class ClaudeDuble:
    def __init__(self):
        self.messages = self

    async def create(self, **kw):
        chamadas["claude"].append(kw)
        if roteiro["claude"] == "erro":
            raise main.anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
        # O título do chat é uma chamada curta (max_tokens=24).
        if kw.get("max_tokens") == 24:
            texto = "Título do chat"
        elif "output_config" in kw:
            schema = kw["output_config"]["format"]["schema"]
            texto = json.dumps(RESUMO_OK if "summary" in schema["properties"] else INSIGHTS_OK)
        else:
            texto = "Resposta do Haiku"
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=texto)],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=3, cache_creation_input_tokens=2),
        )


main.anthropic_client = lambda: ClaudeDuble()


def zerar(**r):
    roteiro.update({"gemini": "ok", "openai": "ok", "claude": "ok", "plano": "avancado"})
    roteiro.update(r)
    for k in ("gemini", "openai", "claude", "events", "rpc"):
        chamadas[k] = []
    main._rate_hits.clear()
    main._token_cache.clear()
    main._usuario_atual.set(UID)


def rodar(coro):
    return asyncio.run(coro)


SEGS = [{"start": 0, "end": 30, "text": "oi, tudo bem"}]

# ─────────────────────────────────────────────────────────────
print("\n== 1. o Gemini responde ==")
zerar()


async def _simples():
    main._usuario_atual.set(UID)
    return await main.simple_summary("oi, tudo bem")

data, tin, tout, cr, cw, modelo = rodar(_simples())
check("transcrição simples vem do Gemini", modelo == "gemini-3.8-flash", modelo)
check("o Claude não foi chamado", not chamadas["claude"])
check("nada registrado como fallback", not chamadas["events"])
check("resumo chegou", data == RESUMO_OK)
check("tokens na convenção do Claude (entrada sem o cache)", (tin, tout, cr, cw) == (600, 250, 400, 0), (tin, tout, cr, cw))
g = chamadas["gemini"][0]
check("modelo e endpoint do teste", g["url"].endswith("/models/gemini-3.8-flash:generateContent"), g["url"])
check("chave vai no cabeçalho, não na URL", g["chave"] == "chave-gemini-de-teste" and "chave-gemini" not in g["url"])
gc = g["corpo"]["generationConfig"]
check("raciocínio baixo, como no teste", gc["thinkingConfig"] == {"thinkingLevel": "low"})
check("schema do resumo simples e teto de 2000", gc["responseJsonSchema"] == main.SIMPLE_SUMMARY_SCHEMA and gc["maxOutputTokens"] == 2000)
check("mesmo system do Claude (instruções + schema)", g["corpo"]["systemInstruction"]["parts"][0]["text"].startswith(main.SIMPLE_SUMMARY_INSTRUCTIONS[:40]) and "Formato esperado (schema JSON)" in g["corpo"]["systemInstruction"]["parts"][0]["text"])

zerar()


async def _completa():
    main._usuario_atual.set(UID)
    return await main.extract_insights("oi, tudo bem", SEGS)

ins, *_, modelo = rodar(_completa())
check("transcrição avançada vem do Gemini", modelo == "gemini-3.8-flash", modelo)
check("schema completo e teto de 16000", chamadas["gemini"][0]["corpo"]["generationConfig"]["maxOutputTokens"] == 16000)
check("passa pelo normalize_insights (título preservado)", ins.get("title") == "Reunião de teste")

# ─────────────────────────────────────────────────────────────
print("\n== 2. o Gemini cai e o Claude responde ==")
for jeito, motivo_esperado in [
    ("http500", "HTTP 500 INTERNAL"),
    ("safety", "finishReason=SAFETY"),
    ("bloqueio", "bloqueado (PROHIBITED_CONTENT)"),
    ("cortado", "finishReason=MAX_TOKENS"),
    ("lixo", "JSON inválido"),
]:
    zerar(gemini=jeito)
    data, tin, tout, cr, cw, modelo = rodar(_simples())
    ev = chamadas["events"][0] if chamadas["events"] else {}
    check(f"[{jeito}] Haiku assume o resumo simples", modelo == "claude-haiku-4-5" and data == RESUMO_OK, modelo)
    check(f"[{jeito}] Gemini chamado uma vez só (sem nova tentativa nele)", len(chamadas["gemini"]) == 1)
    check(f"[{jeito}] fallback registrado com motivo '{motivo_esperado}'",
          ev.get("name") == "ia_fallback" and ev.get("user_id") == UID
          and ev.get("props") == {"uso": "transcricao_simples", "falhou": "gemini-3.8-flash",
                                  "assumiu": "claude-haiku-4-5", "motivo": motivo_esperado}, ev)

check("[http500] a mensagem crua do Google não vai pro registro", "boom" not in json.dumps(chamadas["events"]))

zerar(gemini="cortado")
ins, tin, tout, cr, cw, modelo = rodar(_completa())
kw = chamadas["claude"][0]
check("avançada cai no Sonnet com effort low", modelo == "claude-sonnet-5" and kw["model"] == "claude-sonnet-5"
      and kw["output_config"].get("effort") == "low", (modelo, kw.get("model")))
check("usage do Claude segue igual ao de hoje", (tin, tout, cr, cw) == (10, 5, 3, 2))
check("registro diz transcricao_avancada → Sonnet", chamadas["events"][0]["props"]["uso"] == "transcricao_avancada"
      and chamadas["events"][0]["props"]["assumiu"] == "claude-sonnet-5")

zerar(gemini="lento")
main.GEMINI_TIMEOUT_S = 0.3
data, *_, modelo = rodar(_simples())
main.GEMINI_TIMEOUT_S = 120.0
check("Gemini lento passa do prazo e o Haiku assume", modelo == "claude-haiku-4-5")
check("motivo: demorou demais", chamadas["events"][0]["props"]["motivo"] == "demorou demais")

# ─────────────────────────────────────────────────────────────
print("\n== 3. sem a chave do Gemini, tudo como era ==")
zerar()
main.GEMINI_API_KEY = ""
data, *_, modelo = rodar(_simples())
ins, *_, modelo2 = rodar(_completa())
main.GEMINI_API_KEY = "chave-gemini-de-teste"
check("Gemini nem é chamado", not chamadas["gemini"])
check("simples no Haiku, avançada no Sonnet", modelo == "claude-haiku-4-5" and modelo2 == "claude-sonnet-5")
check("e não é fallback (nada registrado)", not chamadas["events"])

# ─────────────────────────────────────────────────────────────
print("\n== 4. transcrição longa: cada parte pode cair sozinha ==")
zerar()
_gemini_real = main.call_gemini
contagem = {"n": 0}


async def _gemini_cai_na_segunda(*a, **kw):
    contagem["n"] += 1
    if contagem["n"] == 2:
        raise main.FalhaDoPrincipal("HTTP 503 UNAVAILABLE")
    return await _gemini_real(*a, **kw)

main.call_gemini = _gemini_cai_na_segunda
main.MAX_SINGLE_PASS_CHARS_ORIG = main.MAX_SINGLE_PASS_CHARS
main.MAX_SINGLE_PASS_CHARS = 40
longos = [{"start": i * 30, "end": i * 30 + 30, "text": f"trecho número {i} da conversa longa"} for i in range(4)]


async def _longa():
    main._usuario_atual.set(UID)
    return await main.extract_insights("x", longos)

ins, *_, modelo = rodar(_longa())
main.MAX_SINGLE_PASS_CHARS = main.MAX_SINGLE_PASS_CHARS_ORIG
main.call_gemini = _gemini_real
check("usage.modelo lista os dois, na ordem", modelo == "gemini-3.8-flash+claude-sonnet-5", modelo)
check("só a parte que caiu foi registrada", len(chamadas["events"]) == 1)

# ─────────────────────────────────────────────────────────────
print("\n== 5. chat pela rota de verdade (login, contador, registro) ==")
client = TestClient(main.app, raise_server_exceptions=False)
AUTH = {"Authorization": "Bearer token-bom"}
PERGUNTA = {"question": "Quem falou?", "title": "Reunião", "date": "2026-09-19",
            "transcript": "oi, tudo bem", "history": [{"role": "user", "content": "antes"}, {"role": "assistant", "content": "resp"}],
            "session_id": "sessao-1"}

zerar(plano="iniciante")
main._usuario_atual.set(None)  # quem seta agora é o guarda_de_uso da rota
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
j = r.json()
check("Luna responde", r.status_code == 200 and j["answer"] == "Resposta do Luna", r.text[:200])
check("usage.modelo = gpt-5.6-luna", j["usage"]["modelo"] == "gpt-5.6-luna")
check("tokens na convenção do Claude", (j["usage"]["input_tokens"], j["usage"]["cache_read_tokens"], j["usage"]["output_tokens"]) == (476, 1024, 80), j["usage"])
o = chamadas["openai"][0]
check("parâmetros do teste (luna, reasoning low)", o["model"] == "gpt-5.6-luna" and o["reasoning_effort"] == "low")
check("system único com transcrição + regras, depois o histórico e a pergunta",
      o["messages"][0]["role"] == "system" and "oi, tudo bem" in o["messages"][0]["content"]
      and "REGRAS OBRIGATÓRIAS" in o["messages"][0]["content"]
      and [m["role"] for m in o["messages"][1:]] == ["user", "assistant", "user"]
      and o["messages"][-1]["content"] == "Quem falou?")
check("pergunta contada no plano", chamadas["rpc"] == ["consumir_pergunta"])

zerar(plano="iniciante", openai="chave")
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
j = r.json()
ev = chamadas["events"][0] if chamadas["events"] else {}
check("Luna recusa a chave e o Haiku responde", r.status_code == 200 and j["answer"] == "Resposta do Haiku", r.text[:200])
check("usage.modelo = claude-haiku-4-5", j["usage"]["modelo"] == "claude-haiku-4-5")
check("fallback gravado com o usuário da rota (contextvar do guarda_de_uso)", ev.get("user_id") == UID, ev)
check("motivo: HTTP 401 invalid_api_key", ev.get("props", {}).get("motivo") == "HTTP 401 invalid_api_key", ev)
check("nenhum pedaço da chave no registro", "sk-" not in json.dumps(chamadas["events"]))
check("a pergunta NÃO é devolvida (a reserva respondeu)", chamadas["rpc"] == ["consumir_pergunta"])

zerar(plano="iniciante", openai="lento")
main.LUNA_TIMEOUT_S = 0.3
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
main.LUNA_TIMEOUT_S = 30.0
check("Luna lento → Haiku", r.status_code == 200 and r.json()["answer"] == "Resposta do Haiku")

zerar(plano="iniciante", openai="cortado", claude="erro")
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("os dois caem → o mesmo 502 de hoje", r.status_code == 502 and "Erro ao consultar IA" in r.text, f"{r.status_code} {r.text[:200]}")
check("e a pergunta volta pro saldo", chamadas["rpc"] == ["consumir_pergunta", "devolver_pergunta"], chamadas["rpc"])
check("o fallback ficou registrado mesmo assim", len(chamadas["events"]) == 1 and chamadas["events"][0]["props"]["motivo"] == "finish_reason=length")

zerar(plano="iniciante")
main.OPENAI_API_KEY = ""
main._usuario_atual.set(None)
r = client.post("/chat", json={**PERGUNTA, "make_title": True}, headers=AUTH)
main.OPENAI_API_KEY = "chave-openai-de-teste"
check("sem a chave da OpenAI o chat vai direto ao Haiku", r.status_code == 200 and not chamadas["openai"] and r.json()["answer"] == "Resposta do Haiku")
check("sem registrar fallback", not chamadas["events"])

zerar(plano="iniciante")
main._usuario_atual.set(None)
r = client.post("/chat", json={**PERGUNTA, "make_title": True}, headers=AUTH)
check("título do chat continua no Haiku", r.json().get("title") == "Título do chat"
      and len(chamadas["claude"]) == 1 and chamadas["claude"][0]["model"] == "claude-haiku-4-5")

# ─────────────────────────────────────────────────────────────
print("\n== 6. os dois caem na transcrição ==")
zerar(gemini="http500", claude="erro")
try:
    rodar(_simples())
    check("sobe o mesmo HTTPException 502 de hoje", False)
except main.HTTPException as e:
    check("sobe o mesmo HTTPException 502 de hoje", e.status_code == 502 and "Erro ao analisar a conversa" in e.detail)

# ─────────────────────────────────────────────────────────────
print("\n== 7. transcrição pela rota /insights (reanálise) ==")
zerar(plano="avancado")
main._usuario_atual.set(None)
r = client.post("/insights", json={"transcript": "oi, tudo bem", "segments": SEGS}, headers=AUTH)
check("200 com usage.modelo do Gemini", r.status_code == 200 and r.json()["usage"]["modelo"] == "gemini-3.8-flash", r.text[:200])

# ─────────────────────────────────────────────────────────────
print("\n== 8. /ia/fallbacks ==")
zerar()
linhas_events[:] = [{"created_at": "2026-09-19T12:00:00+00:00",
                     "props": {"uso": "chat", "falhou": "gpt-5.6-luna", "assumiu": "claude-haiku-4-5", "motivo": "HTTP 429 rate_limit_exceeded"}}]
r = client.get("/ia/fallbacks")
check("sem login → 401", r.status_code == 401)
r = client.get("/ia/fallbacks?dias=7", headers=AUTH)
j = r.json()
check("com login → lista", r.status_code == 200 and j["total"] == 1 and j["dias"] == 7, r.text[:200])
check("campos certos e nada de usuário", set(j["fallbacks"][0]) == {"quando", "uso", "falhou", "assumiu", "motivo"} and UID not in r.text)
check("diz quem está ligado", j["principais"] == {"transcricao": "gemini-3.8-flash", "chat": "gpt-5.6-luna"})
p = chamadas["events_get"]
check("consulta filtra ia_fallback, período e ordem", p["name"] == "eq.ia_fallback" and p["created_at"].startswith("gte.2026") and p["order"] == "created_at.desc", p)
r = client.get("/ia/fallbacks?dias=9999", headers=AUTH)
check("período limitado a 90 dias", r.json()["dias"] == 90)

print(f"\n{'TUDO CERTO' if not falhas else 'HOUVE FALHAS'} — {ok} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
