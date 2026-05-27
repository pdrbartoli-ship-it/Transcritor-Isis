import os
import io
import math
import asyncio
import httpx
import tempfile
import subprocess
import json
import imageio_ffmpeg
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Transcritor Isis")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

MAX_CHUNK_BYTES = 23 * 1024 * 1024


class TranscriptionResult(BaseModel):
    transcript: str
    summary: str
    chunks_used: int
    duration_estimate: str


def extract_audio(input_path: str, output_path: str):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([
        ffmpeg, "-y", "-i", input_path,
        "-vn", "-acodec", "aac", "-b:a", "64k",
        output_path
    ], capture_output=True, check=True)


def get_duration(input_path: str) -> float:
    ffprobe = imageio_ffmpeg.get_ffprobe_exe()
    result = subprocess.run(
        [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", input_path],
        capture_output=True, text=True
    )
    info = json.loads(result.stdout)
    return float(info["format"]["duration"])


def split_audio(input_path: str, tmpdir: str, num_chunks: int, total_seconds: float) -> list[str]:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    chunk_duration = total_seconds / num_chunks
    chunk_paths = []
    for i in range(num_chunks):
        start = i * chunk_duration
        output_path = os.path.join(tmpdir, f"chunk_{i}.m4a")
        subprocess.run([
            ffmpeg, "-y", "-i", input_path,
            "-ss", str(start), "-t", str(chunk_duration),
            "-acodec", "aac", "-b:a", "64k",
            output_path
        ], capture_output=True, check=True)
        chunk_paths.append(output_path)
    return chunk_paths


async def transcribe_chunk(client: httpx.AsyncClient, audio_bytes: bytes, chunk_index: int) -> str:
    files = {
        "file": (f"chunk_{chunk_index}.m4a", io.BytesIO(audio_bytes), "audio/m4a"),
        "model": (None, "whisper-large-v3-turbo"),
        "response_format": (None, "text"),
        "language": (None, "pt"),
    }
    response = await client.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
        files=files,
        timeout=180.0,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Erro na transcrição (parte {chunk_index + 1}): {response.text}")
    return response.text.strip()


async def summarize(client: httpx.AsyncClient, transcript: str) -> str:
    response = await client.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": f"""Você recebeu a transcrição de um áudio gravado no iPhone. Crie um resumo estruturado em português com:

**🎯 Tema principal** — uma frase resumindo o assunto

**📌 Pontos principais** — lista dos tópicos mais importantes discutidos

**✅ Conclusões / Ações** — o que foi decidido, combinado ou concluído (se houver)

**💬 Observações** — contexto ou detalhes relevantes (se houver)

Seja direto e use linguagem natural.

Transcrição:
{transcript}"""
            }]
        },
        timeout=60.0,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Erro ao gerar resumo: {response.text}")
    return response.json()["content"][0]["text"]


@app.get("/")
async def health():
    return {"status": "ok", "service": "Transcritor Isis"}


@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe(file: UploadFile = File(...)):
    if not GROQ_API_KEY or not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Chaves de API não configuradas.")

    audio_bytes = await file.read()
    filename = file.filename or "audio.m4a"

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, filename)
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        audio_path = os.path.join(tmpdir, "audio.m4a")
        try:
            extract_audio(input_path, audio_path)
        except subprocess.CalledProcessError:
            raise HTTPException(status_code=400, detail=f"Não foi possível processar o arquivo: {filename}")

        audio_size = os.path.getsize(audio_path)
        total_seconds = get_duration(audio_path)

        minutes = total_seconds / 60
        if minutes < 1:
            duration_str = "menos de 1 minuto"
        elif minutes < 60:
            duration_str = f"~{int(minutes)} minutos"
        else:
            hours = int(minutes // 60)
            mins = int(minutes % 60)
            duration_str = f"~{hours}h{mins:02d}min"

        num_chunks = max(1, math.ceil(audio_size / MAX_CHUNK_BYTES))
        chunk_paths = [audio_path] if num_chunks == 1 else split_audio(audio_path, tmpdir, num_chunks, total_seconds)

        chunks_bytes = []
        for path in chunk_paths:
            with open(path, "rb") as f:
                chunks_bytes.append(f.read())

    async with httpx.AsyncClient() as client:
        tasks = [transcribe_chunk(client, chunk, i) for i, chunk in enumerate(chunks_bytes)]
        transcripts = await asyncio.gather(*tasks)
        full_transcript = " ".join(transcripts)
        summary = await summarize(client, full_transcript)

    return TranscriptionResult(
        transcript=full_transcript,
        summary=summary,
        chunks_used=num_chunks,
        duration_estimate=duration_str,
    )
