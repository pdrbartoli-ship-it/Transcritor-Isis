import os
import io
import math
import asyncio
import httpx
import tempfile
import subprocess
import json
import imageio_ffmpeg
from urllib.parse import urlparse, parse_qs
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Dito")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Erro interno: {type(exc).__name__}: {str(exc)}"},
        headers={"Access-Control-Allow-Origin": "*"},
    )

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
YOUTUBE_COOKIES = os.environ.get("YOUTUBE_COOKIES", "")
SUPADATA_API_KEY = os.environ.get("SUPADATA_API_KEY", "")

MAX_CHUNK_BYTES = 23 * 1024 * 1024

VIDEO_HOSTS = [
    "youtube.com", "youtu.be", "instagram.com", "tiktok.com",
    "vimeo.com", "twitter.com", "x.com", "facebook.com", "fb.watch",
]


class TranscriptionResult(BaseModel):
    transcript: str
    summary: str
    chunks_used: int
    duration_estimate: str


class SessionContext(BaseModel):
    title: str
    date: str
    transcript: str | None = None
    summary: str | None = None


class ChatRequest(BaseModel):
    question: str
    client_name: str
    sessions: list[SessionContext]


class ChatResponse(BaseModel):
    answer: str


class FolderInfo(BaseModel):
    id: str
    name: str
    description: str | None = None


class SuggestFolderRequest(BaseModel):
    transcript: str
    folders: list[FolderInfo] = []


class SuggestFolderResponse(BaseModel):
    folder_id: str | None = None
    suggested_new_name: str | None = None
    reason: str = ""


def is_video_url(url: str) -> bool:
    host = urlparse(url).netloc.lower().replace("www.", "")
    return any(h in host for h in VIDEO_HOSTS)


def is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower().replace("www.", "")
    return host in ("youtube.com", "youtu.be", "m.youtube.com")


def extract_youtube_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = parsed.netloc.lower().replace("www.", "").replace("m.", "")
    if host == "youtu.be":
        return parsed.path.lstrip("/").split("?")[0]
    if "youtube.com" in host:
        qs = parse_qs(parsed.query)
        if "v" in qs:
            return qs["v"][0]
        parts = [p for p in parsed.path.split("/") if p]
        for i, part in enumerate(parts):
            if part in ("shorts", "embed", "live") and i + 1 < len(parts):
                return parts[i + 1]
    return None


def extract_audio(input_path: str, output_path: str):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([
        ffmpeg, "-y", "-i", input_path,
        "-vn", "-acodec", "aac", "-b:a", "64k",
        output_path
    ], capture_output=True, check=True)


def get_duration(input_path: str) -> float:
    try:
        ffprobe = imageio_ffmpeg.get_ffprobe_exe()
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", input_path],
            capture_output=True, text=True
        )
        info = json.loads(result.stdout)
        return float(info["format"]["duration"])
    except Exception:
        return 0.0


def format_duration(total_seconds: float) -> str:
    minutes = total_seconds / 60
    if minutes < 1:
        return "menos de 1 minuto"
    elif minutes < 60:
        return f"~{int(minutes)} minutos"
    else:
        hours = int(minutes // 60)
        mins = int(minutes % 60)
        return f"~{hours}h{mins:02d}min"


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
    try:
        response = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files=files,
            timeout=180.0,
        )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Tempo esgotado na transcrição (parte {chunk_index + 1}). Tente um arquivo menor.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Erro de conexão com serviço de transcrição: {e}")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Erro na transcrição (parte {chunk_index + 1}): {response.text}")
    return response.text.strip()


def build_summary_prompt(transcript: str, detailed: bool, prefs: dict) -> str:
    pref_block = ""
    tone_map = {"Formal": "formal e profissional", "Casual": "casual e acessível", "Técnico": "técnico e preciso"}
    style_map = {"Tópicos": "use listas com marcadores (bullet points)", "Parágrafos": "use parágrafos corridos"}

    if prefs.get("tone"):
        pref_block += f"\n- Tom: {tone_map.get(prefs['tone'], prefs['tone'])}"
    if prefs.get("style"):
        pref_block += f"\n- Estilo: {style_map.get(prefs['style'], prefs['style'])}"

    pref_instruction = f"\n\nPreferências do usuário:{pref_block}" if pref_block else ""

    if detailed:
        return f"""Você recebeu uma transcrição. Crie um resumo DETALHADO E EXTENSO em português.{pref_instruction}

**🎯 Tema principal** — uma frase resumindo o assunto

**📌 Pontos principais** — lista completa de todos os tópicos abordados, com sub-pontos quando necessário

**🔍 Análise aprofundada** — desenvolvimento dos temas mais relevantes, com contexto e nuances importantes

**✅ Conclusões / Ações** — o que foi decidido, combinado ou concluído

**💬 Citações relevantes** — trechos importantes ou falas marcantes (se houver)

**📎 Observações** — contexto adicional, ressalvas ou detalhes complementares

Seja abrangente e detalhado. Não omita informações relevantes.

Transcrição:
{transcript}"""
    else:
        return f"""Você recebeu uma transcrição. Crie um resumo estruturado e conciso em português.{pref_instruction}

**🎯 Tema principal** — uma frase resumindo o assunto

**📌 Pontos principais** — lista dos tópicos mais importantes discutidos

**✅ Conclusões / Ações** — o que foi decidido, combinado ou concluído (se houver)

**💬 Observações** — contexto ou detalhes relevantes (se houver)

Seja direto e use linguagem natural.

Transcrição:
{transcript}"""


async def summarize(client: httpx.AsyncClient, transcript: str, detailed: bool = False, prefs: dict = {}) -> str:
    model = "claude-sonnet-4-6" if detailed else "claude-haiku-4-5-20251001"
    max_tokens = 3000 if detailed else 1024

    response = await client.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{
                "role": "user",
                "content": build_summary_prompt(transcript, detailed, prefs),
            }]
        },
        timeout=120.0,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Erro ao gerar resumo: {response.text}")
    return response.json()["content"][0]["text"]


async def process_audio_bytes(audio_bytes: bytes, filename: str) -> tuple[str, int, str]:
    """Returns (full_transcript, num_chunks, duration_str)"""
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
        duration_str = format_duration(total_seconds)

        num_chunks = max(1, math.ceil(audio_size / MAX_CHUNK_BYTES))
        chunk_paths = [audio_path] if num_chunks == 1 else split_audio(audio_path, tmpdir, num_chunks, total_seconds)

        chunks_bytes = []
        for path in chunk_paths:
            with open(path, "rb") as f:
                chunks_bytes.append(f.read())

    async with httpx.AsyncClient() as client:
        tasks = [transcribe_chunk(client, chunk, i) for i, chunk in enumerate(chunks_bytes)]
        transcripts = await asyncio.gather(*tasks)

    return " ".join(transcripts), num_chunks, duration_str


@app.get("/")
async def health():
    return {"status": "ok", "service": "Dito"}


@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe(
    file: UploadFile = File(...),
    detailed: bool = Form(False),
    preferences: str = Form("{}"),
):
    if not GROQ_API_KEY or not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Chaves de API não configuradas.")

    try:
        prefs = json.loads(preferences)
    except Exception:
        prefs = {}

    audio_bytes = await file.read()
    filename = file.filename or "audio.m4a"

    full_transcript, num_chunks, duration_str = await process_audio_bytes(audio_bytes, filename)

    async with httpx.AsyncClient() as client:
        summary = await summarize(client, full_transcript, detailed=detailed, prefs=prefs)

    return TranscriptionResult(
        transcript=full_transcript,
        summary=summary,
        chunks_used=num_chunks,
        duration_estimate=duration_str,
    )


@app.post("/process-url", response_model=TranscriptionResult)
async def process_url(
    url: str = Form(...),
    detailed: bool = Form(False),
    preferences: str = Form("{}"),
):
    if not GROQ_API_KEY or not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Chaves de API não configuradas.")

    try:
        prefs = json.loads(preferences)
    except Exception:
        prefs = {}

    if is_video_url(url):
        if is_youtube_url(url):
            video_id = extract_youtube_id(url)
            if not video_id:
                raise HTTPException(status_code=400, detail="URL do YouTube inválida.")

            full_transcript = None
            num_chunks = 1
            duration_str = "–"

            # Step 1: Supadata API (no proxy needed, covers videos with captions)
            if SUPADATA_API_KEY:
                try:
                    async with httpx.AsyncClient() as sup_client:
                        resp = await sup_client.get(
                            "https://api.supadata.ai/v1/youtube/transcript",
                            headers={"x-api-key": SUPADATA_API_KEY},
                            params={"videoId": video_id, "text": "true"},
                            timeout=30.0,
                        )
                    if resp.status_code == 200:
                        content = resp.json().get("content", "")
                        if content:
                            full_transcript = content
                            total_words = len(full_transcript.split())
                            duration_str = f"~{max(1, total_words // 150)} min"
                except Exception:
                    pass  # fall through to yt-dlp

            # Step 2: yt-dlp with cookies (fallback — any video, including no-captions)
            if full_transcript is None and YOUTUBE_COOKIES:
                with tempfile.TemporaryDirectory() as tmpdir:
                    cookies_path = os.path.join(tmpdir, "yt_cookies.txt")
                    with open(cookies_path, "w") as f:
                        f.write(YOUTUBE_COOKIES)
                    output_template = os.path.join(tmpdir, "video.%(ext)s")
                    try:
                        result = subprocess.run(
                            [
                                "yt-dlp",
                                "--extract-audio", "--audio-format", "m4a",
                                "--audio-quality", "64K",
                                "--no-playlist",
                                "--cookies", cookies_path,
                                "-o", output_template,
                                url,
                            ],
                            capture_output=True, text=True, timeout=300,
                        )
                        if result.returncode != 0:
                            raise HTTPException(status_code=400, detail=f"Não foi possível baixar o vídeo: {result.stderr[:200]}")
                    except subprocess.TimeoutExpired:
                        raise HTTPException(status_code=400, detail="Tempo esgotado ao baixar o vídeo.")
                    audio_files = [f for f in os.listdir(tmpdir) if f.endswith((".m4a", ".mp3", ".webm", ".opus"))]
                    if not audio_files:
                        raise HTTPException(status_code=400, detail="Não foi possível extrair áudio do link.")
                    audio_path = os.path.join(tmpdir, audio_files[0])
                    with open(audio_path, "rb") as f:
                        audio_bytes = f.read()
                full_transcript, num_chunks, duration_str = await process_audio_bytes(audio_bytes, "video.m4a")

            # Step 3: nothing configured — clear error with instructions
            if full_transcript is None:
                raise HTTPException(
                    status_code=400,
                    detail="Para processar vídeos do YouTube configure no Render: SUPADATA_API_KEY (recomendado, supadata.ai) ou YOUTUBE_COOKIES como alternativa.",
                )
        else:
            # Instagram, TikTok, Vimeo, etc. — download via yt-dlp
            with tempfile.TemporaryDirectory() as tmpdir:
                output_template = os.path.join(tmpdir, "video.%(ext)s")
                try:
                    result = subprocess.run(
                        [
                            "yt-dlp",
                            "--extract-audio", "--audio-format", "m4a",
                            "--audio-quality", "64K",
                            "--no-playlist",
                            "--extractor-args", "youtube:player_client=ios,android",
                            "-o", output_template,
                            url,
                        ],
                        capture_output=True, text=True, timeout=300
                    )
                    if result.returncode != 0:
                        raise HTTPException(status_code=400, detail=f"Não foi possível baixar o vídeo: {result.stderr[:200]}")
                except subprocess.TimeoutExpired:
                    raise HTTPException(status_code=400, detail="Tempo esgotado ao baixar o vídeo.")

                audio_files = [f for f in os.listdir(tmpdir) if f.endswith((".m4a", ".mp3", ".webm", ".opus"))]
                if not audio_files:
                    raise HTTPException(status_code=400, detail="Não foi possível extrair áudio do link.")

                audio_path = os.path.join(tmpdir, audio_files[0])
                with open(audio_path, "rb") as f:
                    audio_bytes = f.read()

            full_transcript, num_chunks, duration_str = await process_audio_bytes(audio_bytes, "video.m4a")

    else:
        # Extract text from article/news page
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            raise HTTPException(status_code=400, detail="Não foi possível acessar a página.")

        text = trafilatura.extract(downloaded, include_comments=False, include_tables=False)
        if not text or len(text.strip()) < 100:
            raise HTTPException(status_code=400, detail="Não foi possível extrair conteúdo legível desta página.")

        full_transcript = text.strip()
        num_chunks = 1
        duration_str = f"~{len(full_transcript.split()) // 200} min de leitura"

    async with httpx.AsyncClient() as client:
        summary = await summarize(client, full_transcript, detailed=detailed, prefs=prefs)

    return TranscriptionResult(
        transcript=full_transcript,
        summary=summary,
        chunks_used=num_chunks,
        duration_estimate=duration_str,
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Chave de API não configurada.")

    # Each session carries the FULL transcript (the source of truth) plus the
    # summary. The transcript is what the assistant must reason over — the
    # summary is only an aid. Sending the whole transcript is what lets the
    # model answer specific questions about a video/audio it transcribed.
    sessions_text = ""
    for i, s in enumerate(request.sessions, 1):
        sessions_text += f"\n### Sessão {i}: {s.title} ({s.date})\n"
        if s.summary:
            sessions_text += f"Resumo: {s.summary}\n"
        if s.transcript:
            sessions_text += f"Transcrição completa:\n\"\"\"\n{s.transcript}\n\"\"\"\n"

    prompt = f"""Você é um assistente especializado que ajuda profissionais a consultar e analisar suas sessões com o cliente "{request.client_name}".

Cada sessão abaixo inclui a TRANSCRIÇÃO COMPLETA do áudio/vídeo (entre aspas triplas) e, quando disponível, um resumo. A transcrição é a fonte de verdade: você TEM acesso ao conteúdo completo de cada gravação. Use a transcrição inteira para responder, não apenas o resumo. Nunca diga que não tem acesso ao conteúdo — ele está abaixo.

Sessões disponíveis:{sessions_text}

Responda em português de forma clara e objetiva, baseando-se nas transcrições. Se a resposta envolver algo de uma sessão específica, mencione-a pelo título e, quando útil, cite o trecho relevante. Só diga que não encontrou a informação se ela realmente não estiver em nenhuma transcrição.

Pergunta: {request.question}"""

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=120.0,
        )
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Erro ao consultar IA: {response.text}")
        answer = response.json()["content"][0]["text"]

    return ChatResponse(answer=answer)


@app.post("/suggest-folder", response_model=SuggestFolderResponse)
async def suggest_folder(request: SuggestFolderRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Chave de API não configurada.")

    excerpt = request.transcript[:4000]

    folders_text = ""
    for f in request.folders:
        desc = f" — {f.description}" if f.description else ""
        folders_text += f'\n- id: "{f.id}" | nome: "{f.name}"{desc}'
    if not folders_text:
        folders_text = "\n(nenhuma pasta existente)"

    prompt = f"""Você organiza transcrições em pastas. Analise o conteúdo abaixo e decida em qual pasta ele se encaixa melhor.

Pastas existentes:{folders_text}

Conteúdo (trecho da transcrição):
\"\"\"
{excerpt}
\"\"\"

Regras:
- Se o conteúdo claramente pertence a uma pasta existente (mesma pessoa, processo, tema ou contexto), retorne o id dela.
- Se não houver pasta adequada, proponha um nome curto e claro para uma nova pasta (ex.: nome da pessoa/cliente, processo ou tema principal).
- Nunca invente um id que não esteja na lista.

Responda APENAS com um JSON válido, sem texto extra, no formato:
{{"folder_id": "<id existente ou null>", "suggested_new_name": "<nome para nova pasta ou null>", "reason": "<uma frase curta explicando a escolha>"}}"""

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=60.0,
        )
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Erro ao sugerir pasta: {response.text}")
        raw = response.json()["content"][0]["text"].strip()

    # The model may wrap the JSON in ```json fences — strip them defensively.
    if raw.startswith("```"):
        raw = raw.split("```")[1] if "```" in raw[3:] else raw
        raw = raw.replace("json", "", 1).strip().strip("`").strip()
    try:
        data = json.loads(raw)
    except Exception:
        return SuggestFolderResponse(folder_id=None, suggested_new_name=None, reason="")

    folder_id = data.get("folder_id")
    # Guard against hallucinated ids.
    valid_ids = {f.id for f in request.folders}
    if folder_id not in valid_ids:
        folder_id = None

    return SuggestFolderResponse(
        folder_id=folder_id,
        suggested_new_name=data.get("suggested_new_name") if not folder_id else None,
        reason=data.get("reason", "") or "",
    )
