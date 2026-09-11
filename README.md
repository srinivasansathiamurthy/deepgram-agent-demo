# Deepgram Documentation Voice Agent

A voice agent that answers questions about Deepgram's documentation. Talk to it in your browser — it listens via your microphone, reasons with Claude (Anthropic), looks up live Deepgram docs on demand, and responds in natural speech via Deepgram's Aura-2 TTS engine.

An **Audio Capture** tab lets you record Mac system audio (via BlackHole loopback) and your mic simultaneously into a stereo WAV, with optional QA flow automation that speaks eval questions via TTS at your own pace.

---

## What's in this repo

```
deepgram-agent-demo/
├── backend/
│   ├── config.py      # constants, env vars, system prompt, agent function definitions
│   ├── agent.py       # /api/voice-agent — WebSocket bridge to Deepgram Agent API
│   ├── docs.py        # /api/docs/* — live doc retrieval (Claude router + filter, httpx fetcher)
│   ├── capture.py     # /api/capture/* — audio recording + manual TTS question injection
│   ├── eval.py        # /api/eval/* — serves QA chat flows
│   ├── sessions.py    # Session class — chat_history.txt + metadata.json per session
│   └── server.py      # FastAPI app — wires routers, lifespan startup
├── frontend/
│   └── src/
│       ├── App.tsx                    # tab layout (Voice Agent / Audio Capture)
│       ├── hooks/useVoiceAgent.ts     # WebSocket + AudioContext logic, function call state
│       └── components/
│           ├── AudioCapture.tsx       # Audio Capture tab — recording + QA flow runner
│           ├── ChatHistory.tsx        # transcript display
│           └── StatusOrb.tsx          # animated connection indicator
├── eval/
│   ├── chat_flows.json   # 10 QA flows (10 questions each) covering docs + api_docs
│   └── rubric.md         # 4-dimension scoring rubric (accuracy, voice, scope, conciseness)
├── sessions/          # auto-created; one folder per voice agent session
├── audio_capture/     # auto-created; WAV files from the Capture tab
├── Pipfile            # Python dependencies (pipenv)
├── requirements.txt   # Python dependencies (pip)
├── start.sh           # starts backend + frontend dev server
└── .env               # your API keys (not committed)
```

---

## Architecture

### Voice Agent

```
Browser
  │
  ├── mic audio (PCM 24 kHz, linear16)
  │       │
  │       ▼
  │   FastAPI backend  ──────────────────►  Deepgram Agent API (WSS)
  │   (backend/agent.py)                    • STT: Nova-3
  │       │                                 • LLM: claude-sonnet-4-5 (via Deepgram)
  │       │  TTS audio (PCM 48 kHz)         • TTS: Aura-2-thalia-en
  │       ◄──────────────────────────────
  │
  └── AudioContext plays TTS at 48 kHz
```

### Doc retrieval (function calling)

When the agent calls `lookup_deepgram_docs(query)`:

```
FunctionCallRequest
  │
  ├── InjectAgentMessage → agent says "Let me check the docs…"
  │
  ▼
Two concurrent branch routers (Claude Sonnet)
  ├── docs branch    → selects relevant entries from 325 guide/tutorial URLs
  └── api_docs branch → selects relevant entries from 59 REST API reference URLs
  │
  ▼
Fetch selected pages concurrently (httpx, 10s timeout, 6000 char budget per branch)
  │
  ▼
Claude Haiku filter (if total > 1500 chars) → distilled excerpt
  │
  ▼
FunctionCallResponse → Deepgram → agent formulates spoken answer
```

### Audio Capture

```
Browser UI  ──POST /api/capture/start──►  sounddevice InputStream
                                           • primary:  BlackHole 2ch (system audio → L)
                                           • secondary: built-in mic (1ch → R)
            ──POST /api/capture/ask-next►  Deepgram TTS → afplay → spoken question
                                           (manual trigger, one question at a time)
            ──POST /api/capture/stop───►  stereo WAV → audio_capture/
```

Session data written to `sessions/<id>/chat_history.txt` and `metadata.json`.

---

## Prerequisites

- **Python 3.14** (via Homebrew: `brew install python@3.14`)
- **pipenv**: `pip install pipenv`
- **Node.js** 18+ and npm
- **Deepgram API key** — [console.deepgram.com](https://console.deepgram.com)
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com) (for doc routing + filtering)
- **BlackHole 2ch** (optional, for system-audio capture — see below)

---

## Installation

### 1. Clone and enter the repo

```bash
git clone <repo-url>
cd deepgram-agent-demo
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
DEEPGRAM_API_KEY=your_deepgram_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

### 3. Install Python dependencies

```bash
pipenv install
```

Or with pip:

```bash
pip install -r requirements.txt
```

### 4. Install frontend dependencies

```bash
cd frontend && npm install && cd ..
```

---

## BlackHole setup (for Audio Capture tab)

BlackHole is a virtual audio loopback driver that records whatever plays through your Mac's speakers.

```bash
brew install blackhole-2ch
```

Then **restart your Mac** (required for the driver to load).

**Create a Multi-Output Device:**

1. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup")
2. Click **+** → **Create Multi-Output Device**
3. Check both **BlackHole 2ch** and your speakers/headphones
4. Check **Drift Correction** on BlackHole
5. Right-click the new device → **Use This Device For Sound Output**

BlackHole now appears as an input device in the Audio Capture tab. Select it as **Input device** to capture everything playing on your Mac.

> To revert: System Settings → Sound → Output → select your speakers directly.

---

## Running

```bash
./start.sh
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173` ← open this in your browser

Or manually:

```bash
# backend
cd backend && pipenv run python server.py

# frontend (separate terminal)
cd frontend && npm run dev
```

---

## Usage

### Voice Agent tab

1. Click **Start** to connect (allow mic access when prompted)
2. Ask any question about Deepgram — STT, TTS, Voice Agent API, SDKs, auth, billing
3. When the agent calls `lookup_deepgram_docs`, it says a brief holding line, fetches live docs, then answers
4. Press `Space` to pause/resume · `Esc` to stop
5. Chat history + session metadata saved to `sessions/<session_id>/`

### Audio Capture tab

1. Select **Control** or **Experimental** (affects the output filename)
2. Optionally select a **QA Flow** (one of 10 pre-built question sets)
3. Select your **Input device** (BlackHole for system audio) and mic
4. Click **Start Capture**
5. If a flow is loaded: click **Ask** to speak the current question via TTS and advance to the next one — you control the pace
6. Click **Stop** to save the WAV

WAV files are saved to `audio_capture/<label>[_<flow_id>]_<start_ms>_<end_ms>.wav`
- L channel: system audio (agent voice)
- R channel: microphone (TTS questions + room)

---

## Eval QA flows

`eval/chat_flows.json` contains 10 flows (10 questions each) covering:

| # | Topic |
|---|-------|
| 1 | Nova-3 STT — models, languages, features |
| 2 | Nova-2 / Whisper STT — feature differences |
| 3 | Aura-2 TTS — voices, encoding, streaming |
| 4 | Aura-1 / Aura Asteria TTS |
| 5 | Voice Agent setup and configuration |
| 6 | Voice Agent function calling |
| 7 | Auth, API keys, usage |
| 8 | SDKs and CLI |
| 9 | Pre-recorded STT features |
| 10 | Telephony and integrations |

`eval/rubric.md` defines 4 scoring dimensions (0–5 each): Answer Accuracy, Voice Appropriateness, Scope Adherence, Conciseness.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Backend status |
| `WS` | `/api/voice-agent` | Deepgram Agent WebSocket bridge |
| `GET` | `/api/docs/index` | Full parsed doc index (debug) |
| `GET` | `/api/docs/search?q=` | Router step only — which entries would be fetched |
| `GET` | `/api/capture/devices` | List PortAudio input devices |
| `GET` | `/api/capture/status` | Current recording state + question progress |
| `POST` | `/api/capture/start` | Begin audio capture |
| `POST` | `/api/capture/stop` | Stop capture and write WAV |
| `POST` | `/api/capture/ask-next` | Speak current question via TTS and advance index |
| `GET` | `/api/eval/flows` | List all QA chat flows |

---

## TODO

### Diarization
- [ ] Script to split a stereo WAV from `audio_capture/` into transcripts using a Deepgram pre-recorded STT call
- [ ] Align transcript turns to timestamps so question/answer pairs can be extracted cleanly

### Eval comparison
- [ ] Decide comparison format: given two session transcripts (control vs experimental), what does the judge model score and how? (well off of the rubric, but make the actual script )
- [ ] Build the judge runner: feed `(question, control_answer, experimental_answer)` triples to Claude with the rubric, collect scores + rationale (and build the judge model)
- [ ] Lightweight results tracker (JSON or CSV) for score delta across runs
