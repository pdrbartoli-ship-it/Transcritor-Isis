"""Confere capítulos e locutores de um resultado contra a referência escrita à mão
em casos/<slug>/referencia.py. Ver SKILL.md pra como escrever essa referência.

Uso: python3 score.py <slug> out/modelo1.json out/modelo2.json ...
"""
import importlib.util, json, os, sys, unicodedata


def norm(s):
    return unicodedata.normalize("NFD", (s or "").lower()).encode("ascii", "ignore").decode()


def carregar_referencia(slug):
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(skill_dir, "casos", slug, "referencia.py")
    spec = importlib.util.spec_from_file_location("referencia", path)
    ref = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ref)
    return ref


def quem(nome, apelidos):
    n = norm(nome)
    for k, vs in apelidos.items():
        if any(v in n for v in vs):
            return k
    return "?"


def pontuar(ins, ref):
    dur = ref.DUR
    turnos = sorted(ins.get("speaker_turns") or [], key=lambda x: x["start"])
    acerto_voz = total = 0
    for t in range(0, dur, 10):
        gt = [s for s0, s in ref.GT_TURNOS if s0 <= t][-1]
        mt = None
        for x in turnos:
            if x["start"] <= t:
                mt = x
        acerto_voz += int(mt is not None and quem(mt["speaker"], ref.APELIDOS) == gt)
        total += 1

    caps = ins.get("chapters") or []
    acerto_cap = n = 0
    erros = []
    for t in range(30, dur, 60):
        sec = [s for s in ref.GT_SECOES if s[0] <= t < s[1]][0]
        c = next((c for c in caps if c["start"] <= t < c["end"]), caps[-1]) if caps else None
        ok = c is not None and any(k in norm(c["title"] + " " + " ".join(c.get("bullets") or [])) for k in sec[3])
        acerto_cap += int(ok)
        n += 1
        if not ok:
            erros.append(f"{t//60}min: lá era '{sec[2]}', o capítulo diz '{c['title'] if c else '(nenhum)'}'")

    fora = sum(1 for x in turnos if x["start"] > dur) + sum(
        1 for tp in (ins.get("topics") or []) for r in tp["time_refs"] for v in r if v > dur + 1
    )
    return {
        "voz_certa_%": round(100 * acerto_voz / total) if total else None,
        "capitulo_certo_%": round(100 * acerto_cap / n) if n else None,
        "capitulos": len(caps),
        "tarefas": len(ins.get("todos") or []),
        "tempos_fora_do_audio": fora,
        "erros_capitulo": erros,
    }


if __name__ == "__main__":
    slug, *arquivos = sys.argv[1:]
    ref = carregar_referencia(slug)
    for arq in arquivos:
        r = json.load(open(arq))
        # chat (lista) e modo simples ("resumo") não têm capítulo nem locutor, e o `curto`
        # cobre só um trecho — a referência é do material inteiro: ficam pra leitura manual
        if isinstance(r, list) or "resumo" in r or "segundos_audio" in r:
            continue
        if r.get("insights") is None:
            print(f"{arq.split('/')[-1]:34s} SEM RESULTADO — erro: {r.get('erro')}")
            continue
        p = pontuar(r["insights"], ref)
        print(f"{arq.split('/')[-1]:34s} voz certa {p['voz_certa_%']:3d}% | capítulo certo {p['capitulo_certo_%']:3d}% | "
              f"{p['capitulos']:2d} capítulos | {p['tarefas']} tarefas | tempos fora do áudio: {p['tempos_fora_do_audio']}")
        for e in p["erros_capitulo"][:8]:
            print("      ✗", e)
