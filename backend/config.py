import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── Deepgram ──────────────────────────────────────────────────────────────────

DEEPGRAM_API_KEY  = os.environ.get("DEEPGRAM_API_KEY", "")
DEEPGRAM_AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse"

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

if not DEEPGRAM_API_KEY:
    print("WARNING: DEEPGRAM_API_KEY is not set — connections to Deepgram will fail.")
if not ANTHROPIC_API_KEY:
    print("WARNING: ANTHROPIC_API_KEY is not set — doc lookup functions will not work.")

# ── audio ─────────────────────────────────────────────────────────────────────

STT_SAMPLE_RATE = 24_000   # Hz — mic → Deepgram Nova-3
TTS_SAMPLE_RATE = 48_000   # Hz — Deepgram Aura-2 → browser (max linear16 quality)

# ── paths ─────────────────────────────────────────────────────────────────────

_ROOT             = Path(__file__).parent.parent
SESSIONS_DIR      = _ROOT / "sessions"
AUDIO_CAPTURE_DIR = _ROOT / "audio_capture"
DEBUG_DIR         = _ROOT / "debug"

# ── docs retrieval ────────────────────────────────────────────────────────────

LLMS_TXT_URL              = "https://developers.deepgram.com/llms.txt"
DOC_MAX_CHARS             = 6_000   # total char budget across fetched pages per branch
DOC_MIN_CHUNK_CHARS       = 200     # minimum chars remaining before we skip a page
DOC_FILTER_THRESHOLD      = 1_500   # skip filter pass if fetched content is shorter than this
DOC_FILTER_OUTPUT_CHARS   = 1_200   # max chars the filter pass should return
DOC_ROUTER_MAX_ENTRIES    = 4       # max index entries the router may select
DOC_ROUTER_MAX_TOKENS     = 256     # max_tokens for router Claude call
DOC_FILTER_MAX_TOKENS     = 600     # max_tokens for filter Claude call
DOC_ROUTER_MODEL          = "claude-sonnet-4-6"
DOC_FILTER_MODEL          = "claude-haiku-4-5-20251001"
DOC_FETCH_TIMEOUT         = 10      # seconds per HTTP request

# ── agent function definitions ────────────────────────────────────────────────

AGENT_FUNCTIONS = [
    {
        "name":        "lookup_deepgram_docs",
        "description": (
            "Search and retrieve current Deepgram documentation for a topic or question. "
            "Call this whenever you need accurate, up-to-date details about any Deepgram "
            "API, feature, model, or SDK."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type":        "string",
                    "description": "Concise topic or question to look up in the docs",
                }
            },
            "required": ["query"],
        },
        "defer_until_eot": False,
    }
]

# ── agent personality ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
## CRITICAL: YOU ARE A TEXT GENERATOR FOR A VOICE SYSTEM
You generate text that will be spoken aloud by a text-to-speech engine.
Generate ONLY plain conversational prose. No markdown, headers, bullet points,
bold, italics, brackets, or lists. Write as if scripting someone to read aloud.
Keep answers to 1-3 sentences. Never exceed 300 characters for simple answers
or 500 characters for complex technical explanations.

## YOUR ROLE
You are an expert voice assistant for Deepgram's developer documentation.
You answer questions about Deepgram's products: speech-to-text, text-to-speech,
the Voice Agent API, SDKs, authentication, and billing.

## WHEN TO CALL FUNCTIONS
When a caller asks about a specific Deepgram feature, API parameter, SDK usage,
or any detail you are not fully certain about, call lookup_deepgram_docs with a
concise query describing what they need. Call the function immediately without
narrating it — do not say "let me look that up" or "give me a moment." The system
handles the pause automatically. After receiving the function result, summarize
the relevant information conversationally in 1-3 sentences.

## SPEAKING STYLE
Read model names naturally: say "Nova three" not "Nova-3", "Aura two" not "Aura-2".
Say "WebSocket" as two words. Spell out acronyms on first use: "STT, that is
speech-to-text". Avoid technical jargon when a plain word works just as well.

## SCOPE
You cover Deepgram's products only. For questions outside Deepgram's documentation,
say "That's outside what I can help with, but Deepgram's support team at
deepgram dot com would be a great resource."

## ACCURACY
If a function result does not contain enough information to answer confidently,
say so plainly rather than guessing. Never fabricate API parameters, model names,
or pricing details.\
"""

FUNCTION_CALL_ACK_MESSAGE = (
    "Let me check the documentation on that — just a moment."
)

GREETING = (
    "Hello! I'm a voice assistant for Deepgram's developer documentation. "
    "Ask me anything about speech-to-text, text-to-speech, the Voice Agent API, "
    "SDKs, or anything else Deepgram. How can I help you today?"
)
