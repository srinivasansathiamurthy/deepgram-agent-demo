"""
Deepgram Documentation Voice Agent — thin orchestrator.

Wires together:
  capture.router  — /api/capture/* (sounddevice audio recording)
  agent.router    — /api/voice-agent (Deepgram WS bridge)
  docs.router     — /api/docs/* (documentation retrieval pipeline)

Session files:  sessions/<session_id>/chat_history.txt
Audio captures: audio_capture/<label>_<start_ms>_<end_ms>.wav
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import docs
from config import DEEPGRAM_API_KEY, SESSIONS_DIR, AUDIO_CAPTURE_DIR
from capture import router as capture_router
from agent import router as agent_router
from docs import router as docs_router

# ── lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await docs.load_index()
    yield

# ── app ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Deepgram Documentation Voice Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(capture_router)
app.include_router(agent_router)
app.include_router(docs_router)

# ── health ─────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    try:
        import sounddevice  # noqa: F401
        sd_ok = True
    except ImportError:
        sd_ok = False

    return {
        "status":                "ok",
        "deepgram_key_set":      bool(DEEPGRAM_API_KEY),
        "sounddevice_available": sd_ok,
        "think_provider":        "anthropic/claude-sonnet-4-5 (managed by Deepgram)",
    }

# ── static frontend ────────────────────────────────────────────────────────────

_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="static")

# ── entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"\n  Deepgram Documentation Voice Agent")
    print(f"   Backend  →  http://localhost:{port}")
    print(f"   Health   →  http://localhost:{port}/api/health")
    print(f"   Sessions →  {SESSIONS_DIR.resolve()}")
    print(f"   Audio    →  {AUDIO_CAPTURE_DIR}\n")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
