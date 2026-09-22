"""Motor do teste-qualidade: roda a extração de insights (e opcionalmente o chat)
de um mesmo material em vários modelos, usando o prompt, o schema e a função de
produção do backend do Dito (importados de verdade, nunca recriados à mão).

O material testado pode ser QUALQUER coisa que o Dito aceita: um link (YouTube
e outros sites, via /process-url) ou um arquivo local de áudio/vídeo — gravação,
áudio de WhatsApp, aula baixada, o que for — via /transcribe, a mesma rota que
o app usa quando alguém grava ou envia um arquivo.

Cada teste vive em casos/<slug>/:
  origem.txt             — o link ou caminho do arquivo testado (uma linha)
  transcricao_backend.json  — a transcrição que veio do backend (gerada por `buscar`)
  precos.json           — preço por milhão de tokens de cada modelo candidato, conferido
                           na página oficial no dia do teste (ver SKILL.md)
  referencia.py         — GT_TURNOS/GT_SECOES/DUR, escrito à mão lendo o material (ver score.py)
  perguntas.json         — (opcional) perguntas de chat com resposta conhecida
  out/                  — resultado de cada modelo (criado pelos comandos abaixo)

Uso:
  python3 harness.py buscar   <slug> <url-ou-caminho-de-arquivo> [completa|simples]
  python3 harness.py extrair  <slug> <modelo> [modelo...] [--tag=__r1]
  python3 harness.py simples  <slug> <modelo> [modelo...] [--tag=__r1]
  python3 harness.py curto    <slug> <segundos> <modelo> [modelo...]
  python3 harness.py chat     <slug> <modelo> [modelo...]
"""
import asyncio, json, mimetypes, os, sys, time
import httpx

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
sys.path.insert(0, "/workspaces/Transcritor-Isis/backend")
from sessao import login, B, user_id  # noqa: E402

KEYS_CACHE = {}


def caso_dir(slug):
    d = os.path.join(SKILL_DIR, "casos", slug)
    os.makedirs(os.path.join(d, "out"), exist_ok=True)
    return d


def carregar_keys(slug):
    if slug not in KEYS_CACHE:
        p = os.path.join(caso_dir(slug), "keys.env")
        KEYS_CACHE[slug] = dict(l.strip().split("=", 1) for l in open(p) if "=" in l and not l.startswith("#"))
    return KEYS_CACHE[slug]


def carregar_precos(slug):
    """{modelo: [preco_entrada, preco_saida, preco_leitura_cache]} em US$ por milhão de tokens."""
    return json.load(open(os.path.join(caso_dir(slug), "precos.json")))


def carregar_transcricao(slug):
    j = json.load(open(os.path.join(caso_dir(slug), "transcricao_backend.json")))
    return j["transcript"], j["segments"], j.get("title"), j.get("duration_s")


def prompt_producao(m, transcript, segments, idioma="auto"):
    body = m.format_timed_transcript(segments) or transcript
    system = f"{m.instrucoes_insights(idioma)}\n\nFormato esperado (schema JSON):\n{json.dumps(m.INSIGHTS_SCHEMA, ensure_ascii=False)}"
    return system, f"Transcrição:\n{body}"


def custo(precos, modelo, tin, tout, cache_read=0, cache_write=0):
    pin, pout, pcache = precos[modelo]
    # escrita de cache: 1,25x o preço de entrada é a convenção da Anthropic (TTL de 5 min);
    # pra modelos sem escrita de cache paga (a maioria hoje), cache_write vem sempre 0.
    return (tin - cache_read - cache_write) * pin / 1e6 + cache_read * pcache / 1e6 + cache_write * pin * 1.25 / 1e6 + tout * pout / 1e6


# ---------- buscar: pega a transcrição de verdade pelo backend do Dito ----------
def eh_url(origem):
    return origem.startswith("http://") or origem.startswith("https://")


def buscar(slug, origem, modo="simples"):
    """`origem` é um link (YouTube e outros — vai por /process-url, a mesma rota
    de "colar um link" no app) ou o caminho de um arquivo de áudio/vídeo local
    (grava, WhatsApp, aula baixada — vai por /transcribe, a mesma rota de gravar
    ou enviar um arquivo no app). modo='completa' só funciona com a conta de
    teste no plano Avançado (ver SKILL.md)."""
    _, _, H = login()
    t0 = time.time()
    d = caso_dir(slug)
    if eh_url(origem):
        r = httpx.post(B + "/process-url", headers=H, data={"url": origem, "mode": modo, "language": "auto"}, timeout=900)
        open(os.path.join(d, "origem.txt"), "w").write(f"url: {origem}\n")
    else:
        if not os.path.isfile(origem):
            raise FileNotFoundError(f"{origem!r} não é uma URL (não começa com http) nem um arquivo que existe")
        nome = os.path.basename(origem)
        mime = mimetypes.guess_type(nome)[0] or "application/octet-stream"
        with open(origem, "rb") as f:
            r = httpx.post(B + "/transcribe", headers=H, files={"file": (nome, f, mime)}, data={"mode": modo, "language": "auto"}, timeout=900)
        open(os.path.join(d, "origem.txt"), "w").write(f"arquivo: {origem}\n")
    j = r.json()
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code} {j}")
    json.dump(j, open(os.path.join(d, "transcricao_backend.json"), "w"), ensure_ascii=False, indent=1)
    print(f"ok em {time.time()-t0:.1f}s | modo={j.get('mode')} | duracao_s={j.get('duration_s')} | "
          f"{len(j['segments'])} trechos | {len(j['transcript'])} chars | titulo: {j.get('title')}")
    if modo == "completa":
        u = j["usage"]
        tin = u["input_tokens"] + u["cache_read_tokens"] + u["cache_write_tokens"]
        res = {"modelo": "claude-sonnet-5", "origem": "backend de produção", "segundos": round(time.time() - t0, 1),
               "uso": {"input": tin, "output": u["output_tokens"], "cache_read": u["cache_read_tokens"], "cache_write": u["cache_write_tokens"]},
               "insights": j["insights"]}
        json.dump(res, open(os.path.join(d, "out", "claude-sonnet-5__producao.json"), "w"), ensure_ascii=False, indent=1)
        print("(saída do Sonnet em produção também salva, já que o modo foi completa)")


# ---------- runners: um por fornecedor, todos devolvem (data, uso) ----------
# `schema`/`max_tokens` vazios = os da extração completa; o modo simples passa os dele.
async def rodar_claude(slug, modelo, system, user, m, schema=None, max_tokens=None):
    keys = carregar_keys(slug)
    os.environ["ANTHROPIC_API_KEY"] = keys["ANTHROPIC_API_KEY"]
    m.ANTHROPIC_API_KEY = keys["ANTHROPIC_API_KEY"]
    effort = m.INSIGHTS_EFFORT if modelo == "claude-sonnet-5" else None
    instr = system.split("\n\nFormato esperado (schema JSON):")[0]
    data, tin, tout, cread, cwrite = await m.call_insights(instr, user, schema or m.INSIGHTS_SCHEMA,
        max_tokens=max_tokens or m.INSIGHTS_MAX_TOKENS, effort=effort, model=modelo)
    return data, {"input": tin + cread + cwrite, "output": tout, "cache_read": cread, "cache_write": cwrite}


async def rodar_openai(slug, modelo, system, user, m, schema=None, max_tokens=None):
    keys = carregar_keys(slug)
    async with httpx.AsyncClient(timeout=600) as c:
        r = await c.post("https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {keys['OPENAI_API_KEY']}"},
            json={"model": modelo,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                  "response_format": {"type": "json_schema", "json_schema": {"name": "insights", "schema": schema or m.INSIGHTS_SCHEMA, "strict": True}},
                  "reasoning_effort": "low", "max_completion_tokens": max_tokens or m.INSIGHTS_MAX_TOKENS})
    j = r.json()
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code} {json.dumps(j)[:500]}")
    u = j["usage"]; choice = j["choices"][0]
    if choice.get("finish_reason") != "stop":
        raise RuntimeError(f"finish_reason={choice.get('finish_reason')}")
    return json.loads(choice["message"]["content"]), {
        "input": u["prompt_tokens"], "output": u["completion_tokens"],
        "cache_read": (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0), "cache_write": 0}


async def rodar_gemini(slug, modelo, system, user, m, schema=None, max_tokens=None):
    keys = carregar_keys(slug)
    async with httpx.AsyncClient(timeout=600) as c:
        r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
            headers={"x-goog-api-key": keys["GEMINI_API_KEY"]},
            json={"systemInstruction": {"parts": [{"text": system}]},
                  "contents": [{"role": "user", "parts": [{"text": user}]}],
                  "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": schema or m.INSIGHTS_SCHEMA,
                                       "maxOutputTokens": max_tokens or m.INSIGHTS_MAX_TOKENS, "thinkingConfig": {"thinkingLevel": "low"}}})
    j = r.json()
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code} {json.dumps(j)[:500]}")
    cand = j["candidates"][0]
    if cand.get("finishReason") != "STOP":
        raise RuntimeError(f"finishReason={cand.get('finishReason')}")
    text = "".join(p.get("text", "") for p in cand["content"]["parts"] if not p.get("thought"))
    u = j.get("usageMetadata", {}); thoughts = u.get("thoughtsTokenCount", 0)
    return json.loads(text), {"input": u.get("promptTokenCount", 0), "output": u.get("candidatesTokenCount", 0) + thoughts,
                              "cache_read": u.get("cachedContentTokenCount", 0), "cache_write": 0}


def runner_de(modelo):
    if modelo.startswith("claude"):
        return rodar_claude
    if modelo.startswith("gpt") or modelo.startswith("o"):
        return rodar_openai
    if modelo.startswith("gemini"):
        return rodar_gemini
    raise ValueError(f"não sei de qual fornecedor é o modelo {modelo!r} — ajuste runner_de()")


# ---------- extrair: a extração completa, com o texto inteiro ----------
async def extrair(slug, modelo, tag=""):
    import main as m
    transcript, segments, _, _ = carregar_transcricao(slug)
    precos = carregar_precos(slug)
    system, user = prompt_producao(m, transcript, segments)
    t0 = time.time()
    try:
        data, uso = await runner_de(modelo)(slug, modelo, system, user, m)
        erro = None
    except Exception as e:
        data, uso, erro = None, None, repr(e)[:600]
    res = {"modelo": modelo, "segundos": round(time.time() - t0, 1), "erro": erro, "uso": uso}
    if data is not None:
        res["custo_usd"] = custo(precos, modelo, uso["input"], uso["output"], uso["cache_read"], uso["cache_write"])
        res["insights"] = m.normalize_insights(data, segments)
    json.dump(res, open(os.path.join(caso_dir(slug), "out", f"{modelo}{tag}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "insights"}, ensure_ascii=False))
    return res


# ---------- simples: o resumo curto do modo simples (título + tópicos) ----------
async def resumir(slug, modelo, tag=""):
    """Mesmo texto que `simple_summary` de produção manda: instruções do modo
    simples + schema, e a transcrição corrida (sem marcadores de tempo)."""
    import main as m
    transcript, _, _, _ = carregar_transcricao(slug)
    precos = carregar_precos(slug)
    schema = m.SIMPLE_SUMMARY_SCHEMA
    system = f"{m.instrucoes_resumo_simples(m.IDIOMA_AUTO)}\n\nFormato esperado (schema JSON):\n{json.dumps(schema, ensure_ascii=False)}"
    t0 = time.time()
    try:
        data, uso = await runner_de(modelo)(slug, modelo, system, f"Transcrição:\n{transcript}", m,
                                            schema=schema, max_tokens=m.SIMPLE_SUMMARY_MAX_TOKENS)
        erro = None
    except Exception as e:
        data, uso, erro = None, None, repr(e)[:600]
    res = {"modelo": modelo, "segundos": round(time.time() - t0, 1), "erro": erro, "uso": uso, "resumo": data}
    if data is not None:
        res["custo_usd"] = custo(precos, modelo, uso["input"], uso["output"], uso["cache_read"], uso["cache_write"])
    json.dump(res, open(os.path.join(caso_dir(slug), "out", f"{modelo}__simples{tag}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "resumo"}, ensure_ascii=False))
    return res


# ---------- curto: só os primeiros N segundos — estressa o custo fixo do prompt ----------
async def extrair_curto(slug, segundos, modelo):
    import main as m
    transcript, segments, _, _ = carregar_transcricao(slug)
    precos = carregar_precos(slug)
    segs = [s for s in segments if s["end"] <= segundos]
    if not segs:
        raise ValueError(f"nenhum segmento cabe em {segundos}s — vídeo curto demais ou parâmetro errado")
    system, user = prompt_producao(m, " ".join(s["text"] for s in segs), segs)
    t0 = time.time()
    data, uso = await runner_de(modelo)(slug, modelo, system, user, m)
    res = {"modelo": modelo, "segundos_audio": segs[-1]["end"], "segundos": round(time.time() - t0, 1), "uso": uso,
           "custo_usd": custo(precos, modelo, uso["input"], uso["output"], uso["cache_read"], uso["cache_write"]),
           "insights": m.normalize_insights(data, segs)}
    json.dump(res, open(os.path.join(caso_dir(slug), "out", f"{modelo}__curto{segundos}s.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "insights"}, ensure_ascii=False))


# ---------- chat: mesmo prompt de sistema da rota /chat de produção ----------
def regras_chat():
    src = open("/workspaces/Transcritor-Isis/backend/main.py").read()
    return "A transcrição acima é a fonte de verdade" + src.split('"text": """A transcrição acima é a fonte de verdade')[1].split('""",')[0]


async def perguntar(slug, modelo, pergunta, transcript, titulo):
    precos = carregar_precos(slug)
    keys = carregar_keys(slug)
    s1 = f'Você conhece a fundo esta conversa transcrita e responde perguntas sobre ela.\n\nTítulo: {titulo}\n\nTranscrição completa:\n"""\n{transcript}\n"""'
    s2 = regras_chat()
    async with httpx.AsyncClient(timeout=300) as c:
        if modelo.startswith("claude"):
            r = await c.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key": keys["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
                json={"model": modelo, "max_tokens": 2048,
                      "system": [{"type": "text", "text": s1, "cache_control": {"type": "ephemeral"}}, {"type": "text", "text": s2}],
                      "messages": [{"role": "user", "content": pergunta}]})
            j = r.json(); u = j["usage"]
            txt = "".join(b.get("text", "") for b in j["content"] if b["type"] == "text")
            cr, cw = u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0)
            uso = {"input": u["input_tokens"] + cr + cw, "output": u["output_tokens"], "cache_read": cr, "cache_write": cw}
        elif modelo.startswith("gpt"):
            r = await c.post("https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {keys['OPENAI_API_KEY']}"},
                json={"model": modelo, "reasoning_effort": "low", "max_completion_tokens": 4096,
                      "messages": [{"role": "system", "content": s1 + "\n\n" + s2}, {"role": "user", "content": pergunta}]})
            j = r.json(); u = j["usage"]
            txt = j["choices"][0]["message"]["content"]
            uso = {"input": u["prompt_tokens"], "output": u["completion_tokens"], "cache_read": (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0), "cache_write": 0}
        else:
            r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
                headers={"x-goog-api-key": keys["GEMINI_API_KEY"]},
                json={"systemInstruction": {"parts": [{"text": s1 + "\n\n" + s2}]},
                      "contents": [{"role": "user", "parts": [{"text": pergunta}]}],
                      "generationConfig": {"maxOutputTokens": 4096, "thinkingConfig": {"thinkingLevel": "low"}}})
            j = r.json(); u = j.get("usageMetadata", {})
            txt = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"] if not p.get("thought"))
            uso = {"input": u.get("promptTokenCount", 0), "output": u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0),
                   "cache_read": u.get("cachedContentTokenCount", 0), "cache_write": 0}
    if r.status_code != 200:
        raise RuntimeError(f"{modelo} {r.status_code} {r.text[:300]}")
    return {"pergunta": pergunta, "resposta": txt, "uso": uso, "custo_usd": custo(precos, modelo, uso["input"], uso["output"], uso["cache_read"], uso["cache_write"])}


async def chat_modelo(slug, modelo):
    transcript, _, titulo, _ = carregar_transcricao(slug)
    perguntas = json.load(open(os.path.join(caso_dir(slug), "perguntas.json")))
    res = [await perguntar(slug, modelo, p, transcript, titulo) for p in perguntas]
    json.dump(res, open(os.path.join(caso_dir(slug), "out", f"{modelo}__chat.json"), "w"), ensure_ascii=False, indent=1)
    print(modelo, "chat ok | custo total US$", round(sum(x["custo_usd"] for x in res), 5), "| cache lido por pergunta:", [x["uso"]["cache_read"] for x in res])


async def em_paralelo(coros):
    # asyncio.run() só aceita corrotina; um gather() criado fora do loop quebra no Python 3.12+
    return await asyncio.gather(*coros)


if __name__ == "__main__":
    # `--tag=__r1` / `--tag=__r2` separam as rodadas (o arquivo de saída ganha o sufixo)
    tag = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--tag=")), "")
    cmd, *args = [a for a in sys.argv[1:] if not a.startswith("--tag=")]
    if cmd == "buscar":
        slug, url, *resto = args
        buscar(slug, url, resto[0] if resto else "simples")
    elif cmd == "extrair":
        slug, *modelos = args
        asyncio.run(em_paralelo([extrair(slug, mo, tag) for mo in modelos]))
    elif cmd == "simples":
        slug, *modelos = args
        asyncio.run(em_paralelo([resumir(slug, mo, tag) for mo in modelos]))
    elif cmd == "curto":
        slug, seg, *modelos = args
        asyncio.run(em_paralelo([extrair_curto(slug, int(seg), mo) for mo in modelos]))
    elif cmd == "chat":
        slug, *modelos = args
        asyncio.run(em_paralelo([chat_modelo(slug, mo) for mo in modelos]))
    else:
        print(__doc__)
