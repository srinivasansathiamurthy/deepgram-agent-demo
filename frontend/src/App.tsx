import React, { useState } from "react";
import { useVoiceAgent } from "./hooks/useVoiceAgent";
import { StatusOrb }     from "./components/StatusOrb";
import { ChatHistory }   from "./components/ChatHistory";
import { AudioCapture }  from "./components/AudioCapture";

type Tab = "agent" | "capture";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("agent");

  const {
    mode,
    messages,
    sessionId,
    error,
    startSession,
    stopSession,
    togglePause,
    newSession,
  } = useVoiceAgent();

  // Keyboard shortcuts only active on the agent tab
  useKeyboardShortcuts(activeTab === "agent" ? { togglePause, stopSession } : null);

  const isConnected  = mode !== "disconnected";
  const isConnecting = mode === "connecting";
  const isPaused     = mode === "paused";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* ── header ──────────────────────────────────────────────────────────── */}
      <header style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        "14px 28px",
        borderBottom:   "1px solid var(--border)",
        background:     "var(--bg-panel)",
        flexShrink:     0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width:          32, height: 32, borderRadius: "50%",
            background:     "linear-gradient(135deg, #13ef93, #0c9e62)",
            display:        "flex", alignItems: "center", justifyContent: "center",
            fontWeight:     700, fontSize: "0.85rem", color: "#0a0f0d",
          }}>
            DG
          </div>
          <div>
            <h1 style={{ fontSize: "1rem", fontWeight: 700, lineHeight: 1.2 }}>
              Deepgram Documentation Assistant
            </h1>
            <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              Voice agent powered by Deepgram + Anthropic
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {activeTab === "agent" && (
            <button
              onClick={newSession}
              title="End current session and start a fresh one"
              style={{
                padding:      "8px 16px",
                borderRadius: "var(--radius-sm)",
                background:   "var(--bg-card)",
                border:       "1px solid var(--border)",
                color:        "var(--text-muted)",
                fontWeight:   500,
                fontSize:     "0.82rem",
                transition:   "border-color 0.2s, color 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
                (e.currentTarget as HTMLButtonElement).style.color       = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLButtonElement).style.color       = "var(--text-muted)";
              }}
            >
              + New Session
            </button>
          )}
        </div>
      </header>

      {/* ── tab bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display:     "flex",
        borderBottom: "1px solid var(--border)",
        background:   "var(--bg-panel)",
        flexShrink:   0,
        paddingLeft:  28,
      }}>
        {(["agent", "capture"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding:      "10px 20px",
              fontSize:     "0.82rem",
              fontWeight:   activeTab === tab ? 600 : 400,
              color:        activeTab === tab ? "var(--accent)" : "var(--text-muted)",
              background:   "transparent",
              border:       "none",
              borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
              cursor:       "pointer",
              transition:   "color 0.15s",
              letterSpacing: "0.01em",
            }}
          >
            {tab === "agent"   ? "Voice Agent"   : "Audio Capture"}
          </button>
        ))}
      </div>

      {/* ── content ─────────────────────────────────────────────────────────── */}
      {activeTab === "agent" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* ── LEFT: voice panel ─────────────────────────────────────────── */}
          <div style={{
            flex:           "0 0 55%",
            minWidth:       300,
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "center",
            padding:        "40px 32px",
            gap:            48,
            background:     "var(--bg)",
          }}>
            <StatusOrb mode={mode} />

            <p style={{
              fontSize:   "0.82rem",
              color:      "var(--text-muted)",
              textAlign:  "center",
              maxWidth:   340,
              lineHeight: 1.7,
            }}>
              {mode === "disconnected"   && "Click Start to connect and talk to the Deepgram documentation assistant."}
              {mode === "connecting"     && "Connecting to Deepgram — please allow microphone access when prompted."}
              {mode === "idle"           && "Listening… start talking whenever you're ready."}
              {mode === "paused"         && "Microphone paused. Click Resume to continue."}
              {mode === "user_speaking"  && "Detected your voice — keep talking."}
              {mode === "thinking"       && "Processing your question…"}
              {mode === "agent_speaking" && "Agent is answering — keep listening or interrupt by talking."}
            </p>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
              {!isConnected ? (
                <PrimaryButton onClick={startSession} disabled={isConnecting}>
                  {isConnecting ? "Connecting…" : "▶  Start"}
                </PrimaryButton>
              ) : (
                <DangerButton onClick={stopSession}>■  Stop</DangerButton>
              )}

              {isConnected && !isConnecting && (
                <SecondaryButton onClick={togglePause}>
                  {isPaused ? "⏵  Resume" : "⏸  Pause"}
                </SecondaryButton>
              )}
            </div>

            {error && (
              <div style={{
                padding:      "12px 18px",
                borderRadius: "var(--radius-sm)",
                background:   "#2a1010",
                border:       "1px solid var(--error)",
                color:        "var(--error)",
                fontSize:     "0.82rem",
                maxWidth:     400,
                lineHeight:   1.6,
                textAlign:    "center",
              }}>
                ⚠ {error}
              </div>
            )}

            {isConnected && (
              <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center" }}>
                Press <kbd style={kbdStyle}>Space</kbd> to pause/resume ·{" "}
                <kbd style={kbdStyle}>Esc</kbd> to stop
              </p>
            )}
          </div>

          {/* ── RIGHT: chat history panel ──────────────────────────────────── */}
          <div style={{
            flex:          "1 1 0",
            minWidth:      260,
            minHeight:     0,
            overflow:      "hidden",
            display:       "flex",
            flexDirection: "column",
          }}>
            <ChatHistory messages={messages} sessionId={sessionId} />
          </div>

        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", background: "var(--bg)" }}>
          <AudioCapture />
        </div>
      )}
    </div>
  );
}

// ── keyboard shortcuts ────────────────────────────────────────────────────────

function useKeyboardShortcuts(
  actions: { togglePause: () => void; stopSession: () => void } | null
) {
  React.useEffect(() => {
    if (!actions) return;
    function handleKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); actions!.togglePause(); }
      else if (e.code === "Escape") { actions!.stopSession(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [actions]);
}

// ── button primitives ─────────────────────────────────────────────────────────

interface BtnProps {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

function PrimaryButton({ onClick, children, disabled }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding:      "12px 28px",
        borderRadius: "var(--radius-sm)",
        background:   disabled ? "var(--bg-card)" : "var(--accent)",
        color:        disabled ? "var(--text-muted)" : "#0a0f0d",
        fontWeight:   700,
        fontSize:     "0.9rem",
        letterSpacing: "0.02em",
        transition:   "opacity 0.2s",
        opacity:      disabled ? 0.6 : 1,
        cursor:       disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({ onClick, children }: BtnProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:       "12px 28px",
        borderRadius:  "var(--radius-sm)",
        background:    "#2a1010",
        border:        "1px solid var(--error)",
        color:         "var(--error)",
        fontWeight:    600,
        fontSize:      "0.9rem",
        letterSpacing: "0.02em",
        transition:    "background 0.2s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#3a1515"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#2a1010"; }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: BtnProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:       "12px 24px",
        borderRadius:  "var(--radius-sm)",
        background:    "var(--bg-card)",
        border:        "1px solid var(--border)",
        color:         "var(--text)",
        fontWeight:    500,
        fontSize:      "0.9rem",
        transition:    "border-color 0.2s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
    >
      {children}
    </button>
  );
}

const kbdStyle: React.CSSProperties = {
  display:    "inline-block",
  padding:    "1px 6px",
  borderRadius: 3,
  border:     "1px solid var(--border)",
  background: "var(--bg-card)",
  fontFamily: "JetBrains Mono, monospace",
  fontSize:   "0.68rem",
  color:      "var(--text-muted)",
};
