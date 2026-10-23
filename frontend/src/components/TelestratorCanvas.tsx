/**
 * TelestratorCanvas — professional annotation overlay for the swing player.
 *
 * Tools:
 *   pen    — freehand, rendered as a Catmull-Rom spline through the sampled
 *            pointer points (smooth curves, no polyline jaggies)
 *   line   — straight line with two draggable endpoint handles (swing plane,
 *            shaft plane, spine vector)
 *   circle — head circle with a draggable center handle and a draggable edge
 *            handle for radius
 *
 * Every annotation stores normalized (0..1) coordinates so it survives
 * resizes, and either locks to the video frame it was drawn on or persists
 * globally ("Lock to Frame" vs "Global Overlay" toggle).
 */

import { useEffect, useRef } from "react";
import type { Annotation, AnnoPoint, TelestratorTool } from "../types/pose.ts";

const HANDLE_R = 7;
const HIT_R = 16;

export interface TelestratorProps {
  active: boolean;
  tool: TelestratorTool;
  color: string;
  lockToFrame: boolean;
  frame: number;
  annotations: readonly Annotation[];
  onAdd: (a: Annotation) => void;
  onReplace: (a: Annotation) => void;
}

const uid = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Catmull-Rom spline through the points, drawn as cubic Bézier segments. */
function strokeCatmullRom(
  ctx: CanvasRenderingContext2D,
  pts: readonly AnnoPoint[],
  w: number,
  h: number,
): void {
  if (pts.length < 2) return;
  const P = (i: number): AnnoPoint =>
    pts[Math.max(0, Math.min(pts.length - 1, i))] as AnnoPoint;
  ctx.beginPath();
  ctx.moveTo(P(0).x * w, P(0).y * h);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    // standard Catmull-Rom -> Bézier control-point conversion (tau = 1/6)
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(c1x * w, c1y * h, c2x * w, c2y * h, p2.x * w, p2.y * h);
  }
  ctx.stroke();
}

export function TelestratorCanvas(props: TelestratorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const draftRef = useRef<Annotation | null>(null);
  const dragRef = useRef<{ id: string; part: "a" | "b" | "c" | "r" } | null>(null);

  // ---- render loop ------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    // Persistence contract (V4.1): the canvas buffer is cleared and FULLY
    // REDRAWN from the annotations state on every animation frame — video
    // playback, scrubbing, and pointer events can never erase a stored
    // drawing. Only the user's explicit Clear button empties the state.
    // Global annotations (frame === null) render on every frame; frame-locked
    // ones render within a ±1-frame tolerance so scrub jitter can't hide them.
    const visible = (a: Annotation): boolean => {
      const p = propsRef.current;
      return a.frame === null || Math.abs(a.frame - p.frame) <= 1;
    };

    const drawAnnotation = (a: Annotation, w: number, h: number, isDraft: boolean) => {
      const p = propsRef.current;
      ctx.save();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (isDraft) ctx.globalAlpha = 0.9;
      if (a.tool === "pen") {
        strokeCatmullRom(ctx, a.points, w, h);
      } else if (a.tool === "line") {
        ctx.beginPath();
        ctx.moveTo(a.a.x * w, a.a.y * h);
        ctx.lineTo(a.b.x * w, a.b.y * h);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(a.c.x * w, a.c.y * h, a.r * w, 0, Math.PI * 2);
        ctx.stroke();
      }
      // endpoint handles for the active editable shape
      if (p.active && !isDraft && (a.tool === "line" || a.tool === "circle") && p.tool === a.tool) {
        const handles: AnnoPoint[] =
          a.tool === "line"
            ? [a.a, a.b]
            : [a.c, { x: a.c.x + a.r, y: a.c.y }];
        ctx.fillStyle = "#0d0d0e";
        for (const hd of handles) {
          ctx.beginPath();
          ctx.arc(hd.x * w, hd.y * h, HANDLE_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const loop = () => {
      const p = propsRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 400;
      const h = canvas.clientHeight || 300;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const a of p.annotations) if (visible(a)) drawAnnotation(a, w, h, false);
      if (draftRef.current) drawAnnotation(draftRef.current, w, h, true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- pointer interaction ---------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const norm = (e: PointerEvent): AnnoPoint => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
      };
    };

    const hitHandle = (pt: AnnoPoint): { id: string; part: "a" | "b" | "c" | "r" } | null => {
      const p = propsRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (d: number) => d * rect.width;
      for (const a of p.annotations) {
        if (a.frame !== null && a.frame !== p.frame) continue;
        if (a.tool !== p.tool) continue;
        if (a.tool === "line") {
          if (Math.hypot(px(pt.x - a.a.x), px(pt.y - a.a.y)) < HIT_R) return { id: a.id, part: "a" };
          if (Math.hypot(px(pt.x - a.b.x), px(pt.y - a.b.y)) < HIT_R) return { id: a.id, part: "b" };
        } else if (a.tool === "circle") {
          const edge: AnnoPoint = { x: a.c.x + a.r, y: a.c.y };
          if (Math.hypot(px(pt.x - edge.x), px(pt.y - edge.y)) < HIT_R) return { id: a.id, part: "r" };
          if (Math.hypot(px(pt.x - a.c.x), px(pt.y - a.c.y)) < HIT_R) return { id: a.id, part: "c" };
        }
      }
      return null;
    };

    const down = (e: PointerEvent) => {
      const p = propsRef.current;
      if (!p.active || p.tool === "off") return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const pt = norm(e);
      const frame = p.lockToFrame ? p.frame : null;

      const grabbed = hitHandle(pt);
      if (grabbed) {
        dragRef.current = grabbed;
        return;
      }

      if (p.tool === "pen") {
        draftRef.current = { id: uid(), tool: "pen", color: p.color, frame, points: [pt] };
      } else if (p.tool === "line") {
        draftRef.current = { id: uid(), tool: "line", color: p.color, frame, a: pt, b: pt };
      } else {
        draftRef.current = { id: uid(), tool: "circle", color: p.color, frame, c: pt, r: 0.02 };
      }
    };

    const move = (e: PointerEvent) => {
      const p = propsRef.current;
      if (!p.active) return;
      const pt = norm(e);

      const drag = dragRef.current;
      if (drag) {
        const target = p.annotations.find((a) => a.id === drag.id);
        if (!target) return;
        if (target.tool === "line") {
          p.onReplace({ ...target, [drag.part === "a" ? "a" : "b"]: pt });
        } else if (target.tool === "circle") {
          if (drag.part === "c") p.onReplace({ ...target, c: pt });
          else p.onReplace({ ...target, r: Math.max(0.01, Math.abs(pt.x - target.c.x)) });
        }
        return;
      }

      const draft = draftRef.current;
      if (!draft) return;
      if (draft.tool === "pen") {
        const last = draft.points[draft.points.length - 1];
        if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.004) {
          draftRef.current = { ...draft, points: [...draft.points, pt] };
        }
      } else if (draft.tool === "line") {
        draftRef.current = { ...draft, b: pt };
      } else {
        draftRef.current = {
          ...draft,
          r: Math.max(0.01, Math.hypot(pt.x - draft.c.x, pt.y - draft.c.y)),
        };
      }
    };

    const up = () => {
      const p = propsRef.current;
      dragRef.current = null;
      const draft = draftRef.current;
      draftRef.current = null;
      if (!draft) return;
      if (draft.tool === "pen" && draft.points.length < 2) return;
      p.onAdd(draft);
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

  return (
    <canvas
      ref={canvasRef}
      className="telestrator-canvas"
      style={{ pointerEvents: props.active && props.tool !== "off" ? "auto" : "none" }}
      aria-label="annotation overlay"
    />
  );
}
