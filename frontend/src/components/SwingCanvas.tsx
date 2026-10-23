/**
 * SwingCanvas (V2) — high-performance dual-stream swing player.
 *
 * One unified requestAnimationFrame loop renders, per frame:
 *   SOLO  — a single pane: video / procedural backdrop, 33-pt skeleton,
 *           deviation-tinted joints, lead-wrist swing-plane trail.
 *   DUAL  — a synchronized split view (user left, reference right). The
 *           reference frame is DTW-time-mapped from the user's playhead,
 *           plus a manual ±30-frame calibration offset. GHOST additionally
 *           projects the reference skeleton onto the user's pane.
 *
 * Input: ← / → frame-step, Space play/pause, horizontal touch-drag scrubbing
 * (12 px per frame) when the telestrator is inactive. Playback speed is a
 * multiplier on video-time advance (0.1× … 1×).
 */

import { useCallback, useEffect, useRef } from "react";
import type { AnalysisResult, PoseFrame, SwingSequence } from "../types/pose.ts";
import { BONES, LM } from "../types/pose.ts";

const ACCENT = "#a3c293";
const RED = "#e0564b";
const AMBER = "#d9a441";
const REF_COLOR = "#00E5FF";
const BONE_W = 2.2;
const SWIPE_PX_PER_FRAME = 12;

export interface SwingCanvasProps {
  user: SwingSequence;
  reference: SwingSequence | null;
  analysis: AnalysisResult | null;
  mode: "solo" | "dual";
  frame: number;
  playing: boolean;
  speed: number;
  frameOffset: number;
  ghostOpacity: number;
  ghostOn: boolean;
  video: HTMLVideoElement | null;
  referenceVideo: HTMLVideoElement | null;
  interactive: boolean; // false while the telestrator captures the pointer
  /** Multi-angle mode: down-the-line clip rendered beside the face-on clip. */
  multiView: boolean;
  dtl: SwingSequence | null;
  dtlVideo: HTMLVideoElement | null;
  onFrameChange: (frame: number) => void;
  onTogglePlay: () => void;
}

interface Pt {
  x: number;
  y: number;
}

interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

const project = (f: PoseFrame, i: number, pane: Pane): Pt => {
  const lm = f[i];
  return lm
    ? { x: pane.x + lm.x * pane.w, y: pane.y + lm.y * pane.h }
    : { x: pane.x, y: pane.y };
};

/** Reference frame for a user frame: DTW map + manual calibration offset. */
export function mappedReferenceFrame(
  analysis: AnalysisResult | null,
  userFrame: number,
  offset: number,
  refLength: number,
): number {
  const base = analysis?.alignment
    ? (analysis.alignment.userToPro[userFrame] ?? 0)
    : userFrame;
  return Math.max(0, Math.min(refLength - 1, base + offset));
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  pane: Pane,
  video: HTMLVideoElement | null,
  seedShift: number,
): void {
  if (video && video.readyState >= 2) {
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const scale = Math.max(pane.w / vw, pane.h / vh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.x, pane.y, pane.w, pane.h);
    ctx.clip();
    ctx.drawImage(
      video,
      pane.x + (pane.w - vw * scale) / 2,
      pane.y + (pane.h - vh * scale) / 2,
      vw * scale,
      vh * scale,
    );
    ctx.fillStyle = "rgba(13,13,14,0.35)";
    ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
    ctx.restore();
    return;
  }
  const sky = ctx.createLinearGradient(pane.x, pane.y, pane.x, pane.y + pane.h);
  sky.addColorStop(0, "#1c2420");
  sky.addColorStop(0.62, "#141a16");
  sky.addColorStop(0.63, "#10140f");
  sky.addColorStop(1, "#0c0f0b");
  ctx.fillStyle = sky;
  ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
  ctx.fillStyle = "#0e130e";
  for (let i = 0; i < 7; i++) {
    const tx = pane.x + (i / 6) * pane.w;
    const th = 12 + ((i * 37 + seedShift) % 20);
    ctx.beginPath();
    ctx.ellipse(tx, pane.y + pane.h * 0.62, 30, th, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(163,194,147,0.05)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const gy = pane.y + pane.h * 0.62 + (i / 5) * pane.h * 0.38;
    ctx.beginPath();
    ctx.moveTo(pane.x, gy);
    ctx.lineTo(pane.x + pane.w, gy);
    ctx.stroke();
  }
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  pane: Pane,
  color: string,
  flagged: ReadonlySet<number>,
  severe: boolean,
  dashed = false,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = BONE_W + (dashed ? 0 : 0.6);
  if (dashed) ctx.setLineDash([5, 4]);
  for (const [a, b] of BONES) {
    const bad = !dashed && (flagged.has(a) || flagged.has(b));
    ctx.strokeStyle = bad ? (severe ? RED : AMBER) : color;
    const pa = project(frame, a, pane);
    const pb = project(frame, b, pane);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const joints = new Set<number>();
  for (const [a, b] of BONES) {
    joints.add(a);
    joints.add(b);
  }
  for (const j of joints) {
    const pt = project(frame, j, pane);
    const bad = !dashed && flagged.has(j);
    ctx.fillStyle = bad ? (severe ? RED : AMBER) : dashed ? color : "#e7efe2";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, bad ? 4.4 : dashed ? 2.4 : 3.1, 0, Math.PI * 2);
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
}

/** Anchor the reference ghost onto the user's body (pelvis + torso scale). */
function ghostTransform(userF: PoseFrame, refF: PoseFrame, pane: Pane) {
  const mid = (f: PoseFrame, a: number, b: number): Pt => {
    const la = f[a];
    const lb = f[b];
    if (!la || !lb) return { x: 0.5, y: 0.5 };
    return { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 };
  };
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) || 1e-6;
  const uPelvis = mid(userF, LM.LEFT_HIP, LM.RIGHT_HIP);
  const uSho = mid(userF, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER);
  const rPelvis = mid(refF, LM.LEFT_HIP, LM.RIGHT_HIP);
  const rSho = mid(refF, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER);
  const s = dist(uPelvis, uSho) / dist(rPelvis, rSho);
  // remap the reference frame into a shifted/scaled virtual pane so the
  // regular skeleton drawing path can be reused untouched
  return (lm: { x: number; y: number }): Pt => ({
    x: pane.x + (uPelvis.x + (lm.x - rPelvis.x) * s) * pane.w,
    y: pane.y + (uPelvis.y + (lm.y - rPelvis.y) * s) * pane.h,
  });
}

export function SwingCanvas(props: SwingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const lastTickRef = useRef<number>(0);
  const frameFloatRef = useRef<number>(props.frame);

  if (!props.playing) frameFloatRef.current = props.frame;

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const p = propsRef.current;
    const { user, reference, analysis } = p;
    const T = user.frames.length;
    const fi = Math.max(0, Math.min(T - 1, Math.round(frameFloatRef.current)));
    const userF = user.frames[fi];
    if (!userF) return;

    const dual = p.mode === "dual" && reference !== null;
    const multi = p.multiView && p.dtl !== null;
    const split = dual || multi;
    const userPane: Pane = split
      ? { x: 0, y: 0, w: w / 2 - 1, h }
      : { x: 0, y: 0, w, h };

    drawBackdrop(ctx, userPane, p.video, 0);

    // deviation lookup (dual only — solo has no reference to deviate from)
    let flagged: ReadonlySet<number> = new Set();
    let severe = false;
    if (analysis && analysis.deviations.length > 0) {
      const dev = analysis.deviations.find((d) => d.userFrame === fi);
      if (dev) {
        flagged = new Set(dev.flaggedJoints);
        severe =
          Math.abs(dev.spineAngleDelta) > 12 ||
          dev.leadArmDelta < -30 ||
          Math.abs(dev.hipSwayDelta) > 0.085;
      }
    }

    // lead-wrist swing-plane trail
    const WRIST = user.leadSide === "left" ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    ctx.save();
    ctx.lineWidth = 2;
    const trailStart = Math.max(0, fi - 26);
    for (let t = trailStart + 1; t <= fi; t++) {
      const a = user.frames[t - 1];
      const b = user.frames[t];
      if (!a || !b) continue;
      const pa = project(a, WRIST, userPane);
      const pb = project(b, WRIST, userPane);
      const alpha = ((t - trailStart) / (fi - trailStart || 1)) * 0.85;
      ctx.strokeStyle = `rgba(163,194,147,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.restore();

    // ghost overlay on the user pane (dual mode option)
    let refFi = 0;
    if (dual && reference) {
      refFi = mappedReferenceFrame(analysis, fi, p.frameOffset, reference.frames.length);
      const refF = reference.frames[refFi];
      if (p.ghostOn && refF) {
        const xf = ghostTransform(userF, refF, userPane);
        ctx.save();
        ctx.globalAlpha = p.ghostOpacity;
        ctx.strokeStyle = "#f5f5f7";
        ctx.lineWidth = BONE_W;
        ctx.setLineDash([5, 4]);
        for (const [a, b] of BONES) {
          const la = refF[a];
          const lb = refF[b];
          if (!la || !lb) continue;
          const pa = xf(la);
          const pb = xf(lb);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    drawSkeleton(ctx, userF, userPane, ACCENT, flagged, severe);

    // reference pane (right half)
    if (dual && reference) {
      const refPane: Pane = { x: w / 2 + 1, y: 0, w: w / 2 - 1, h };
      drawBackdrop(ctx, refPane, p.referenceVideo, 13);
      const refF = reference.frames[refFi];
      if (refF) drawSkeleton(ctx, refF, refPane, REF_COLOR, new Set(), false);
      // divider + pane labels
      ctx.fillStyle = "rgba(245,245,247,0.14)";
      ctx.fillRect(w / 2 - 1, 0, 2, h);
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(163,194,147,0.85)";
      ctx.fillText("YOU", 12, h - 12);
      ctx.fillStyle = "rgba(0,229,255,0.85)";
      ctx.fillText(`REF · F${String(refFi).padStart(3, "0")}`, w / 2 + 13, h - 12);
    }

    // down-the-line pane (multi-angle mode)
    if (multi && p.dtl) {
      const dtlPane: Pane = { x: w / 2 + 1, y: 0, w: w / 2 - 1, h };
      drawBackdrop(ctx, dtlPane, p.dtlVideo, 29);
      const Tdtl = p.dtl.frames.length;
      const dtlFi = Math.max(0, Math.min(Tdtl - 1,
        Math.round((fi / Math.max(T - 1, 1)) * (Tdtl - 1)) + p.frameOffset));
      const dtlF = p.dtl.frames[dtlFi];
      if (dtlF) drawSkeleton(ctx, dtlF, dtlPane, "#FFB800", new Set(), false);
      ctx.fillStyle = "rgba(245,245,247,0.14)";
      ctx.fillRect(w / 2 - 1, 0, 2, h);
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(163,194,147,0.85)";
      ctx.fillText("FACE-ON", 12, h - 12);
      ctx.fillStyle = "rgba(255,184,0,0.85)";
      ctx.fillText(`DTL · F${String(dtlFi).padStart(3, "0")}`, w / 2 + 13, h - 12);
    }

    // phase watermark
    if (analysis) {
      const entries = Object.entries(analysis.phases.user).sort((a, b) => a[1] - b[1]);
      let current = entries[0]?.[0] ?? "setup";
      for (const [name, at] of entries) if (fi >= at) current = name;
      ctx.save();
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(245,245,247,0.55)";
      ctx.fillText(current.replace(/_/g, " ").toUpperCase(), 14, 20);
      ctx.restore();
    }
  }, []);

  // unified rAF loop: playback advance + redraw
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
        frameFloatRef.current += dt * p.user.fps * p.speed;
        const T = p.user.frames.length;
        if (frameFloatRef.current >= T - 1) frameFloatRef.current = 0;
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

  // keyboard: ← / → frame-step, Space play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = propsRef.current;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
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

  // touch-swipe frame stepping (disabled while telestrating)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let startX: number | null = null;
    let startFrame = 0;

    const down = (e: PointerEvent) => {
      const p = propsRef.current;
      if (!p.interactive) return;
      startX = e.clientX;
      startFrame = p.frame;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const p = propsRef.current;
      if (startX === null || !p.interactive) return;
      const T = p.user.frames.length;
      const delta = Math.round((e.clientX - startX) / SWIPE_PX_PER_FRAME);
      if (delta !== 0) {
        const next = Math.max(0, Math.min(T - 1, startFrame + delta));
        if (next !== p.frame) {
          frameFloatRef.current = next;
          p.onFrameChange(next);
        }
      }
    };
    const up = () => {
      startX = null;
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
  }, []);

  return <canvas ref={canvasRef} aria-label="swing player canvas" style={{ touchAction: "none" }} />;
}
