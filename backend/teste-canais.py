# Testa a separação "você" e "outros" das gravações do app de Windows, sem
# rede e sem gastar crédito: o Whisper e a IA são dublês. O que está sob teste
# é a regra — de que lado veio cada trecho, o que a IA recebe e como ficam as
# trocas de voz no fim —, não a qualidade da transcrição.
#
# Rodar:  cd backend && python teste-canais.py

import asyncio
import os
import sys

os.environ["GROQ_API_KEY"] = "chave-de-teste"
os.environ["ANTHROPIC_API_KEY"] = "chave-de-teste"

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


def niveis(janelas):
    """Monta o texto que o gravador manda, a partir de (dB do microfone, dB do
    computador) por janela de 250 ms. É o inverso de ler_niveis."""
    def degrau(db):
        return main.NIVEIS_ALFABETO[max(0, min(63, round((db + 72) / 72 * 63)))]
    return "250:" + "".join(degrau(m) + degrau(s) for m, s in janelas)


def trecho(inicio, fim, texto):
    return {"start": inicio, "end": fim, "text": texto}


SALA = -60      # rumor da sala no microfone
VOZ = -25       # alguém falando
ECO = -45       # a voz dos outros vazando para o microfone, sem fone
MUDO = -80      # silêncio digital do computador

# Uma chamada de 20 s: 0 a 5 s você fala, 5 a 12 s os outros (com eco no seu
# microfone), 12 a 16 s você, 16 a 20 s ninguém.
CHAMADA = (
    [(VOZ, MUDO)] * 20
    + [(ECO, VOZ)] * 28
    + [(VOZ, MUDO)] * 16
    + [(SALA, MUDO)] * 16
)

print("\nler_niveis")
lido = main.ler_niveis(niveis(CHAMADA))
check("lê a janela e os dois lados", lido is not None and lido[0] == 0.25 and len(lido[1]) == len(CHAMADA))
check("volta o volume perto do original", lido and abs(lido[1][0] - VOZ) < 1.2 and abs(lido[2][30] - VOZ) < 1.2)
check("texto vazio não vale", main.ler_niveis("") is None and main.ler_niveis(None) is None)
check("caractere fora do alfabeto não vale", main.ler_niveis("250:AB*C") is None)
check("número ímpar de degraus não vale", main.ler_niveis("250:ABC") is None)
check("janela absurda não vale", main.ler_niveis("7:AB") is None)
check("texto grande demais não vale", main.ler_niveis("250:" + "AB" * 300_000) is None)

print("\nmarcar_canais")
segs = [
    trecho(0.0, 4.8, "Bom dia, pessoal."),
    trecho(5.2, 11.5, "Bom dia. Vamos aos números do trimestre."),
    trecho(12.0, 15.6, "Pode seguir."),
]
check("marca uma chamada", main.marcar_canais(segs, niveis(CHAMADA)))
check("o que só saiu do microfone é você", segs[0].get("canal") == "voce", segs[0])
check("eco dos outros no microfone continua sendo dos outros", segs[1].get("canal") == "outros", segs[1])
check("você de novo depois dos outros", segs[2].get("canal") == "voce", segs[2])

# Trecho do Whisper que pega o fim de uma fala e o começo da outra: fica com
# o lado que ocupou mais tempo dele.
misto = [trecho(3.0, 11.0, "fim da minha fala e o começo da resposta")]
main.marcar_canais(misto, niveis(CHAMADA))
check("trecho misturado fica com quem falou mais", misto[0].get("canal") == "outros", misto[0])

silencio = [trecho(16.5, 19.5, "Obrigado.")]
main.marcar_canais(silencio, niveis(CHAMADA))
check("trecho sem voz de lado nenhum fica sem marca", "canal" not in silencio[0], silencio[0])

presencial = [trecho(0, 5, "a"), trecho(5, 10, "b")]
check(
    "gravação presencial (o computador calado) não marca nada",
    not main.marcar_canais(presencial, niveis([(VOZ, MUDO)] * 40)) and all("canal" not in s for s in presencial),
)
sem = [trecho(0, 5, "a")]
check("instalador antigo (sem níveis) não marca nada", not main.marcar_canais(sem, None) and "canal" not in sem[0])

# Microfone com ganho alto (piso do microfone em -40): o limiar sobe junto,
# e o rumor não vira voz.
ruidoso = [(-40, MUDO)] * 20 + [(-40, VOZ)] * 20 + [(-15, MUDO)] * 20
segs_ruido = [trecho(0, 4.9, "rumor"), trecho(5, 9.9, "outros"), trecho(10, 14.9, "você")]
main.marcar_canais(segs_ruido, niveis(ruidoso))
check("rumor alto no microfone não vira você", "canal" not in segs_ruido[0], segs_ruido[0])
check("com rumor alto, os outros e você continuam separados",
      segs_ruido[1].get("canal") == "outros" and segs_ruido[2].get("canal") == "voce")

print("\nformat_timed_transcript")
texto = main.format_timed_transcript(segs)
linhas = texto.split("\n")
check("uma linha por troca de lado, com o rótulo", linhas == [
    "[00:00] (Você) Bom dia, pessoal.",
    "[00:05] (Outros) Bom dia. Vamos aos números do trimestre.",
    "[00:12] (Você) Pode seguir.",
], texto)
sem_canal = [trecho(0, 10, "um"), trecho(10, 20, "dois"), trecho(20, 31, "três"), trecho(31, 40, "quatro")]
check("sem canais, igual a antes (janelas de 30 s)",
      main.format_timed_transcript(sem_canal) == "[00:00] um dois três\n[00:31] quatro",
      main.format_timed_transcript(sem_canal))

print("\nbloco_de_contexto")
bloco = main.bloco_de_contexto({"origem": "record", "nome": "Pedro", "canais": True})
check("explica os rótulos com o nome de quem gravou", "(Você) saíram do microfone de Pedro" in bloco, bloco)
check("sem canais, sem a explicação", "(Você)" not in main.bloco_de_contexto({"origem": "record", "nome": "Pedro"}))
check("sem travessão no texto que vai à IA", "—" not in bloco and "–" not in bloco)

print("\naplicar_canais")
# A IA errou: juntou o primeiro trecho dos outros com a voz do microfone.
ia = {
    "speakers": [
        {"label": "Locutor 1", "name": None, "confidence": "baixa"},
        {"label": "Locutor 2", "name": "Júlia", "confidence": "alta"},
    ],
    "speaker_turns": [{"start": 0, "speaker": "Locutor 1"}, {"start": 12, "speaker": "Júlia"}],
    "todos": [{"task": "Enviar números", "owners": ["Locutor 1", "Júlia"]}],
}
fim = main.aplicar_canais(ia, segs, "Pedro")
check("trocas refeitas pelos canais", fim["speaker_turns"] == [
    {"start": 0.0, "speaker": "Pedro"},
    {"start": 5.2, "speaker": "Júlia"},
    {"start": 12.0, "speaker": "Pedro"},
], fim["speaker_turns"])
check("a voz do microfone vira o nome das Configurações",
      {"label": "Locutor 1", "name": "Pedro", "confidence": "alta"} in fim["speakers"], fim["speakers"])
check("os outros continuam com o nome que a IA achou", any(l.get("name") == "Júlia" for l in fim["speakers"]))
check("responsáveis das tarefas acompanham", fim["todos"][0]["owners"] == ["Pedro", "Júlia"], fim["todos"])

sem_nome = main.aplicar_canais(ia, segs, None)
check("sem nome nas Configurações, a voz do microfone é Você",
      sem_nome["speaker_turns"][0]["speaker"] == "Você", sem_nome["speaker_turns"])

ia_sabe = {
    "speakers": [
        {"label": "Locutor 1", "name": "Marcos", "confidence": "alta"},
        {"label": "Locutor 2", "name": "Júlia", "confidence": "alta"},
    ],
    "speaker_turns": [{"start": 0, "speaker": "Marcos"}, {"start": 5, "speaker": "Júlia"}, {"start": 12, "speaker": "Marcos"}],
    "todos": [],
}
check("sem nome nas Configurações, vale o nome que a IA achou com segurança",
      main.aplicar_canais(ia_sabe, segs, None)["speaker_turns"][0]["speaker"] == "Marcos")

papel = {
    "speakers": [{"label": "Locutor 1", "name": "Entrevistador", "confidence": "media"}],
    "speaker_turns": [{"start": 0, "speaker": "Entrevistador"}],
    "todos": [],
}
tudo_um = main.aplicar_canais(papel, segs, None)
check("a IA pôs todo mundo numa voz só: os outros ganham um locutor próprio",
      [t["speaker"] for t in tudo_um["speaker_turns"]] == ["Você", "Participante", "Você"], tudo_um["speaker_turns"])
check("e uma ficha na lista, com rótulo livre",
      sorted((l["label"], l["name"]) for l in tudo_um["speakers"]) == [("Locutor 1", "Você"), ("Locutor 2", "Participante")],
      tudo_um["speakers"])
check("sem canais, não mexe em nada", main.aplicar_canais(ia, [trecho(0, 5, "a")], "Pedro") is ia)

print("\n/transcribe de ponta a ponta (Whisper e IA dublês)")
pedidos = []


async def whisper_duble(input_path, filename):
    return (
        " ".join(s["text"] for s in segs),
        [{k: v for k, v in s.items() if k != "canal"} for s in segs],
        1, "menos de 1 minuto", 20.0,
    )


async def ia_duble(uso, system, user, schema, **kw):
    pedidos.append(user)
    return {
        "title": "Números do trimestre", "summary_bullets": ["Um ponto"],
        "speakers": ia["speakers"], "speaker_turns": ia["speaker_turns"],
        "topics": [], "todos": [], "chapters": [],
    }, 10, 10, 0, 0, "dublê"


main.process_audio_path = whisper_duble
main.call_insights_com_reserva = ia_duble
main.app.dependency_overrides[main.guarda_de_captura] = lambda: None
cliente = TestClient(main.app)

r = cliente.post("/transcribe", files={"file": ("gravacao.wav", b"RIFF----WAVEfmt ", "audio/wav")},
                 data={"mode": "completa", "origem": "record", "nome": "Pedro", "niveis": niveis(CHAMADA)})
check("responde 200", r.status_code == 200, r.text[:300])
corpo = r.json() if r.status_code == 200 else {}
check("a IA recebeu os rótulos e a explicação",
      pedidos and "(Você) Bom dia, pessoal." in pedidos[-1] and "microfone de Pedro" in pedidos[-1], pedidos[-1:] and pedidos[-1][:400])
check("os trechos voltam com o lado de cada um",
      [s.get("canal") for s in corpo.get("segments", [])] == ["voce", "outros", "voce"], corpo.get("segments"))
check("as trocas de voz saem pelos canais",
      [t["speaker"] for t in (corpo.get("insights") or {}).get("speaker_turns", [])] == ["Pedro", "Júlia", "Pedro"],
      (corpo.get("insights") or {}).get("speaker_turns"))

pedidos.clear()
r = cliente.post("/transcribe", files={"file": ("gravacao.wav", b"RIFF----WAVEfmt 2", "audio/wav")},
                 data={"mode": "completa", "origem": "record", "nome": "Pedro"})
check("sem níveis (instalador antigo): sem rótulos, como antes",
      r.status_code == 200 and pedidos and "(Você)" not in pedidos[-1]
      and all("canal" not in s for s in r.json().get("segments", [])), r.text[:300])

print(f"\n{ok} ok, {falhas} falha(s)")
sys.exit(1 if falhas else 0)
