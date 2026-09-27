"""Quem fala: mede os serviços que separam vozes pelo SOM contra o jeito de hoje
(a IA adivinhando pelo texto), com a referência escrita à mão em
casos/<slug>/referencia.py (GT_TURNOS). Fase 6.4 da atualização do desktop.

Uso:
  python3 locutores.py <slug> [servico ...]   # manda o áudio e pontua
  python3 locutores.py <slug> --so-pontuar     # só pontua o que já está em out/

Serviços: assemblyai, deepgram, elevenlabs, pyannote. As chaves ficam em
casos/<slug>/keys.env (gitignored), com os nomes ASSEMBLYAI_API_KEY,
DEEPGRAM_API_KEY, ELEVENLABS_API_KEY e PYANNOTE_API_KEY. Serviço sem chave é
pulado. Todos dão crédito grátis na conta nova, então medir não custa nada.

O áudio é o do `origem.txt` do caso ("arquivo: amostras-teste/..."), a partir
da raiz do repositório. Caso de link (YouTube) precisa do áudio baixado antes
em casos/<slug>/audio.<ext>.

A medida:
- `fala_certa_%`: de segundo em segundo, quem o serviço diz que fala contra
  quem fala de verdade. Os rótulos do serviço ("A", "SPEAKER_01") são casados
  um a um com as pessoas de verdade pelo maior tempo em comum; rótulo que sobra
  (a mesma pessoa partida em duas) conta como erro.
- `vozes`: quantas vozes o serviço achou, contra quantas havia.
- `custo_R$_h`: preço de tabela por hora de áudio, já com o Whisper de hoje
  quando o serviço só separa vozes (pyannote).

O jeito de hoje entra como "atual", lido de out/<modelo>__r1.json (a saída da
extração que o harness já gravou), pontuado com a mesma regra.

Pode apontar para outra pasta de casos com DITO_CASOS=/caminho/casos.
"""
import importlib.util
import json
import os
import sys
import time
from collections import defaultdict

import httpx

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASOS = os.environ.get("DITO_CASOS") or os.path.join(SKILL_DIR, "casos")
RAIZ = os.path.abspath(os.path.join(CASOS, "..", "..", "..", ".."))

# Preço de tabela por hora de áudio, em US$, conferido nas páginas oficiais em
# 27/09/2026. Reconfira antes de decidir.
DOLAR = 5.14          # R$ por US$ (o mesmo do teste de 19/09)
EURO_EM_DOLAR = 1.16  # aproximado
WHISPER_H = 0.04      # Groq whisper-large-v3-turbo, o que o Dito paga hoje
PRECO_H = {
    # Universal-3.5 Pro (US$ 0,21/h) + diarização padrão (US$ 0,02/h)
    "assemblyai": 0.21 + 0.02,
    # Nova-3 monolíngue, US$ 0,0043/min; diarização incluída no pré-gravado
    "deepgram": 0.0043 * 60,
    # Scribe v2, US$ 0,22/h; diarização incluída
    "elevenlabs": 0.22,
    # Precision-3, € 0,112/h, só separa vozes: o Whisper de hoje continua
    "pyannote": 0.112 * EURO_EM_DOLAR + WHISPER_H,
    "atual": WHISPER_H,
}


def carregar_referencia(slug):
    spec = importlib.util.spec_from_file_location("referencia", os.path.join(CASOS, slug, "referencia.py"))
    ref = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ref)
    return ref


def carregar_keys(slug):
    p = os.path.join(CASOS, slug, "keys.env")
    if not os.path.exists(p):
        return {}
    return dict(l.strip().split("=", 1) for l in open(p) if "=" in l and not l.startswith("#"))


def audio_do_caso(slug):
    d = os.path.join(CASOS, slug)
    for f in sorted(os.listdir(d)):
        if f.startswith("audio."):
            return os.path.join(d, f)
    origem = open(os.path.join(d, "origem.txt")).read().strip()
    if origem.startswith("arquivo:"):
        return os.path.join(RAIZ, origem.split(":", 1)[1].strip())
    raise SystemExit(f"{slug}: caso de link; baixe o áudio para casos/{slug}/audio.<ext> antes")


def em_turnos(trechos):
    """[(inicio, rotulo)] só nas trocas de voz, em ordem."""
    turnos = []
    for inicio, rotulo in sorted(trechos):
        if not turnos or turnos[-1][1] != rotulo:
            turnos.append((float(inicio), str(rotulo)))
    return turnos


# ── Serviços ──────────────────────────────────────────────────────────────
# Cada um devolve (turnos, resposta crua). A resposta vai inteira para out/,
# para conferir à mão depois.

def assemblyai(caminho, chave):
    h = {"authorization": chave}
    with httpx.Client(timeout=600) as c:
        url = c.post("https://api.assemblyai.com/v2/upload", headers=h, content=open(caminho, "rb").read()).raise_for_status().json()["upload_url"]
        job = c.post("https://api.assemblyai.com/v2/transcript", headers=h, json={
            "audio_url": url, "speaker_labels": True, "language_code": "pt",
        }).raise_for_status().json()
        while job["status"] not in ("completed", "error"):
            time.sleep(3)
            job = c.get(f"https://api.assemblyai.com/v2/transcript/{job['id']}", headers=h).raise_for_status().json()
    if job["status"] == "error":
        raise RuntimeError(job.get("error"))
    return em_turnos((u["start"] / 1000, u["speaker"]) for u in job.get("utterances") or []), job


def deepgram(caminho, chave):
    with httpx.Client(timeout=600) as c:
        r = c.post(
            "https://api.deepgram.com/v1/listen",
            params={"model": "nova-3", "language": "pt-BR", "diarize": "true", "utterances": "true", "smart_format": "true"},
            headers={"Authorization": f"Token {chave}", "Content-Type": "audio/*"},
            content=open(caminho, "rb").read(),
        ).raise_for_status().json()
    return em_turnos((u["start"], u["speaker"]) for u in r["results"].get("utterances") or []), r


def elevenlabs(caminho, chave):
    with httpx.Client(timeout=600) as c:
        r = c.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": chave},
            data={"model_id": "scribe_v2", "diarize": "true", "language_code": "por"},
            files={"file": (os.path.basename(caminho), open(caminho, "rb"))},
        ).raise_for_status().json()
    palavras = [w for w in r.get("words") or [] if w.get("type") == "word" and w.get("speaker_id")]
    return em_turnos((w["start"], w["speaker_id"]) for w in palavras), r


def pyannote(caminho, chave):
    h = {"Authorization": f"Bearer {chave}"}
    media = f"media://dito-teste/{int(time.time())}"
    with httpx.Client(timeout=600) as c:
        put = c.post("https://api.pyannote.ai/v1/media/input", headers=h, json={"url": media}).raise_for_status().json()["url"]
        c.put(put, content=open(caminho, "rb").read()).raise_for_status()
        job = c.post("https://api.pyannote.ai/v1/diarize", headers=h, json={"url": media}).raise_for_status().json()
        while True:
            r = c.get(f"https://api.pyannote.ai/v1/jobs/{job['jobId']}", headers=h).raise_for_status().json()
            if r["status"] in ("succeeded", "failed", "canceled"):
                break
            time.sleep(3)
    if r["status"] != "succeeded":
        raise RuntimeError(r)
    return em_turnos((s["start"], s["speaker"]) for s in r["output"]["diarization"]), r


SERVICOS = {"assemblyai": assemblyai, "deepgram": deepgram, "elevenlabs": elevenlabs, "pyannote": pyannote}
CHAVES = {"assemblyai": "ASSEMBLYAI_API_KEY", "deepgram": "DEEPGRAM_API_KEY",
          "elevenlabs": "ELEVENLABS_API_KEY", "pyannote": "PYANNOTE_API_KEY"}


# ── Pontuação ─────────────────────────────────────────────────────────────

def quem_em(turnos, t):
    atual = None
    for inicio, rotulo in turnos:
        if inicio > t:
            break
        atual = rotulo
    return atual


def pontuar(turnos, ref):
    """Casa cada rótulo com uma pessoa de verdade, um a um, pelo maior tempo em
    comum, e conta os segundos em que o rótulo casado é a pessoa certa."""
    gt = sorted(ref.GT_TURNOS)
    segundos = range(0, int(ref.DUR))
    juntos = defaultdict(int)
    for t in segundos:
        juntos[(quem_em(turnos, t), quem_em(gt, t))] += 1
    casado, usados_gt = {}, set()
    for (rotulo, pessoa), _ in sorted(juntos.items(), key=lambda kv: -kv[1]):
        if rotulo is None or rotulo in casado or pessoa in usados_gt:
            continue
        casado[rotulo] = pessoa
        usados_gt.add(pessoa)
    certos = sum(1 for t in segundos if casado.get(quem_em(turnos, t)) == quem_em(gt, t))
    return {
        "fala_certa_%": round(100 * certos / len(segundos)),
        "vozes": len({r for _, r in turnos}),
        "vozes_de_verdade": len({p for _, p in gt}),
    }


def turnos_atuais(slug, modelo="gemini-3.8-flash"):
    p = os.path.join(CASOS, slug, "out", f"{modelo}__r1.json")
    if not os.path.exists(p):
        return None
    ins = json.load(open(p)).get("insights") or {}
    return em_turnos((t["start"], t["speaker"]) for t in ins.get("speaker_turns") or [])


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    slug = sys.argv[1]
    so_pontuar = "--so-pontuar" in sys.argv
    pedidos = [s for s in sys.argv[2:] if not s.startswith("--")] or list(SERVICOS)
    ref = carregar_referencia(slug)
    saida = os.path.join(CASOS, slug, "out")
    os.makedirs(saida, exist_ok=True)

    linhas = []
    atual = turnos_atuais(slug)
    if atual:
        linhas.append(("atual (IA pelo texto)", pontuar(atual, ref), PRECO_H["atual"]))

    keys = carregar_keys(slug)
    for nome in pedidos:
        arquivo = os.path.join(saida, f"{nome}__locutores.json")
        if not so_pontuar:
            chave = keys.get(CHAVES[nome]) or os.environ.get(CHAVES[nome])
            if not chave:
                print(f"  {nome}: sem {CHAVES[nome]}, pulado")
                continue
            inicio = time.time()
            try:
                turnos, cru = SERVICOS[nome](audio_do_caso(slug), chave)
            except Exception as e:
                print(f"  {nome}: falhou ({e})")
                continue
            json.dump({"turnos": turnos, "segundos": round(time.time() - inicio, 1), "cru": cru},
                      open(arquivo, "w"), ensure_ascii=False)
        if os.path.exists(arquivo):
            turnos = [tuple(t) for t in json.load(open(arquivo))["turnos"]]
            linhas.append((nome, pontuar(turnos, ref), PRECO_H[nome]))

    print(f"\n{slug}: {ref.DUR // 60} min, {len({p for _, p in ref.GT_TURNOS})} voz(es) de verdade\n")
    print(f"  {'':24} {'fala certa':>10} {'vozes':>6} {'R$/h':>7}")
    for nome, p, preco in linhas:
        print(f"  {nome:24} {p['fala_certa_%']:>9}% {p['vozes']:>6} {preco * DOLAR:>7.2f}")


if __name__ == "__main__":
    main()
