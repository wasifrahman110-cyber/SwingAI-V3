/**
 * SwingAI V5 — optimistic Swing Index recalibration (/src/engine/scoring.ts).
 *
 * The score starts from a 100-point baseline and applies LOGARITHMIC
 * soft-margin deductions:
 *
 *   score100 = 100 − Σ faultDeduction(f) − microDeduction
 *
 *   faultDeduction = sevWeight · (0.5 + 0.5 · min(excess, 1))
 *     where excess = (measured − target) / max(target, 1) — a fault barely
 *     over its threshold costs half the severity weight; a blowout costs the
 *     full weight. Diminishing (log-like) rather than linear punishment.
 *
 *   microDeduction ∈ [1, 4] = log-scaled penalty for micro-deviations that
 *     never rise to a fault (RMS spine-posture wobble). This is why a tour
 *     benchmark swing with ZERO faults lands in the elite 96–99 band
 *     (9.6–9.9 / 10) instead of an implausible perfect 100.
 */

import type { Fault } from "../types/pose.ts";

export interface ScoreBreakdown {
  readonly score100: number;
  readonly score10: number;
  readonly microDeduction: number;
  readonly faultDeductions: ReadonlyArray<{ code: string; points: number }>;
}

const SEV_WEIGHT: Record<string, number> = {
  critical: 9,
  major: 6,
  minor: 3,
};

/** Deduction for one fault: severity weight scaled by soft-margin excess. */
export function faultDeduction(f: Fault): number {
  const weight = SEV_WEIGHT[f.severity] ?? 5;
  if (f.unit === "order" || f.target <= 0) return weight * 0.75; // binary faults
  const excess = Math.max(0, (f.measured - f.target) / Math.max(f.target, 1));
  return weight * (0.5 + 0.5 * Math.min(excess, 1));
}

/**
 * Micro-deviation deduction from the spine-retention series (degrees).
 * Log-scaled: rms 0.4° → ~1.4 pts, rms 3° → ~2.9 pts, capped at 4.
 */
export function microDeduction(spineDeltaDeg: readonly number[]): number {
  if (spineDeltaDeg.length === 0) return 1;
  const rms = Math.sqrt(
    spineDeltaDeg.reduce((s, v) => s + v * v, 0) / spineDeltaDeg.length,
  );
  const pts = 1 + (3 * Math.log1p(rms)) / Math.log1p(10);
  return Math.min(4, Math.max(1, pts));
}

export function computeScore(
  faults: readonly Fault[],
  spineDeltaDeg: readonly number[],
): ScoreBreakdown {
  const faultDeductions = faults.map((f) => ({
    code: f.code,
    points: Math.round(faultDeduction(f) * 10) / 10,
  }));
  const micro = Math.round(microDeduction(spineDeltaDeg) * 10) / 10;
  const total = faultDeductions.reduce((s, d) => s + d.points, 0) + micro;
  const score100 = Math.round(Math.max(0, Math.min(100, 100 - total)) * 10) / 10;
  return {
    score100,
    score10: Math.round(score100) / 10,
    microDeduction: micro,
    faultDeductions,
  };
}

// Center-of-pressure estimate + smash-factor heuristic (V5 metric card)
export interface CopEstimate {
  readonly leadPct: number;
  readonly trailPct: number;
}

/**
 * CoP proxy at impact from the pelvic center's position between the ankles.
 * (True CoP needs force plates; this is the standard video-analysis proxy —
 * tour reference: 75–90% lead-side at impact.)
 */
export function estimateCop(
  hipXAtImpact: number,
  leadAnkleX: number,
  trailAnkleX: number,
): CopEstimate {
  const span = leadAnkleX - trailAnkleX || 1e-9;
  const raw = (hipXAtImpact - trailAnkleX) / span; // 0 = trail ankle, 1 = lead ankle
  // pelvis mid-stance = 50/50; map with a 1.6 gain so ankle-line = ~100%
  const lead = Math.round(Math.min(96, Math.max(4, 50 + (raw - 0.5) * 160)));
  return { leadPct: lead, trailPct: 100 - lead };
}

/**
 * Smash-factor ESTIMATE (no ball tracking in V5 — labeled "est" in the UI).
 * Starts from the tour-average 1.48 and deducts for the impact faults that
 * physically destroy energy transfer: flip (adds loft), casting (spends the
 * lever early), chicken wing (shrinks radius at strike).
 */
export function estimateSmashFactor(faults: readonly Fault[]): number {
  let smash = 1.48;
  for (const f of faults) {
    if (f.code === "flip_scoop") smash -= 0.007 * Math.min(f.measured, 20);
    if (f.code === "casting") smash -= 0.05;
    if (f.code === "chicken_wing") smash -= 0.004 * Math.min(Math.max(f.measured - 52, 0), 25);
    if (f.code === "early_extension") smash -= 0.03;
  }
  return Math.round(Math.max(1.2, Math.min(1.5, smash)) * 100) / 100;
}

export type SmashBand = "elite" | "solid" | "leak";

export function smashBand(smash: number): SmashBand {
  if (smash > 1.45) return "elite";
  if (smash >= 1.35) return "solid";
  return "leak";
}

// Face-on impact metrics (V5 multi-angle suite)
export interface ImpactMetrics {
  /** Forward shaft lean at impact in degrees (+ = toward target); null when
   *  hand landmarks are unresolved. Iron compression target: 5–12°. */
  readonly shaftLeanDeg: number | null;
  /** Pelvic-center lead past mid-stance at impact, inches (+ = toward target). */
  readonly hipLeadIn: number;
  readonly cop: CopEstimate;
}

const PLAYER_HEIGHT_IN = 70;

/**
 * Computed from NORMALIZED frames (+y up, height units).
 * Landmark indices follow the MediaPipe 33-point topology.
 */
export function computeImpactMetrics(
  frames: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>,
  impact: number,
  setup: number,
  leadSide: "left" | "right",
): ImpactMetrics {
  const L = leadSide === "left";
  const sign = L ? 1 : -1;
  const g = (t: number, i: number): readonly [number, number, number] =>
    frames[Math.max(0, Math.min(frames.length - 1, t))]?.[i] ?? [0, 0, 0];

  const WR = L ? 15 : 16;
  const hands = L ? [17, 19, 21] : [18, 20, 22];
  const LH = 23;
  const RH = 24;
  const leadAnkle = L ? 27 : 28;
  const trailAnkle = L ? 28 : 27;

  // shaft lean: hand/club direction vs vertical at impact, signed toward target
  const w = g(impact, WR);
  let hx = 0;
  let hy = 0;
  for (const h of hands) {
    const pt = g(impact, h);
    hx += pt[0] / 3;
    hy += pt[1] / 3;
  }
  const dx = (hx - w[0]) * sign;
  const dy = hy - w[1]; // +y up; club points down toward ball => dy < 0
  const sep = Math.hypot(hx - w[0], hy - w[1]);
  let shaftLeanDeg: number | null = null;
  if (sep > 1.2 / PLAYER_HEIGHT_IN && dy < 0) {
    // lean = deviation of the shaft from vertical, + when hands are ahead
    shaftLeanDeg = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI * 10) / 10;
  }

  const hipX = ((g(impact, LH)[0] + g(impact, RH)[0]) / 2) * sign;
  const setupHipX = ((g(setup, LH)[0] + g(setup, RH)[0]) / 2) * sign;
  const hipLeadIn = Math.round((hipX - setupHipX) * PLAYER_HEIGHT_IN * 10) / 10;

  const cop = estimateCop(hipX, g(setup, leadAnkle)[0] * sign, g(setup, trailAnkle)[0] * sign);
  return { shaftLeanDeg, hipLeadIn, cop };
}
