import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── Deepgram ──────────────────────────────────────────────────────────────────

DEEPGRAM_API_KEY  = os.environ.get("DEEPGRAM_API_KEY", "")
DEEPGRAM_AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse"

if not DEEPGRAM_API_KEY:
    print("WARNING: DEEPGRAM_API_KEY is not set — connections to Deepgram will fail.")

# ── audio ─────────────────────────────────────────────────────────────────────

STT_SAMPLE_RATE = 24_000   # Hz — mic → Deepgram Nova-3
TTS_SAMPLE_RATE = 48_000   # Hz — Deepgram Aura-2 → browser (max linear16 quality)

# ── paths ─────────────────────────────────────────────────────────────────────

_ROOT             = Path(__file__).parent.parent
SESSIONS_DIR      = _ROOT / "sessions"
AUDIO_CAPTURE_DIR = _ROOT / "audio_capture"

# ── agent personality ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert voice assistant specialised in Deepgram's products and documentation.
You have deep, accurate knowledge of:
  • Speech-to-Text (STT) — Nova-3 / Nova-2 / Whisper models, streaming vs pre-recorded,
    smart formatting, diarisation, language detection, custom vocabulary
  • Text-to-Speech (TTS) — Aura-2 and Flux model families, voice cloning, SSML support
  • Voice Agent API — WebSocket protocol, Settings/UpdatePrompt/FunctionCall messages,
    multi-agent handoffs, telephony integration
  • SDKs — Python, JavaScript, Go, .NET, Rust; npm packages, pip packages
  • Authentication — API keys, temporary tokens, project scoping
  • Platform — usage-based billing, rate limits, model versioning

Always answer from factual knowledge of Deepgram's official documentation.
If you are unsure about a specific detail, say so clearly rather than guessing.
Respond in a single, complete answer — do not send follow-up messages or continue
elaborating after your first response. Stop after answering the question.
Keep answers to 1-3 sentences because this is a voice interface.
Avoid bullet lists or markdown; speak in natural prose.\
"""

GREETING = (
    "Hello! I'm a voice agent built to answer questions about Deepgram's documentation. "
    "Ask me anything — speech-to-text, text-to-speech, the Voice Agent API, SDKs, or "
    "anything else about Deepgram. How can I help you today?"
)
