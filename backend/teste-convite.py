# Testa o convite premiado e o Avançado ilimitado sem rede: o Supabase é um
# dublê com tabelas em memória, que entende o pedaço do PostgREST que o
# backend usa (eq, is.null, not.is.null, ignore-duplicates, return=representation)
# e as duas funções de supabase/convites.sql.
#
# Rodar:  cd backend && python teste-convite.py

import asyncio
import datetime
import json
import os

os.environ["GROQ_API_KEY"] = "chave-de-teste"
os.environ["ANTHROPIC_API_KEY"] = "chave-de-teste"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-de-teste"
os.environ["RESEND_API_KEY"] = "resend-de-teste"

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


AGORA = datetime.datetime.now(tz=datetime.timezone.utc)
iso = lambda d: d.isoformat()  # noqa: E731

# Contas do dublê: token → usuário.
USUARIOS = {
    "tok-dono": {"id": "dono-1", "email": "ana.silva@gmail.com", "created_at": iso(AGORA - datetime.timedelta(days=90))},
    "tok-amigo": {"id": "amigo-1", "email": "bruno@exemplo.com", "created_at": iso(AGORA - datetime.timedelta(hours=2))},
    "tok-alias": {"id": "alias-1", "email": "anasilva+2@gmail.com", "created_at": iso(AGORA - datetime.timedelta(hours=1))},
    "tok-antigo": {"id": "antigo-1", "email": "carla@exemplo.com", "created_at": iso(AGORA - datetime.timedelta(days=30))},
    "tok-anon": {"id": "anon-1", "email": "", "created_at": iso(AGORA), "is_anonymous": True},
}
POR_ID = {u["id"]: u for u in USUARIOS.values()}

db = {}
emails = []
rpcs = []


def zerar():
    db.clear()
    db.update({"convite_codigos": [], "convites": [], "subscriptions": [], "uso_mensal": []})
    emails.clear()
    rpcs.clear()
    main._token_cache.clear()
    main._rate_hits.clear()


def filtra(linhas, params):
    fora = {"select", "limit", "order"}
    saida = []
    for linha in linhas:
        casa = True
        for campo, cond in params.items():
            if campo in fora:
                continue
            valor = linha.get(campo)
            if cond == "is.null":
                casa = casa and valor is None
            elif cond == "not.is.null":
                casa = casa and valor is not None
            elif cond.startswith("eq."):
                casa = casa and str(valor) == cond[3:]
            else:
                raise AssertionError(f"filtro desconhecido {campo}={cond}")
        if casa:
            saida.append(linha)
    if "limit" in params:
        saida = saida[: int(params["limit"])]
    return saida


CHAVES = {"convite_codigos": "user_id", "convites": "convidado_id", "subscriptions": "user_id", "uso_mensal": "user_id"}


def rpc(nome, args):
    rpcs.append((nome, args))
    if nome == "contar_captura_convite":
        for c in db["convites"]:
            if c["convidado_id"] == args["p_convidado"] and c["valido_em"] is None:
                c["capturas"] += 1
                if c["capturas"] >= args["p_meta"]:
                    c["valido_em"] = iso(datetime.datetime.now(tz=datetime.timezone.utc))
                    return c["dono_id"]
                return None
        return None
    if nome == "premiar_convite_minutos":
        fim = iso(AGORA + datetime.timedelta(days=20))
        linhas = [u for u in db["uso_mensal"] if u["user_id"] == args["p_user_id"]]
        if not linhas:
            db["uso_mensal"].append({"user_id": args["p_user_id"], "minutos_usados": 0, "perguntas_usadas": 0,
                                     "periodo_fim": fim, "minutos_extra": args["p_minutos"],
                                     "perguntas_extra": args["p_perguntas"], "extra_ate": fim})
        else:
            u = linhas[0]
            u["minutos_extra"] = (u.get("minutos_extra") or 0) + args["p_minutos"]
            u["perguntas_extra"] = (u.get("perguntas_extra") or 0) + args["p_perguntas"]
            u["extra_ate"] = u["periodo_fim"]
        return None
    return None


async def handler(request: httpx.Request):
    path = request.url.path
    params = dict(request.url.params)
    if request.url.host == "api.resend.com":
        emails.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "email-1"})
    if path == "/auth/v1/user":
        token = request.headers["authorization"][7:]
        u = USUARIOS.get(token)
        if not u:
            return httpx.Response(401)
        return httpx.Response(200, json={"is_anonymous": False, **u})
    if path.startswith("/auth/v1/admin/users/"):
        u = POR_ID.get(path.rsplit("/", 1)[1])
        return httpx.Response(200, json=u) if u else httpx.Response(404)
    if path.startswith("/rest/v1/rpc/"):
        return httpx.Response(200, json=rpc(path.rsplit("/", 1)[1], json.loads(request.content)))
    if path.startswith("/rest/v1/"):
        tabela = path.rsplit("/", 1)[1]
        linhas = db[tabela]
        if request.method == "GET":
            return httpx.Response(200, json=filtra(linhas, params))
        if request.method == "POST":
            nova = json.loads(request.content)
            chave = CHAVES[tabela]
            if any(l[chave] == nova[chave] for l in linhas):
                if "ignore-duplicates" in request.headers.get("prefer", ""):
                    return httpx.Response(201)
                return httpx.Response(409)
            if tabela == "convite_codigos" and any(l["codigo"] == nova["codigo"] for l in linhas):
                return httpx.Response(409)
            base = {"convites": {"capturas": 0, "valido_em": None, "premio": None, "visto_em": None},
                    "convite_codigos": {"apoiador_desde": None}}.get(tabela, {})
            linhas.append({**base, **nova})
            return httpx.Response(201)
        if request.method == "PATCH":
            mudou = filtra(linhas, params)
            for l in mudou:
                l.update(json.loads(request.content))
            return httpx.Response(200, json=mudou)
    return httpx.Response(404, json={"erro": f"dublê não conhece {request.method} {path}"})


_AsyncClientReal = httpx.AsyncClient


class AsyncClientDuble(_AsyncClientReal):
    def __init__(self, *a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        super().__init__(*a, **kw)


httpx.AsyncClient = AsyncClientDuble
client = TestClient(main.app)
H = lambda tok: {"Authorization": f"Bearer {tok}"}  # noqa: E731


def rodar(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def assinar(user_id, plano):
    db["subscriptions"].append({"user_id": user_id, "plano": plano, "status": "active",
                                "current_period_end": iso(AGORA + datetime.timedelta(days=20))})


# ─────────────────────────────────────────────────────────────
print("\n== 1. régua: Avançado ilimitado e recomendado ==")
zerar()
planos = {p["id"]: p for p in client.get("/planos").json()["planos"]}
check("avançado: ilimitado, com número alto para app antigo",
      planos["avancado"]["ilimitado"] is True and planos["avancado"]["minutos"] == main.MINUTOS_PARA_APP_ANTIGO)
check("grátis e iniciante continuam 100 e 250, sem ilimitado",
      (planos["gratuito"]["minutos"], planos["iniciante"]["minutos"]) == (100, 250)
      and not planos["gratuito"]["ilimitado"] and not planos["iniciante"]["ilimitado"])
check("cartão do avançado diz 'Minutos ilimitados'", "Minutos ilimitados" in planos["avancado"]["itens"], planos["avancado"]["itens"])
check("selo de recomendado no avançado, e só nele",
      [i for i, p in planos.items() if p["destaque"]] == ["avancado"])

zerar()
assinar("dono-1", "avancado")
db["uso_mensal"].append({"user_id": "dono-1", "minutos_usados": 5000, "periodo_fim": iso(AGORA + datetime.timedelta(days=5))})
saldo = rodar(main.ler_saldo("dono-1"))
check("saldo do avançado: limite None mesmo com 5000 min usados", saldo["minutos_limite"] is None, saldo)
try:
    main.recusar_se_nao_cabe(saldo, 600)
    check("captura de 10 h no avançado passa", True)
except main.HTTPException as e:
    check("captura de 10 h no avançado passa", False, e.detail)

zerar()
db["uso_mensal"].append({"user_id": "amigo-1", "minutos_usados": 99, "periodo_fim": iso(AGORA + datetime.timedelta(days=5))})
try:
    main.recusar_se_nao_cabe(rodar(main.ler_saldo("amigo-1")), 10)
    check("grátis sem bônus: 99 + 10 min não cabe", False)
except main.HTTPException as e:
    check("grátis sem bônus: 99 + 10 min não cabe", e.status_code == 402 and "restam 1 min" in e.detail, e.detail)

# ─────────────────────────────────────────────────────────────
print("\n== 2. bônus do mês ==")
zerar()
fim = iso(AGORA + datetime.timedelta(days=5))
db["uso_mensal"].append({"user_id": "amigo-1", "minutos_usados": 99, "periodo_fim": fim,
                         "minutos_extra": 25, "perguntas_extra": 2, "extra_ate": fim})
saldo = rodar(main.ler_saldo("amigo-1"))
check("bônus valendo soma ao limite (100 + 25)", saldo["minutos_limite"] == 125, saldo)
check("e às perguntas (5 + 2)", rodar(main.limite_de_perguntas("amigo-1", "gratuito")) == 7)
check("convidado sem conta não soma bônus", rodar(main.ler_saldo("amigo-1", convidado=True))["minutos_limite"] == main.LIMITE_CONVIDADO_MIN)

db["uso_mensal"][0]["extra_ate"] = iso(AGORA - datetime.timedelta(days=1))
check("bônus de ciclo passado não vale", rodar(main.ler_saldo("amigo-1"))["minutos_limite"] == 100)
check("nem nas perguntas", rodar(main.limite_de_perguntas("amigo-1", "gratuito")) == 5)
check("avançado: perguntas sem limite", rodar(main.limite_de_perguntas("amigo-1", "avancado")) is None)

# ─────────────────────────────────────────────────────────────
print("\n== 3. /convite/estado ==")
zerar()
r = client.post("/convite/estado")
check("sem login → 401", r.status_code == 401)
r = client.post("/convite/estado", headers=H("tok-anon"))
check("convidado sem conta → 401", r.status_code == 401)
r = client.post("/convite/estado", headers=H("tok-dono"))
j = r.json()
check("cria o código na primeira vez", r.status_code == 200 and len(j["codigo"]) == main.TAMANHO_CODIGO, r.text[:200])
check("link aponta para o site com ?c=", j["link"] == f"{main.FRONTEND_URL}/?c={j['codigo']}", j["link"])
check("regras vêm do servidor", j["regras"] == {"capturas": 3, "minutos": 25, "perguntas": 2, "apoiador": 5}, j["regras"])
check("sem amigos, sem novidade", j["validos"] == 0 and j["pendentes"] == 0 and j["novidade"] is None)
codigo = j["codigo"]
check("o mesmo código na segunda vez", client.post("/convite/estado", headers=H("tok-dono")).json()["codigo"] == codigo)

# ─────────────────────────────────────────────────────────────
print("\n== 4. /convite/aceitar ==")
r = client.post("/convite/aceitar", json={"codigo": "naoexiste"}, headers=H("tok-amigo"))
check("código que não existe → recusado", r.json() == {"aceito": False, "motivo": "codigo"}, r.text)
r = client.post("/convite/aceitar", json={"codigo": codigo}, headers=H("tok-dono"))
check("o próprio código → recusado", r.json()["motivo"] == "proprio", r.text)
r = client.post("/convite/aceitar", json={"codigo": codigo}, headers=H("tok-alias"))
check("mesma caixa de e-mail com + e ponto → recusado", r.json()["motivo"] == "proprio", r.text)
r = client.post("/convite/aceitar", json={"codigo": codigo}, headers=H("tok-antigo"))
check("conta de 30 dias → recusado", r.json()["motivo"] == "conta_antiga", r.text)
r = client.post("/convite/aceitar", json={"codigo": codigo.upper()}, headers=H("tok-amigo"))
check("conta nova, código em maiúscula → aceito", r.json() == {"aceito": True}, r.text)
check("gravou amigo → dono", db["convites"] == [{"convidado_id": "amigo-1", "dono_id": "dono-1", "capturas": 0,
                                                 "valido_em": None, "premio": None, "visto_em": None}], db["convites"])
client.post("/convite/aceitar", json={"codigo": codigo}, headers=H("tok-amigo"))
check("aceitar de novo não duplica", len(db["convites"]) == 1)
check("pendente aparece para o dono", client.post("/convite/estado", headers=H("tok-dono")).json()["pendentes"] == 1)

# ─────────────────────────────────────────────────────────────
print("\n== 5. três transcrições premiam quem convidou (Grátis) ==")
rodar(main.contar_captura_para_convite("amigo-1"))
rodar(main.contar_captura_para_convite("amigo-1"))
check("duas capturas: ainda não premia", not any(n == "premiar_convite_minutos" for n, _ in rpcs) and not emails)
rodar(main.contar_captura_para_convite("amigo-1"))
premios = [a for n, a in rpcs if n == "premiar_convite_minutos"]
check("terceira captura: bônus de 25 min e 2 perguntas para o dono",
      premios == [{"p_user_id": "dono-1", "p_minutos": 25, "p_perguntas": 2, "p_periodo_fim": None}], premios)
check("convite marcado com prêmio em minutos", db["convites"][0]["premio"] == "minutos" and db["convites"][0]["valido_em"])
check("e-mail para o dono, sem travessão nem exclamação",
      len(emails) == 1 and emails[0]["to"] == ["ana.silva@gmail.com"] and "25 minutos" in emails[0]["subject"]
      and not any(c in emails[0]["text"] for c in "—–!"), emails)
rodar(main.contar_captura_para_convite("amigo-1"))
check("quarta captura não premia de novo", len([n for n, _ in rpcs if n == "premiar_convite_minutos"]) == 1 and len(emails) == 1)
check("quem não entrou por convite: nada acontece",
      rodar(main.contar_captura_para_convite("dono-1")) is None and len(emails) == 1)

j = client.post("/convite/estado", headers=H("tok-dono")).json()
check("estado: 1 válido e a novidade de 25 min e 2 perguntas",
      j["validos"] == 1 and j["pendentes"] == 0 and j["novidade"] == {"amigos": 1, "minutos": 25, "perguntas": 2}, j)
check("o bônus entrou no saldo do dono", rodar(main.ler_saldo("dono-1"))["minutos_limite"] == 125)
client.post("/convite/visto", headers=H("tok-dono"))
check("depois de visto, a novidade some", client.post("/convite/estado", headers=H("tok-dono")).json()["novidade"] is None)

# ─────────────────────────────────────────────────────────────
print("\n== 6. Avançado: 5 amigos dão o selo de apoiador ==")
zerar()
assinar("dono-1", "avancado")
codigo = client.post("/convite/estado", headers=H("tok-dono")).json()["codigo"]
for i in range(5):
    db["convites"].append({"convidado_id": f"amigo-{i}", "dono_id": "dono-1", "capturas": 2,
                           "valido_em": None, "premio": None, "visto_em": None})
for i in range(4):
    rodar(main.contar_captura_para_convite(f"amigo-{i}"))
check("avançado não ganha minutos", not any(n == "premiar_convite_minutos" for n, _ in rpcs))
check("cada amigo vira progresso", [c["premio"] for c in db["convites"]] == ["progresso"] * 4 + [None])
check("e-mail de progresso com quanto falta", emails[-1]["subject"] == "Mais um amigo no Dito" and "Falta 1 " in emails[-1]["text"], emails[-1])
j = client.post("/convite/estado", headers=H("tok-dono")).json()
check("4 amigos: ainda sem selo", not j["apoiador"] and j["validos"] == 4 and j["novidade"]["minutos"] == 0, j)
rodar(main.contar_captura_para_convite("amigo-4"))
check("5º amigo: selo gravado", db["convite_codigos"][0]["apoiador_desde"] is not None)
check("e-mail do selo", emails[-1]["subject"] == "Você ganhou o selo de apoiador do Dito", emails[-1]["subject"])
check("estado mostra apoiador", client.post("/convite/estado", headers=H("tok-dono")).json()["apoiador"] is True)
n_emails = len(emails)
db["convites"].append({"convidado_id": "amigo-9", "dono_id": "dono-1", "capturas": 2,
                       "valido_em": None, "premio": None, "visto_em": None})
rodar(main.contar_captura_para_convite("amigo-9"))
check("6º amigo de quem já tem o selo: sem e-mail", len(emails) == n_emails)

zerar()
codigo = client.post("/convite/estado", headers=H("tok-dono")).json()["codigo"]
for i in range(5):
    db["convites"].append({"convidado_id": f"amigo-{i}", "dono_id": "dono-1", "capturas": 3,
                           "valido_em": iso(AGORA), "premio": "minutos", "visto_em": iso(AGORA)})
check("5 amigos no Grátis: sem selo", client.post("/convite/estado", headers=H("tok-dono")).json()["apoiador"] is False)
assinar("dono-1", "avancado")
check("assinou o Avançado depois: ganha o selo na próxima leitura",
      client.post("/convite/estado", headers=H("tok-dono")).json()["apoiador"] is True)

# ─────────────────────────────────────────────────────────────
print("\n== 7. falhas não derrubam nada ==")
zerar()
main.RESEND_API_KEY = ""
db["convite_codigos"].append({"user_id": "dono-1", "codigo": "abc2345", "apoiador_desde": None})
db["convites"].append({"convidado_id": "amigo-1", "dono_id": "dono-1", "capturas": 2,
                       "valido_em": None, "premio": None, "visto_em": None})
rodar(main.contar_captura_para_convite("amigo-1"))
check("sem chave do Resend: prêmio sai, e-mail não", db["convites"][0]["premio"] == "minutos" and not emails)

print()
if falhas:
    print(f"FALHOU — {ok} passaram, {falhas} falharam")
    raise SystemExit(1)
print(f"TUDO CERTO — {ok} passaram, 0 falharam")
