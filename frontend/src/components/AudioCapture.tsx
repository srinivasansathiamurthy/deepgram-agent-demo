import { useState, useEffect, useCallback, useRef } from "react";

// ── types ─────────────────────────────────────────────────────────────────────

interface Device {
  index:        number;
  name:         string;
  channels:     number;
  is_blackhole: boolean;
  is_default:   boolean;
}

interface ChatFlow {
  id:        string;
  title:     string;
  questions: string[];
}

type Label = "control" | "experimental";

// ── component ─────────────────────────────────────────────────────────────────

export function AudioCapture() {
  const [sdAvailable,    setSdAvailable]  = useState<boolean | null>(null);
  const [installHint,    setInstallHint]  = useState("");
  const [devices,        setDevices]      = useState<Device[]>([]);
  const [deviceIndex,    setDeviceIndex]  = useState<number | null>(null);
  const [micEnabled,     setMicEnabled]   = useState(true);
  const [micDeviceIndex, setMicDevice]    = useState<number | null>(null);
  const [label,          setLabel]        = useState<Label>("control");
  const [flows,          setFlows]        = useState<ChatFlow[]>([]);
  const [selectedFlowId, setSelectedFlow] = useState<string | null>(null);
  const [recording,      setRecording]    = useState(false);
  const [startTs,        setStartTs]      = useState<number | null>(null);
  const [elapsed,        setElapsed]      = useState(0);
  const [lastFile,       setLastFile]     = useState<string | null>(null);
  const [error,          setError]        = useState<string | null>(null);

  // question state (updated locally after each ask-next call)
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [totalQuestions,  setTotalQuestions]   = useState<number | null>(null);
  const [asking,          setAsking]           = useState(false);
  const [allAsked,        setAllAsked]         = useState(false);

  const timerRef = useRef<number | null>(null);

  // ── load devices + flows on mount ────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const [devRes, statusRes, flowsRes] = await Promise.all([
          fetch("/api/capture/devices"),
          fetch("/api/capture/status"),
          fetch("/api/eval/flows"),
        ]);
        const devData    = await devRes.json();
        const statusData = await statusRes.json();
        const flowsData  = await flowsRes.json();

        setSdAvailable(devData.sounddevice_available);
        setInstallHint(devData.install_hint ?? "");
        setDevices(devData.devices ?? []);
        setFlows(Array.isArray(flowsData) ? flowsData : []);

        // Auto-select BlackHole for system audio, built-in mic for mic
        const devs: Device[] = devData.devices ?? [];
        const bh  = devs.find((d) => d.is_blackhole);
        const def = devs.find((d) => d.is_default);
        setDeviceIndex(bh?.index ?? def?.index ?? devs[0]?.index ?? null);
        const isBuiltIn = (d: Device) => /macbook|built.?in|internal/i.test(d.name) && !d.is_blackhole;
        const mic = devs.find(isBuiltIn)
                 ?? devs.find((d) => d.is_default && !d.is_blackhole)
                 ?? devs.find((d) => !d.is_blackhole);
        setMicDevice(mic?.index ?? null);

        if (statusData.recording) {
          setRecording(true);
          setStartTs(statusData.start_ts);
          setLabel(statusData.label ?? "control");
          setCurrentQuestion(statusData.current_question ?? 0);
          setTotalQuestions(statusData.total_questions ?? null);
        }
      } catch {
        setError("Failed to reach backend.");
      }
    };
    init();
  }, []);

  // ── elapsed timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (recording && startTs) {
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTs) / 1000));
      }, 500);
    } else {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current !== null) clearInterval(timerRef.current); };
  }, [recording, startTs]);

  // ── start ─────────────────────────────────────────────────────────────────────
  const startCapture = useCallback(async () => {
    setError(null);
    setLastFile(null);
    setCurrentQuestion(0);
    setTotalQuestions(null);
    setAllAsked(false);
    try {
      const res = await fetch("/api/capture/start", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          label,
          device_index:     deviceIndex,
          mic_device_index: micEnabled ? micDeviceIndex : null,
          flow_id:          selectedFlowId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to start."); return; }
      setRecording(true);
      setStartTs(data.start_ts);
      setTotalQuestions(data.total_questions ?? null);
      setCurrentQuestion(0);
    } catch {
      setError("Could not reach backend.");
    }
  }, [label, deviceIndex, micEnabled, micDeviceIndex, selectedFlowId]);

  // ── stop ──────────────────────────────────────────────────────────────────────
  const stopCapture = useCallback(async () => {
    setError(null);
    try {
      const res  = await fetch("/api/capture/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to stop."); return; }
      setRecording(false);
      setStartTs(null);
      setLastFile(data.filename);
      setCurrentQuestion(null);
      setTotalQuestions(null);
      setAllAsked(false);
    } catch {
      setError("Could not reach backend.");
    }
  }, []);

  // ── ask next question ─────────────────────────────────────────────────────────
  const askNext = useCallback(async () => {
    setAsking(true);
    setError(null);
    try {
      const res  = await fetch("/api/capture/ask-next", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Ask failed."); return; }
      setCurrentQuestion(data.question_index);
      if (data.done) setAllAsked(true);
    } catch {
      setError("Could not reach backend.");
    } finally {
      setAsking(false);
    }
  }, []);

  const formatElapsed = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── render ────────────────────────────────────────────────────────────────────

  if (sdAvailable === false) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h2 style={styles.heading}>Audio Capture</h2>
          <p style={{ color: "var(--error)", marginBottom: 12 }}>sounddevice is not installed.</p>
          <code style={styles.code}>{installHint || "pip install sounddevice"}</code>
          <p style={{ ...styles.muted, marginTop: 16 }}>
            For Mac system-audio capture, also install{" "}
            <strong style={{ color: "var(--text)" }}>BlackHole 2ch</strong>:<br />
            <code style={{ ...styles.code, display: "inline", padding: "2px 6px" }}>
              brew install blackhole-2ch
            </code>{" "}
            then set up a Multi-Output Device in Audio MIDI Setup.
          </p>
        </div>
      </div>
    );
  }

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) ?? null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.heading}>Audio Capture</h2>
        <p style={styles.muted}>
          Records from any audio input device. Use{" "}
          <strong style={{ color: "var(--text)" }}>BlackHole 2ch</strong> to capture Mac
          system output. When a QA flow is selected, questions are spoken automatically via
          TTS after each agent response.
        </p>

        {/* ── session type ──────────────────────────────────────────────────── */}
        <div style={styles.field}>
          <label style={styles.label}>Session type</label>
          <div style={styles.segmented}>
            {(["control", "experimental"] as Label[]).map((l) => (
              <button
                key={l}
                disabled={recording}
                onClick={() => setLabel(l)}
                style={{
                  ...styles.seg,
                  background: label === l ? "var(--accent)" : "transparent",
                  color:      label === l ? "#0a0f0d"       : "var(--text-muted)",
                  fontWeight: label === l ? 700              : 400,
                }}
              >
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── QA flow selector ──────────────────────────────────────────────── */}
        <div style={styles.field}>
          <label style={styles.label}>QA Flow (optional)</label>
          <select
            value={selectedFlowId ?? ""}
            disabled={recording}
            onChange={(e) => setSelectedFlow(e.target.value || null)}
            style={styles.select}
          >
            <option value="">— None (manual session) —</option>
            {flows.map((f, i) => (
              <option key={f.id} value={f.id}>
                {i + 1}. {f.title}
              </option>
            ))}
          </select>
          {selectedFlow && (
            <p style={{ ...styles.muted, fontSize: "0.75rem" }}>
              {selectedFlow.questions.length} questions — auto-injected via TTS after each agent response
            </p>
          )}
        </div>

        {/* ── input device ──────────────────────────────────────────────────── */}
        <div style={styles.field}>
          <label style={styles.label}>Input device</label>
          {devices.length === 0 ? (
            <p style={{ ...styles.muted, fontSize: "0.8rem" }}>No input devices found.</p>
          ) : (
            <select
              value={deviceIndex ?? ""}
              disabled={recording}
              onChange={(e) => setDeviceIndex(Number(e.target.value))}
              style={styles.select}
            >
              {devices.map((d) => (
                <option key={d.index} value={d.index}>
                  {d.is_blackhole ? "★ " : ""}
                  {d.name}
                  {d.is_blackhole ? " (recommended)" : ""}
                  {d.is_default && !d.is_blackhole ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ── microphone ────────────────────────────────────────────────────── */}
        <div style={styles.field}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={styles.label}>Microphone</label>
            <button
              disabled={recording}
              onClick={() => setMicEnabled((v) => !v)}
              style={{
                width:        40, height: 22, borderRadius: 11,
                border:       "none",
                background:   micEnabled ? "var(--accent)" : "var(--border)",
                position:     "relative",
                cursor:       recording ? "not-allowed" : "pointer",
                transition:   "background 0.2s",
                flexShrink:   0,
              }}
            >
              <span style={{
                position:  "absolute", top: 3,
                left:      micEnabled ? 21 : 3,
                width:     16, height: 16, borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
              }} />
            </button>
          </div>
          {micEnabled && (
            <select
              value={micDeviceIndex ?? ""}
              disabled={recording}
              onChange={(e) => setMicDevice(Number(e.target.value))}
              style={styles.select}
            >
              {devices.map((d) => (
                <option key={d.index} value={d.index}>
                  {d.name}{d.is_default && !d.is_blackhole ? " (default)" : ""}
                </option>
              ))}
            </select>
          )}
          {micEnabled && (
            <p style={{ ...styles.muted, fontSize: "0.75rem" }}>
              Mixed into the right channel (system audio on left, mic on right).
            </p>
          )}
        </div>

        {/* ── record button ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <button
            onClick={recording ? stopCapture : startCapture}
            disabled={devices.length === 0 || sdAvailable === null}
            style={{
              ...styles.recBtn,
              background: recording ? "#2a1010" : "var(--accent)",
              border:     recording ? "1px solid var(--error)" : "none",
              color:      recording ? "var(--error)" : "#0a0f0d",
            }}
          >
            {recording ? "■  Stop" : "●  Start Capture"}
          </button>

          {recording && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                background: "var(--error)", display: "inline-block",
                animation: "pulse-rec 1.2s ease-in-out infinite",
              }} />
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--error)", fontSize: "0.9rem" }}>
                {formatElapsed(elapsed)}
              </span>
            </div>
          )}
        </div>

        {/* ── question panel ────────────────────────────────────────────────── */}
        {recording && totalQuestions != null && (
          <div style={styles.questionBox}>
            {allAsked ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--accent)" }}>✓</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)" }}>
                  All {totalQuestions} questions asked
                </span>
              </div>
            ) : (
              <>
                {/* progress bar */}
                <div style={{ height: 3, background: "var(--border)", borderRadius: 2, marginBottom: 12 }}>
                  <div style={{
                    height: "100%", borderRadius: 2, background: "var(--accent)",
                    width: `${((currentQuestion ?? 0) / totalQuestions) * 100}%`,
                    transition: "width 0.4s",
                  }} />
                </div>

                {/* question text */}
                {selectedFlow && currentQuestion != null && currentQuestion < selectedFlow.questions.length && (
                  <p style={{ fontSize: "0.85rem", color: "var(--text)", lineHeight: 1.5, margin: "0 0 12px" }}>
                    <span style={{
                      fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)",
                      marginRight: 8, fontVariantNumeric: "tabular-nums",
                    }}>
                      Q{currentQuestion + 1}/{totalQuestions}
                    </span>
                    {selectedFlow.questions[currentQuestion]}
                  </p>
                )}

                <button
                  onClick={askNext}
                  disabled={asking}
                  style={{
                    padding: "9px 20px", borderRadius: "var(--radius-sm)",
                    background: asking ? "var(--bg-card)" : "var(--accent)",
                    color: asking ? "var(--text-muted)" : "#0a0f0d",
                    border: asking ? "1px solid var(--border)" : "none",
                    fontWeight: 700, fontSize: "0.82rem",
                    cursor: asking ? "not-allowed" : "pointer",
                    opacity: asking ? 0.7 : 1, transition: "opacity 0.15s",
                  }}
                >
                  {asking ? "Speaking…" : "Ask"}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── status / last file ────────────────────────────────────────────── */}
        {lastFile && !recording && (
          <div style={styles.savedBox}>
            <span style={{ color: "var(--accent)", marginRight: 6 }}>✓</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{lastFile}</div>
              <div style={{ ...styles.muted, fontSize: "0.75rem", marginTop: 2 }}>
                saved to audio_capture/
              </div>
            </div>
          </div>
        )}

        {error && <div style={styles.errorBox}>{error}</div>}

        {!devices.some((d) => d.is_blackhole) && sdAvailable && (
          <div style={styles.tipBox}>
            <strong style={{ color: "var(--warn)" }}>Tip</strong>{" "}
            <span style={styles.muted}>
              Install BlackHole 2ch for system-audio loopback —{" "}
              <code style={{ color: "var(--text)", fontSize: "0.78rem" }}>
                brew install blackhole-2ch
              </code>
              {" "}then create a Multi-Output Device in Audio MIDI Setup (add speakers + BlackHole).
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    flex: 1, display: "flex", alignItems: "flex-start",
    justifyContent: "center", padding: "48px 24px", overflowY: "auto",
  },
  card: {
    width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 20,
    background: "var(--bg-panel)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)", padding: "32px 36px",
  },
  heading:   { fontSize: "1.1rem", fontWeight: 700, color: "var(--text)" },
  muted:     { color: "var(--text-muted)", fontSize: "0.82rem", lineHeight: 1.6 },
  field:     { display: "flex", flexDirection: "column", gap: 8 },
  label:     {
    fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)",
    textTransform: "uppercase", letterSpacing: "0.06em",
  },
  segmented: {
    display: "flex", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", overflow: "hidden", width: "fit-content",
  },
  seg: {
    padding: "8px 20px", fontSize: "0.85rem", border: "none",
    cursor: "pointer", transition: "background 0.15s, color 0.15s",
  },
  select: {
    background: "var(--bg-card)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", color: "var(--text)",
    padding: "9px 12px", fontSize: "0.85rem", width: "100%", cursor: "pointer",
  },
  recBtn: {
    padding: "13px 32px", borderRadius: "var(--radius-sm)",
    fontSize: "0.95rem", fontWeight: 700, letterSpacing: "0.02em",
    cursor: "pointer", transition: "opacity 0.15s",
  },
  questionBox: {
    background: "rgba(19,239,147,0.05)", border: "1px solid rgba(19,239,147,0.15)",
    borderRadius: "var(--radius-sm)", padding: "14px 18px",
  },
  savedBox: {
    display: "flex", alignItems: "flex-start", gap: 10,
    background: "rgba(19,239,147,0.07)", border: "1px solid rgba(19,239,147,0.2)",
    borderRadius: "var(--radius-sm)", padding: "12px 16px",
    fontSize: "0.85rem", color: "var(--text)",
  },
  errorBox: {
    background: "#2a1010", border: "1px solid var(--error)",
    borderRadius: "var(--radius-sm)", color: "var(--error)",
    padding: "12px 16px", fontSize: "0.82rem",
  },
  tipBox: {
    background: "rgba(245,200,66,0.05)", border: "1px solid rgba(245,200,66,0.15)",
    borderRadius: "var(--radius-sm)", padding: "12px 16px",
    fontSize: "0.8rem", lineHeight: 1.6,
  },
  code: {
    display: "block", background: "var(--bg-card)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", padding: "10px 14px",
    fontFamily: "monospace", fontSize: "0.82rem", color: "var(--accent)",
  },
};
