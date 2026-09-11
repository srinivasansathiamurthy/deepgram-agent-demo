"""
Audio capture — sounddevice-based recording from any PortAudio input device.

When a flow_id is provided to /start and the user clicks "Ask next question" in
the UI, the backend synthesizes the current question via Deepgram TTS, plays it
through macOS speakers (afplay), and advances the index.  Pacing is fully manual.

REST routes (mounted at /api/capture in server.py):
    GET  /devices    — list available input devices
    GET  /status     — recording state + question progress
    POST /start      — begin capture { label, device_index, mic_device_index, flow_id }
    POST /stop       — end capture, write WAV to AUDIO_CAPTURE_DIR
    POST /ask-next   — speak current question via TTS and advance index
"""

import asyncio
import json
import os
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import AUDIO_CAPTURE_DIR, DEEPGRAM_API_KEY

try:
    import sounddevice as sd
    import numpy as np
    SD_OK = True
except ImportError:
    SD_OK = False
    sd = None   # type: ignore
    np = None   # type: ignore

AUDIO_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

# ── constants ─────────────────────────────────────────────────────────────────

_RATE     = 48_000
_CHANNELS = 2

_FLOWS_FILE = Path(__file__).parent.parent / "eval" / "chat_flows.json"
_TTS_URL    = "https://api.deepgram.com/v1/speak"
_TTS_MODEL  = "aura-2-thalia-en"
_TTS_RATE   = 24_000

# ── module-level recording state ──────────────────────────────────────────────

_lock:        threading.Lock   = threading.Lock()
_stream:      Optional[object] = None
_stream_mic:  Optional[object] = None
_frames:      list             = []
_frames_mic:  list             = []
_start_ts:    Optional[int]    = None
_label:       Optional[str]    = None

# question state
_questions:        list        = []
_current_question: int         = 0
_flow_id:          Optional[str] = None

# ── router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/capture", tags=["capture"])

# ── request model ─────────────────────────────────────────────────────────────

class StartBody(BaseModel):
    label:            str           = "control"
    device_index:     Optional[int] = None
    mic_device_index: Optional[int] = None
    flow_id:          Optional[str] = None

# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/devices")
async def devices():
    if not SD_OK:
        return {
            "devices": [],
            "sounddevice_available": False,
            "install_hint": "pip install sounddevice  # also needs: brew install portaudio",
        }
    devs = []
    for i, d in enumerate(sd.query_devices()):
        if int(d["max_input_channels"]) < 1:
            continue
        default_in = sd.default.device[0] if isinstance(sd.default.device, (list, tuple)) else sd.default.device
        devs.append({
            "index":        i,
            "name":         d["name"],
            "channels":     min(int(d["max_input_channels"]), 2),
            "is_blackhole": "blackhole" in d["name"].lower(),
            "is_default":   i == default_in,
        })
    return {"devices": devs, "sounddevice_available": True}


@router.get("/status")
async def status():
    return {
        "recording":        _stream is not None,
        "label":            _label,
        "start_ts":         _start_ts,
        "has_mic":          _stream_mic is not None,
        "flow_id":          _flow_id,
        "current_question": _current_question if _questions else None,
        "total_questions":  len(_questions) if _questions else None,
    }


@router.post("/start")
async def start(body: StartBody):
    global _stream, _stream_mic, _frames, _frames_mic, _start_ts, _label
    global _questions, _current_question, _flow_id

    if not SD_OK:
        return JSONResponse(
            {"error": "sounddevice not installed — run: pip install sounddevice"},
            status_code=503,
        )

    with _lock:
        if _stream is not None:
            return JSONResponse({"error": "capture already running"}, status_code=409)

        channels = _CHANNELS
        if body.device_index is not None:
            try:
                info = sd.query_devices(body.device_index)
                channels = max(1, min(int(info["max_input_channels"]), 2))
            except Exception:
                pass

        _frames           = []
        _frames_mic       = []
        _start_ts         = int(time.time() * 1000)
        _label            = body.label
        _flow_id          = body.flow_id
        _questions        = []
        _current_question = 0

        if body.flow_id:
            try:
                flows = json.loads(_FLOWS_FILE.read_text())
                flow = next((f for f in flows if f["id"] == body.flow_id), None)
                if flow:
                    _questions = flow["questions"]
                    print(f"[capture] Loaded {len(_questions)} questions from flow '{body.flow_id}'")
            except Exception as exc:
                print(f"[capture] Could not load flow: {exc}")

        def _cb_primary(indata, frames, time_info, status):
            _frames.append(indata.copy())

        try:
            _stream = sd.InputStream(
                device=body.device_index,
                channels=channels,
                samplerate=_RATE,
                dtype="int16",
                callback=_cb_primary,
            )
            _stream.start()
        except Exception as exc:
            _stream = _start_ts = _label = _flow_id = None
            _frames = []
            return JSONResponse({"error": str(exc)}, status_code=500)

        if body.mic_device_index is not None:
            def _cb_mic(indata, frames, time_info, status):
                _frames_mic.append(indata.copy())
            try:
                _stream_mic = sd.InputStream(
                    device=body.mic_device_index,
                    channels=1,
                    samplerate=_RATE,
                    dtype="int16",
                    callback=_cb_mic,
                )
                _stream_mic.start()
                print(f"[capture] Mic stream started — device={body.mic_device_index}")
            except Exception as exc:
                _stream_mic = None
                print(f"[capture] Mic stream failed (non-fatal): {exc}")

    print(f"[capture] Started — label={body.label} flow={body.flow_id} "
          f"primary={body.device_index} mic={body.mic_device_index}")
    return {
        "status":          "started",
        "start_ts":        _start_ts,
        "label":           body.label,
        "total_questions": len(_questions),
    }


@router.post("/stop")
async def stop():
    global _stream, _stream_mic, _frames, _frames_mic, _start_ts, _label
    global _flow_id, _questions, _current_question

    with _lock:
        if _stream is None:
            return JSONResponse({"error": "no capture running"}, status_code=409)

        _stream.stop()
        _stream.close()
        _stream = None

        if _stream_mic is not None:
            _stream_mic.stop()
            _stream_mic.close()
            _stream_mic = None

        end_ts   = int(time.time() * 1000)
        label    = _label or "capture"
        start_ts = _start_ts or end_ts
        flow_tag = f"_{_flow_id}" if _flow_id else ""
        filename = f"{label}{flow_tag}_{start_ts}_{end_ts}.wav"
        out_path = AUDIO_CAPTURE_DIR / filename

        frames     = _frames[:]
        frames_mic = _frames_mic[:]
        _frames           = []
        _frames_mic       = []
        _start_ts         = None
        _label            = None
        _flow_id          = None
        _questions        = []
        _current_question = 0

    await asyncio.get_running_loop().run_in_executor(None, _write_wav, frames, frames_mic, out_path)
    print(f"[capture] Done → {filename}")
    return {"status": "stopped", "file": str(out_path), "filename": filename}


@router.post("/ask-next")
async def ask_next():
    global _current_question

    if _stream is None:
        return JSONResponse({"error": "no capture running"}, status_code=409)
    if not _questions:
        return JSONResponse({"error": "no flow loaded"}, status_code=400)
    if _current_question >= len(_questions):
        return {"done": True, "question_index": _current_question, "total": len(_questions)}

    q = _questions[_current_question]
    idx = _current_question
    print(f"[capture] Asking Q{idx + 1}/{len(_questions)}: {q[:80]!r}")

    try:
        await _speak_question(q)
    except Exception as exc:
        return JSONResponse({"error": f"TTS failed: {exc}"}, status_code=500)

    _current_question += 1
    return {
        "asked":          q,
        "question_index": _current_question,
        "total":          len(_questions),
        "done":           _current_question >= len(_questions),
    }


# ── TTS synthesis + playback ──────────────────────────────────────────────────

async def _speak_question(text: str) -> None:
    """Synthesize text via Deepgram TTS and play through macOS default output."""
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type":  "application/json",
    }
    params = {
        "model":       _TTS_MODEL,
        "encoding":    "linear16",
        "sample_rate": str(_TTS_RATE),
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _TTS_URL, params=params, headers=headers,
            json={"text": text}, timeout=15.0,
        )
        resp.raise_for_status()
        pcm_bytes = resp.content

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_path = f.name
    try:
        with wave.open(tmp_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(_TTS_RATE)
            wf.writeframes(pcm_bytes)
        proc = await asyncio.create_subprocess_exec("afplay", tmp_path)
        await proc.wait()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ── WAV writer (runs in thread executor so it never blocks the event loop) ────

def _write_wav(frames: list, frames_mic: list, out_path) -> None:
    if not frames:
        return

    if frames_mic:
        primary = np.concatenate(frames, axis=0)
        mic_arr = np.concatenate(frames_mic, axis=0)

        if primary.ndim > 1 and primary.shape[1] >= 2:
            sys_mono = ((primary[:, 0].astype(np.int32) + primary[:, 1].astype(np.int32)) // 2).astype(np.int16)
        else:
            sys_mono = primary.reshape(-1).astype(np.int16)

        mic_mono = mic_arr.reshape(-1).astype(np.int16)

        n = max(len(sys_mono), len(mic_mono))
        if len(sys_mono) < n:
            sys_mono = np.pad(sys_mono, (0, n - len(sys_mono)))
        if len(mic_mono) < n:
            mic_mono = np.pad(mic_mono, (0, n - len(mic_mono)))

        stereo = np.empty(n * 2, dtype=np.int16)
        stereo[0::2] = sys_mono
        stereo[1::2] = mic_mono
        audio_bytes  = stereo.tobytes()
        out_channels = 2
    else:
        arr          = np.concatenate(frames, axis=0)
        audio_bytes  = arr.tobytes()
        out_channels = frames[0].shape[1] if frames[0].ndim > 1 else 1

    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(out_channels)
        wf.setsampwidth(2)
        wf.setframerate(_RATE)
        wf.writeframes(audio_bytes)

    print(f"[capture] Saved {out_path.name}  ({len(audio_bytes):,} bytes, {out_channels}ch @ {_RATE} Hz)")
