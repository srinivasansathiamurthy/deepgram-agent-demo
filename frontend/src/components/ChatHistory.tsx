/**
 * ChatHistory
 *
 * Displays the live transcript of the current session.
 *
 * Each message is a bubble on either side of the panel:
 *   • User messages (role = "user")       — right-aligned, blue tint
 *   • Agent messages (role = "assistant") — left-aligned,  green tint
 *
 * The panel scrolls to the latest message automatically whenever messages
 * change.  An empty-state prompt encourages the user to start talking.
 *
 * Below the messages, a muted footer shows the session ID (as it appears
 * in the sessions/ directory on disk) and a copy button.
 */

import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../hooks/useVoiceAgent";

interface Props {
  messages:  ChatMessage[];
  sessionId: string | null;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function ChatHistory({ messages, sessionId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const [copied, setCopied] = React.useState(false);

  function copySessionId() {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{
      display:       "flex",
      flexDirection: "column",
      flex:          1,
      minHeight:     0,
      background:    "var(--bg-panel)",
      borderLeft:    "1px solid var(--border)",
    }}>
      {/* ── header ── */}
      <div style={{
        padding:      "16px 20px 12px",
        borderBottom: "1px solid var(--border)",
        flexShrink:   0,
      }}>
        <h2 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text)", letterSpacing: "0.02em" }}>
          Chat History
        </h2>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
          Saved to <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.72rem" }}>sessions/</code> on disk
        </p>
      </div>

      {/* ── messages ── */}
      {/* Outer div grows to fill remaining panel height via flex: 1.        */}
      {/* Inner div is absolutely positioned inside it — this bypasses all   */}
      {/* the flex-chain height-constraint issues and always scrolls cleanly. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <div style={{
        position:  "absolute",
        inset:     0,
        overflowY: "scroll",
        padding:   "16px 16px 8px",
        display:   "flex",
        flexDirection: "column",
        gap:       12,
      }}>
        {messages.length === 0 ? (
          <div style={{
            flex:           1,
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "center",
            gap:            10,
            color:          "var(--text-muted)",
            textAlign:      "center",
            padding:        "0 24px",
          }}>
            <span style={{ fontSize: "2rem" }}>💬</span>
            <p style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
              Transcript will appear here as you talk.
              <br />
              Click <strong style={{ color: "var(--accent)" }}>Start</strong> to begin.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
      </div>{/* end absolute scroll container + relative wrapper */}

      {/* ── session footer ── */}
      {sessionId && (
        <div style={{
          padding:    "10px 16px",
          borderTop:  "1px solid var(--border)",
          flexShrink: 0,
          display:    "flex",
          alignItems: "center",
          gap:        8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: 2 }}>
              Session ID
            </p>
            <p style={{
              fontSize:     "0.72rem",
              fontFamily:   "JetBrains Mono, monospace",
              color:        "var(--text)",
              whiteSpace:   "nowrap",
              overflow:     "hidden",
              textOverflow: "ellipsis",
            }}>
              {sessionId}
            </p>
          </div>
          <button
            onClick={copySessionId}
            title="Copy session ID"
            style={{
              padding:      "4px 10px",
              borderRadius: "var(--radius-sm)",
              background:   copied ? "var(--accent-dim)" : "var(--bg-card)",
              border:       "1px solid var(--border)",
              color:        copied ? "#fff" : "var(--text-muted)",
              fontSize:     "0.72rem",
              flexShrink:   0,
              transition:   "background 0.2s, color 0.2s",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── MessageBubble ──────────────────────────────────────────────────────────────

interface BubbleProps {
  msg: ChatMessage;
}

function MessageBubble({ msg }: BubbleProps) {
  const isUser = msg.role === "user";

  return (
    <div style={{
      display:        "flex",
      flexDirection:  "column",
      alignItems:     isUser ? "flex-end" : "flex-start",
    }}>
      {/* role label + timestamp */}
      <div style={{
        display:  "flex",
        gap:      8,
        marginBottom: 4,
        alignItems:   "baseline",
      }}>
        <span style={{
          fontSize:   "0.72rem",
          fontWeight: 600,
          color:      isUser ? "var(--user-color)" : "var(--agent-color)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          {isUser ? "You" : "Agent"}
        </span>
        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
          {formatTime(msg.timestamp)}
        </span>
      </div>

      {/* bubble */}
      <div style={{
        maxWidth:     "88%",
        padding:      "10px 14px",
        borderRadius: isUser
          ? "var(--radius-md) var(--radius-sm) var(--radius-md) var(--radius-md)"
          : "var(--radius-sm) var(--radius-md) var(--radius-md) var(--radius-md)",
        background:   isUser
          ? "#1a2e3f"
          : "#0f2019",
        border:       `1px solid ${isUser ? "#1e3e54" : "#1a3826"}`,
        color:        "var(--text)",
        fontSize:     "0.88rem",
        lineHeight:   1.6,
        wordBreak:    "break-word",
      }}>
        {msg.content}
      </div>
    </div>
  );
}
