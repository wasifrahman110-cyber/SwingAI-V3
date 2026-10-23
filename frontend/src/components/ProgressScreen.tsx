/**
 * ProgressScreen — swing-index trend across saved sessions, fault-frequency
 * bars, and the session library (tap a session to reload it into the player).
 */

import { useEffect, useRef } from "react";
import type { SessionRecord } from "../types/pose.ts";
import { deleteSession } from "../lib/sessionStore.ts";

interface ProgressProps {
  sessions: readonly SessionRecord[];
  onOpenSession: (s: SessionRecord) => void;
  onSessionsChanged: (s: SessionRecord[]) => void;
}

const FAULT_LABELS: Record<string, string> = {
  early_extension: "Early Ext.",
  chicken_wing: "Chicken Wing",
  sway: "Sway",
  spine_retention: "Spine Loss",
  kinematic_sequence: "Sequence",
  head_sway: "Head Sway",
  head_lift: "Head Lift",
  head_dip: "Head Dip",
  flat_shoulder_turn: "Flat Turn",
  reverse_spine: "Rev. Spine",
  overswing: "Overswing",
  shoulder_snatch: "Snatch",
  casting: "Casting",
  lead_arm_breakdown: "Arm Bend",
  flip_scoop: "Flip",
  hip_slide: "Hip Slide",
  hip_stall: "Hip Stall",
  trail_heel_lift: "Heel Lift",
  lead_knee_collapse: "Knee Dive",
  hanging_back: "Hang Back",
};

function TrendChart({ sessions }: { sessions: readonly SessionRecord[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 340;
    const h = 150;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const data = [...sessions].reverse(); // oldest -> newest
    if (data.length === 0) return;
    const padL = 10;
    const padR = 10;
    const padT = 14;
    const padB = 20;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const X = (i: number) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const Y = (v: number) => padT + (1 - v / 10) * innerH;

    ctx.strokeStyle = "rgba(39,39,42,0.9)";
    ctx.lineWidth = 1;
    for (const g of [0, 5, 10]) {
      ctx.beginPath();
      ctx.moveTo(padL, Y(g));
      ctx.lineTo(w - padR, Y(g));
      ctx.stroke();
    }

    ctx.strokeStyle = "#a3c293";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((s, i) => {
      if (i === 0) ctx.moveTo(X(i), Y(s.swingIndex));
      else ctx.lineTo(X(i), Y(s.swingIndex));
    });
    ctx.stroke();
    ctx.fillStyle = "#a3c293";
    data.forEach((s, i) => {
      ctx.beginPath();
      ctx.arc(X(i), Y(s.swingIndex), 3.4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#5d5d66";
    ctx.font = "500 9px 'JetBrains Mono', monospace";
    ctx.fillText("10", padL, Y(10) - 3);
    ctx.fillText("0", padL, Y(0) - 3);
    const last = data[data.length - 1];
    if (last) {
      ctx.fillStyle = "#f5f5f7";
      ctx.font = "700 11px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(last.swingIndex.toFixed(1), w - padR, Y(last.swingIndex) - 8);
      ctx.textAlign = "left";
    }
  }, [sessions]);

  return <canvas ref={ref} aria-label="swing index trend" style={{ width: "100%", display: "block" }} />;
}

export function ProgressScreen({ sessions, onOpenSession, onSessionsChanged }: ProgressProps) {
  const faultCounts = new Map<string, number>();
  for (const s of sessions) {
    for (const code of s.faultCodes) {
      faultCounts.set(code, (faultCounts.get(code) ?? 0) + 1);
    }
  }
  const maxCount = Math.max(1, ...faultCounts.values());

  return (
    <div className="screen">
      <h2 className="section-title">Progress</h2>

      <div className="chart-card">
        <div className="chart-head">
          <span className="title">Swing Index Trend</span>
          <span className="pill">{sessions.length} sessions</span>
        </div>
        {sessions.length === 0 ? (
          <div className="empty-note">Analyze a swing and it lands here automatically.</div>
        ) : (
          <TrendChart sessions={sessions} />
        )}
      </div>

      {faultCounts.size > 0 && (
        <div className="chart-card">
          <div className="chart-head">
            <span className="title">Fault Frequency</span>
          </div>
          {[...faultCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => (
              <div className="fault-bar-row" key={code}>
                <span className="fault-bar-label">{FAULT_LABELS[code] ?? code}</span>
                <div className="fault-bar-track">
                  <div
                    className="fault-bar-fill"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="fault-bar-count">{count}</span>
              </div>
            ))}
        </div>
      )}

      <h2 className="section-title">Session Library</h2>
      {sessions.length === 0 && (
        <div className="empty-note">No saved sessions yet.</div>
      )}
      {sessions.map((s) => (
        <section className="line-section" key={s.id}>
          <div className="studio-lib-row">
            <button
              className="session-open"
              onClick={() => onOpenSession(s)}
              disabled={s.swing.frames.length === 0}
            >
              <div className="fix-name">
                {s.label}
                <span className={`pill ${s.mode === "dual" ? "accent" : ""}`}>{s.mode}</span>
              </div>
              <div className="fix-metric">
                {new Date(s.dateISO).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · index {s.swingIndex.toFixed(1)} · {s.faultCodes.length}{" "}
                {s.faultCodes.length === 1 ? "fault" : "faults"}
                {s.swing.frames.length === 0 && " · pose data evicted"}
              </div>
            </button>
            <button
              className="journal-delete"
              onClick={() => {
                deleteSession(s.id);
                onSessionsChanged(sessions.filter((x) => x.id !== s.id));
              }}
              aria-label="delete session"
            >
              ×
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
