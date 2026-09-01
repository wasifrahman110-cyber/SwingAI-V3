/**
 * FaultTrendDashboard (/src/components/FaultTrendDashboard.tsx) — home-page
 * card: fault frequency trend across all locally saved sessions, the most
 * frequent faults, and percentage improvement over time (older half of
 * sessions vs newer half).
 */

import { useEffect, useRef } from "react";
import type { SessionRecord } from "../types/pose.ts";

const FAULT_LABELS: Record<string, string> = {
  early_extension: "Early Extension",
  chicken_wing: "Chicken Wing",
  sway: "Hip Sway",
  spine_retention: "Spine Loss",
  kinematic_sequence: "Sequence",
  head_sway: "Head Sway",
  head_lift: "Head Lift",
  head_dip: "Head Dip",
  reverse_spine: "Reverse Spine",
  overswing: "Overswing",
  shoulder_snatch: "Shoulder Snatch",
  casting: "Casting",
  flip_scoop: "Flip at Impact",
  hip_slide: "Hip Slide",
  hip_stall: "Hip Stall",
  trail_heel_lift: "Heel Lift",
  lead_knee_collapse: "Knee Collapse",
};

function TrendCanvas({ perSession }: { perSession: readonly number[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 340;
    const h = 90;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (perSession.length === 0) return;

    const maxV = Math.max(1, ...perSession);
    const n = perSession.length;
    const barW = Math.min(26, (w - 16) / n - 4);
    perSession.forEach((v, i) => {
      const x = 8 + (i * (w - 16)) / n;
      const bh = (v / maxV) * (h - 24);
      ctx.fillStyle = i === n - 1 ? "#a3c293" : "#3a3a41";
      ctx.beginPath();
      ctx.roundRect(x, h - 14 - bh, barW, Math.max(bh, 2), 3);
      ctx.fill();
      ctx.fillStyle = "#5d5d66";
      ctx.font = "500 8px 'JetBrains Mono', monospace";
      ctx.fillText(String(v), x + barW / 2 - 2, h - 3);
    });
  }, [perSession]);
  return <canvas ref={ref} aria-label="fault count per session" style={{ width: "100%", display: "block" }} />;
}

export function FaultTrendDashboard({ sessions }: { sessions: readonly SessionRecord[] }) {
  if (sessions.length < 2) {
    return (
      <div className="hex-card">
        <div className="hex-head">
          <span className="t">Fault Improvement Trend</span>
        </div>
        <div className="empty-note" style={{ padding: "18px 10px" }}>
          Analyze at least two swings and your improvement trend appears here.
        </div>
      </div>
    );
  }

  // oldest -> newest
  const ordered = [...sessions].reverse();
  const perSession = ordered.map((s) => s.faultCodes.length);

  // older half vs newer half — per-fault reduction
  const half = Math.floor(ordered.length / 2);
  const older = ordered.slice(0, half);
  const newer = ordered.slice(half);
  const rate = (list: readonly SessionRecord[], code: string): number =>
    list.length === 0 ? 0 : list.filter((s) => s.faultCodes.includes(code)).length / list.length;

  const allCodes = [...new Set(ordered.flatMap((s) => s.faultCodes))];
  const freq = allCodes
    .map((code) => ({
      code,
      total: ordered.filter((s) => s.faultCodes.includes(code)).length,
      delta: rate(older, code) - rate(newer, code), // + = improved
    }))
    .sort((a, b) => b.total - a.total);

  const improvements = freq
    .filter((f) => f.delta > 0.05)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2);

  return (
    <div className="hex-card" aria-label="fault improvement trend dashboard">
      <div className="hex-head">
        <span className="t">Fault Improvement Trend</span>
        <span className="pill">{sessions.length} sessions</span>
      </div>
      <TrendCanvas perSession={perSession} />
      <div className="trend-sub">faults per analyzed swing · latest highlighted</div>

      <div className="trend-most">
        <span className="trend-label">MOST FREQUENT</span>
        {freq.slice(0, 3).map((f) => (
          <span className="pill" key={f.code}>
            {FAULT_LABELS[f.code] ?? f.code} ×{f.total}
          </span>
        ))}
      </div>

      {improvements.length > 0 && (
        <div className="trend-improve">
          {improvements.map((f) => (
            <div className="trend-improve-row" key={f.code}>
              <span className="trend-improve-arrow">▼</span>
              {FAULT_LABELS[f.code] ?? f.code} reduced by {Math.round(f.delta * 100)}% across
              recent sessions
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
