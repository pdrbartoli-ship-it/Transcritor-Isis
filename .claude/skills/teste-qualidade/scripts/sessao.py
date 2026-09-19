"""Login na conta de teste do Dito (produção). A conta é a do usuário de verdade —
ver dito-supabase-acesso e e2e-test-harness na memória antes de gastar o saldo dela."""
import json, re, httpx

CREDS_PATH = "/workspaces/Transcritor-Isis/e2e/credentials.json"
SUPABASE_JS_PATH = "/workspaces/Transcritor-Isis/frontend/src/lib/supabase.js"


def login():
    creds = json.load(open(CREDS_PATH))
    src = open(SUPABASE_JS_PATH).read()
    url = re.search(r"https://[a-z0-9]+\.supabase\.co", src).group(0)
    key = re.search(r"eyJ[\w\-\.]+", src).group(0)
    tok = httpx.post(
        f"{url}/auth/v1/token?grant_type=password",
        json={"email": creds["email"], "password": creds["password"]},
        headers={"apikey": key},
    ).json()
    return url, key, {"Authorization": f"Bearer {tok['access_token']}"}


def user_id():
    url, key, H = login()
    r = httpx.get(f"{url}/auth/v1/user", headers={"apikey": key, **H}).json()
    return r["id"]


B = "https://transcritor-backend.onrender.com"
