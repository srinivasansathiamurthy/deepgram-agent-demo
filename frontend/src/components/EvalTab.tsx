import { useState, useEffect, useCallback } from "react";
import type { AgentMode } from "../hooks/useVoiceAgent";

// ── types ─────────────────────────────────────────────────────────────────────

interface ChatFlow {
  id:                 string;
  title:              string;
  topic_area:         string;
  branches_expected:  string[];
  doc_areas:          string[];
  questions:          string[];
}

interface Device {
  index:        number;
  name:         string;
  is_blackhole: boolean;
  is_default:   boolean;
}

interface EvalTabProps {
  mode:         AgentMode;
  startSession: (flowId?: string) => Promise<void>;
  stopSession:  () => void;
  sessionId:    string | null;
}

// ── component ─────────────────────────────────────────────────────────────────

export function EvalTab({ mode, startSession, stopSession, sessionId }: EvalTabProps) {
  const [flows,            setFlows]           = useState<ChatFlow[]>([]);
  const [selectedFlow,     setSelectedFlow]     = useState<ChatFlow | null>(null);
  const [checked,          setChecked]          = useState<Set<number>>(new Set());
  const [capturing,        setCapturing]        = useState(false);
  const [captureError,     setCaptureError]     = useState<string | null>(null);
  const [devices,          setDevices]          = useState<Device[]>([]);

  const isConnected = mode !== "disconnected" && mode !== "connecting";

  // Load flows and devices on mount
  useEffect(() => {
    fetch("/api/eval/flows")
      .then((r) => r.json())
      .then(setFlows)
      .catch(() => {});

    fetch("/api/capture/devices")
      .then((r) => r.json())
      .then((d) => setDevices(d.devices ?? []))
      .catch(() => {});

    // Sync any in-progress capture
    fetch("/api/capture/status")
      .then((r) => r.json())
      .then((d) => { if (d.recording) setCapturing(true); })
      .catch(() => {});
  }, []);

  // Reset per-flow state when flow changes
  useEffect(() => {
    setChecked(new Set());
    setCaptureError(null);
  }, [selectedFlow?.id]);

  const toggleCheck = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const handleStartSession = useCallback(async () => {
    if (!selectedFlow) return;
    await startSession(selectedFlow.id);
  }, [selectedFlow, startSession]);

  const handleRecord = useCallback(async () => {
    setCaptureError(null);
    if (capturing) {
      const res  = await fetch("/api/capture/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setCaptureError(data.error ?? "Stop failed"); return; }
      setCapturing(false);
    } else {
      if (!selectedFlow) return;
      const isBuiltIn = (d: Device) => /macbook|built.?in|internal/i.test(d.name) && !d.is_blackhole;
      const bh       = devices.find((d) => d.is_blackhole);
      const mic      = devices.find(isBuiltIn) ?? devices.find((d) => d.is_default && !d.is_blackhole);
      const res = await fetch("/api/capture/start", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          label:            selectedFlow.id,
          device_index:     bh?.index ?? null,
          mic_device_index: mic?.index ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCaptureError(data.error ?? "Start failed"); return; }
      setCapturing(true);
    }
  }, [capturing, selectedFlow, devices]);


  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

      {/* ── LEFT: flow list ───────────────────────────────────────────────── */}
      <div style={{
        flex:          "0 0 38%",
        minWidth:      260,
        borderRight:   "1px solid var(--border)",
        display:       "flex",
        flexDirection: "column",
        overflow:      "hidden",
      }}>
        <div style={{
          padding:      "16px 20px",
          borderBottom: "1px solid var(--border)",
          fontSize:     "0.75rem",
          fontWeight:   600,
          color:        "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          flexShrink:   0,
        }}>
          QA Flows ({flows.length})
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {flows.map((flow, i) => {
            const selected = selectedFlow?.id === flow.id;
            return (
              <div
                key={flow.id}
                onClick={() => setSelectedFlow(flow)}
                style={{
                  padding:     "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  borderLeft:  selected ? "3px solid var(--accent)" : "3px solid transparent",
                  background:  selected ? "rgba(19,239,147,0.05)" : "transparent",
                  cursor:      "pointer",
                  transition:  "background 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize:   "0.7rem",
                    fontWeight: 700,
                    color:      selected ? "var(--accent)" : "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span style={{
                    fontSize:   "0.85rem",
                    fontWeight: selected ? 600 : 400,
                    color:      selected ? "var(--text)" : "var(--text)",
                    lineHeight: 1.3,
                  }}>
                    {flow.title}
                  </span>
                </div>
                <span style={{
                  fontSize:     "0.7rem",
                  color:        "var(--text-muted)",
                  background:   "var(--bg-card)",
                  border:       "1px solid var(--border)",
                  borderRadius: 3,
                  padding:      "1px 6px",
                }}>
                  {flow.topic_area}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: flow detail ─────────────────────────────────────────────── */}
      <div style={{
        flex:          "1 1 0",
        minWidth:      0,
        display:       "flex",
        flexDirection: "column",
        overflow:      "hidden",
        background:    "var(--bg)",
      }}>
        {!selectedFlow ? (
          <div style={{
            flex:           1,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            color:          "var(--text-muted)",
            fontSize:       "0.85rem",
          }}>
            Select a flow to get started
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

            {/* Title */}
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 8, lineHeight: 1.3 }}>
              {selectedFlow.title}
            </h2>

            {/* Badges */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 24 }}>
              <Chip color="var(--accent)">{selectedFlow.topic_area}</Chip>
              {selectedFlow.branches_expected.map((b) => (
                <Chip key={b} color="var(--text-muted)">{b}</Chip>
              ))}
            </div>

            {/* Controls */}
            <div style={{
              display:      "flex",
              gap:          10,
              marginBottom: 28,
              flexWrap:     "wrap",
              alignItems:   "center",
            }}>
              {/* Session */}
              {!isConnected ? (
                <CtrlButton
                  accent
                  onClick={handleStartSession}
                  disabled={mode === "connecting"}
                >
                  {mode === "connecting" ? "Connecting…" : "▶  Start Session"}
                </CtrlButton>
              ) : (
                <CtrlButton danger onClick={stopSession}>
                  ■  Stop Session
                </CtrlButton>
              )}

              {/* Recording */}
              <CtrlButton
                danger={capturing}
                onClick={handleRecord}
              >
                {capturing ? "■  Stop Recording" : "●  Record"}
              </CtrlButton>

              {sessionId && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", alignSelf: "center" }}>
                  session: {sessionId.slice(-12)}
                </span>
              )}
            </div>

            {captureError && <ErrorBox>{captureError}</ErrorBox>}

            {/* Question list */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontSize:      "0.7rem",
                fontWeight:    600,
                color:         "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom:  12,
              }}>
                Questions ({selectedFlow.questions.length})
              </div>
              {selectedFlow.questions.map((q, i) => {
                const done = checked.has(i);
                return (
                  <div
                    key={i}
                    onClick={() => toggleCheck(i)}
                    style={{
                      display:      "flex",
                      alignItems:   "flex-start",
                      gap:          10,
                      padding:      "10px 12px",
                      marginBottom: 4,
                      borderRadius: "var(--radius-sm)",
                      background:   done ? "transparent" : "rgba(19,239,147,0.04)",
                      border:       done ? "1px solid transparent" : "1px solid rgba(19,239,147,0.1)",
                      cursor:       "pointer",
                      transition:   "background 0.15s",
                    }}
                  >
                    <span style={{
                      width:        18,
                      height:       18,
                      borderRadius: 3,
                      border:       `1.5px solid ${done ? "var(--accent)" : "var(--border)"}`,
                      background:   done ? "var(--accent)" : "transparent",
                      display:      "flex",
                      alignItems:   "center",
                      justifyContent: "center",
                      flexShrink:   0,
                      marginTop:    1,
                      transition:   "background 0.15s, border-color 0.15s",
                    }}>
                      {done && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="#0a0f0d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <span style={{
                      fontSize:       "0.85rem",
                      lineHeight:     1.5,
                      color:          done ? "var(--text-muted)" : "var(--text)",
                      textDecoration: done ? "line-through" : "none",
                      flex:           1,
                    }}>
                      <span style={{ color: "var(--text-muted)", marginRight: 6, fontVariantNumeric: "tabular-nums" }}>
                        {i + 1}.
                      </span>
                      {q}
                    </span>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ── small primitives ──────────────────────────────────────────────────────────

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize:     "0.72rem",
      fontWeight:   600,
      color,
      background:   `${color}18`,
      border:       `1px solid ${color}44`,
      borderRadius: 4,
      padding:      "2px 8px",
    }}>
      {children}
    </span>
  );
}

interface CtrlBtnProps {
  onClick:   () => void;
  children:  React.ReactNode;
  disabled?: boolean;
  accent?:   boolean;
  danger?:   boolean;
}

function CtrlButton({ onClick, children, disabled, accent, danger }: CtrlBtnProps) {
  const bg     = accent ? "var(--accent)"  : danger ? "#2a1010"       : "var(--bg-card)";
  const color  = accent ? "#0a0f0d"        : danger ? "var(--error)"   : "var(--text)";
  const border = accent ? "none"           : danger ? "1px solid var(--error)" : "1px solid var(--border)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding:      "9px 20px",
        borderRadius: "var(--radius-sm)",
        background:   disabled ? "var(--bg-card)" : bg,
        color:        disabled ? "var(--text-muted)" : color,
        border:       disabled ? "1px solid var(--border)" : border,
        fontWeight:   600,
        fontSize:     "0.82rem",
        cursor:       disabled ? "not-allowed" : "pointer",
        opacity:      disabled ? 0.6 : 1,
        transition:   "opacity 0.15s",
        whiteSpace:   "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background:   "#2a1010",
      border:       "1px solid var(--error)",
      borderRadius: "var(--radius-sm)",
      color:        "var(--error)",
      padding:      "10px 14px",
      fontSize:     "0.82rem",
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}
