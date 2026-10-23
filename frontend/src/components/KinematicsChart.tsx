/**
 * KinematicsChart — high-density angular-velocity chart under the scrubber.
 *
 * Four series (pelvis, thorax, arm, hand assembly), the downswing evaluation
 * window shaded, per-segment peak markers, and a playhead cursor. Tap or
 * drag anywhere on the chart to seek the player.
 */

import { useEffect, useRef } from "react";
import type { AnalysisResult, KinematicSegment } from "../types/pose.ts";

const SERIES: ReadonlyArray<{ key: KinematicSegment; label: string; color: string }> = [
  { key: "hips", label: "HIP", color: "#30D158" },
  { key: "torso", label: "TORSO", color: "#00E5FF" },
  { key: "arms", label: "ARM", color: "#FFB800" },
  { key: "hands", label: "HAND", color: "#FF3B30" },
];

interface ChartProps {
  analysis: AnalysisResult;
  fps: number;
  frame: number;
  totalFrames: number;
  onSeek: (frame: number) => void;
}

export function KinematicsChart({ analysis, fps, frame, totalFrames, onSeek }: ChartProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ analysis, fps, frame, totalFrames });
  stateRef.current = { analysis, fps, frame, totalFrames };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const render = () => {
      const { analysis: an, fps: f, frame: fi, totalFrames: T } = stateRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 340;
      const h = canvas.clientHeight || 130;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 8;
      const padR = 8;
      const padT = 22;
      const padB = 16;
      const innerW = w - padL - padR;
      const innerH = h - padT - padB;
      const N = Math.max(T - 1, 1);

      // deg/frame -> deg/s for display scale
      let vmax = 1;
      for (const s of SERIES) {
        const series = an.kinematicVelocity[s.key];
        for (const v of series) vmax = Math.max(vmax, v * f);
      }

      const X = (t: number) => padL + (t / N) * innerW;
      const Y = (v: number) => padT + (1 - v / vmax) * innerH;

      // downswing evaluation window
      const win = an.kinematicSequence.window;
      ctx.fillStyle = "rgba(163,194,147,0.06)";
      ctx.fillRect(X(win.start), padT, X(win.end) - X(win.start), innerH);

      // grid
      ctx.strokeStyle = "rgba(39,39,42,0.9)";
      ctx.lineWidth = 1;
      for (let g = 0; g <= 2; g++) {
        const gy = padT + (g / 2) * innerH;
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(w - padR, gy);
        ctx.stroke();
      }

      // series
      for (const s of SERIES) {
        const series = an.kinematicVelocity[s.key];
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let t = 0; t < series.length; t++) {
          const x = X(t);
          const y = Y((series[t] as number) * f);
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // peak marker
        const peak = an.kinematicSequence.peakFrames[s.key];
        if (peak !== undefined && series[peak] !== undefined) {
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(X(peak), Y((series[peak] as number) * f), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // playhead
      ctx.strokeStyle = "rgba(245,245,247,0.7)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(X(Math.min(fi, N)), padT - 4);
      ctx.lineTo(X(Math.min(fi, N)), padT + innerH + 4);
      ctx.stroke();

      // legend + scale
      ctx.font = "600 9.5px Inter, -apple-system, 'Segoe UI', sans-serif";
      let lx = padL + 2;
      for (const s of SERIES) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, 6, 7, 2.5);
        ctx.fillStyle = "#8e8e96";
        ctx.fillText(s.label, lx + 10, 11);
        lx += 10 + ctx.measureText(s.label).width + 12;
      }
      ctx.fillStyle = "#5d5d66";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(vmax)} deg/s`, w - padR, 11);
      ctx.textAlign = "left";
      const order = an.kinematicSequence.sequenceCorrect ? "SEQUENCE OK" : "OUT OF ORDER";
      ctx.fillStyle = an.kinematicSequence.sequenceCorrect ? "#30D158" : "#FF3B30";
      ctx.fillText(order, padL + 2, h - 5);

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  // tap / drag to seek
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let down = false;
    const seekAt = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const { totalFrames: T } = stateRef.current;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - 8) / (rect.width - 16)));
      onSeek(Math.round(ratio * (T - 1)));
    };
    const onDown = (e: PointerEvent) => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      seekAt(e.clientX);
    };
    const onMove = (e: PointerEvent) => {
      if (down) seekAt(e.clientX);
    };
    const onUp = () => {
      down = false;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [onSeek]);

  return (
    <div className="kin-chart">
      <canvas ref={ref} aria-label="kinematic sequence angular velocity chart" />
    </div>
  );
}
