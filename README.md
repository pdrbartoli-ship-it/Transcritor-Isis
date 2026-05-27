# Transcritor Isis

App de transcrição e resumo de áudios e vídeos.

## Estrutura

- `frontend/` — site estático (GitHub Pages)
- `backend/` — servidor Python/FastAPI (Render)

## URLs

- Frontend: https://pdrbartoli-ship-it.github.io/transcritor-isis/
- Backend: https://transcritor-backend.onrender.com

## Como funciona

1. Usuário envia áudio ou vídeo pelo site
2. Backend extrai o áudio (ffmpeg), fatia se necessário, transcreve (Groq Whisper) e resume (Claude Haiku)
3. Resultado aparece na tela com botões de copiar
