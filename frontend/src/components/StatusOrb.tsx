/**
 * StatusOrb
 *
 * An animated circular indicator that reflects the current agent mode.
 * Each state has its own colour, glow, and animation so the user always
 * has an unambiguous visual cue about what the agent is doing.
 *
 * States → visuals:
 *   disconnected  — grey, static
 *   connecting    — grey, slow pulse
 *   idle          — teal, gentle breathe
 *   paused        — amber, static with inner ring
 *   user_speaking — blue-white, rapid pulse (user is talking)
 *   thinking      — orange, rotating orbit dot
 *   agent_speaking — green, slow wave pulse (agent is talking)
 */

import React, { CSSProperties } from "react";
import type { AgentMode } from "../hooks/useVoiceAgent";

interface Props {
  mode: AgentMode;
}

/** Per-mode config: orb colour and glow colour */
const THEME: Record<AgentMode, { color: string; glow: string; label: string }> = {
  disconnected:   { color: "#3a3a3a", glow: "transparent",   label: "Disconnected" },
  connecting:     { color: "#555e5a", glow: "#13ef9344",      label: "Connecting…" },
  idle:           { color: "#13ef93", glow: "#13ef9366",      label: "Listening" },
  paused:         { color: "#f5c842", glow: "#f5c84244",      label: "Paused" },
  user_speaking:  { color: "#5bc8f5", glow: "#5bc8f577",      label: "You're speaking" },
  thinking:       { color: "#ff9f43", glow: "#ff9f4366",      label: "Thinking…" },
  agent_speaking: { color: "#13ef93", glow: "#13ef9399",      label: "Agent speaking" },
};

/** Inline keyframe injection — keeps all animation code co-located with the component. */
const STYLE_TAG_ID = "orb-keyframes";

function injectKeyframes() {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
    @keyframes orbBreathe {
      0%, 100% { transform: scale(1);    opacity: 1; }
      50%       { transform: scale(1.08); opacity: 0.85; }
    }
    @keyframes orbPulseUser {
      0%, 100% { transform: scale(1);    box-shadow: var(--orb-glow); }
      50%       { transform: scale(1.15); box-shadow: var(--orb-glow-big); }
    }
    @keyframes orbWaveAgent {
      0%, 100% { transform: scale(1.0); }
      25%       { transform: scale(1.12); }
      75%       { transform: scale(0.96); }
    }
    @keyframes orbSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes orbSlowPulse {
      0%, 100% { opacity: 0.5; }
      50%       { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export function StatusOrb({ mode }: Props) {
  injectKeyframes();

  const { color, glow, label } = THEME[mode];

  // The thinking state shows a spinner ring rather than a solid orb.
  const isThinking = mode === "thinking";

  const orbStyle: CSSProperties = {
    position:     "relative",
    width:        120,
    height:       120,
    borderRadius: "50%",
    background:   isThinking ? "transparent" : `radial-gradient(circle at 38% 35%, ${color}cc, ${color}55)`,
    border:       isThinking ? `3px solid ${color}` : "none",
    boxShadow:    isThinking ? "none" : `0 0 40px ${glow}, 0 0 80px ${glow}55`,
    display:      "flex",
    alignItems:   "center",
    justifyContent: "center",
    transition:   "background 0.4s, box-shadow 0.4s",
    // CSS custom props used in keyframes
    ["--orb-glow" as string]:     `0 0 40px ${glow}`,
    ["--orb-glow-big" as string]: `0 0 70px ${glow}`,
    animation:
      mode === "disconnected"    ? "none" :
      mode === "connecting"      ? "orbSlowPulse 1.8s ease-in-out infinite" :
      mode === "idle"            ? "orbBreathe 3s ease-in-out infinite" :
      mode === "paused"          ? "none" :
      mode === "user_speaking"   ? "orbPulseUser 0.6s ease-in-out infinite" :
      mode === "thinking"        ? "orbSpin 1.2s linear infinite" :
   /* mode === "agent_speaking" */ "orbWaveAgent 0.9s ease-in-out infinite",
  };

  // Inner dot for disconnected/paused states to show the orb is non-empty.
  const innerDotStyle: CSSProperties = {
    width:        36,
    height:       36,
    borderRadius: "50%",
    background:   mode === "paused" ? color : `${color}88`,
    boxShadow:    mode === "paused" ? `0 0 12px ${glow}` : "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
      <div style={orbStyle}>
        {(mode === "disconnected" || mode === "paused") && <div style={innerDotStyle} />}
      </div>

      <span style={{
        fontSize:   "0.85rem",
        fontWeight: 500,
        color:      mode === "disconnected" ? "var(--text-muted)" : color,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        transition: "color 0.3s",
      }}>
        {label}
      </span>
    </div>
  );
}
