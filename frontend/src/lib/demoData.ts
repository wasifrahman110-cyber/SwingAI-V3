/**
 * SwingAI — deterministic synthetic swing generator (demo fallback).
 *
 * Produces raw MediaPipe-style screen coordinates (+y down, unit box) for a
 * parametric golf swing, with injectable faults so the full analysis pipeline
 * lights up without any uploaded footage.
 */

import type { Landmark, PoseFrame, SwingSequence } from "../types/pose.ts";
import { LM } from "../types/pose.ts";

/** Deterministic PRNG (mulberry32) — reproducible demo data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (rng: () => number) => {
  // Box–Muller
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export interface SynthOptions {
  frames?: number;
  tempo?: number;
  earlyExtension?: number;
  chickenWing?: number;
  sway?: number;
  seed?: number;
  fps?: number;
}

export function synthSwing(opts: SynthOptions = {}): SwingSequence {
  const {
    frames: T = 90,
    tempo = 1,
    earlyExtension = 0,
    chickenWing = 0,
    sway = 0,
    seed = 7,
    fps = 30,
  } = opts;
  const rng = mulberry32(seed);

  const backswingAmt = (si: number): number => {
    if (si < 0.55) return Math.sin((si / 0.55) * (Math.PI / 2));
    if (si < 0.8) return Math.cos(((si - 0.55) / 0.25) * (Math.PI / 2));
    return -0.6 * Math.sin(((si - 0.8) / 0.2) * (Math.PI / 2));
  };

  const out: PoseFrame[] = [];
  for (let t = 0; t < T; t++) {
    const si = Math.pow(t / (T - 1), tempo);
    const b = backswingAmt(si);
    const down = Math.max(0, (si - 0.55) / 0.45);

    const pts: { x: number; y: number; z: number }[] = Array.from(
      { length: 33 },
      () => ({ x: 0.5, y: 0.5, z: 0 }),
    );
    const set = (i: number, x: number, y: number, z: number) => {
      const p = pts[i];
      if (p) { p.x = x; p.y = y; p.z = z; }
    };

    const hipCx = 0.5 - sway * Math.max(0, b) * 0.5;
    const hipCy = 0.62;
    const hipCz = earlyExtension * down; // toward ball/camera in downswing
    const hipHalf = 0.055;
    const rot = b * 0.35;
    set(LM.LEFT_HIP, hipCx + hipHalf, hipCy, hipCz + rot * hipHalf);
    set(LM.RIGHT_HIP, hipCx - hipHalf, hipCy, hipCz - rot * hipHalf);

    const shoCy = hipCy - 0.19;
    const shoHalf = 0.075;
    const srot = b * 0.7;
    set(LM.LEFT_SHOULDER, hipCx + shoHalf, shoCy, hipCz + srot * shoHalf);
    set(LM.RIGHT_SHOULDER, hipCx - shoHalf, shoCy, hipCz - srot * shoHalf);

    set(LM.NOSE, hipCx, shoCy - 0.085, hipCz);
    set(LM.LEFT_EYE, hipCx + 0.012, shoCy - 0.09, hipCz);
    set(LM.RIGHT_EYE, hipCx - 0.012, shoCy - 0.09, hipCz);
    for (const i of [
      LM.LEFT_EAR, LM.RIGHT_EAR, LM.MOUTH_LEFT, LM.MOUTH_RIGHT,
      LM.LEFT_EYE_INNER, LM.LEFT_EYE_OUTER, LM.RIGHT_EYE_INNER, LM.RIGHT_EYE_OUTER,
    ]) {
      set(i, hipCx + gaussian(rng) * 0.002, shoCy - 0.085 + gaussian(rng) * 0.002, hipCz);
    }

    // Lead (left) arm on an arc; chicken wing bends the elbow post-impact.
    // theta is measured from straight-down: ~0.35 rad at address (arms hang),
    // sweeping to ~2.25 rad at the top of the backswing.
    const armLen = 0.16;
    const theta = 0.35 + b * 1.9;
    const wing = chickenWing * Math.max(0, (si - 0.75) / 0.25);
    const sx = hipCx + shoHalf;
    const sy = shoCy;
    const ex = sx + armLen * Math.sin(theta) * 0.9;
    const ey = sy + armLen * Math.cos(theta);
    set(LM.LEFT_ELBOW, ex, ey, hipCz);
    const wx = ex + armLen * Math.sin(theta - wing * 1.2);
    const wy = ey + armLen * Math.cos(theta - wing * 1.2) - wing * 0.05;
    set(LM.LEFT_WRIST, wx, wy, hipCz);
    set(LM.RIGHT_ELBOW, 2 * hipCx - ex, ey, hipCz);
    set(LM.RIGHT_WRIST, 2 * hipCx - wx, wy, hipCz);
    for (const [hand, wrist] of [
      [LM.LEFT_PINKY, LM.LEFT_WRIST], [LM.LEFT_INDEX, LM.LEFT_WRIST], [LM.LEFT_THUMB, LM.LEFT_WRIST],
      [LM.RIGHT_PINKY, LM.RIGHT_WRIST], [LM.RIGHT_INDEX, LM.RIGHT_WRIST], [LM.RIGHT_THUMB, LM.RIGHT_WRIST],
    ] as const) {
      const w = pts[wrist];
      if (w) set(hand, w.x + 0.01, w.y + 0.01, w.z);
    }

    for (const [hip, knee, ankle, heel, toe, sign] of [
      [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX, 1],
      [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX, -1],
    ] as const) {
      const h = pts[hip];
      if (!h) continue;
      set(knee, h.x, h.y + 0.13, hipCz * 0.5);
      const baseX = 0.5 + sign * hipHalf;
      set(ankle, baseX, h.y + 0.26, 0);
      set(heel, baseX - 0.01, h.y + 0.27, 0);
      set(toe, baseX + 0.02, h.y + 0.27, 0.02);
    }

    const frame: Landmark[] = pts.map((p) => ({
      x: p.x + gaussian(rng) * 0.0015,
      y: p.y + gaussian(rng) * 0.0015,
      z: p.z + gaussian(rng) * 0.0015,
      visibility: 1,
    }));
    out.push(frame);
  }

  return { fps, leadSide: "left", frames: out };
}

/** The bundled demo pair: a clean model swing and a faulty student swing. */
export function demoSwings(): { user: SwingSequence; pro: SwingSequence } {
  return {
    pro: synthSwing({ frames: 75, tempo: 1, seed: 3 }),
    user: synthSwing({
      frames: 95,
      tempo: 1.25,
      earlyExtension: 0.09,
      chickenWing: 0.9,
      sway: 0.16,
      seed: 11,
    }),
  };
}

// ---------------------------------------------------------------------------
// Built-in reference library (synthetic model swings — no licensed footage)
// ---------------------------------------------------------------------------
export interface ReferenceClip {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly make: () => SwingSequence;
}

export const REFERENCE_LIBRARY: readonly ReferenceClip[] = [
  {
    id: "model-driver-balanced",
    name: "Model Driver — Balanced Tempo",
    description: "Neutral 3:1 tempo, textbook sequencing. The default benchmark.",
    make: () => synthSwing({ frames: 75, tempo: 1, seed: 3 }),
  },
  {
    id: "model-driver-fast",
    name: "Model Driver — Fast Tempo",
    description: "Aggressive transition and quicker downswing — for players who load hard.",
    make: () => synthSwing({ frames: 58, tempo: 0.85, seed: 21 }),
  },
  {
    id: "model-iron-smooth",
    name: "Model Mid-Iron — Smooth",
    description: "Longer, smoother move with an early wrist set. Good rhythm reference.",
    make: () => synthSwing({ frames: 88, tempo: 1.12, seed: 33 }),
  },
] as const;

// ---------------------------------------------------------------------------
// Dashboard demo telemetry (Home screen)
// ---------------------------------------------------------------------------
export interface DashboardData {
  readonly swingIndex: number;
  readonly swingIndexDelta: number;
  readonly analyzedCount: number;
  readonly weekLabel: string;
  readonly scoreSeries: readonly number[];
  readonly goal: number;
  readonly dayLabels: readonly string[];
}

export function demoDashboard(): DashboardData {
  return {
    swingIndex: 5.0,
    swingIndexDelta: 0.4,
    analyzedCount: 340,
    weekLabel: "Jul 13 – 19, 2026",
    scoreSeries: [4.1, 4.4, 4.2, 4.7, 4.6, 5.0, 4.9],
    goal: 6.0,
    dayLabels: ["07/13", "07/14", "07/15", "07/16", "07/17", "07/18", "07/19"],
  };
}
