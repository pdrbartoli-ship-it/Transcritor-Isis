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
roteiro = {"gemini": "ok", "openai": "ok", "claude": "ok", "embed": "ok", "plano": "avancado", "saldo": "ok", "periodo_fim": None, "usadas": 1}
chamadas = {"gemini": [], "openai": [], "claude": [], "events": [], "rpc": [], "rpc_args": []}
linhas_events = []

INSIGHTS_OK = {
    "title": "Reunião de teste", "summary_bullets": ["Um ponto"], "speakers": [],
    "speaker_turns": [], "topics": [], "todos": [],
    "chapters": [{"start": 0, "end": 30, "title": "Abertura", "bullets": ["oi"]}],
}
RESUMO_OK = {"title": "Áudio de teste", "summary": "- Um fato"}
PLANO_OK = {"palavras": ["sprint", "usabilidade"], "conversas": ["c-1"], "recencia": 2,
            "desde": None, "ate": None, "pergunta": "o que foi dito sobre a UX nas últimas 2 sprints?"}


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


def resposta_embed(corpo):
    r = roteiro["embed"]
    if r == "http429":
        return httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED", "message": "quota da chave AIzaSyABC"}})
    if r == "curto":
        return httpx.Response(200, json={"embeddings": [{"values": [0.0] * 768}]})
    n = len(corpo["requests"])
    return httpx.Response(200, json={"embeddings": [{"values": [0.1] * 768} for _ in range(n)]})


def resposta_openai(corpo):
    r = roteiro["openai"]
    # O planner pede JSON; o chat, texto.
    if corpo.get("response_format", {}).get("type") == "json_object":
        if r == "planner_lixo":
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "não é json"}}],
                                             "usage": {"prompt_tokens": 900, "completion_tokens": 40}})
        if r == "chave":
            return httpx.Response(401, json={"error": {"message": "Incorrect API key provided: sk-abc***xyz", "code": "invalid_api_key"}})
        return httpx.Response(200, json={
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(PLANO_OK)}}],
            "usage": {"prompt_tokens": 900, "completion_tokens": 40, "prompt_tokens_details": {"cached_tokens": 0}},
        })
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
        if "batchEmbedContents" in url:
            return resposta_embed(corpo)
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
        return httpx.Response(200, json=[{"plano": roteiro["plano"], "status": "active", "current_period_end": roteiro["periodo_fim"]}])
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
        chamadas["rpc_args"].append(json.loads(request.content))
        if nome == "consumir_pergunta_mes":
            # "limite" = o banco recusando porque o saldo do mês acabou (devolve null).
            if roteiro["saldo"] == "limite":
                return httpx.Response(200, content=b"null", headers={"content-type": "application/json"})
            if roteiro["saldo"] == "fora":
                return httpx.Response(500, text="banco fora do ar")
            return httpx.Response(200, json=roteiro["usadas"])
        return httpx.Response(200, json=None)
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
            if "palavras" in schema["properties"]:
                texto = json.dumps(PLANO_OK)
            else:
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
    roteiro.update({"gemini": "ok", "openai": "ok", "claude": "ok", "embed": "ok", "plano": "avancado", "saldo": "ok", "periodo_fim": None, "usadas": 1})
    roteiro.update(r)
    for k in ("gemini", "openai", "claude", "events", "rpc", "rpc_args"):
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
check("pergunta contada no plano", chamadas["rpc"] == ["consumir_pergunta_mes"])

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
check("a pergunta NÃO é devolvida (a reserva respondeu)", chamadas["rpc"] == ["consumir_pergunta_mes"])

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
check("e a pergunta volta pro saldo", chamadas["rpc"] == ["consumir_pergunta_mes", "devolver_pergunta_mes"], chamadas["rpc"])
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

# ─────────────────────────────────────────────────────────────
print("\n== 9. saldo mensal de perguntas (5 / 60 / sem limite) ==")
zerar(plano="gratuito", usadas=3)
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
a = chamadas["rpc_args"][0] if chamadas["rpc_args"] else {}
check("grátis: 3ª pergunta do mês → restam 2", r.status_code == 200 and r.json()["perguntas_restantes"] == 2, r.text[:200])
check("grátis: manda limite 5 e o usuário (não a conversa)", a.get("p_limite") == 5 and a.get("p_user_id") == UID and "p_session_id" not in a, a)

zerar(plano="iniciante", usadas=60)
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("iniciante: manda limite 60 e a 60ª ainda passa (restam 0)", r.status_code == 200 and r.json()["perguntas_restantes"] == 0
      and chamadas["rpc_args"][0]["p_limite"] == 60, r.text[:200])

zerar(plano="gratuito", saldo="limite")
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("saldo do mês acabou → 402 com convite ao Iniciante", r.status_code == 402 and "5 perguntas deste mês" in r.text and "60 perguntas por mês" in r.text, r.text[:250])
check("402 antes da IA: nenhuma chamada de modelo e nada devolvido",
      not chamadas["openai"] and not chamadas["claude"] and chamadas["rpc"] == ["consumir_pergunta_mes"])

zerar(plano="iniciante", saldo="limite")
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("iniciante esgotado → convite ao Avançado", r.status_code == 402 and "Avançado" in r.text, r.text[:250])

zerar(plano="avancado", usadas=137)
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("avançado: é contado (limite null) e a resposta não traz saldo",
      r.status_code == 200 and r.json()["perguntas_restantes"] is None
      and chamadas["rpc_args"][0]["p_limite"] is None, r.text[:200])

zerar(plano="iniciante", periodo_fim="2026-10-05T00:00:00+00:00")
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("ciclo do Stripe repassado ao banco (mesma virada dos minutos)",
      chamadas["rpc_args"][0]["p_periodo_fim"] == "2026-10-05T00:00:00+00:00", chamadas["rpc_args"])

zerar(plano="gratuito", saldo="fora")
main._usuario_atual.set(None)
r = client.post("/chat", json=PERGUNTA, headers=AUTH)
check("contador fora do ar → o chat responde mesmo assim (sem saldo na resposta)",
      r.status_code == 200 and r.json()["perguntas_restantes"] is None, r.text[:200])

zerar(plano="gratuito", usadas=1)
main._usuario_atual.set(None)
r = client.post("/chat", json={k: v for k, v in PERGUNTA.items() if k != "session_id"}, headers=AUTH)
check("versão antiga do app (sem session_id) também é contada", r.status_code == 200 and chamadas["rpc"] == ["consumir_pergunta_mes"], r.text[:200])

zerar(plano="iniciante")
planos = client.get("/planos").json()["planos"]
por_id = {p["id"]: p for p in planos}
check("/planos: números e textos do saldo mensal",
      [por_id[i]["perguntas"] for i in ("gratuito", "iniciante", "avancado")] == [5, 60, None]
      and "5 perguntas por mês" in por_id["gratuito"]["itens"]
      and "60 perguntas por mês" in por_id["iniciante"]["itens"]
      and "Perguntas ilimitadas" in por_id["avancado"]["itens"]
      and not any("transcrição" in i and "pergunta" in i for p in planos for i in p["itens"]),
      [p["itens"] for p in planos])


# ─────────────────────────────────────────────────────────────
print("\n== 10. /embeddar: converte e não guarda ==")
zerar()
r = client.post("/embeddar", json={"textos": ["trecho um", "trecho dois"]})
check("sem login → 401", r.status_code == 401, r.text[:120])

zerar()
r = client.post("/embeddar", json={"textos": ["trecho um", "trecho dois"]}, headers=AUTH)
j = r.json()
check("200 com um vetor por trecho", r.status_code == 200 and len(j["vetores"]) == 2, r.text[:200])
check("768 dimensões, modelo do teste de recall", j["dimensoes"] == 768 and j["modelo"] == "gemini-embedding-2" and len(j["vetores"][0]) == 768)
g = chamadas["gemini"][0]
check("endpoint batchEmbedContents do Gemini Embedding 2", g["url"].endswith("/models/gemini-embedding-2:batchEmbedContents"), g["url"])
check("chave no cabeçalho, não na URL", g["chave"] == "chave-gemini-de-teste" and "chave-gemini" not in g["url"])
req = g["corpo"]["requests"]
check("prefixo de DOCUMENTO e 768 dims por trecho",
      req[0]["content"]["parts"][0]["text"] == "title: none | text: trecho um"
      and req[0]["output_dimensionality"] == 768 and len(req) == 2, req[0])

zerar()
r = client.post("/embeddar", json={"textos": ["quanto custou?"], "tipo": "pergunta"}, headers=AUTH)
t = chamadas["gemini"][0]["corpo"]["requests"][0]["content"]["parts"][0]["text"]
check("prefixo de PERGUNTA é outro (buscar com o errado piora sem dar erro)",
      t == "task: search result | query: quanto custou?", t)

zerar(embed="http429")
r = client.post("/embeddar", json={"textos": ["x"]}, headers=AUTH)
check("cota estourada → 503 (o app segue na busca por palavra)", r.status_code == 503 and "indexação" in r.text, r.text[:160])
check("nenhum pedaço da chave do Google vaza na resposta", "AIzaSy" not in r.text)

zerar(embed="curto")
r = client.post("/embeddar", json={"textos": ["a", "b"]}, headers=AUTH)
check("resposta incompleta → 502 (não grava vetor trocado)", r.status_code == 502, r.text[:160])

zerar()
main.GEMINI_API_KEY = ""
r = client.post("/embeddar", json={"textos": ["x"]}, headers=AUTH)
main.GEMINI_API_KEY = "chave-gemini-de-teste"
check("sem a chave do Gemini → 503, e nada é chamado", r.status_code == 503 and not chamadas["gemini"])

zerar()
r = client.post("/embeddar", json={"textos": ["x" * 9000]}, headers=AUTH)
t = chamadas["gemini"][0]["corpo"]["requests"][0]["content"]["parts"][0]["text"]
check("trecho gigante é cortado antes de virar gasto", len(t) <= 8000 + 30, len(t))

zerar()
r = client.post("/embeddar", json={"textos": ["x" * 7000] * 40}, headers=AUTH)
check("lote acima do teto de caracteres → 413 sem chamar o Gemini", r.status_code == 413 and not chamadas["gemini"], r.status_code)

zerar()
r = client.post("/embeddar", json={"textos": ["x"] * 101}, headers=AUTH)
check("mais de 100 trechos por lote → 422 do contrato", r.status_code == 422, r.status_code)

zerar()
r = client.post("/embeddar", json={"textos": []}, headers=AUTH)
check("lote vazio → 200 sem chamar o Gemini", r.status_code == 200 and r.json()["vetores"] == [] and not chamadas["gemini"])

# ─────────────────────────────────────────────────────────────
print("\n== 11. /entender-pergunta: só títulos saem do aparelho ==")
ACERVO = [{"id": "c-1", "titulo": "Sprint 14", "data": "2026-09-12", "idioma": "português", "minutos": 47},
          {"id": "c-2", "titulo": "Aula de fisiologia", "data": "2026-08-30", "idioma": "português", "minutos": 30}]
PERG_ACERVO = {"question": "o que foi dito sobre UX nas últimas 2 sprints?", "conversas": ACERVO}

zerar()
r = client.post("/entender-pergunta", json=PERG_ACERVO)
check("sem login → 401", r.status_code == 401)

zerar()
main._usuario_atual.set(None)
r = client.post("/entender-pergunta", json=PERG_ACERVO, headers=AUTH)
j = r.json()
check("Luna devolve o plano de busca", r.status_code == 200 and j["palavras"] == ["sprint", "usabilidade"]
      and j["conversas"] == ["c-1"] and j["recencia"] == 2, r.text[:250])
check("pergunta reescrita volta", j["pergunta"].startswith("o que foi dito sobre a UX"))
check("usage.modelo = gpt-5.6-luna", j["usage"]["modelo"] == "gpt-5.6-luna")
o = chamadas["openai"][0]
check("mesmo prompt medido no teste de recall (SYS_PLANNER)", o["messages"][0]["content"] == main.SYS_PLANNER)
check("pede JSON e raciocínio baixo", o["response_format"] == {"type": "json_object"} and o["reasoning_effort"] == "low")
enviado = o["messages"][1]["content"]
check("só título, data, idioma e duração vão junto", "Sprint 14" in enviado and "2026-09-12" in enviado and "47 min" in enviado)
check("NÃO consome pergunta do saldo (quem consome é a resposta)", not chamadas["rpc"], chamadas["rpc"])

zerar()
main._usuario_atual.set(None)
r = client.post("/entender-pergunta", json={**PERG_ACERVO, "history": [{"role": "user", "content": "e sobre o prazo?"}]}, headers=AUTH)
check("histórico entra para reescrever a pergunta", "e sobre o prazo?" in chamadas["openai"][0]["messages"][1]["content"])

zerar(openai="chave")
main._usuario_atual.set(None)
r = client.post("/entender-pergunta", json=PERG_ACERVO, headers=AUTH)
ev = chamadas["events"][0] if chamadas["events"] else {}
check("Luna cai e o Haiku entende a pergunta", r.status_code == 200 and r.json()["usage"]["modelo"] == "claude-haiku-4-5", r.text[:200])
check("fallback registrado como entender_pergunta", ev.get("props", {}).get("uso") == "entender_pergunta"
      and ev["props"]["assumiu"] == "claude-haiku-4-5", ev)
check("nenhum pedaço da chave no registro", "sk-" not in json.dumps(chamadas["events"]))

zerar(openai="planner_lixo")
main._usuario_atual.set(None)
r = client.post("/entender-pergunta", json=PERG_ACERVO, headers=AUTH)
check("JSON inválido do Luna também vira fallback", r.status_code == 200
      and chamadas["events"][0]["props"]["motivo"] == "JSON inválido", r.text[:160])

zerar(openai="chave", claude="erro")
main._usuario_atual.set(None)
r = client.post("/entender-pergunta", json=PERG_ACERVO, headers=AUTH)
j = r.json()
check("os dois caem → plano vazio, e não erro (a busca por palavra segue)",
      r.status_code == 200 and j["palavras"] == [] and j["recencia"] is None, r.text[:200])
check("a pergunta crua volta no lugar da reescrita", j["pergunta"] == PERG_ACERVO["question"])

zerar()
main._usuario_atual.set(None)
PLANO_RUIM = {"palavras": "não é lista", "conversas": None, "recencia": "duas", "desde": "ontem", "ate": "2026-09-01", "pergunta": ""}
_plano = main._plano_do_json(PLANO_RUIM, "pergunta original")
check("campo com tipo errado é ignorado, não derruba a busca",
      _plano == {"palavras": [], "conversas": [], "recencia": None, "desde": None,
                 "ate": "2026-09-01", "pergunta": "pergunta original"}, _plano)

# ─────────────────────────────────────────────────────────────
print("\n== 12. /chat-acervo: responde só com os trechos ==")
TRECHOS = [{"rotulo": "C1", "titulo": "Sprint 14", "data": "12/09/2026", "minuto": "14:32", "texto": "o botão de salvar ficou escondido"},
           {"rotulo": "C2", "titulo": "Sprint 13", "data": "05/09/2026", "minuto": "03:10", "texto": "a busca demora a responder"}]
PERG_GERAL = {"question": "o que foi dito sobre a UX?", "trechos": TRECHOS,
              "history": [{"role": "user", "content": "antes"}, {"role": "assistant", "content": "resp"}]}

zerar(plano="iniciante")
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
j = r.json()
check("Luna responde", r.status_code == 200 and j["answer"] == "Resposta do Luna", r.text[:200])
check("usage.modelo = gpt-5.6-luna", j["usage"]["modelo"] == "gpt-5.6-luna")
check("pergunta contada no MESMO saldo mensal do chat de conversa",
      chamadas["rpc"] == ["consumir_pergunta_mes"] and chamadas["rpc_args"][0]["p_limite"] == 60
      and chamadas["rpc_args"][0]["p_user_id"] == UID, chamadas["rpc_args"])
o = chamadas["openai"][0]
sistema = o["messages"][0]["content"]
check("regra de responder só com os trechos e citar o rótulo",
      "Responda SÓ com o que está nos trechos" in sistema and "[C1]" in sistema)
ultima = o["messages"][-1]["content"]
check("trechos rotulados com título, data e minuto", "[C1 · Sprint 14 · 12/09/2026 · 14:32]" in ultima
      and "o botão de salvar ficou escondido" in ultima, ultima[:200])
check("histórico antes da pergunta", [m["role"] for m in o["messages"][1:]] == ["user", "assistant", "user"])
check("nenhuma transcrição inteira sai do aparelho (só os trechos)", len(ultima) < 1000)

zerar(plano="iniciante")
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json={"question": "e sobre o prazo?", "trechos": []}, headers=AUTH)
check("busca sem resultado → o modelo é avisado disso, em vez de receber contexto vazio",
      r.status_code == 200 and "não encontrou nenhum trecho" in chamadas["openai"][0]["messages"][-1]["content"])

zerar(plano="iniciante", openai="chave")
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
ev = chamadas["events"][0] if chamadas["events"] else {}
check("Luna cai e o Haiku responde", r.status_code == 200 and r.json()["answer"] == "Resposta do Haiku")
check("fallback registrado como chat_acervo", ev.get("props", {}).get("uso") == "chat_acervo", ev)
check("a pergunta NÃO é devolvida (a reserva respondeu)", chamadas["rpc"] == ["consumir_pergunta_mes"])

zerar(plano="iniciante", openai="cortado", claude="erro")
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
check("os dois caem → 502", r.status_code == 502 and "Erro ao consultar IA" in r.text, r.text[:160])
check("e a pergunta volta pro saldo", chamadas["rpc"] == ["consumir_pergunta_mes", "devolver_pergunta_mes"], chamadas["rpc"])

zerar(plano="gratuito", saldo="limite")
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
check("saldo do mês acabou → 402 antes de qualquer IA",
      r.status_code == 402 and "5 perguntas deste mês" in r.text and not chamadas["openai"] and not chamadas["claude"], r.text[:200])

zerar(plano="gratuito", usadas=4)
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
check("grátis: a 4ª pergunta do mês deixa 1", r.status_code == 200 and r.json()["perguntas_restantes"] == 1, r.text[:200])

zerar(plano="avancado", usadas=300)
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
check("avançado: contado sem limite e sem saldo na resposta",
      r.status_code == 200 and r.json()["perguntas_restantes"] is None and chamadas["rpc_args"][0]["p_limite"] is None)

zerar(plano="iniciante")
main.OPENAI_API_KEY = ""
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json=PERG_GERAL, headers=AUTH)
main.OPENAI_API_KEY = "chave-openai-de-teste"
check("sem a chave da OpenAI vai direto ao Haiku, sem registrar fallback",
      r.status_code == 200 and not chamadas["openai"] and not chamadas["events"])

zerar(plano="iniciante")
main._usuario_atual.set(None)
r = client.post("/chat-acervo", json={"question": "x", "trechos": [dict(TRECHOS[0], texto="t") for _ in range(21)]}, headers=AUTH)
check("mais de 20 trechos por pergunta → 422 do contrato", r.status_code == 422, r.status_code)

print(f"\n{'TUDO CERTO' if not falhas else 'HOUVE FALHAS'} — {ok} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
