/**
 * SwingAI — 1080×1920 social telemetry card renderer.
 *
 * Draws a stylized story-format graphic (Swing Index, max rotary velocity,
 * spine retention, kinematic order, skeleton overlay at impact) onto an
 * offscreen canvas and triggers a PNG download.
 */

import type { AnalysisResult, SwingSequence } from "../types/pose.ts";
import { BONES, PHASE_LABELS, PHASE_NAMES } from "../types/pose.ts";
import { maxRotaryVelocity } from "./engine.ts";

const W = 1080;
const H = 1920;

export function renderTelemetryCard(
  user: SwingSequence,
  analysis: AnalysisResult,
  playerName: string,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // ---- backdrop ---------------------------------------------------------
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0d0d0e");
  bg.addColorStop(0.55, "#101210");
  bg.addColorStop(1, "#0d0d0e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // faint grid
  ctx.strokeStyle = "rgba(163,194,147,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // ---- header -----------------------------------------------------------
  ctx.fillStyle = "#a3c293";
  ctx.font = "800 54px Inter, sans-serif";
  ctx.fillText("SWINGAI", 72, 130);
  ctx.fillStyle = "#8e8e96";
  ctx.font = "500 34px 'JetBrains Mono', monospace";
  ctx.fillText("MOTION TELEMETRY", 72, 182);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), W - 72, 130);
  ctx.fillText(playerName.toUpperCase(), W - 72, 182);
  ctx.textAlign = "left";

  // ---- swing index hero -------------------------------------------------
  ctx.fillStyle = "#f5f5f7";
  ctx.font = "800 300px 'JetBrains Mono', monospace";
  ctx.fillText(analysis.swingIndex.toFixed(1), 72, 520);
  ctx.fillStyle = "#8e8e96";
  ctx.font = "600 40px Inter, sans-serif";
  ctx.fillText("SWING INDEX / 10", 78, 585);
  ctx.fillStyle = analysis.mode === "dual" ? "#00E5FF" : "#a3c293";
  ctx.font = "700 30px 'JetBrains Mono', monospace";
  ctx.fillText(analysis.mode === "dual" ? "VS REFERENCE" : "SOLO ANALYSIS", 78, 640);

  // ---- skeleton snapshot at impact -------------------------------------
  const impact = analysis.phases.user.impact;
  const frame = user.frames[Math.min(impact, user.frames.length - 1)];
  if (frame) {
    const panel = { x: 560, y: 260, w: 450, h: 430 };
    ctx.fillStyle = "#18181b";
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(panel.x, panel.y, panel.w, panel.h, 28);
    ctx.fill();
    ctx.stroke();

    // fit landmarks into the panel with padding
    const xs = frame.map((l) => l.x);
    const ys = frame.map((l) => l.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min((panel.w * 0.7) / spanX, (panel.h * 0.8) / spanY);
    const px = (v: number) => panel.x + panel.w / 2 + (v - (minX + maxX) / 2) * scale;
    const py = (v: number) => panel.y + panel.h / 2 + (v - (minY + maxY) / 2) * scale;

    ctx.strokeStyle = "#a3c293";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const [a, b] of BONES) {
      const la = frame[a];
      const lb = frame[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo(px(la.x), py(la.y));
      ctx.lineTo(px(lb.x), py(lb.y));
      ctx.stroke();
    }
    ctx.fillStyle = "#e7efe2";
    for (const [, b] of BONES) {
      const lm = frame[b];
      if (!lm) continue;
      ctx.beginPath();
      ctx.arc(px(lm.x), py(lm.y), 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#8e8e96";
    ctx.font = "600 26px 'JetBrains Mono', monospace";
    ctx.fillText("IMPACT FRAME", panel.x + 24, panel.y + panel.h - 24);
  }

  // ---- stat rows --------------------------------------------------------
  const stats: Array<[string, string, string]> = [
    ["MAX ROTARY VELOCITY", `${maxRotaryVelocity(analysis, user.fps)}`, "deg/s pelvis"],
    [
      "SPINE RETENTION Δ",
      `${(analysis.spineDeltaDeg[impact] ?? 0).toFixed(1)}°`,
      "address → impact · target ≤ 8°",
    ],
    [
      "KINEMATIC SEQUENCE",
      analysis.kinematicSequence.sequenceCorrect ? "IN ORDER" : "OUT OF ORDER",
      "hips → torso → arms → hands",
    ],
    [
      "ACTIVE FAULTS",
      `${analysis.faults.length}`,
      analysis.faults.map((f) => f.name).slice(0, 3).join(" · ") || "clean pass",
    ],
  ];
  let y = 800;
  for (const [label, value, sub] of stats) {
    ctx.fillStyle = "#18181b";
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(72, y, W - 144, 190, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8e8e96";
    ctx.font = "700 30px Inter, sans-serif";
    ctx.fillText(label, 112, y + 62);
    ctx.fillStyle = value === "OUT OF ORDER" ? "#FF3B30" : "#f5f5f7";
    ctx.font = "800 64px 'JetBrains Mono', monospace";
    ctx.fillText(value, 112, y + 140);
    ctx.fillStyle = "#5d5d66";
    ctx.font = "500 26px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(sub.slice(0, 46), W - 112, y + 140);
    ctx.textAlign = "left";
    y += 220;
  }

  // ---- phase strip ------------------------------------------------------
  const stripY = y + 40;
  const T = user.frames.length - 1 || 1;
  ctx.fillStyle = "#18181b";
  ctx.beginPath();
  ctx.roundRect(72, stripY, W - 144, 120, 24);
  ctx.fill();
  ctx.strokeStyle = "#27272a";
  ctx.stroke();
  const stripX = 112;
  const stripW = W - 224;
  ctx.strokeStyle = "#2a2a30";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(stripX, stripY + 60);
  ctx.lineTo(stripX + stripW, stripY + 60);
  ctx.stroke();
  ctx.font = "600 22px 'JetBrains Mono', monospace";
  for (const name of PHASE_NAMES) {
    const f = analysis.phases.user[name];
    const x = stripX + (f / T) * stripW;
    ctx.fillStyle = "#a3c293";
    ctx.beginPath();
    ctx.arc(x, stripY + 60, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8e8e96";
    const label = PHASE_LABELS[name].toUpperCase();
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(Math.max(x - tw / 2, stripX), stripX + stripW - tw), stripY + 100);
  }

  // ---- footer -----------------------------------------------------------
  ctx.fillStyle = "#5d5d66";
  ctx.font = "500 26px 'JetBrains Mono', monospace";
  ctx.fillText("pose: mediapipe 33pt · alignment: dtw · analysis: swingai engine", 72, H - 72);

  return canvas;
}

export function downloadTelemetryCard(
  user: SwingSequence,
  analysis: AnalysisResult,
  playerName: string,
): void {
  const canvas = renderTelemetryCard(user, analysis, playerName);
  const a = document.createElement("a");
  a.download = `swingai-telemetry-${Date.now()}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}
