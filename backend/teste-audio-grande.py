"""Regressão do bug do arquivo grande: uma reunião longa tem de ser aceita.

Antes deste teste, uma gravação de 58 minutos do app de Windows (WAV 48 kHz)
chegava com 305 MB e o backend a recusava com 413 — o teto de 150 MB existia só
porque o upload inteiro ia para a memória do worker.

Aqui o áudio é sintético e o Groq/Claude são substituídos por dublês: o que se
verifica é o CAMINHO (upload em blocos → disco → ffmpeg → fatiamento →
transcrição em ondas → faxina), não a qualidade da transcrição.

Rodar: cd backend && python3 teste-audio-grande.py
"""
import asyncio
import os
import subprocess
import sys
import tempfile

import imageio_ffmpeg

os.environ.setdefault("GROQ_API_KEY", "fake")
os.environ.setdefault("ANTHROPIC_API_KEY", "fake")

import main
from fastapi.testclient import TestClient

MINUTOS = 100
falhas = []


def check(nome, condicao, detalhe=""):
    print(f"  {'✓' if condicao else '✗'} {nome}{'' if condicao else f' — {detalhe}'}")
    if not condicao:
        falhas.append(nome)


def gerar_wav(caminho: str, minutos: int):
    """WAV 16 kHz mono, o mesmo formato que o app de Windows grava agora."""
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([
        ffmpeg, "-y", "-f", "lavfi",
        "-i", f"sine=frequency=440:duration={minutos * 60}",
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", caminho,
    ], capture_output=True, check=True)


def main_test():
    tmp = tempfile.mkdtemp()
    wav = os.path.join(tmp, "gravacao.wav")
    print(f"Gerando {MINUTOS} min de WAV 16 kHz mono…")
    gerar_wav(wav, MINUTOS)
    tamanho = os.path.getsize(wav)
    mb = tamanho / (1024 * 1024)
    print(f"Arquivo: {mb:.0f} MB\n")

    check("o arquivo é maior que o teto antigo de 150 MB", mb > 150, f"{mb:.0f} MB")
    check("o arquivo cabe no teto novo", tamanho <= main.MAX_UPLOAD_BYTES)

    # Dublês: nenhuma chamada externa é feita.
    enviados = []
    simultaneos = {"agora": 0, "pico": 0}

    async def send_chunk_fake(client, audio_bytes, i, name="audio.m4a", mime="audio/m4a"):
        simultaneos["agora"] += 1
        simultaneos["pico"] = max(simultaneos["pico"], simultaneos["agora"])
        enviados.append(len(audio_bytes))
        await asyncio.sleep(0.05)
        simultaneos["agora"] -= 1
        offset = i * main.CHUNK_SECONDS
        return (f"bloco {i}", [{"start": offset, "end": offset + 5, "text": f"bloco {i}"}])

    async def insights_fake(transcript, segments):
        return ({"title": "Reunião longa", "duration_s": 0}, 10, 10)

    main.send_chunk = send_chunk_fake
    main.extract_insights = insights_fake

    antes = set(os.listdir(tempfile.gettempdir()))

    client = TestClient(main.app)
    print("Enviando…")
    with open(wav, "rb") as f:
        resp = client.post("/transcribe", files={"file": ("gravacao.wav", f, "audio/wav")})

    check("o upload não é recusado", resp.status_code == 200,
          f"{resp.status_code}: {resp.text[:200]}")

    if resp.status_code == 200:
        dados = resp.json()
        esperado = -(-MINUTOS * 60 // main.CHUNK_SECONDS)  # ceil
        check(f"o áudio foi fatiado em ~{esperado} blocos",
              dados["chunks_used"] >= esperado - 1, f"veio {dados['chunks_used']}")
        check("a transcrição juntou todos os blocos",
              all(f"bloco {i}" in dados["transcript"] for i in range(dados["chunks_used"])))
        check("os segmentos vieram com o tempo corrido (offset por bloco)",
              dados["segments"][-1]["start"] >= main.CHUNK_SECONDS)
        check("a duração foi medida do áudio, não chutada",
              abs(dados["duration_s"] - MINUTOS * 60) < 60, f"{dados['duration_s']}s")
        check("nenhum bloco enviado passa do teto do Groq",
              all(t <= main.MAX_CHUNK_BYTES for t in enviados),
              f"maior={max(enviados) if enviados else 0}")
        check(f"nunca mais de {main.MAX_PARALLEL_CHUNKS} envios simultâneos",
              simultaneos["pico"] <= main.MAX_PARALLEL_CHUNKS, f"pico={simultaneos['pico']}")

    depois = set(os.listdir(tempfile.gettempdir()))
    check("os temporários foram apagados no fim", not (depois - antes),
          f"sobrou {depois - antes}")

    # Um arquivo vazio ainda precisa dar erro claro, não 200.
    vazio = client.post("/transcribe", files={"file": ("vazio.wav", b"", "audio/wav")})
    check("arquivo vazio é recusado com mensagem", vazio.status_code == 400,
          f"{vazio.status_code}: {vazio.text[:120]}")

    subprocess.run(["rm", "-rf", tmp])
    print()
    if falhas:
        print(f"FALHOU: {len(falhas)} — {', '.join(falhas)}")
        return 1
    print("Tudo passou.")
    return 0


if __name__ == "__main__":
    sys.exit(main_test())
