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
  KinematicSequence,
  Phases,
  PoseFrame,
  SwingSequence,
  WarpStep,
} from "../types/pose.ts";
import { LM } from "../types/pose.ts";
import {
  angleBetweenDeg,
  argmax,
  clamp,
  gradient,
  jointAngle3dDeg,
  mid,
  movingAverage,
  sub,
  unwrap,
  type Vec3,
} from "./vectorMath.ts";

const PLAYER_HEIGHT_IN = 70;

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
  readonly leadArmAngleDeg: readonly number[];
  readonly hipSway: readonly number[];
  readonly hipThrust: readonly number[];
  readonly hipRotationDeg: readonly number[];
  readonly shoulderRotationDeg: readonly number[];
  readonly wristSpeed: readonly number[];
  readonly kinematicPeaks: Record<string, number>;
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

const angularSpeed = (lines: readonly Vec3[]): number[] => {
  const ang = unwrap(lines.map((v) => Math.atan2(v[2], v[0]))).map(
    (r) => (r * 180) / Math.PI,
  );
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

  const kinematicPeaks: Record<string, number> = {
    hips: argmax(movingAverage(angularSpeed(hipLine), 5)),
    torso: argmax(movingAverage(angularSpeed(shoLine), 5)),
    arms: argmax(movingAverage(angularSpeed(armLine), 5)),
    hands: argmax(movingAverage(angularSpeed(handLine), 5)),
  };

  return {
    spineAngleDeg: movingAverage(spine, 5),
    leadArmAngleDeg: movingAverage(leadArm, 5),
    hipSway: movingAverage(hipSway, 5),
    hipThrust: movingAverage(hipThrust, 5),
    hipRotationDeg: movingAverage(planeRotationDeg(hipLine), 5),
    shoulderRotationDeg: movingAverage(planeRotationDeg(shoLine), 5),
    wristSpeed: movingAverage(speedOf(wristPos), 3),
    kinematicPeaks,
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
    const spineD = (user.spineAngleDeg[u] as number) - (pro.spineAngleDeg[p] as number);
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

const window_ = (s: readonly number[], a: number, b: number): number[] => {
  const start = clamp(a, 0, s.length - 1);
  const end = clamp(b, start + 1, s.length);
  return s.slice(start, end) as number[];
};

export function detectFaults(
  user: SwingMetrics,
  userPhases: Phases,
  deviations: readonly DeviationFrame[],
): Fault[] {
  const faults: Fault[] = [];
  const p = userPhases;

  // 1) Early extension
  const thrustWin = window_(user.hipThrust, p.top_of_backswing, p.impact + 1);
  const setupThrust = user.hipThrust[p.setup] as number;
  const thrustIn =
    Math.max(...thrustWin.map((v) => Math.abs(v - setupThrust))) * PLAYER_HEIGHT_IN;
  const spineGain =
    (user.spineAngleDeg[p.impact] as number) -
    (user.spineAngleDeg[p.top_of_backswing] as number);
  if (thrustIn > 3.2 || spineGain > 8) {
    faults.push({
      code: "early_extension",
      name: "Early Extension",
      severity: "critical",
      phase: "downswing",
      measured: Math.round(Math.max(thrustIn, 0) * 10) / 10,
      target: 2.0,
      unit: "in",
      summary: `Your hips moved ${thrustIn.toFixed(1)} in toward the ball during the downswing and your spine angle rose ${Math.max(spineGain, 0).toFixed(1)}°. This forces a stand-up delivery and blocks rotation.`,
    });
  }

  // 2) Chicken wing
  const impactWin = window_(user.leadArmAngleDeg, p.impact - 2, p.follow_through + 1);
  const impactMin = Math.min(...impactWin);
  if (impactMin < 155) {
    faults.push({
      code: "chicken_wing",
      name: "Chicken Wing (Lead-Elbow Breakdown)",
      severity: "major",
      phase: "impact",
      measured: Math.round(impactMin * 10) / 10,
      target: 165,
      unit: "deg",
      summary: `Your lead elbow collapsed to ${impactMin.toFixed(0)}° through impact (target ≥ 165°). The bend robs width, loft control, and speed.`,
    });
  }

  // 3) Sway
  const swayWin = window_(user.hipSway, p.setup, p.top_of_backswing + 1);
  const swayIn = -Math.min(...swayWin) * PLAYER_HEIGHT_IN;
  if (swayIn > 2.5) {
    faults.push({
      code: "sway",
      name: "Hip Sway",
      severity: "major",
      phase: "top_of_backswing",
      measured: Math.round(swayIn * 10) / 10,
      target: 2.5,
      unit: "in",
      summary: `Your hips slid ${swayIn.toFixed(1)} in away from the target in the backswing (target ≤ 2.5 in). Sway kills the coil and makes low-point control random.`,
    });
  }

  // 4) Spine retention vs pro
  if (deviations.length > 0) {
    const worst = Math.max(...deviations.map((d) => Math.abs(d.spineAngleDelta)));
    if (worst > 8) {
      faults.push({
        code: "spine_retention",
        name: "Spine-Angle Retention",
        severity: "minor",
        phase: "downswing",
        measured: Math.round(worst * 10) / 10,
        target: 8,
        unit: "deg",
        summary: `Your spine angle deviated up to ${worst.toFixed(1)}° from the model swing (tolerance ± 8°).`,
      });
    }
  }

  // 5) Kinematic sequence
  const seq = kinematicSequenceReport(user);
  if (!seq.sequenceCorrect) {
    const orderStr = Object.entries(seq.peakFrames)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k)
      .join(" → ");
    faults.push({
      code: "kinematic_sequence",
      name: "Kinematic Sequence Out of Order",
      severity: "major",
      phase: "downswing",
      measured: 0,
      target: 0,
      unit: "order",
      summary: `Your peak-speed order was ${orderStr}; the efficient chain is hips → torso → arms → hands. Energy is leaking up the chain early.`,
    });
  }

  const sevOrder: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  faults.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
  return faults;
}

export function kinematicSequenceReport(m: SwingMetrics): KinematicSequence {
  const order = ["hips", "torso", "arms", "hands"] as const;
  const frames = order.map((k) => m.kinematicPeaks[k] ?? 0);
  const correct = frames.every((f, i) => i === 0 || (frames[i - 1] as number) <= f);
  return { order, peakFrames: { ...m.kinematicPeaks }, sequenceCorrect: correct };
}

// ---------------------------------------------------------------------------
// Drill library
// ---------------------------------------------------------------------------
const DRILL_BODIES: Record<string, { name: string; body: string }> = {
  early_extension: {
    name: "Chair Drill (Butt-Back Wall Drill)",
    body: "**Setup**\n\n1. Address a ball with a chair back (or wall) lightly touching your glutes.\n2. Make slow-motion swings keeping **both glutes in contact** until lead-arm-parallel in the downswing.\n3. At impact, your **trail glute** should still brush the chair.\n\n**Reps:** 3 sets × 10 slow swings, then 5 at 75% speed.\n\n**Checkpoint:** hip thrust toward the ball under **2.0 in** on your next upload.",
  },
  chicken_wing: {
    name: "Glove Under Armpit Drill",
    body: "**Setup**\n\n1. Tuck a glove (or headcover) under your **lead armpit**.\n2. Hit half-shots keeping the glove pinned from setup through waist-high finish.\n3. The glove may only drop **after** both arms extend past impact.\n\n**Reps:** 20 balls at 50% speed, 10 at 75%.\n\n**Checkpoint:** lead-elbow angle ≥ **165°** through the impact window.",
  },
  sway: {
    name: "Crossed-Arms Stance Pivot Drill",
    body: "**Setup**\n\n1. Cross your arms over your chest, club across your shoulders.\n2. Rotate to a full backswing turn while keeping your **trail hip inside your trail ankle**.\n3. Feel pressure screw **into** the trail heel, not slide over it.\n\n**Reps:** 3 sets × 12 pivots; add an alignment stick outside the trail hip.\n\n**Checkpoint:** lateral hip sway under **2.5 in** at the top.",
  },
  spine_retention: {
    name: "Head-on-Wall Posture Drill",
    body: "**Setup**\n\n1. Set up with your forehead lightly touching a wall-mounted pad (or door frame).\n2. Rehearse backswing and downswing keeping constant light head pressure.\n3. Losing contact = losing spine angle.\n\n**Reps:** 3 sets × 8 rehearsals, eyes on a fixed ball position.\n\n**Checkpoint:** spine-angle deviation within **± 8°** of the model swing.",
  },
  kinematic_sequence: {
    name: "Step-Change-of-Direction Drill",
    body: "**Setup**\n\n1. Start with feet together; swing to the top.\n2. **Step** the lead foot toward the target to start the downswing — the step forces the lower body to fire first.\n3. Let the torso, arms, and club lag behind the step in order.\n\n**Reps:** 15 swings with a mid-iron at 60–70% speed.\n\n**Checkpoint:** peak-speed order hips → torso → arms → hands.",
  },
};

export function recommendDrills(faults: readonly Fault[]): DrillCard[] {
  return faults
    .filter((f) => f.code in DRILL_BODIES)
    .map((f) => {
      const d = DRILL_BODIES[f.code] as { name: string; body: string };
      const header =
        `### ${d.name}\n\n` +
        `**Fault:** ${f.name} · **Severity:** ${f.severity[0]?.toUpperCase()}${f.severity.slice(1)} · ` +
        `**Phase:** ${f.phase.replace(/_/g, " ")}\n\n` +
        `> **Target:** ${f.target} ${f.unit} · **Yours:** ${f.measured} ${f.unit}\n\n` +
        `${f.summary}\n\n`;
      return { faultCode: f.code, drillName: d.name, markdown: header + d.body };
    });
}

// ---------------------------------------------------------------------------
// Full local pipeline
// ---------------------------------------------------------------------------
export function swingIndex(normalizedCost: number, faultCount: number): number {
  const base = 10 * Math.exp(-Math.max(0, normalizedCost - 0.6) / 2.2);
  return Math.round(clamp(base - 0.6 * faultCount, 0, 10) * 10) / 10;
}

export function analyzeLocally(
  user: SwingSequence,
  pro: SwingSequence,
): AnalysisResult {
  const userNorm = normalizeSwing(user);
  const proNorm = normalizeSwing(pro);
  const userMetrics = computeMetrics(userNorm, user.leadSide);
  const proMetrics = computeMetrics(proNorm, pro.leadSide);
  const userPhases = segmentPhases(userNorm, user.leadSide);
  const proPhases = segmentPhases(proNorm, pro.leadSide);

  const uf = featureMatrix(userMetrics);
  const pf = featureMatrix(proMetrics);
  const band = Math.max(5, Math.floor(0.25 * Math.max(uf.length, pf.length)));
  const alignment = dtwAlign(uf, pf, band);

  const deviations = deviationMatrix(userMetrics, proMetrics, alignment.path, user.leadSide);
  const faults = detectFaults(userMetrics, userPhases, deviations);
  const drills = recommendDrills(faults);

  return {
    alignment,
    phases: { user: userPhases, pro: proPhases },
    kinematicSequence: kinematicSequenceReport(userMetrics),
    deviations,
    faults,
    drills,
    swingIndex: swingIndex(alignment.normalizedCost, faults.length),
    source: "local",
  };
}

export { normalizeSwing as normalize };
