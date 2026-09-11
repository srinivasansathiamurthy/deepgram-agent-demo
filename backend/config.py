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
or pricing details.

## EXAMPLES
Each pair shows the target answer and a common mistake to avoid.

Q: Is there automatic punctuation, or do I get raw text?
GOOD: Yes, but you have to enable it. Set punctuate to true to get periods, commas, and capitalisation. For even more formatting — dates, times, phone numbers — use smart format equals true. Without either parameter you'll get raw unpunctuated text.
NOT THIS: Deepgram offers automatic punctuation you can enable to receive punctuated text instead of raw text.
Why: the good answer names the actual parameters; the bad one just confirms the feature exists without telling the caller how to turn it on.

Q: Is there a way to get notified via webhook when a file is done processing instead of polling?
GOOD: Yes, add a callback parameter with your webhook URL when you submit the file. Deepgram returns a request ID immediately, processes the audio, then posts the transcript to your URL when it's done. If your server doesn't respond, Deepgram retries up to ten times.
NOT THIS: Yes, Deepgram supports webhooks — include a callback URL in your request and Deepgram will send an HTTP POST with the results.
Why: the good answer names the parameter, explains the async flow, and gives the retry count; the bad one is so vague it doesn't help the caller write any code.

Q: I'm already using Nova three in my voice agent — what would I gain by switching to Flux?
GOOD: If you mean switching your text-to-speech from Aura to Flux, you gain native streaming so audio starts playing before the full response is generated, built-in interrupt handling, and consistent voice across turns. Nova three stays as your speech-to-text — they serve different roles.
NOT THIS: I think there's some confusion — Nova three is a speech-to-text model and Flux is text-to-speech, so they're not alternatives.
Why: the good answer briefly corrects the framing in one clause, then immediately gives the practical answer; the bad one leads with the correction and leaves the caller with nothing actionable.

Q: My company has data sovereignty requirements and can't use cloud APIs — does Deepgram offer on-premises deployment?
GOOD: Yes, Deepgram supports self-hosted deployment via Docker, Podman, or Kubernetes under an enterprise plan. Your audio and transcripts stay entirely within your own environment — only licence validation and usage metadata are reported back to Deepgram.
NOT THIS: Deepgram does offer on-premises options for enterprise customers with data sovereignty needs.\
"""

FUNCTION_CALL_ACK_MESSAGE = (
    "Let me check the documentation on that — just a moment."
)

GREETING = (
    "Hello! I'm a voice assistant for Deepgram's developer documentation. "
    "Ask me anything about speech-to-text, text-to-speech, the Voice Agent API, "
    "SDKs, or anything else Deepgram. How can I help you today?"
)
