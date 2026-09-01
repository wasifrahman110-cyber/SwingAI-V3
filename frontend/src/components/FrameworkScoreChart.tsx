/**
 * FrameworkScoreChart — canvas line chart of the weekly framework score with
 * the goal band and "This is your goal." marker, matching the reference UI.
 */

import { useEffect, useRef } from "react";

interface ChartProps {
  series: readonly number[];
  goal: number;
  dayLabels: readonly string[];
}

export function FrameworkScoreChart({ series, goal, dayLabels }: ChartProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 340;
    const h = 170;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padL = 8;
    const padR = 8;
    const padT = 30;
    const padB = 26;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const lo = Math.min(...series, goal) - 0.8;
    const hi = Math.max(...series, goal) + 0.8;
    const X = (i: number) => padL + (i / (series.length - 1)) * innerW;
    const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

    ctx.clearRect(0, 0, w, h);

    // horizontal grid
    ctx.strokeStyle = "rgba(42,42,48,0.8)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = padT + (g / 3) * innerH;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(w - padR, gy);
      ctx.stroke();
    }

    // goal line (dashed) + pill
    const gy = Y(goal);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(163,194,147,0.65)";
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    const pillText = "This is your goal.";
    ctx.font = "600 10.5px Inter, sans-serif";
    const tw = ctx.measureText(pillText).width;
    const pw = tw + 18;
    const px = w - padR - pw - 4;
    const py = gy - 22;
    ctx.fillStyle = "#a3c293";
    ctx.beginPath();
    ctx.roundRect(px, py, pw, 19, 9.5);
    ctx.fill();
    ctx.beginPath(); // pointer nub
    ctx.moveTo(px + pw / 2 - 4, py + 19);
    ctx.lineTo(px + pw / 2 + 4, py + 19);
    ctx.lineTo(px + pw / 2, py + 24);
    ctx.fill();
    ctx.fillStyle = "#0d130c";
    ctx.fillText(pillText, px + 9, py + 13);

    // score curve (smoothed)
    ctx.strokeStyle = "#8e8e96";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const x = X(i);
      const y = Y(series[i] as number);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const xPrev = X(i - 1);
        const yPrev = Y(series[i - 1] as number);
        const cx = (xPrev + x) / 2;
        ctx.bezierCurveTo(cx, yPrev, cx, y, x, y);
      }
    }
    ctx.stroke();

    // last point emphasis
    const li = series.length - 1;
    ctx.fillStyle = "#a3c293";
    ctx.beginPath();
    ctx.arc(X(li), Y(series[li] as number), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(163,194,147,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(li), Y(series[li] as number), 8, 0, Math.PI * 2);
    ctx.stroke();

    // x labels
    ctx.fillStyle = "#5d5d66";
    ctx.font = "500 9.5px 'JetBrains Mono', monospace";
    for (let i = 0; i < dayLabels.length; i += 1) {
      const label = dayLabels[i] as string;
      const lw = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(Math.max(X(i) - lw / 2, 0), w - lw), h - 8);
    }
  }, [series, goal, dayLabels]);

  return <canvas ref={ref} aria-label="framework score chart" />;
}
