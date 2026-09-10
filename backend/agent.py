"""
Voice agent WebSocket bridge between the browser and Deepgram Agent API.

Route: WS /api/voice-agent
"""

import asyncio
import json

import websockets
import websockets.exceptions
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import DEEPGRAM_API_KEY, DEEPGRAM_AGENT_WS, STT_SAMPLE_RATE, TTS_SAMPLE_RATE, SYSTEM_PROMPT, GREETING
from sessions import Session

router = APIRouter(tags=["agent"])


def build_settings() -> dict:
    return {
        "type": "Settings",
        "audio": {
            "input": {
                "encoding":    "linear16",
                "sample_rate": STT_SAMPLE_RATE,
            },
            "output": {
                "encoding":    "linear16",
                "sample_rate": TTS_SAMPLE_RATE,
                "container":   "none",
            },
        },
        "agent": {
            "greeting": GREETING,
            "listen": {
                "provider": {"type": "deepgram", "model": "nova-3"},
            },
            "think": {
                "provider": {"type": "anthropic", "model": "claude-sonnet-4-5"},
                "prompt":   SYSTEM_PROMPT,
            },
            "speak": {
                "provider": {"type": "deepgram", "model": "aura-2-thalia-en", "version": "v1"},
            },
        },
    }


@router.websocket("/api/voice-agent")
async def voice_agent_ws(browser_ws: WebSocket):
    await browser_ws.accept()

    session = Session()
    print(f"[{session.session_id}] Browser connected.")

    await browser_ws.send_text(json.dumps({
        "type":       "SessionCreated",
        "session_id": session.session_id,
    }))

    dg_headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

    try:
        async with websockets.connect(
            DEEPGRAM_AGENT_WS,
            additional_headers=dg_headers,
            max_size=10 * 1024 * 1024,
        ) as dg_ws:
            print(f"[{session.session_id}] Connected to Deepgram Agent API.")
            await dg_ws.send(json.dumps(build_settings()))

            async def from_deepgram():
                try:
                    async for msg in dg_ws:
                        if isinstance(msg, (bytes, bytearray)):
                            await browser_ws.send_bytes(bytes(msg))
                            continue
                        try:
                            evt = json.loads(msg)
                        except ValueError:
                            await browser_ws.send_text(msg)
                            continue

                        kind = evt.get("type", "")
                        print(f"[{session.session_id}] ← {kind}")

                        if kind == "ConversationText":
                            session.append_chat(evt.get("role", "unknown"), evt.get("content", ""))

                        await browser_ws.send_text(json.dumps(evt))

                except websockets.exceptions.ConnectionClosed:
                    pass
                except Exception as exc:
                    print(f"[{session.session_id}] from_deepgram error: {exc}")
                    try:
                        await browser_ws.send_text(json.dumps({
                            "type":        "Error",
                            "description": "Deepgram connection lost",
                            "code":        "DEEPGRAM_DISCONNECTED",
                        }))
                    except Exception:
                        pass

            async def from_browser():
                try:
                    while True:
                        msg = await browser_ws.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break

                        raw_bytes = msg.get("bytes")
                        if raw_bytes:
                            await dg_ws.send(raw_bytes)
                            continue

                        text = msg.get("text", "")
                        if not text:
                            continue

                        try:
                            payload = json.loads(text)
                        except ValueError:
                            continue

                        if payload.get("type") == "Settings":
                            continue  # server owns config; drop browser Settings

                        await dg_ws.send(text)

                except WebSocketDisconnect:
                    print(f"[{session.session_id}] Browser disconnected.")
                except Exception as exc:
                    print(f"[{session.session_id}] from_browser error: {exc}")

            dg_task      = asyncio.create_task(from_deepgram())
            browser_task = asyncio.create_task(from_browser())

            done, pending = await asyncio.wait(
                {dg_task, browser_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except Exception as exc:
        print(f"[{session.session_id}] WebSocket error: {exc}")
        try:
            await browser_ws.send_text(json.dumps({
                "type":        "Error",
                "description": f"Could not connect to Deepgram ({type(exc).__name__})",
                "code":        "CONNECTION_FAILED",
            }))
        except Exception:
            pass

    print(f"[{session.session_id}] Session ended. → {session.session_dir}")
