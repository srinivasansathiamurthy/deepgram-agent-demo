# Deepgram Documentation Voice Agent

A voice agent demo that answers questions about Deepgram's documentation. Talk to it in your browser — it listens via your microphone, reasons with Claude (Anthropic), and responds in natural speech via Deepgram's Aura-2 TTS engine.

A separate **Audio Capture** tab lets you record Mac system audio (via BlackHole loopback) and your mic simultaneously into a stereo WAV, independently of the voice agent, for later diarization or analysis.

---

## What's in this repo

```
deepgram-agent-demo/
├── backend/
│   ├── config.py      # constants, env vars, system prompt
│   ├── sessions.py    # Session class — creates session dir, writes chat_history.txt
│   ├── capture.py     # /api/capture/* — sounddevice audio recording (BlackHole + mic)
│   ├── agent.py       # /api/voice-agent — WebSocket bridge to Deepgram Agent API
│   └── server.py      # FastAPI app — wires routers, health endpoint, static file serving
├── frontend/
│   └── src/
│       ├── App.tsx                    # tab layout (Voice Agent / Audio Capture)
│       ├── hooks/useVoiceAgent.ts     # WebSocket + AudioContext logic
│       └── components/
│           ├── AudioCapture.tsx       # Audio Capture tab UI
│           ├── ChatHistory.tsx        # transcript display
│           └── StatusOrb.tsx          # animated connection indicator
├── sessions/          # auto-created; one folder per voice agent session
├── audio_capture/     # auto-created; WAV files from the Capture tab
├── Pipfile            # Python dependencies (pipenv)
├── requirements.txt   # Python dependencies (pip)
├── start.sh           # starts backend + frontend dev server
└── .env               # your API keys (not committed)
```

---

## Architecture

```
Browser
  │
  ├── mic audio (PCM 24 kHz, linear16)
  │       │
  │       ▼
  │   FastAPI backend  ──────────────────►  Deepgram Agent API (WSS)
  │   (backend/server.py)                   • STT: Nova-3  (24 kHz input)
  │       │                                 • LLM: claude-sonnet-4-5 (via Deepgram)
  │       │  TTS audio (PCM 48 kHz)         • TTS: Aura-2-thalia-en (48 kHz output)
  │       ◄──────────────────────────────
  │
  └── AudioContext plays TTS at 48 kHz

Audio Capture tab (independent of voice agent)
  Browser UI  ──POST /api/capture/start──►  sounddevice InputStream
                                             • primary:  BlackHole 2ch (system audio)
                                             • secondary: built-in mic (1ch)
              ──POST /api/capture/stop───►  stereo WAV written to audio_capture/
                                             • L channel: system audio (mono-downmixed)
                                             • R channel: microphone
```

Session data written to `sessions/<session_id>/chat_history.txt`. No audio is saved per session — use the Audio Capture tab for that.

---

## Prerequisites

- **Python 3.14** (via Homebrew: `brew install python@3.14`)
- **pipenv**: `pip install pipenv`
- **Node.js** 18+ and npm
- **Deepgram API key** — [console.deepgram.com](https://console.deepgram.com)
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

Edit `.env` and add your Deepgram API key:

```
DEEPGRAM_API_KEY=your_key_here
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

BlackHole is a virtual audio loopback driver that lets you record whatever is playing through your Mac's speakers.

### Install BlackHole

```bash
brew install blackhole-2ch
```

Then **restart your Mac** (required for the driver to load).

### Create a Multi-Output Device

1. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup")
2. Click **+** in the bottom-left → **Create Multi-Output Device**
3. Check both **BlackHole 2ch** and your speakers/headphones
4. Check **Drift Correction** on BlackHole
5. Right-click the new device → **Use This Device For Sound Output**

Your Mac now plays audio through both your speakers and BlackHole simultaneously. BlackHole shows up as an input device in the Audio Capture tab — select it as the **Input device** to capture everything playing on your Mac.

> To revert to normal output: go to System Settings → Sound → Output and select your speakers directly.

---

## Running

```bash
./start.sh
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173` ← open this in your browser

Or start each process manually:

```bash
# backend
cd backend && pipenv run python server.py

# frontend (in a separate terminal)
cd frontend && npm run dev
```

---

## Usage

### Voice Agent tab

- Click **Connect** (or press `Space`) to start a session
- Speak — the agent will respond with voice and show the transcript
- Click **Disconnect** (or press `Esc`) to end the session
- Chat history is saved to `sessions/<session_id>/chat_history.txt`

### Audio Capture tab

- Choose **Control** or **Experimental** label (affects the output filename)
- Select your **Input device** (BlackHole recommended for system audio)
- Toggle **Microphone** on to also capture your mic in the right channel
- Click **Start Capture** → do your recording → click **Stop**
- WAV saved to `audio_capture/<label>_<start_ms>_<end_ms>.wav`
  - Stereo: system audio on L, mic on R — ready for per-speaker diarization

---

## TODO

### Deepgram docs ingestion
- [ ] Fetch and parse `https://developers.deepgram.com/llms.txt` into structured knowledge (endpoints, models, parameters, code examples)
- [ ] Functions to query that knowledge at runtime so the agent can cite specific, up-to-date doc content rather than relying solely on training data
- [ ] Refresh strategy (cron or on-demand) so the knowledge stays current as Deepgram ships new features

### Diarization pipeline
- [ ] Script to run speaker diarization on any WAV in `audio_capture/` — stereo files already have system audio on L and mic on R, so channel splitting gives a free head start before model-based diarization
- [ ] Output per-speaker turn transcripts aligned to timestamps, ready for eval scoring

### Eval harness
- [ ] Curate a golden question set derived from the parsed `llms.txt` (factual recall, API parameter lookup, SDK usage, edge cases)
- [ ] Eval runner script: sends each question to the voice agent, captures the spoken response, transcribes it, stores `(question, response, label)` triples
- [ ] Judge model (e.g. Claude) that scores each response against the ground-truth answer on accuracy, completeness, and conciseness — outputs a numeric score + short rationale per question
- [ ] Aggregate scoring: mean score per run, per-question breakdown, failure analysis

### Iteration loop (control vs. experimental)
- [ ] **Iteration 1** — baseline: run eval on current `control` harness; record mean score and failure modes
- [ ] **Iteration 2** — first change (e.g. improved system prompt or doc grounding); label runs `experimental`; compare score delta against control with judge rationales
- [ ] **Iteration 3** — second change informed by iteration 2 failure analysis; promote winning config to new `control` baseline
- [ ] Lightweight results tracker (CSV or JSON) so scores across iterations are comparable at a glance

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Backend status |
| `WS` | `/api/voice-agent` | Deepgram Agent WebSocket bridge |
| `GET` | `/api/capture/devices` | List PortAudio input devices |
| `GET` | `/api/capture/status` | Current recording state |
| `POST` | `/api/capture/start` | Begin audio capture |
| `POST` | `/api/capture/stop` | Stop capture and write WAV |
