# Testa a assinatura pelas lojas sem rede: o Supabase e o RevenueCat são dublês.
# Cada cenário monta o estado que o RevenueCat mostraria naquele momento (o que a
# Apple já decidiu) e manda o aviso que chega ao webhook, na ordem em que a Apple
# manda. Confere o plano gravado depois de cada aviso.
#
# São as regras pedidas no teste de 05/10:
#   7.1 descer de plano só vale no fim do período pago;
#   7.2 cancelar mantém o acesso até o fim do período;
#   7.3 subir de plano vale na hora.
# E os dois defeitos vistos ao vivo: a troca de dono e a conta apagada.
#
# Rodar:  cd backend && python teste-loja.py

import datetime
import json
import os

os.environ["GROQ_API_KEY"] = "chave-de-teste"
os.environ["ANTHROPIC_API_KEY"] = "chave-de-teste"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-de-teste"
os.environ["REVENUECAT_WEBHOOK_TOKEN"] = "token-do-webhook"

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


def em(**kw):
    return (AGORA + datetime.timedelta(**kw)).strftime("%Y-%m-%dT%H:%M:%SZ")


ANA = "11111111-1111-4111-8111-111111111111"
BRUNO = "22222222-2222-4222-8222-222222222222"
CARLA = "33333333-3333-4333-8333-333333333333"
APAGADA = "99999999-9999-4999-8999-999999999999"
# Contas que existem em auth.users. A APAGADA não está aqui: gravar para ela
# esbarra na chave estrangeira, como no banco de verdade.
EXISTENTES = {ANA, BRUNO, CARLA}
TOKENS = {"tok-ana": ANA, "tok-bruno": BRUNO}

P = "br.com.albiecloud.dito."
db = {"subscriptions": []}
loja = {}  # user_id → {produto: assinatura no formato do RevenueCat v1}
roteiro = {"revenuecat": "ok"}
chamadas_rc = []


def zerar():
    db["subscriptions"].clear()
    loja.clear()
    chamadas_rc.clear()
    roteiro["revenuecat"] = "ok"
    main._token_cache.clear()


def assinatura(expira, loja_nome="app_store", **extra):
    return {
        "expires_date": expira, "grace_period_expires_date": None, "refunded_at": None,
        "billing_issues_detected_at": None, "unsubscribe_detected_at": None,
        "store": loja_nome, "is_sandbox": True, "purchase_date": em(days=-1), **extra,
    }


def linha(user_id):
    return next((l for l in db["subscriptions"] if l["user_id"] == user_id), None)


async def handler(request: httpx.Request):
    path = request.url.path
    if request.url.host == "api.revenuecat.com":
        user_id = path.rsplit("/", 1)[1]
        chamadas_rc.append(user_id)
        assert request.headers["authorization"] == f"Bearer {main.REVENUECAT_CHAVE_PUBLICA}"
        if roteiro["revenuecat"] == "fora":
            return httpx.Response(500, json={"message": "erro interno"})
        # Quem o RevenueCat nunca viu é criado na primeira consulta, com 201.
        return httpx.Response(200 if user_id in loja else 201, json={"subscriber": {
            "original_app_user_id": user_id, "subscriptions": loja.get(user_id, {}),
        }})
    if path == "/auth/v1/user":
        uid = TOKENS.get(request.headers["authorization"][7:])
        if not uid:
            return httpx.Response(401)
        return httpx.Response(200, json={"id": uid, "email": f"{uid[:4]}@exemplo.com", "is_anonymous": False})
    if path == "/rest/v1/subscriptions":
        if request.method == "GET":
            uid = dict(request.url.params)["user_id"][3:]
            l = linha(uid)
            return httpx.Response(200, json=[l] if l else [])
        if request.method == "POST":
            nova = json.loads(request.content)
            if nova["user_id"] not in EXISTENTES:
                return httpx.Response(409, json={
                    "code": "23503",
                    "message": 'insert or update on table "subscriptions" violates foreign key constraint',
                })
            atual = linha(nova["user_id"])
            if atual:
                atual.update(nova)
            else:
                db["subscriptions"].append(nova)
            return httpx.Response(201)
    return httpx.Response(404, json={"erro": f"dublê não conhece {request.method} {path}"})


_AsyncClientReal = httpx.AsyncClient


class AsyncClientDuble(_AsyncClientReal):
    def __init__(self, *a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        super().__init__(*a, **kw)


httpx.AsyncClient = AsyncClientDuble
client = TestClient(main.app)


def aviso(tipo, user_id=None, **extra):
    corpo = {"event": {"type": tipo, "app_user_id": user_id, "environment": "SANDBOX",
                       "store": "APP_STORE", "original_transaction_id": "2000001245553799", **extra}}
    return client.post("/billing/webhook-loja", json=corpo, headers={"Authorization": "token-do-webhook"})


def plano(user_id):
    l = linha(user_id) or {}
    return (l.get("plano"), l.get("ciclo"), l.get("status"))


print("\nCompra nova")
zerar()
loja[ANA] = {P + "iniciante.mensal": assinatura(em(days=30))}
r = aviso("INITIAL_PURCHASE", ANA, product_id=P + "iniciante.mensal")
check("webhook responde 200", r.status_code == 200, r.text)
check("Grátis → Iniciante mensal vale na hora", plano(ANA) == ("iniciante", "mensal", "active"), plano(ANA))
check("origem é a Apple", linha(ANA)["origem"] == "apple")
check("guarda o id original da compra", linha(ANA)["loja_assinatura_id"] == "2000001245553799")
check("fim do período vem da loja", linha(ANA)["current_period_end"].startswith(em(days=30)[:16]), linha(ANA)["current_period_end"])

print("\n7.3 · Iniciante → Avançado vale na hora")
zerar()
loja[ANA] = {P + "iniciante.mensal": assinatura(em(days=15))}
aviso("INITIAL_PURCHASE", ANA)
# A Apple encerra o Iniciante no momento da troca e começa o Avançado.
loja[ANA] = {
    P + "iniciante.mensal": assinatura(em(seconds=-5)),
    P + "avancado.mensal": assinatura(em(days=30)),
}
aviso("PRODUCT_CHANGE", ANA, product_id=P + "iniciante.mensal", new_product_id=P + "avancado.mensal")
check("passa para o Avançado na hora", plano(ANA) == ("avancado", "mensal", "active"), plano(ANA))
# Se o RevenueCat ainda mostrar o Iniciante valendo por alguns segundos, vale o mais alto.
loja[ANA][P + "iniciante.mensal"] = assinatura(em(days=15))
aviso("RENEWAL", ANA)
check("com as duas valendo, fica o plano mais alto", plano(ANA)[0] == "avancado", plano(ANA))

print("\n7.1 · Avançado → Iniciante só no fim do período (o defeito de 05/10)")
zerar()
loja[ANA] = {P + "avancado.mensal": assinatura(em(days=15))}
aviso("INITIAL_PURCHASE", ANA)
# A Apple agenda: o Avançado continua valendo até vencer.
r = aviso("PRODUCT_CHANGE", ANA, product_id=P + "avancado.mensal", new_product_id=P + "iniciante.mensal")
check("webhook responde 200", r.status_code == 200, r.text)
check("continua no Avançado depois de escolher o Iniciante", plano(ANA) == ("avancado", "mensal", "active"), plano(ANA))
check("com o fim do período pago", linha(ANA)["current_period_end"].startswith(em(days=15)[:16]))
# Na renovação, o Avançado venceu e o Iniciante começou.
loja[ANA] = {
    P + "avancado.mensal": assinatura(em(seconds=-5)),
    P + "iniciante.mensal": assinatura(em(days=30)),
}
aviso("RENEWAL", ANA, product_id=P + "iniciante.mensal")
check("na renovação vira Iniciante", plano(ANA) == ("iniciante", "mensal", "active"), plano(ANA))

print("\n7.1 no anual · a troca espera o ano pago")
zerar()
loja[ANA] = {P + "avancado.anual": assinatura(em(days=200))}
aviso("PRODUCT_CHANGE", ANA, product_id=P + "avancado.anual", new_product_id=P + "iniciante.mensal")
check("continua no Avançado anual", plano(ANA) == ("avancado", "anual", "active"), plano(ANA))

print("\nMensal → anual no mesmo plano · a Apple troca na renovação")
zerar()
loja[ANA] = {P + "avancado.mensal": assinatura(em(days=10))}
aviso("PRODUCT_CHANGE", ANA, new_product_id=P + "avancado.anual")
check("continua no mensal até renovar", plano(ANA) == ("avancado", "mensal", "active"), plano(ANA))
loja[ANA] = {P + "avancado.mensal": assinatura(em(seconds=-5)), P + "avancado.anual": assinatura(em(days=365))}
aviso("RENEWAL", ANA)
check("depois vira anual", plano(ANA) == ("avancado", "anual", "active"), plano(ANA))

print("\n7.2 · Cancelar mantém o acesso até o fim")
zerar()
loja[ANA] = {P + "iniciante.mensal": assinatura(em(days=10), unsubscribe_detected_at=em(seconds=-1))}
aviso("CANCELLATION", ANA, cancel_reason="UNSUBSCRIBE")
check("cancelado continua no Iniciante", plano(ANA) == ("iniciante", "mensal", "active"), plano(ANA))
loja[ANA] = {P + "iniciante.mensal": assinatura(em(seconds=-5), unsubscribe_detected_at=em(days=-10))}
aviso("EXPIRATION", ANA)
check("ao vencer volta para o Grátis", plano(ANA) == ("gratuito", None, "canceled"), plano(ANA))
check("a linha continua de loja", linha(ANA)["origem"] == "apple")

print("\nDevolução tira o plano na hora")
zerar()
loja[ANA] = {P + "avancado.mensal": assinatura(em(days=20), refunded_at=em(seconds=-1))}
aviso("CANCELLATION", ANA, cancel_reason="CUSTOMER_SUPPORT")
check("devolvido não vale", plano(ANA)[0] in (None, "gratuito"), plano(ANA))

print("\nCobrança recusada mantém o plano na carência")
zerar()
loja[ANA] = {P + "avancado.mensal": assinatura(em(hours=-2), grace_period_expires_date=em(days=6),
                                               billing_issues_detected_at=em(hours=-2))}
aviso("BILLING_ISSUE", ANA)
check("fica em atraso, com o plano", plano(ANA) == ("avancado", "mensal", "past_due"), plano(ANA))

print("\nTroca de dono · a assinatura passa de uma conta do Dito para outra")
zerar()
loja[ANA] = {P + "avancado.mensal": assinatura(em(days=20))}
aviso("INITIAL_PURCHASE", ANA)
loja[ANA] = {}
loja[BRUNO] = {P + "avancado.mensal": assinatura(em(days=20))}
r = aviso("TRANSFER", None, transferred_from=[ANA], transferred_to=[BRUNO])
check("webhook responde 200", r.status_code == 200, r.text)
check("quem ganhou recebe o plano", plano(BRUNO) == ("avancado", "mensal", "active"), plano(BRUNO))
check("quem perdeu volta para o Grátis", plano(ANA) == ("gratuito", None, "canceled"), plano(ANA))

print("\nConta apagada com assinatura viva (o erro em laço de 03 a 05/10)")
zerar()
loja[APAGADA] = {P + "avancado.mensal": assinatura(em(days=1))}
r = aviso("RENEWAL", APAGADA)
check("renovação para conta apagada responde 200", r.status_code == 200, r.text)
check("e não cria linha nenhuma", linha(APAGADA) is None)
loja[APAGADA] = {}
loja[BRUNO] = {P + "avancado.mensal": assinatura(em(days=1))}
r = aviso("TRANSFER", None, transferred_from=[APAGADA], transferred_to=[BRUNO])
check("troca de dono vinda de conta apagada responde 200", r.status_code == 200, r.text)
check("e quem ganhou recebe o plano", plano(BRUNO)[0] == "avancado", plano(BRUNO))

print("\nTrava do Stripe")
zerar()
db["subscriptions"].append({"user_id": CARLA, "plano": "avancado", "ciclo": "mensal", "status": "active",
                            "origem": "stripe", "current_period_end": em(days=9)})
loja[CARLA] = {P + "iniciante.mensal": assinatura(em(days=30))}
aviso("INITIAL_PURCHASE", CARLA)
check("assinatura do site valendo não é sobrescrita", plano(CARLA) == ("avancado", "mensal", "active")
      and linha(CARLA)["origem"] == "stripe", linha(CARLA))
linha(CARLA)["status"] = "canceled"
aviso("INITIAL_PURCHASE", CARLA)
check("assinatura do site cancelada dá lugar à da loja", plano(CARLA) == ("iniciante", "mensal", "active")
      and linha(CARLA)["origem"] == "apple", linha(CARLA))
zerar()
db["subscriptions"].append({"user_id": CARLA, "plano": "gratuito", "ciclo": None, "status": "canceled",
                            "origem": "stripe", "current_period_end": None})
aviso("EXPIRATION", CARLA)
check("sem nada na loja, linha do site fica como estava", linha(CARLA)["origem"] == "stripe", linha(CARLA))

print("\nRevenueCat fora do ar")
zerar()
roteiro["revenuecat"] = "fora"
r = aviso("INITIAL_PURCHASE", ANA)
check("pede reentrega (503)", r.status_code == 503, r.status_code)
check("e não grava nada", linha(ANA) is None)

print("\nAvisos sem dono")
zerar()
r = aviso("TEST", "$RCAnonymousID:abc")
check("id anônimo é ignorado com 200", r.status_code == 200 and not chamadas_rc, (r.status_code, chamadas_rc))
r = aviso("TEST", "usuario-de-teste-do-painel")
check("id que não é do Dito é ignorado com 200", r.status_code == 200 and not chamadas_rc)
r = client.post("/billing/webhook-loja", json={"event": {"type": "RENEWAL", "app_user_id": ANA}},
                headers={"Authorization": "outro"})
check("token errado é 401", r.status_code == 401)

print("\nPlay Store")
zerar()
loja[ANA] = {P + "iniciante.anual:anual": assinatura(em(days=300), loja_nome="play_store")}
aviso("INITIAL_PURCHASE", ANA, store="PLAY_STORE")
check("produto com plano base e origem Google", plano(ANA) == ("iniciante", "anual", "active")
      and linha(ANA)["origem"] == "google", linha(ANA))

print("\nSincronizar depois de comprar ou restaurar")
zerar()
r = client.post("/billing/sincronizar-loja")
check("sem login é 401", r.status_code == 401)
r = client.post("/billing/sincronizar-loja", headers={"Authorization": "Bearer tok-ana"})
check("sem nada na loja devolve Grátis", r.status_code == 200 and r.json()["plano"] == "gratuito", r.text)
check("e não cria linha", linha(ANA) is None)
loja[ANA] = {P + "avancado.mensal": assinatura(em(days=20))}
r = client.post("/billing/sincronizar-loja", headers={"Authorization": "Bearer tok-ana"})
check("compra recém-feita: plano na hora", r.json()["plano"] == "avancado" and r.json()["antes"] == "gratuito", r.text)
r = client.post("/billing/sincronizar-loja", headers={"Authorization": "Bearer tok-ana"})
check("restaurar na mesma conta: já estava ativa", r.json()["plano"] == "avancado" and r.json()["antes"] == "avancado", r.text)
roteiro["revenuecat"] = "fora"
r = client.post("/billing/sincronizar-loja", headers={"Authorization": "Bearer tok-ana"})
check("loja fora do ar é 503 com texto claro", r.status_code == 503 and "loja" in r.json()["detail"], r.text)

print(f"\n{ok} ok, {falhas} falha(s)")
raise SystemExit(1 if falhas else 0)
