"""
Voice agent WebSocket bridge between the browser and Deepgram Agent API.

Route: WS /api/voice-agent
"""

import asyncio
import json

import websockets
import websockets.exceptions
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import DEEPGRAM_API_KEY, DEEPGRAM_AGENT_WS, STT_SAMPLE_RATE, TTS_SAMPLE_RATE, SYSTEM_PROMPT, GREETING, AGENT_FUNCTIONS, FUNCTION_CALL_ACK_MESSAGE
from docs import lookup_docs
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
                "functions": AGENT_FUNCTIONS,
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
                # Tracks the function_call_id that is currently in-flight.
                # Cleared on UserStartedSpeaking so stale results are discarded.
                _active_call_id: str | None = None
                _lookup_task:  asyncio.Task | None = None

                async def _run_lookup(fn_id: str, fn_name: str, query: str) -> None:
                    nonlocal _active_call_id
                    try:
                        result = await lookup_docs(query)
                    except asyncio.CancelledError:
                        print(f"[{session.session_id}] Lookup cancelled: {fn_id}")
                        return

                    if fn_id != _active_call_id:
                        print(f"[{session.session_id}] Discarding stale result for {fn_id}")
                        return

                    session.append_function_call(query, result)
                    await dg_ws.send(json.dumps({
                        "type":    "FunctionCallResponse",
                        "id":      fn_id,
                        "name":    fn_name,
                        "content": result,
                    }))
                    await browser_ws.send_text(json.dumps({"type": "FunctionCallCompleted"}))

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
                            continue

                        if kind == "UserStartedSpeaking":
                            if _lookup_task and not _lookup_task.done():
                                _lookup_task.cancel()
                                print(f"[{session.session_id}] Lookup cancelled — user interrupted")
                            _active_call_id = None
                            await browser_ws.send_text(json.dumps(evt))
                            continue

                        if kind == "FunctionCallRequest":
                            fns = evt.get("functions", [])
                            for fn in fns:
                                fn_id   = fn.get("id", "")
                                fn_name = fn.get("name", "")
                                raw_args = fn.get("arguments", "{}")
                                try:
                                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                                except (ValueError, TypeError):
                                    args = {}
                                query = args.get("query", "")
                                print(f"[{session.session_id}] Function call: {fn_name}({query!r})")
                                _active_call_id = fn_id
                                await browser_ws.send_text(json.dumps({"type": "FunctionCallStarted"}))
                                await dg_ws.send(json.dumps({
                                    "type":    "InjectAgentMessage",
                                    "message": FUNCTION_CALL_ACK_MESSAGE,
                                }))
                                _lookup_task = asyncio.create_task(_run_lookup(fn_id, fn_name, query))
                            continue  # do not forward to browser; agent holds turn until FunctionCallResponse

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
