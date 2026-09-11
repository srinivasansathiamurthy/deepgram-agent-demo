/**
 * useVoiceAgent
 *
 * The central hook that manages the entire voice agent lifecycle:
 *
 *   Browser mic  ──PCM──►  WebSocket  ──PCM──►  FastAPI bridge  ──►  Deepgram
 *   AudioContext ◄──PCM──  WebSocket  ◄──PCM──  FastAPI bridge  ◄──  Deepgram
 *
 * State machine:
 *
 *   disconnected
 *       │ startSession()
 *       ▼
 *   connecting
 *       │ WebSocket open + mic permission granted
 *       ▼
 *   idle  ──────────────────────── togglePause() ──► paused
 *       │ UserStartedSpeaking                            │ togglePause()
 *       ▼                                               ▼
 *   user_speaking  ◄── UserStartedSpeaking ────────── idle
 *       │ ConversationText(role=user)
 *       ▼
 *   thinking
 *       │ AgentStartedSpeaking
 *       ▼
 *   agent_speaking
 *       │ AgentAudioDone
 *       ▼
 *   idle
 *
 *   Any state ──► stopSession() / newSession() ──► disconnected
 *
 * Audio pipeline:
 *
 *   CAPTURE: getUserMedia → AudioContext → ScriptProcessorNode
 *     • Runs at the browser's native sample rate (44100 or 48000 Hz).
 *     • Each onaudioprocess callback downsamples float32 frames from the
 *       native rate to MIC_SAMPLE_RATE (24 kHz) and encodes as Int16,
 *       then sends the binary chunk over the WebSocket.
 *     • Downsampling uses linear interpolation — low complexity, good enough
 *       for speech at these ratios.
 *
 *   PLAYBACK: WebSocket binary → AudioContext → AudioBufferSourceNode
 *     • Each binary frame is decoded from Int16 to float32 and pushed into
 *       a queue.  A scheduler fires every SCHEDULE_INTERVAL_MS to dequeue
 *       chunks and schedule them as AudioBufferSourceNodes starting at the
 *       next available time slot (gapless sequential playback).
 *     • AudioContext is created once and reused across sessions (browsers
 *       limit the number of contexts per page).
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── constants ────────────────────────────────────────────────────────────────

/** Sample rate Deepgram Nova-3 STT expects for microphone audio. */
const MIC_SAMPLE_RATE = 24_000;

/** Sample rate of Deepgram Aura-2 TTS output (48 kHz for max quality). */
const TTS_SAMPLE_RATE = 48_000;

/** WebSocket URL (proxied through Vite → FastAPI during dev). */
const WS_URL = "/api/voice-agent";

/** How often (ms) the playback scheduler checks for buffered audio chunks. */
const SCHEDULE_INTERVAL_MS = 50;

// ── types ────────────────────────────────────────────────────────────────────

export type AgentMode =
  | "disconnected"
  | "connecting"
  | "idle"
  | "user_speaking"
  | "thinking"
  | "agent_speaking"
  | "paused";

export interface ChatMessage {
  id:        string;
  role:      "user" | "assistant";
  content:   string;
  timestamp: number;   // ms since epoch
}

export interface VoiceAgentState {
  mode:       AgentMode;
  messages:   ChatMessage[];
  sessionId:  string | null;
  error:      string | null;
}

export interface VoiceAgentActions {
  startSession: (flowId?: string) => Promise<void>;
  stopSession:  () => void;
  togglePause:  () => void;
  newSession:   (flowId?: string) => void;
}

// ── audio utilities ───────────────────────────────────────────────────────────

/**
 * Downsample a Float32Array from `fromRate` to `toRate` using linear
 * interpolation.  This avoids the complexity of a proper polyphase FIR but
 * is entirely adequate for voice-quality speech.
 */
function downsample(src: Float32Array<ArrayBuffer>, fromRate: number, toRate: number): Float32Array<ArrayBuffer> {
  if (fromRate === toRate) return src;
  const ratio     = fromRate / toRate;
  const outLength = Math.floor(src.length / ratio);
  const out       = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos   = i * ratio;
    const index = Math.floor(pos);
    const frac  = pos - index;
    out[i] =
      index + 1 < src.length
        ? src[index] * (1 - frac) + src[index + 1] * frac
        : src[index];
  }
  return out;
}

/**
 * Convert a Float32Array (samples in [-1, 1]) to an Int16 ArrayBuffer
 * suitable for sending as PCM linear16 over the WebSocket.
 */
function float32ToInt16(float32: Float32Array<ArrayBuffer>): ArrayBuffer {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    // Clamp then scale to the Int16 range [-32768, 32767].
    const s  = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16.buffer;
}

/**
 * Decode an incoming binary frame (PCM linear16, little-endian) into a
 * Float32Array for use with the Web Audio API.
 */
function int16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buffer);
  const float = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float;
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useVoiceAgent(): VoiceAgentState & VoiceAgentActions {

  // ── React state ─────────────────────────────────────────────────────────────
  const [mode,      setMode]      = useState<AgentMode>("disconnected");
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  // ── refs (mutable, do NOT trigger re-renders) ────────────────────────────────
  const wsRef            = useRef<WebSocket | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const sourceRef        = useRef<MediaStreamAudioSourceNode | null>(null);
  const pausedRef        = useRef(false);   // tracks pause state without stale closures

  // Playback queue: Float32Arrays waiting to be scheduled by the idle scheduler.
  // TTS chunks are pushed here as they stream in and played immediately, gaplessly.
  const playQueueRef     = useRef<Float32Array[]>([]);
  const nextPlayTimeRef  = useRef(0);
  const schedulerRef     = useRef<number | null>(null);
  // All AudioBufferSourceNodes currently scheduled or playing — tracked so we
  // can stop them instantly when the user interrupts the agent.
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // Set to true when AgentAudioDone fires; the last source's onended uses this
  // to know it's the final chunk and should transition mode back to idle.
  const agentDoneRef = useRef(false);
  // True while the server is executing a function call lookup. Prevents
  // AgentAudioDone (fired after the injected ack message) from going to idle.
  const functionCallInProgressRef = useRef(false);

  // ── audio context (created once, reused) ────────────────────────────────────
  function ensureAudioContext(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      // Resume after a user gesture (browsers suspend contexts at start).
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  // ── playback scheduler ───────────────────────────────────────────────────────
  /**
   * Runs on a setInterval timer.  Drains playQueueRef and schedules
   * AudioBufferSourceNodes back-to-back so TTS audio plays without gaps.
   *
   * The agent audio comes from Deepgram at TTS_SAMPLE_RATE (48 kHz), so we create
   * each AudioBuffer at that rate — the AudioContext resamples to its native
   * rate internally, which is higher quality than our own resampler.
   */
  function drainPlayQueue() {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;
    if (ctx.state === "suspended") ctx.resume();

    // Ensure the next play time is at least "now" so the first chunk isn't in the past.
    if (nextPlayTimeRef.current < ctx.currentTime) {
      nextPlayTimeRef.current = ctx.currentTime + 0.05; // 50 ms lookahead
    }

    while (playQueueRef.current.length > 0) {
      const chunk  = playQueueRef.current.shift()!;
      const buffer = ctx.createBuffer(1, chunk.length, TTS_SAMPLE_RATE);
      buffer.copyToChannel(chunk as Float32Array<ArrayBuffer>, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(nextPlayTimeRef.current);
      activeSourcesRef.current.add(source);

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        // When all audio has played AND AgentAudioDone has fired, transition.
        if (
          agentDoneRef.current &&
          activeSourcesRef.current.size === 0 &&
          playQueueRef.current.length === 0
        ) {
          agentDoneRef.current = false;
          if (functionCallInProgressRef.current) {
            setMode("thinking");
          } else {
            setMode((prev) =>
              prev === "agent_speaking" ? (pausedRef.current ? "paused" : "idle") : prev
            );
          }
        }
      };

      nextPlayTimeRef.current += buffer.duration;
    }
  }

  function startScheduler() {
    if (schedulerRef.current !== null) return;
    schedulerRef.current = window.setInterval(drainPlayQueue, SCHEDULE_INTERVAL_MS);
  }

  function stopScheduler() {
    if (schedulerRef.current !== null) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    playQueueRef.current  = [];
    nextPlayTimeRef.current = 0;
  }

  /**
   * Immediately silence any agent audio — both queued chunks and already-
   * scheduled AudioBufferSourceNodes.  Called on UserStartedSpeaking.
   */
  function cutPlayback() {
    agentDoneRef.current = false;
    playQueueRef.current = [];
    activeSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* already ended */ }
    });
    activeSourcesRef.current.clear();
    nextPlayTimeRef.current = 0;
  }

  // ── microphone capture ───────────────────────────────────────────────────────
  /**
   * Open the microphone, attach a ScriptProcessorNode, and start sending
   * 16-bit PCM chunks to Deepgram via the WebSocket.
   *
   * bufferSize=4096 gives ~85 ms frames at 48 kHz — large enough to avoid
   * scheduling jitter but small enough for responsive latency.
   *
   * We use ScriptProcessorNode (rather than AudioWorklet) because it requires
   * no extra bundler setup and works everywhere React + Vite runs.
   */
  async function startMicrophone(ws: WebSocket): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // prevents agent audio played through speakers from feeding back into the mic
        noiseSuppression: true,   // reduces background hiss and static
        autoGainControl:  true,   // normalises mic level across speakers
      },
      video: false,
    });
    streamRef.current = stream;

    const ctx    = ensureAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // 4096-sample buffer, 1 input channel, 0 output channels (no monitoring).
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    const nativeRate = ctx.sampleRate;

    processor.onaudioprocess = (evt) => {
      // If paused, stop sending audio — Deepgram treats silence as end-of-turn.
      if (pausedRef.current) return;
      if (ws.readyState !== WebSocket.OPEN) return;

      const inputData = evt.inputBuffer.getChannelData(0); // Float32, native rate
      const resampled = downsample(inputData, nativeRate, MIC_SAMPLE_RATE);
      const pcm       = float32ToInt16(resampled);
      ws.send(pcm);
    };

    source.connect(processor);
    // Connect processor to destination with zero volume so no audio is output
    // from the microphone (prevents echo); the node still receives input.
    processor.connect(ctx.destination);
  }

  /** Release the microphone and disconnect the audio graph nodes. */
  function stopMicrophone() {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    sourceRef.current    = null;
    streamRef.current    = null;
  }

  // ── WebSocket event handler ──────────────────────────────────────────────────
  /**
   * Attach all WebSocket event handlers.
   *
   * Binary messages  → PCM audio from the agent → push to play queue.
   * Text messages    → JSON events from Deepgram → update React state.
   */
  function attachWsHandlers(ws: WebSocket) {
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      console.log("WebSocket connected to backend");
      setError(null);
      try {
        await startMicrophone(ws);
        startScheduler();
        setMode("idle");
      } catch (err) {
        setError("Microphone access denied. Please allow mic access and try again.");
        setMode("disconnected");
        ws.close();
      }
    };

    ws.onmessage = (evt) => {
      // ── binary: agent TTS audio — stream immediately into play queue ────────
      if (evt.data instanceof ArrayBuffer) {
        playQueueRef.current.push(int16ToFloat32(evt.data));
        // Switch orb to "speaking" as soon as the first audio chunk arrives.
        setMode((prev) =>
          prev === "thinking" || prev === "idle" || prev === "user_speaking"
            ? "agent_speaking"
            : prev
        );
        return;
      }

      // ── text: JSON control / transcript events ───────────────────────────────
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }

      const type = msg.type as string;

      switch (type) {
        // ── session info injected by our own backend ─────────────────────────
        case "SessionCreated":
          setSessionId(msg.session_id as string);
          break;

        // ── Deepgram connection confirmed ────────────────────────────────────
        case "Welcome":
          console.log("Deepgram Welcome received, session open.");
          break;

        // ── settings accepted; agent is ready ────────────────────────────────
        case "SettingsApplied":
          console.log("Deepgram SettingsApplied — agent is configured.");
          break;

        // ── user started speaking (VAD triggered) ────────────────────────────
        case "UserStartedSpeaking":
          // Discard buffered TTS chunks and stop any already-playing nodes.
          cutPlayback();
          functionCallInProgressRef.current = false;
          setMode("user_speaking");
          break;

        // ── transcript finalized for user or agent ────────────────────────────
        case "ConversationText": {
          const role    = msg.role    as "user" | "assistant";
          const content = msg.content as string;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            // Deepgram streams long agent responses as multiple ConversationText
            // events (one per TTS sentence). Append to the existing bubble so
            // the UI shows one cohesive agent message instead of many fragments.
            if (role === "assistant" && last?.role === "assistant") {
              const updated = { ...last, content: last.content + " " + content };
              return [...prev.slice(0, -1), updated];
            }
            return [...prev, {
              id:        `${Date.now()}-${Math.random()}`,
              role,
              content,
              timestamp: Date.now(),
            }];
          });
          if (role === "user") setMode("thinking");
          break;
        }

        // ── agent started speaking ────────────────────────────────────────────
        case "AgentStartedSpeaking":
          // Binary frames stream in and are played immediately via the scheduler.
          // Mode is already set to "agent_speaking" on first binary frame.
          // agentDoneRef is reset here in case a new turn starts before the
          // previous onended fired (e.g. very short responses back-to-back).
          agentDoneRef.current = false;
          break;

        // ── all TTS audio for this turn has been sent by Deepgram ─────────────
        case "AgentAudioDone":
          agentDoneRef.current = true;
          // If the scheduler has already drained everything, transition now.
          // Otherwise the last source's onended will handle the transition.
          if (activeSourcesRef.current.size === 0 && playQueueRef.current.length === 0) {
            agentDoneRef.current = false;
            setMode(functionCallInProgressRef.current ? "thinking" : (pausedRef.current ? "paused" : "idle"));
          }
          break;

        case "FunctionCallStarted":
          functionCallInProgressRef.current = true;
          setMode("thinking");
          break;

        case "FunctionCallCompleted":
          functionCallInProgressRef.current = false;
          break;

        // ── error from Deepgram or backend ────────────────────────────────────
        case "Error":
          setError((msg.description as string) ?? "Unknown error from agent.");
          break;

        default:
          // All other events (LatencyReport, FunctionCallRequest, etc.) are
          // logged for debugging but don't change UI state.
          console.debug("Agent event:", type, msg);
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection error. Is the backend running?");
    };

    ws.onclose = (evt) => {
      console.log(`WebSocket closed (code ${evt.code})`);
      cleanupAudio();
      setMode("disconnected");
    };
  }

  // ── cleanup ──────────────────────────────────────────────────────────────────

  function cleanupAudio() {
    stopMicrophone();
    stopScheduler();
  }

  function cleanupAll() {
    wsRef.current?.close();
    wsRef.current = null;
    cleanupAudio();
    pausedRef.current = false;
  }

  // Cleanup on unmount.
  useEffect(() => () => cleanupAll(), []);

  // ── public actions ───────────────────────────────────────────────────────────

  /**
   * Open a new WebSocket connection to the backend, which immediately connects
   * to Deepgram and sends the agent Settings.  Simultaneously request mic
   * permission (this happens inside ws.onopen so it's gated on connection success).
   */
  const startSession = useCallback(async (flowId?: string) => {
    if (wsRef.current) return;   // already running

    setMode("connecting");
    setMessages([]);
    setSessionId(null);
    setError(null);
    pausedRef.current = false;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const qs       = flowId ? `?flow_id=${encodeURIComponent(flowId)}` : "";
    const wsUrl    = `${protocol}//${window.location.host}${WS_URL}${qs}`;
    const ws       = new WebSocket(wsUrl);
    wsRef.current  = ws;
    attachWsHandlers(ws);
  }, []);

  /**
   * Close the WebSocket and stop all audio.  The on-disk session files
   * (chat_history.txt, chat_<start>_<end>.wav) remain intact — this only stops the live connection.
   */
  const stopSession = useCallback(() => {
    cleanupAll();
    setMode("disconnected");
  }, []);

  /**
   * Toggle microphone capture on/off without closing the WebSocket.
   * When paused, the mic stops sending audio, so Deepgram won't start a new
   * user turn.  The agent can still finish speaking if it's mid-response.
   */
  const togglePause = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    pausedRef.current = !pausedRef.current;
    setMode((prev) => {
      if (pausedRef.current) return "paused";
      // If we were paused, return to idle (or agent_speaking if still playing).
      return prev === "paused" ? "idle" : prev;
    });
  }, []);

  /**
   * End the current session and immediately start a fresh one.
   * This creates a new server-side session directory, a new chat_history.txt,
   * and a new Deepgram conversation with the welcome greeting.
   */
  const newSession = useCallback((flowId?: string) => {
    cleanupAll();
    setMode("disconnected");
    setMessages([]);
    setSessionId(null);
    setError(null);
    // Brief delay so React flushes the disconnected state before reconnecting.
    setTimeout(() => startSession(flowId), 150);
  }, [startSession]);

  return {
    mode,
    messages,
    sessionId,
    error,
    startSession,
    stopSession,
    togglePause,
    newSession,
  };
}
