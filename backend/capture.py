"""
Audio capture — sounddevice-based recording from any PortAudio input device.

Intended use: select BlackHole 2ch as the primary device (mirrors Mac system
audio output) and optionally a microphone as the secondary device.  On stop,
the two streams are mixed into a stereo WAV (system audio → L, mic → R) so
diarization tools can work per-channel.

REST routes (mounted at /api/capture in server.py):
    GET  /devices   — list available input devices
    GET  /status    — current recording state
    POST /start     — begin capture  { label, device_index, mic_device_index }
    POST /stop      — end capture, write WAV to AUDIO_CAPTURE_DIR
"""

import asyncio
import threading
import time
import wave
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import AUDIO_CAPTURE_DIR

try:
    import sounddevice as sd
    import numpy as np
    SD_OK = True
except ImportError:
    SD_OK = False
    sd = None   # type: ignore
    np = None   # type: ignore

# Ensure the output directory exists at import time
AUDIO_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

# ── constants ─────────────────────────────────────────────────────────────────

_RATE     = 48_000  # Hz — full quality for BlackHole and mic
_CHANNELS = 2       # stereo (BlackHole 2ch native)

# ── module-level recording state ──────────────────────────────────────────────

_lock:        threading.Lock   = threading.Lock()
_stream:      Optional[object] = None   # primary InputStream (system audio)
_stream_mic:  Optional[object] = None   # secondary InputStream (microphone)
_frames:      list             = []     # numpy frames from primary
_frames_mic:  list             = []     # numpy frames from mic
_start_ts:    Optional[int]    = None
_label:       Optional[str]    = None

# ── router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/capture", tags=["capture"])

# ── request model ─────────────────────────────────────────────────────────────

class StartBody(BaseModel):
    label:            str           = "control"
    device_index:     Optional[int] = None   # system audio (e.g. BlackHole)
    mic_device_index: Optional[int] = None   # microphone; None = skip

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
        "recording": _stream is not None,
        "label":     _label,
        "start_ts":  _start_ts,
        "has_mic":   _stream_mic is not None,
    }


@router.post("/start")
async def start(body: StartBody):
    global _stream, _stream_mic, _frames, _frames_mic, _start_ts, _label

    if not SD_OK:
        return JSONResponse(
            {"error": "sounddevice not installed — run: pip install sounddevice"},
            status_code=503,
        )

    with _lock:
        if _stream is not None:
            return JSONResponse({"error": "capture already running"}, status_code=409)

        # ── primary (system audio / BlackHole) ─────────────────────────────────
        channels = _CHANNELS
        if body.device_index is not None:
            try:
                info = sd.query_devices(body.device_index)
                channels = max(1, min(int(info["max_input_channels"]), 2))
            except Exception:
                pass

        _frames     = []
        _frames_mic = []
        _start_ts   = int(time.time() * 1000)
        _label      = body.label

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
            _stream   = None
            _frames   = []
            _start_ts = None
            _label    = None
            return JSONResponse({"error": str(exc)}, status_code=500)

        # ── secondary (microphone, optional) ───────────────────────────────────
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

    print(f"[capture] Started — label={body.label} primary={body.device_index} mic={body.mic_device_index}")
    return {"status": "started", "start_ts": _start_ts, "label": body.label}


@router.post("/stop")
async def stop():
    global _stream, _stream_mic, _frames, _frames_mic, _start_ts, _label

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
        filename = f"{label}_{start_ts}_{end_ts}.wav"
        out_path = AUDIO_CAPTURE_DIR / filename

        frames     = _frames[:]
        frames_mic = _frames_mic[:]
        _frames     = []
        _frames_mic = []
        _start_ts   = None
        _label      = None

    await asyncio.get_running_loop().run_in_executor(None, _write_wav, frames, frames_mic, out_path)
    print(f"[capture] Done → {filename}")
    return {"status": "stopped", "file": str(out_path), "filename": filename}


# ── WAV writer (runs in thread executor so it never blocks the event loop) ────

def _write_wav(frames: list, frames_mic: list, out_path) -> None:
    if not frames:
        return

    if frames_mic:
        # Stereo mix: system audio on L, mic on R
        primary = np.concatenate(frames, axis=0)
        mic_arr = np.concatenate(frames_mic, axis=0)

        # Downmix primary to mono (BlackHole is 2ch)
        if primary.ndim > 1 and primary.shape[1] >= 2:
            sys_mono = ((primary[:, 0].astype(np.int32) + primary[:, 1].astype(np.int32)) // 2).astype(np.int16)
        else:
            sys_mono = primary.reshape(-1).astype(np.int16)

        mic_mono = mic_arr.reshape(-1).astype(np.int16)

        # Pad the shorter stream with silence
        n = max(len(sys_mono), len(mic_mono))
        if len(sys_mono) < n:
            sys_mono = np.pad(sys_mono, (0, n - len(sys_mono)))
        if len(mic_mono) < n:
            mic_mono = np.pad(mic_mono, (0, n - len(mic_mono)))

        # Interleave: [L, R, L, R, ...]
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
        wf.setsampwidth(2)        # int16 = 2 bytes/sample
        wf.setframerate(_RATE)
        wf.writeframes(audio_bytes)

    print(f"[capture] Saved {out_path.name}  ({len(audio_bytes):,} bytes, {out_channels}ch @ {_RATE} Hz)")
