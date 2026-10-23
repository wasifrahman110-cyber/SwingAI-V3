/**
 * SwingCanvas — the core high-performance 2D-canvas swing player.
 *
 * Renders, per frame, on a devicePixelRatio-aware canvas inside a single
 * requestAnimationFrame loop (no per-prop redraw thrash):
 *   • the user's video frame (when uploaded) or a procedural range backdrop
 *   • the user's 33-point skeleton, joints tinted amber/red when the
 *     deviation engine flags them
 *   • the pro's "ghost" skeleton, DTW-time-mapped and pelvis-anchored onto
 *     the user's body, at adjustable opacity
 *   • a trailing lead-wrist path tracing the swing-plane arc
 *
 * Keyboard: ← / → frame-step, Space toggles play.
 */

import { useCallback, useEffect, useRef } from "react";
import type { AnalysisResult, PoseFrame, SwingSequence } from "../types/pose.ts";
import { BONES, LM } from "../types/pose.ts";

const ACCENT = "#a3c293";
const RED = "#e0564b";
const AMBER = "#d9a441";
const BONE_W = 2.2;

export interface SwingCanvasProps {
  user: SwingSequence;
  pro: SwingSequence;
  analysis: AnalysisResult | null;
  frame: number;
  playing: boolean;
  ghostOpacity: number;
  ghostOn: boolean;
  video: HTMLVideoElement | null;
  onFrameChange: (frame: number) => void;
  onTogglePlay: () => void;
}

interface Pt {
  x: number;
  y: number;
}

const project = (f: PoseFrame, i: number, w: number, h: number): Pt => {
  const lm = f[i];
  return lm ? { x: lm.x * w, y: lm.y * h } : { x: 0, y: 0 };
};

/**
 * Anchor the pro's ghost onto the user's body: translate so pelvis centers
 * coincide and scale by torso-length ratio (screen space).
 */
function ghostTransform(userF: PoseFrame, proF: PoseFrame): (p: Pt, w: number, h: number) => Pt {
  const mid = (f: PoseFrame, a: number, b: number): Pt => {
    const la = f[a];
    const lb = f[b];
    if (!la || !lb) return { x: 0.5, y: 0.5 };
    return { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 };
  };
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) || 1e-6;

  const uPelvis = mid(userF, LM.LEFT_HIP, LM.RIGHT_HIP);
  const uSho = mid(userF, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER);
  const pPelvis = mid(proF, LM.LEFT_HIP, LM.RIGHT_HIP);
  const pSho = mid(proF, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER);
  const s = dist(uPelvis, uSho) / dist(pPelvis, pSho);

  return (p: Pt, w: number, h: number): Pt => ({
    x: (uPelvis.x + (p.x / w - pPelvis.x) * s) * w,
    y: (uPelvis.y + (p.y / h - pPelvis.y) * s) * h,
  });
}

export function SwingCanvas(props: SwingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const lastTickRef = useRef<number>(0);
  const frameFloatRef = useRef<number>(props.frame);

  // keep the float accumulator in sync with external scrubs
  if (!props.playing) frameFloatRef.current = props.frame;

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const p = propsRef.current;
    const { user, pro, analysis } = p;
    const T = user.frames.length;
    const fi = Math.max(0, Math.min(T - 1, Math.round(frameFloatRef.current)));
    const userF = user.frames[fi];
    if (!userF) return;

    // ---- backdrop -----------------------------------------------------
    if (p.video && p.video.readyState >= 2) {
      const vw = p.video.videoWidth || 16;
      const vh = p.video.videoHeight || 9;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(p.video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(11,11,13,0.35)";
      ctx.fillRect(0, 0, w, h);
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#1c2420");
      sky.addColorStop(0.62, "#141a16");
      sky.addColorStop(0.63, "#10140f");
      sky.addColorStop(1, "#0c0f0b");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      // horizon treeline
      ctx.fillStyle = "#0e130e";
      for (let i = 0; i < 9; i++) {
        const tx = (i / 8) * w;
        const th = 14 + ((i * 37) % 23);
        ctx.beginPath();
        ctx.ellipse(tx, h * 0.62, 34, th, 0, Math.PI, 0);
        ctx.fill();
      }
      // fairway grid
      ctx.strokeStyle = "rgba(163,194,147,0.05)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        const gy = h * 0.62 + (i / 6) * h * 0.38;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
    }

    // ---- deviation lookup for this user frame -------------------------
    let flagged: ReadonlySet<number> = new Set();
    let severe = false;
    if (analysis) {
      const dev = analysis.deviations.find((d) => d.userFrame === fi);
      if (dev) {
        flagged = new Set(dev.flaggedJoints);
        severe =
          Math.abs(dev.spineAngleDelta) > 12 ||
          dev.leadArmDelta < -30 ||
          Math.abs(dev.hipSwayDelta) > 0.085;
      }
    }

    // ---- lead-wrist trail (swing-plane arc) ---------------------------
    const WRIST = user.leadSide === "left" ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    ctx.save();
    ctx.lineWidth = 2;
    const trailStart = Math.max(0, fi - 26);
    for (let t = trailStart + 1; t <= fi; t++) {
      const a = user.frames[t - 1];
      const b = user.frames[t];
      if (!a || !b) continue;
      const pa = project(a, WRIST, w, h);
      const pb = project(b, WRIST, w, h);
      const alpha = ((t - trailStart) / (fi - trailStart || 1)) * 0.85;
      ctx.strokeStyle = `rgba(163,194,147,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.restore();

    // ---- ghost (pro) skeleton -----------------------------------------
    if (p.ghostOn && analysis) {
      const proIdx = analysis.alignment.userToPro[fi] ?? 0;
      const proF = pro.frames[Math.min(proIdx, pro.frames.length - 1)];
      if (proF) {
        const xf = ghostTransform(userF, proF);
        ctx.save();
        ctx.globalAlpha = p.ghostOpacity;
        ctx.strokeStyle = "#f5f5f7";
        ctx.lineWidth = BONE_W;
        ctx.setLineDash([5, 4]);
        for (const [a, b] of BONES) {
          const pa = xf(project(proF, a, w, h), w, h);
          const pb = xf(project(proF, b, w, h), w, h);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = "#f5f5f7";
        for (const [, b] of BONES) {
          const pt = xf(project(proF, b, w, h), w, h);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // ---- user skeleton -------------------------------------------------
    ctx.save();
    ctx.lineWidth = BONE_W + 0.6;
    for (const [a, b] of BONES) {
      const bad = flagged.has(a) || flagged.has(b);
      ctx.strokeStyle = bad ? (severe ? RED : AMBER) : ACCENT;
      const pa = project(userF, a, w, h);
      const pb = project(userF, b, w, h);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    const jointSet = new Set<number>();
    for (const [a, b] of BONES) {
      jointSet.add(a);
      jointSet.add(b);
    }
    for (const j of jointSet) {
      const pt = project(userF, j, w, h);
      const bad = flagged.has(j);
      ctx.fillStyle = bad ? (severe ? RED : AMBER) : "#e7efe2";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, bad ? 4.4 : 3.1, 0, Math.PI * 2);
      ctx.fill();
      if (bad) {
        ctx.strokeStyle = severe ? "rgba(224,86,75,0.4)" : "rgba(217,164,65,0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // ---- phase watermark ----------------------------------------------
    if (analysis) {
      const ph = analysis.phases.user;
      const entries = Object.entries(ph).sort((a, b) => a[1] - b[1]);
      let current = entries[0]?.[0] ?? "setup";
      for (const [name, at] of entries) if (fi >= at) current = name;
      ctx.save();
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(245,245,247,0.55)";
      ctx.fillText(current.replace(/_/g, " ").toUpperCase(), 14, 20);
      ctx.restore();
    }
  }, []);

  // single rAF loop: advances playback + redraws
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const loop = (now: number) => {
      const p = propsRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 400;
      const cssH = Math.round(cssW * 0.72);
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (p.playing) {
        const dt = lastTickRef.current ? (now - lastTickRef.current) / 1000 : 0;
        frameFloatRef.current += dt * p.user.fps;
        const T = p.user.frames.length;
        if (frameFloatRef.current >= T - 1) frameFloatRef.current = 0; // loop playback
        const rounded = Math.round(frameFloatRef.current);
        if (rounded !== p.frame) p.onFrameChange(rounded);
      }
      lastTickRef.current = now;

      draw(ctx, cssW, cssH);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // keyboard scrubbing: ← / → frame-by-frame, Space toggles play
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = propsRef.current;
      const T = p.user.frames.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        const next = Math.max(0, Math.min(T - 1, p.frame + delta));
        frameFloatRef.current = next;
        p.onFrameChange(next);
      } else if (e.key === " ") {
        e.preventDefault();
        p.onTogglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <canvas ref={canvasRef} aria-label="swing player canvas" />;
}
