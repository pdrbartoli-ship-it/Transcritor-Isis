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

# Credenciais de notificação de mentira, mas de verdade no formato: o dublê do
# Google e o da Apple conferem a assinatura com a metade pública delas.
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402

CHAVE_GOOGLE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
CHAVE_APPLE = ec.generate_private_key(ec.SECP256R1())
pem = lambda k: k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,  # noqa: E731
                                serialization.NoEncryption()).decode()
os.environ["FCM_SERVICE_ACCOUNT"] = json.dumps({
    "project_id": "dito-teste", "client_email": "push@dito-teste.iam.gserviceaccount.com",
    "private_key": pem(CHAVE_GOOGLE), "token_uri": "https://oauth2.googleapis.com/token",
})
os.environ["APNS_KEY"] = pem(CHAVE_APPLE).replace("\n", "\\n")
os.environ["APNS_KEY_ID"] = "KEY123"
os.environ["APNS_TEAM_ID"] = "TEAM456"

import base64  # noqa: E402
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
pushes = []
rpcs = []


def zerar():
    db.clear()
    db.update({"convite_codigos": [], "convites": [], "subscriptions": [], "uso_mensal": [], "dispositivos": []})
    pushes.clear()
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


CHAVES = {"convite_codigos": "user_id", "convites": "convidado_id", "subscriptions": "user_id",
          "uso_mensal": "user_id", "dispositivos": "token"}
roteiro = {"fcm": "ok"}


def b64(parte):
    return base64.urlsafe_b64decode(parte + "=" * (-len(parte) % 4))


def jwt_confere(token, conferir):
    cab, corpo, assinatura = token.split(".")
    conferir(f"{cab}.{corpo}".encode(), b64(assinatura))
    return json.loads(b64(cab)), json.loads(b64(corpo))


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
    if request.url.host == "oauth2.googleapis.com":
        assercao = dict(p.split("=", 1) for p in request.content.decode().split("&"))["assertion"]
        _, corpo = jwt_confere(assercao, lambda d, a: CHAVE_GOOGLE.public_key().verify(a, d, padding.PKCS1v15(), hashes.SHA256()))
        assert corpo["scope"].endswith("firebase.messaging"), corpo
        return httpx.Response(200, json={"access_token": "acesso-google", "expires_in": 3600})
    if request.url.host == "fcm.googleapis.com":
        pushes.append({"via": "fcm", "url": str(request.url), "auth": request.headers["authorization"],
                       **json.loads(request.content)["message"]})
        if roteiro["fcm"] == "sumiu":
            return httpx.Response(404, json={"error": {"status": "NOT_FOUND", "details": [{"errorCode": "UNREGISTERED"}]}})
        return httpx.Response(200, json={"name": "projects/dito-teste/messages/1"})
    if request.url.host == "api.push.apple.com":
        cab, corpo = jwt_confere(
            request.headers["authorization"][7:],
            lambda d, a: CHAVE_APPLE.public_key().verify(
                encode_dss_signature(int.from_bytes(a[:32], "big"), int.from_bytes(a[32:], "big")), d, ec.ECDSA(hashes.SHA256())),
        )
        pushes.append({"via": "apns", "token": path.rsplit("/", 1)[1], "kid": cab["kid"], "iss": corpo["iss"],
                       "topic": request.headers["apns-topic"], **json.loads(request.content)})
        return httpx.Response(200)
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
        return httpx.Response(200, content=json.dumps(rpc(path.rsplit("/", 1)[1], json.loads(request.content))).encode(),
                              headers={"content-type": "application/json"})
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
                if "merge-duplicates" in request.headers.get("prefer", ""):
                    next(l for l in linhas if l[chave] == nova[chave]).update(nova)
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
        if request.method == "DELETE":
            for l in filtra(linhas, params):
                linhas.remove(l)
            return httpx.Response(204)
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
check("duas capturas: ainda não premia", not any(n == "premiar_convite_minutos" for n, _ in rpcs) and not pushes)
rodar(main.contar_captura_para_convite("amigo-1"))
premios = [a for n, a in rpcs if n == "premiar_convite_minutos"]
check("terceira captura: bônus de 25 min e 2 perguntas para o dono",
      premios == [{"p_user_id": "dono-1", "p_minutos": 25, "p_perguntas": 2, "p_periodo_fim": None}], premios)
check("convite marcado com prêmio em minutos", db["convites"][0]["premio"] == "minutos" and db["convites"][0]["valido_em"])
check("dono sem celular cadastrado: sem notificação", not pushes, pushes)
rodar(main.contar_captura_para_convite("amigo-1"))
check("quarta captura não premia de novo", len([n for n, _ in rpcs if n == "premiar_convite_minutos"]) == 1)
check("quem não entrou por convite: nada acontece",
      rodar(main.contar_captura_para_convite("dono-1")) is None and not pushes)

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
db["dispositivos"].append({"token": "fcm-token-do-avancado-0123456789", "user_id": "dono-1", "plataforma": "android"})
codigo = client.post("/convite/estado", headers=H("tok-dono")).json()["codigo"]
for i in range(5):
    db["convites"].append({"convidado_id": f"amigo-{i}", "dono_id": "dono-1", "capturas": 2,
                           "valido_em": None, "premio": None, "visto_em": None})
for i in range(4):
    rodar(main.contar_captura_para_convite(f"amigo-{i}"))
check("avançado não ganha minutos", not any(n == "premiar_convite_minutos" for n, _ in rpcs))
check("cada amigo vira progresso", [c["premio"] for c in db["convites"]] == ["progresso"] * 4 + [None])
check("notificação de progresso com quanto falta",
      pushes[-1]["notification"] == {"title": "Um amigo entrou pelo seu convite", "body": "Falta 1 para o selo de apoiador."},
      pushes[-1] if pushes else None)
j = client.post("/convite/estado", headers=H("tok-dono")).json()
check("4 amigos: ainda sem selo", not j["apoiador"] and j["validos"] == 4 and j["novidade"]["minutos"] == 0, j)
rodar(main.contar_captura_para_convite("amigo-4"))
check("5º amigo: selo gravado", db["convite_codigos"][0]["apoiador_desde"] is not None)
check("notificação do selo", pushes[-1]["notification"]["title"] == "Você ganhou o selo de apoiador", pushes[-1])
check("estado mostra apoiador", client.post("/convite/estado", headers=H("tok-dono")).json()["apoiador"] is True)
n_pushes = len(pushes)
db["convites"].append({"convidado_id": "amigo-9", "dono_id": "dono-1", "capturas": 2,
                       "valido_em": None, "premio": None, "visto_em": None})
rodar(main.contar_captura_para_convite("amigo-9"))
check("6º amigo de quem já tem o selo: sem notificação", len(pushes) == n_pushes)

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
print("\n== 7. notificação no celular ==")
zerar()
TOKEN_ANDROID = "fcm-token-do-celular-android-0123456789"
TOKEN_IPHONE = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
r = client.post("/push/registrar", json={"token": TOKEN_ANDROID, "plataforma": "android"})
check("registrar sem login → 401", r.status_code == 401)
r = client.post("/push/registrar", json={"token": TOKEN_ANDROID, "plataforma": "android"}, headers=H("tok-anon"))
check("registrar sem conta (convidado) → 401", r.status_code == 401)
r = client.post("/push/registrar", json={"token": TOKEN_ANDROID, "plataforma": "windows"}, headers=H("tok-dono"))
check("plataforma que não é celular → 422", r.status_code == 422)
client.post("/push/registrar", json={"token": TOKEN_ANDROID, "plataforma": "android"}, headers=H("tok-dono"))
client.post("/push/registrar", json={"token": TOKEN_IPHONE, "plataforma": "ios"}, headers=H("tok-dono"))
check("dois celulares cadastrados para o dono",
      sorted((d["plataforma"], d["user_id"]) for d in db["dispositivos"]) == [("android", "dono-1"), ("ios", "dono-1")])
client.post("/push/registrar", json={"token": TOKEN_ANDROID, "plataforma": "android"}, headers=H("tok-dono"))
check("registrar de novo não duplica", len(db["dispositivos"]) == 2)

db["convite_codigos"].append({"user_id": "dono-1", "codigo": "abc2345", "apoiador_desde": None})
db["convites"].append({"convidado_id": "amigo-1", "dono_id": "dono-1", "capturas": 2,
                       "valido_em": None, "premio": None, "visto_em": None})
rodar(main.contar_captura_para_convite("amigo-1"))
fcm = [p for p in pushes if p["via"] == "fcm"]
apns = [p for p in pushes if p["via"] == "apns"]
check("Android: FCM com o token do aparelho e credencial assinada",
      len(fcm) == 1 and fcm[0]["token"] == TOKEN_ANDROID and fcm[0]["auth"] == "Bearer acesso-google"
      and fcm[0]["url"].endswith("/projects/dito-teste/messages:send"), fcm)
check("Android: título, corpo, canal e cor",
      fcm[0]["notification"] == {"title": "Você ganhou 25 minutos e 2 perguntas", "body": "Um amigo começou a usar o Dito pelo seu convite."}
      and fcm[0]["android"]["notification"] == {"channel_id": "convites", "color": "#1a5c4e"}, fcm[0])
check("iPhone: APNs com o token, o tópico do app e JWT ES256 válido",
      len(apns) == 1 and apns[0]["token"] == TOKEN_IPHONE and apns[0]["topic"] == "br.com.albiecloud.dito"
      and apns[0]["kid"] == "KEY123" and apns[0]["iss"] == "TEAM456", apns)
check("iPhone: mesmo texto do Android", apns[0]["aps"]["alert"] == {"title": fcm[0]["notification"]["title"], "body": fcm[0]["notification"]["body"]})
check("textos sem travessão nem exclamação",
      not any(c in p["notification"]["title"] + p["notification"]["body"] for p in fcm for c in "—–!"))

zerar()
roteiro["fcm"] = "sumiu"
db["dispositivos"].append({"token": TOKEN_ANDROID, "user_id": "dono-1", "plataforma": "android"})
rodar(main.enviar_notificacao(TOKEN_ANDROID, "android", "t", "c"))
check("token que o Google não conhece mais sai da lista", db["dispositivos"] == [])
roteiro["fcm"] = "ok"

zerar()
db["dispositivos"].append({"token": TOKEN_ANDROID, "user_id": "dono-1", "plataforma": "android"})
client.post("/push/remover", json={"token": TOKEN_ANDROID}, headers=H("tok-amigo"))
check("remover o token de outra conta não apaga", len(db["dispositivos"]) == 1)
client.post("/push/remover", json={"token": TOKEN_ANDROID}, headers=H("tok-dono"))
check("sair da conta tira o celular da lista", db["dispositivos"] == [])

print("\n== 8. falhas não derrubam nada ==")
zerar()
main.FCM_SERVICE_ACCOUNT = ""
main.APNS_KEY = ""
main._credenciais_push.clear()
db["dispositivos"].append({"token": TOKEN_ANDROID, "user_id": "dono-1", "plataforma": "android"})
db["dispositivos"].append({"token": TOKEN_IPHONE, "user_id": "dono-1", "plataforma": "ios"})
db["convite_codigos"].append({"user_id": "dono-1", "codigo": "abc2345", "apoiador_desde": None})
db["convites"].append({"convidado_id": "amigo-1", "dono_id": "dono-1", "capturas": 2,
                       "valido_em": None, "premio": None, "visto_em": None})
rodar(main.contar_captura_para_convite("amigo-1"))
check("sem credenciais de notificação: prêmio sai, notificação não", db["convites"][0]["premio"] == "minutos" and not pushes)

print()
if falhas:
    print(f"FALHOU — {ok} passaram, {falhas} falharam")
    raise SystemExit(1)
print(f"TUDO CERTO — {ok} passaram, 0 falharam")
