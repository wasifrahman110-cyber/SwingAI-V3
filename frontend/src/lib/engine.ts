/**
 * SwingAI — in-browser analysis engine.
 *
 * A faithful TypeScript mirror of the Python backend (analytics/*.py) so the
 * app is fully functional offline; `api.ts` prefers the FastAPI service and
 * falls back to this module transparently.
 */

import type {
  Alignment,
  AnalysisResult,
  DeviationFrame,
  DrillCard,
  Fault,
  KinematicSegment,
  KinematicSequence,
  Phases,
  PoseFrame,
  SwingSequence,
  WarpStep,
} from "../types/pose.ts";
import { LM } from "../types/pose.ts";
import { detectFaults18 } from "../engine/diagnostics.ts";
import { DRILL_LIBRARY, GENERIC_DRILL } from "../engine/drills.ts";
import { computeScore } from "../engine/scoring.ts";
import {
  angleBetweenDeg,
  argmax,
  clamp,
  gradient,
  jointAngle3dDeg,
  mid,
  movingAverage,
  savgolSmooth,
  savgolSmoothVec3,
  sub,
  unwrap,
  type Vec3,
} from "./vectorMath.ts";


// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------
export interface NormalizedSwing {
  /** frames[t][i] = [x, y, z] with pelvis-anchored origin, +y UP, height units. */
  readonly frames: ReadonlyArray<ReadonlyArray<Vec3>>;
  readonly scale: number;
}

const p3 = (f: PoseFrame, i: number): Vec3 => {
  const lm = f[i];
  if (!lm) throw new Error(`missing landmark ${i}`);
  return [lm.x, lm.y, lm.z];
};

/**
 * Scale by estimated player height, anchor to the setup-frame pelvis center,
 * flip y so +y = up. Per-frame pelvis is deliberately NOT subtracted — that
 * would erase sway / early-extension, the very signals we measure.
 */
export function normalizeSwing(seq: SwingSequence, setupFrames = 5): NormalizedSwing {
  const T = seq.frames.length;
  if (T < 10) throw new Error("a swing needs at least 10 frames");

  const heights: number[] = [];
  for (const f of seq.frames) {
    const midAnkle = mid(p3(f, LM.LEFT_ANKLE), p3(f, LM.RIGHT_ANKLE));
    const midHip = mid(p3(f, LM.LEFT_HIP), p3(f, LM.RIGHT_HIP));
    const midSho = mid(p3(f, LM.LEFT_SHOULDER), p3(f, LM.RIGHT_SHOULDER));
    const head = p3(f, LM.NOSE);
    const len = (a: Vec3, b: Vec3) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    heights.push(len(midAnkle, midHip) + len(midHip, midSho) + len(midSho, head));
  }
  const sorted = [...heights].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  const scale = Math.max(median, 1e-9);

  let ax = 0, ay = 0, az = 0;
  const nAnchor = Math.min(setupFrames, T);
  for (let t = 0; t < nAnchor; t++) {
    const f = seq.frames[t] as PoseFrame;
    const c = mid(p3(f, LM.LEFT_HIP), p3(f, LM.RIGHT_HIP));
    ax += c[0]; ay += c[1]; az += c[2];
  }
  ax /= nAnchor; ay /= nAnchor; az /= nAnchor;

  const frames = seq.frames.map((f) =>
    f.map((lm): Vec3 => [
      (lm.x - ax) / scale,
      -((lm.y - ay) / scale), // +y is now up
      (lm.z - az) / scale,
    ]),
  );
  return { frames, scale };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export interface SwingMetrics {
  readonly spineAngleDeg: readonly number[];
  /** |theta_t − theta_setup|: posture CHANGE from address, in degrees. */
  readonly spineDeltaDeg: readonly number[];
  readonly leadArmAngleDeg: readonly number[];
  readonly hipSway: readonly number[];
  readonly hipThrust: readonly number[];
  readonly hipRotationDeg: readonly number[];
  readonly shoulderRotationDeg: readonly number[];
  readonly wristSpeed: readonly number[];
  /** |deg/frame| angular-velocity series per body segment. */
  readonly kinematicVelocity: Record<KinematicSegment, readonly number[]>;
}

const speedOf = (positions: readonly Vec3[]): number[] => {
  const gx = gradient(positions.map((p) => p[0]));
  const gy = gradient(positions.map((p) => p[1]));
  const gz = gradient(positions.map((p) => p[2]));
  return gx.map((_, i) =>
    Math.hypot(gx[i] as number, gy[i] as number, gz[i] as number),
  );
};

const planeRotationDeg = (lines: readonly Vec3[]): number[] => {
  const raw = unwrap(lines.map((v) => Math.atan2(v[2], v[0])));
  const first = raw[0] ?? 0;
  return raw.map((r) => ((r - first) * 180) / Math.PI);
};

/**
 * Angular speed (|deg/frame|) of a rotating body line.
 * plane "xz": horizontal plane — pelvis/thorax ROTATION.
 * plane "xy": swing (vertical) plane — the arm/club assembly, which swings
 * up-and-down far more than it rotates about the vertical axis. Projecting
 * arms onto the horizontal plane yields noise-dominated phantom peaks.
 */
const angularSpeed = (lines: readonly Vec3[], plane: "xz" | "xy"): number[] => {
  const ang = unwrap(
    lines.map((v) => Math.atan2(plane === "xz" ? v[2] : v[1], v[0])),
  ).map((r) => (r * 180) / Math.PI);
  return gradient(ang).map(Math.abs);
};

export function computeMetrics(
  norm: NormalizedSwing,
  leadSide: "left" | "right" = "left",
): SwingMetrics {
  const F = norm.frames;
  const T = F.length;
  const L = leadSide === "left";
  const SH = L ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
  const EL = L ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW;
  const WR = L ? LM.LEFT_WRIST : LM.RIGHT_WRIST;

  const at = (t: number, i: number): Vec3 => (F[t] as readonly Vec3[])[i] as Vec3;
  const midHip = Array.from({ length: T }, (_, t) =>
    mid(at(t, LM.LEFT_HIP), at(t, LM.RIGHT_HIP)),
  );
  const midSho = Array.from({ length: T }, (_, t) =>
    mid(at(t, LM.LEFT_SHOULDER), at(t, LM.RIGHT_SHOULDER)),
  );

  const up: Vec3 = [0, 1, 0];
  const spine = midHip.map((h, t) => {
    const a = angleBetweenDeg(sub(midSho[t] as Vec3, h), up);
    return 90 - Math.min(a, 90); // 90 = vertical trunk, 0 = horizontal
  });

  const leadArm = Array.from({ length: T }, (_, t) =>
    jointAngle3dDeg(at(t, SH), at(t, EL), at(t, WR)),
  );

  const hip0 = midHip[0] as Vec3;
  const hipSway = midHip.map((h) => h[0] - hip0[0]);
  const hipThrust = midHip.map((h) => h[2] - hip0[2]);

  const hipLine = Array.from({ length: T }, (_, t) =>
    sub(at(t, LM.LEFT_HIP), at(t, LM.RIGHT_HIP)),
  );
  const shoLine = Array.from({ length: T }, (_, t) =>
    sub(at(t, LM.LEFT_SHOULDER), at(t, LM.RIGHT_SHOULDER)),
  );
  const armLine = Array.from({ length: T }, (_, t) => sub(at(t, EL), at(t, SH)));
  const handLine = Array.from({ length: T }, (_, t) => sub(at(t, WR), at(t, EL)));

  const wristPos = Array.from({ length: T }, (_, t) => at(t, WR));

  // SavGol runs twice: on the raw line vectors (kills positional jitter
  // before the angle derivative) and on the resulting velocity series (kills
  // residual angle noise on short segments) — true peaks stay sharp while
  // peak ORDER becomes robust to MediaPipe sensor noise.
  const kinematicVelocity: Record<KinematicSegment, readonly number[]> = {
    hips: savgolSmooth(angularSpeed(savgolSmoothVec3(hipLine), "xz"), 7),
    torso: savgolSmooth(angularSpeed(savgolSmoothVec3(shoLine), "xz"), 7),
    arms: savgolSmooth(angularSpeed(savgolSmoothVec3(armLine), "xy"), 7),
    hands: savgolSmooth(angularSpeed(savgolSmoothVec3(handLine), "xy"), 7),
  };

  // Spine-angle RETENTION: theta_0 is the median over the address frames;
  // the series is |theta_t − theta_0| — posture change, not raw global angle.
  // A tour pro bent 30° over the ball scores ~0 for the entire swing.
  const spineSmoothed = savgolSmooth(spine, 5);
  const addressWindow = spineSmoothed.slice(0, Math.max(3, Math.floor(T / 15)));
  const sortedAddr = [...addressWindow].sort((a, b) => a - b);
  const theta0 = sortedAddr[Math.floor(sortedAddr.length / 2)] ?? 0;
  const spineDelta = spineSmoothed.map((v) => Math.abs(v - theta0));

  return {
    spineAngleDeg: spineSmoothed,
    spineDeltaDeg: spineDelta,
    leadArmAngleDeg: savgolSmooth(leadArm, 5),
    hipSway: savgolSmooth(hipSway, 5),
    hipThrust: savgolSmooth(hipThrust, 5),
    hipRotationDeg: savgolSmooth(planeRotationDeg(hipLine), 5),
    shoulderRotationDeg: savgolSmooth(planeRotationDeg(shoLine), 5),
    wristSpeed: savgolSmooth(speedOf(wristPos), 5),
    kinematicVelocity,
  };
}

/** (T, F) z-scored feature matrix for the DTW cost space. */
export function featureMatrix(m: SwingMetrics): number[][] {
  const cols = [
    m.spineAngleDeg,
    m.leadArmAngleDeg,
    m.hipRotationDeg,
    m.shoulderRotationDeg,
    m.hipSway,
    m.wristSpeed,
  ];
  const T = m.spineAngleDeg.length;
  const z = cols.map((col) => {
    const mu = col.reduce((s, v) => s + v, 0) / T;
    const sd =
      Math.sqrt(col.reduce((s, v) => s + (v - mu) ** 2, 0) / T) || 1;
    return col.map((v) => (v - mu) / sd);
  });
  return Array.from({ length: T }, (_, t) => z.map((c) => c[t] as number));
}

// ---------------------------------------------------------------------------
// DTW  —  D[i,j] = d(i,j) + min(D[i-1,j], D[i,j-1], D[i-1,j-1])
// ---------------------------------------------------------------------------
export function dtwAlign(
  userFeat: readonly (readonly number[])[],
  proFeat: readonly (readonly number[])[],
  band?: number,
): Alignment {
  const n = userFeat.length;
  const m = proFeat.length;
  if (n === 0 || m === 0) throw new Error("empty sequence passed to dtwAlign");
  const dim = (userFeat[0] as readonly number[]).length;

  const effBand =
    band === undefined ? Number.POSITIVE_INFINITY : Math.max(band, Math.abs(n - m) + 1);

  const INF = Number.POSITIVE_INFINITY;
  const D: Float64Array[] = Array.from(
    { length: n + 1 },
    () => new Float64Array(m + 1).fill(INF),
  );
  (D[0] as Float64Array)[0] = 0;

  const local = (i: number, j: number): number => {
    const a = userFeat[i] as readonly number[];
    const b = proFeat[j] as readonly number[];
    let s = 0;
    for (let k = 0; k < dim; k++) {
      const d = (a[k] as number) - (b[k] as number);
      s += d * d;
    }
    return Math.sqrt(s);
  };

  for (let i = 1; i <= n; i++) {
    const jCenter = Math.round(((i - 1) * (m - 1)) / Math.max(n - 1, 1));
    const lo = Number.isFinite(effBand) ? Math.max(1, jCenter - effBand + 1) : 1;
    const hi = Number.isFinite(effBand) ? Math.min(m, jCenter + effBand + 1) : m;
    const Di = D[i] as Float64Array;
    const Dp = D[i - 1] as Float64Array;
    for (let j = lo; j <= hi; j++) {
      const best = Math.min(Dp[j] as number, Di[j - 1] as number, Dp[j - 1] as number);
      if (best === INF) continue;
      Di[j] = local(i - 1, j - 1) + best;
    }
  }

  if (!Number.isFinite((D[n] as Float64Array)[m] as number)) {
    throw new Error("DTW band too narrow: no admissible path");
  }

  const path: WarpStep[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = (D[i - 1] as Float64Array)[j - 1] as number;
    const upC = (D[i - 1] as Float64Array)[j] as number;
    const leftC = (D[i] as Float64Array)[j - 1] as number;
    if (diag <= upC && diag <= leftC) {
      i -= 1; j -= 1;
    } else if (upC <= leftC) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  path.reverse();

  const userToPro = new Array<number>(n).fill(0);
  const proToUser = new Array<number>(m).fill(0);
  for (const [ui, pj] of path) {
    userToPro[ui] = pj;
    proToUser[pj] = ui;
  }

  const cost = (D[n] as Float64Array)[m] as number;
  return {
    path,
    cost,
    normalizedCost: cost / path.length,
    userToPro,
    proToUser,
  };
}

// ---------------------------------------------------------------------------
// Phase segmentation (lead-wrist trajectory heuristics)
// ---------------------------------------------------------------------------
export function segmentPhases(
  norm: NormalizedSwing,
  leadSide: "left" | "right" = "left",
): Phases {
  const WR = leadSide === "left" ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
  const F = norm.frames;
  const T = F.length;
  if (T < 10) throw new Error("need at least 10 frames to segment a swing");

  const wrist = F.map((f) => f[WR] as Vec3);
  const height = movingAverage(wrist.map((w) => w[1]), 5);
  const speed = movingAverage(speedOf(wrist), 5);

  const peakSpeedFrame = argmax(speed);
  const peakSpeed = speed[peakSpeedFrame] as number;

  const searchEnd = Math.max(peakSpeedFrame, 2);
  let top = 0;
  for (let t = 1; t < searchEnd; t++) {
    if ((height[t] as number) > (height[top] as number)) top = t;
  }

  const addressWin = Math.max(2, Math.floor(T / 10));
  const addressHeights = height.slice(0, addressWin).sort((a, b) => a - b);
  const addressHeight = addressHeights[Math.floor(addressHeights.length / 2)] ?? 0;

  const lo = top + 1;
  const hi = Math.min(T, peakSpeedFrame + Math.max(3, Math.floor(T / 8)) + 1);
  let impact = peakSpeedFrame;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let t = lo; t < hi; t++) {
    if ((speed[t] as number) >= 0.6 * peakSpeed) {
      const score = Math.abs((height[t] as number) - addressHeight);
      if (score < bestScore) {
        bestScore = score;
        impact = t;
      }
    }
  }
  impact = clamp(impact, top + 1, T - 2);

  let setup = 0;
  for (let t = 0; t < top; t++) {
    if ((speed[t] as number) > 0.15 * peakSpeed) break;
    setup = t;
  }
  setup = Math.min(setup, Math.max(top - 1, 0));

  let follow = T - 1;
  for (let t = impact + 1; t < T; t++) {
    if ((speed[t] as number) < 0.3 * peakSpeed) {
      follow = t;
      break;
    }
  }

  return {
    setup,
    top_of_backswing: top,
    downswing: Math.floor((top + impact) / 2),
    impact,
    follow_through: follow,
  };
}

// ---------------------------------------------------------------------------
// Deviations + fault detection + drills
// ---------------------------------------------------------------------------
export const SPINE_ANGLE_THRESHOLD_DEG = 8;
export const LEAD_ARM_THRESHOLD_DEG = 20;
export const HIP_SWAY_THRESHOLD = 0.055;

export function deviationMatrix(
  user: SwingMetrics,
  pro: SwingMetrics,
  path: readonly WarpStep[],
  leadSide: "left" | "right" = "left",
): DeviationFrame[] {
  const L = leadSide === "left";
  const EL = L ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW;
  const WR = L ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
  return path.map(([ui, pi]) => {
    const u = clamp(ui, 0, user.spineAngleDeg.length - 1);
    const p = clamp(pi, 0, pro.spineAngleDeg.length - 1);
    // Compare posture RETENTION (change-from-address), not raw global angles —
    // different address postures are not a deviation.
    const spineD = (user.spineDeltaDeg[u] as number) - (pro.spineDeltaDeg[p] as number);
    const armD = (user.leadArmAngleDeg[u] as number) - (pro.leadArmAngleDeg[p] as number);
    const swayD = (user.hipSway[u] as number) - (pro.hipSway[p] as number);
    const thrustD = (user.hipThrust[u] as number) - (pro.hipThrust[p] as number);
    const rotD = (user.hipRotationDeg[u] as number) - (pro.hipRotationDeg[p] as number);
    const flagged = new Set<number>();
    if (Math.abs(spineD) > SPINE_ANGLE_THRESHOLD_DEG) {
      [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER].forEach((x) =>
        flagged.add(x),
      );
    }
    if (armD < -LEAD_ARM_THRESHOLD_DEG) {
      flagged.add(EL);
      flagged.add(WR);
    }
    if (Math.abs(swayD) > HIP_SWAY_THRESHOLD) {
      flagged.add(LM.LEFT_HIP);
      flagged.add(LM.RIGHT_HIP);
    }
    return {
      userFrame: u,
      proFrame: p,
      spineAngleDelta: spineD,
      leadArmDelta: armD,
      hipSwayDelta: swayD,
      hipThrustDelta: thrustD,
      hipRotationDelta: rotD,
      flaggedJoints: [...flagged].sort((a, b) => a - b),
    };
  });
}


export function kinematicSequenceReport(
  m: SwingMetrics,
  downswingStart: number,
  impact: number,
): KinematicSequence {
  const order = ["hips", "torso", "arms", "hands"] as const;
  const T = m.spineAngleDeg.length;
  const lo = clamp(downswingStart, 0, T - 2);
  const hi = clamp(impact + Math.max(2, Math.floor(T / 20)), lo + 2, T);
  const tol = Math.max(2, Math.floor(T / 30));

  const peakFrames: Record<string, number> = {};
  for (const k of order) {
    const vel = m.kinematicVelocity[k];
    const window = vel.slice(lo, hi);
    const vmax = Math.max(...window);
    if (!(vmax > 1e-9)) {
      peakFrames[k] = lo;
      continue;
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < window.length; i++) {
      const v = window[i] as number;
      if (v >= 0.7 * vmax) {
        num += i * v;
        den += v;
      }
    }
    peakFrames[k] = lo + Math.round(num / den);
  }

  const frames = order.map((k) => peakFrames[k] as number);
  const correct = frames.every(
    (f, i) => i === 0 || f >= (frames[i - 1] as number) - tol,
  );
  return {
    order,
    peakFrames,
    sequenceCorrect: correct,
    window: { start: lo, end: hi - 1 },
    toleranceFrames: tol,
  };
}

// ---------------------------------------------------------------------------
// Drill recommendation mapping (V4) — structured drill objects from
// src/engine/drills.ts, with the markdown card built from the same data.
// ---------------------------------------------------------------------------
export function recommendDrills(faults: readonly Fault[]): DrillCard[] {
  return faults.map((f) => {
    const spec = DRILL_LIBRARY[f.code] ?? GENERIC_DRILL;
    const steps = spec.description.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const header =
      `### ${spec.title}\n\n` +
      `**Fault:** ${f.name} · **Severity:** ${f.severity[0]?.toUpperCase()}${f.severity.slice(1)} · ` +
      `**Phase:** ${f.phase.replace(/_/g, " ")}\n\n` +
      `> **Target:** ${f.target} ${f.unit} · **Yours:** ${f.measured} ${f.unit}\n\n` +
      `${f.summary}\n\n`;
    const body =
      `${steps}\n\n` +
      `**Focus:** ${spec.focusKey}\n\n` +
      `**Reps:** ${spec.recommendedReps}`;
    return {
      faultCode: f.code,
      drillName: spec.title,
      markdown: header + body,
      title: spec.title,
      description: spec.description.join(" "),
      focusKey: spec.focusKey,
      recommendedReps: spec.recommendedReps,
    };
  });
}

// ---------------------------------------------------------------------------
// Full local pipeline (solo + dual)
// ---------------------------------------------------------------------------
/**
 * V5 optimistic recalibration: both solo and dual indices come from the
 * 100-point log-soft-margin scoring engine (src/engine/scoring.ts). The DTW
 * similarity cost remains available in the metrics tab for dual mode.
 */
export function swingIndexFromScore(
  faults: readonly Fault[],
  spineDeltaDeg: readonly number[],
): number {
  return computeScore(faults, spineDeltaDeg).score10;
}

/** Peak pelvis angular velocity in deg/s (telemetry-card headline number). */
export function maxRotaryVelocity(analysis: AnalysisResult, fps: number): number {
  const hips = analysis.kinematicVelocity.hips;
  return Math.round(Math.max(...hips) * fps);
}

export function analyzeLocally(
  user: SwingSequence,
  reference: SwingSequence | null,
): AnalysisResult {
  const userNorm = normalizeSwing(user);
  const userMetrics = computeMetrics(userNorm, user.leadSide);
  const userPhases = segmentPhases(userNorm, user.leadSide);
  const faults = detectFaults18(userNorm.frames, userMetrics, userPhases, user.leadSide);
  const drills = recommendDrills(faults);
  const kin = kinematicSequenceReport(
    userMetrics,
    userPhases.top_of_backswing,
    userPhases.impact,
  );

  const base = {
    kinematicSequence: kin,
    kinematicVelocity: userMetrics.kinematicVelocity,
    spineDeltaDeg: userMetrics.spineDeltaDeg,
    faults,
    drills,
    source: "local" as const,
  };

  if (!reference) {
    return {
      ...base,
      mode: "solo",
      alignment: null,
      phases: { user: userPhases, pro: null },
      deviations: [],
      swingIndex: swingIndexFromScore(faults, userMetrics.spineDeltaDeg),
    };
  }

  const proNorm = normalizeSwing(reference);
  const proMetrics = computeMetrics(proNorm, reference.leadSide);
  const proPhases = segmentPhases(proNorm, reference.leadSide);
  const uf = featureMatrix(userMetrics);
  const pf = featureMatrix(proMetrics);
  const band = Math.max(5, Math.floor(0.25 * Math.max(uf.length, pf.length)));
  const alignment = dtwAlign(uf, pf, band);
  const deviations = deviationMatrix(userMetrics, proMetrics, alignment.path, user.leadSide);

  return {
    ...base,
    mode: "dual",
    alignment,
    phases: { user: userPhases, pro: proPhases },
    deviations,
    swingIndex: swingIndexFromScore(faults, userMetrics.spineDeltaDeg),
  };
}

export { normalizeSwing as normalize };
