/**
 * Scrubber — canvas keyframe timeline.
 *
 * Draws a deviation heat-strip (per-frame max deviation magnitude), the five
 * phase checkpoint ticks, and the playhead. Click / drag to scrub; the parent
 * owns the frame state.
 */

import { useEffect, useRef } from "react";
import type { AnalysisResult } from "../types/pose.ts";
import { PHASE_LABELS, PHASE_NAMES } from "../types/pose.ts";

interface ScrubberProps {
  totalFrames: number;
  frame: number;
  analysis: AnalysisResult | null;
  onScrub: (frame: number) => void;
}

export function Scrubber({ totalFrames, frame, analysis, onScrub }: ScrubberProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ totalFrames, frame, analysis });
  stateRef.current = { totalFrames, frame, analysis };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const render = () => {
      const { totalFrames: T, frame: fi, analysis: an } = stateRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 44;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // base track
      ctx.fillStyle = "#202025";
      ctx.beginPath();
      ctx.roundRect(0, h / 2 - 8, w, 16, 6);
      ctx.fill();

      // deviation heat strip
      if (an && T > 1) {
        const mag = new Float64Array(T);
        for (const d of an.deviations) {
          const m =
            Math.abs(d.spineAngleDelta) / 8 +
            Math.max(0, -d.leadArmDelta) / 20 +
            Math.abs(d.hipSwayDelta) / 0.055;
          if (d.userFrame < T) mag[d.userFrame] = Math.max(mag[d.userFrame] as number, m);
        }
        for (let t = 0; t < T; t++) {
          const m = mag[t] as number;
          if (m <= 0.4) continue;
          const x = (t / (T - 1)) * w;
          const alpha = Math.min(0.85, m / 4);
          ctx.fillStyle =
            m > 2.4 ? `rgba(224,86,75,${alpha})` : `rgba(217,164,65,${alpha})`;
          ctx.fillRect(x, h / 2 - 8, Math.max(w / T, 1.5), 16);
        }

        // phase ticks — skip a label when it would collide with the previous
        ctx.font = "600 8px 'JetBrains Mono', monospace";
        let lastLabelEnd = -Infinity;
        for (const name of PHASE_NAMES) {
          const at = an.phases.user[name];
          const x = (at / (T - 1)) * w;
          ctx.strokeStyle = "rgba(245,245,247,0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, h / 2 - 12);
          ctx.lineTo(x, h / 2 + 8);
          ctx.stroke();
          const label = PHASE_LABELS[name].toUpperCase();
          const tw = ctx.measureText(label).width;
          const lx = Math.min(Math.max(x - tw / 2, 1), w - tw - 1);
          if (lx > lastLabelEnd + 4) {
            ctx.fillStyle = "rgba(142,142,150,0.9)";
            ctx.fillText(label, lx, h - 2);
            lastLabelEnd = lx + tw;
          }
        }
      }

      // playhead
      if (T > 1) {
        const x = (fi / (T - 1)) * w;
        ctx.fillStyle = "#a3c293";
        ctx.beginPath();
        ctx.roundRect(x - 1.5, h / 2 - 14, 3, 24, 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let dragging = false;

    const frameAt = (clientX: number): number => {
      const rect = canvas.getBoundingClientRect();
      const { totalFrames: T } = stateRef.current;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * (T - 1));
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      onScrub(frameAt(e.clientX));
    };
    const move = (e: PointerEvent) => {
      if (dragging) onScrub(frameAt(e.clientX));
    };
    const up = () => {
      dragging = false;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [onScrub]);

  return (
    <div className="scrubber">
      <canvas ref={ref} aria-label="timeline scrubber" />
    </div>
  );
}
