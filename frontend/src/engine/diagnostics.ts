/**
 * SwingAI V3 — 17-rule biomechanical diagnostic matrix (TypeScript mirror of
 * backend/analytics/biomechanics.py).
 *
 * 15 spec rules across five body groups + the V2 carry-overs (backswing sway,
 * kinematic sequence). Every rule is self-contained, runs on SavGol-smoothed
 * series, and is verified to stay silent on the clean model swings.
 */

import type { Fault, Phases } from "../types/pose.ts";
import { LM } from "../types/pose.ts";
import type { SwingMetrics } from "../lib/engine.ts";
import { kinematicSequenceReport } from "../lib/engine.ts";
import { jointAngle3dDeg, savgolSmooth, type Vec3 } from "../lib/vectorMath.ts";

const PLAYER_HEIGHT_IN = 70;
const IN = 1 / PLAYER_HEIGHT_IN;

type Frames = ReadonlyArray<ReadonlyArray<Vec3>>;

const at = (F: Frames, t: number, i: number): Vec3 =>
  ((F[t] as readonly Vec3[])[i] as Vec3) ?? [0, 0, 0];

const series = (F: Frames, i: number, axis: 0 | 1 | 2): number[] =>
  savgolSmooth(F.map((_, t) => at(F, t, i)[axis]), 5);

const midSeries = (F: Frames, a: number, b: number, axis: 0 | 1 | 2): number[] =>
  savgolSmooth(F.map((_, t) => (at(F, t, a)[axis] + at(F, t, b)[axis]) / 2), 5);

const maxIn = (x: readonly number[], lo: number, hi: number): number => {
  let m = -Infinity;
  for (let t = Math.max(0, lo); t < Math.min(x.length, hi); t++) m = Math.max(m, x[t] as number);
  return m;
};
const minIn = (x: readonly number[], lo: number, hi: number): number => {
  let m = Infinity;
  for (let t = Math.max(0, lo); t < Math.min(x.length, hi); t++) m = Math.min(m, x[t] as number);
  return m;
};

/** Signed wrist-cock series; polarity normalized so + = cocked at the top. */
function signedWristCock(F: Frames, lead: boolean, top: number): number[] {
  const EL = lead ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW;
  const WR = lead ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
  const hands = lead
    ? [LM.LEFT_PINKY, LM.LEFT_INDEX, LM.LEFT_THUMB]
    : [LM.RIGHT_PINKY, LM.RIGHT_INDEX, LM.RIGHT_THUMB];
  const T = F.length;
  const raw = new Array<number>(T).fill(0);
  const fxS = savgolSmooth(F.map((_, t) => at(F, t, WR)[0] - at(F, t, EL)[0]), 5);
  const fyS = savgolSmooth(F.map((_, t) => at(F, t, WR)[1] - at(F, t, EL)[1]), 5);
  const cxS = savgolSmooth(
    F.map((_, t) => hands.reduce((s, h) => s + at(F, t, h)[0], 0) / 3 - at(F, t, WR)[0]),
    5,
  );
  const cyS = savgolSmooth(
    F.map((_, t) => hands.reduce((s, h) => s + at(F, t, h)[1], 0) / 3 - at(F, t, WR)[1]),
    5,
  );
  for (let t = 0; t < T; t++) {
    const fx = fxS[t] as number;
    const fy = fyS[t] as number;
    const cx = cxS[t] as number;
    const cy = cyS[t] as number;
    const nf = Math.hypot(fx, fy);
    const nc = Math.hypot(cx, cy);
    if (nf < 1e-9 || nc < 1e-9) continue;
    const cos = Math.min(1, Math.max(-1, (fx * cx + fy * cy) / (nf * nc)));
    const ang = (Math.acos(cos) * 180) / Math.PI;
    raw[t] = fx * cy - fy * cx >= 0 ? ang : -ang;
  }
  let topMean = 0;
  let n = 0;
  for (let t = Math.max(0, top - 2); t <= Math.min(T - 1, top + 2); t++) {
    topMean += raw[t] as number;
    n++;
  }
  const pol = topMean / Math.max(n, 1) >= 0 ? 1 : -1;
  return raw.map((v) => v * pol);
}

export function detectFaults18(
  F: Frames,
  m: SwingMetrics,
  p: Phases,
  leadSide: "left" | "right" = "left",
): Fault[] {
  const faults: Fault[] = [];
  const T = F.length;
  const L = leadSide === "left";
  const sign = L ? 1 : -1; // +x toward target for a left-lead golfer

  const add = (
    code: string, name: string, severity: Fault["severity"], phase: Fault["phase"],
    measured: number, target: number, unit: string, summary: string,
  ) => faults.push({ code, name, severity, phase, measured: Math.round(measured * 10) / 10, target, unit, summary });

  const headX = series(F, LM.NOSE, 0).map((v) => v * sign);
  const headY = series(F, LM.NOSE, 1);
  const hipX = midSeries(F, LM.LEFT_HIP, LM.RIGHT_HIP, 0).map((v) => v * sign);
  const shoX = midSeries(F, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, 0).map((v) => v * sign);
  const leadAnkleX = at(F, p.setup, L ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE)[0] * sign;
  const trailHeelY = series(F, L ? LM.RIGHT_HEEL : LM.LEFT_HEEL, 1);
  const leadKneeX = series(F, L ? LM.LEFT_KNEE : LM.RIGHT_KNEE, 0).map((v) => v * sign);

  const downLo = p.top_of_backswing;
  const downHi = p.impact + 1;
  const midDown = p.downswing;

  // 1. Head & spine
  // Head sway — loosened to 4.5 in AND required to be SUSTAINED (> 3
  // consecutive frames) so single-frame landmark jumps never flag.
  {
    let run = 0;
    let sustained = false;
    let peak = 0;
    for (let t = p.setup; t <= p.top_of_backswing && t < headX.length; t++) {
      const dev = Math.abs((headX[t] as number) - (headX[p.setup] as number)) / IN;
      peak = Math.max(peak, dev);
      run = dev > 4.5 ? run + 1 : 0;
      if (run > 3) sustained = true;
    }
    if (sustained) {
      add("head_sway", "Head Sway", "major", "top_of_backswing", peak, 4.5, "in",
        `Your head drifted ${peak.toFixed(1)} in laterally between address and the top (tolerance ≤ 4.5 in, sustained). A stable head is the axis of the coil.`);
    }
  }

  const liftIn = (maxIn(headY, downLo, downHi) - (headY[p.setup] as number)) / IN;
  if (liftIn > 2.0) {
    add("head_lift", "Early Head Lift", "minor", "downswing", liftIn, 2.0, "in",
      `Your head rose ${liftIn.toFixed(1)} in before impact (tolerance ≤ 2.0 in) — standing up early costs compression and low-point control.`);
  }

  const dipIn = ((headY[p.setup] as number) - minIn(headY, downLo, downHi)) / IN;
  if (dipIn > 3.0) {
    add("head_dip", "Head Dipping", "minor", "downswing", dipIn, 3.0, "in",
      `Your head dropped ${dipIn.toFixed(1)} in during the downswing (tolerance ≤ 3.0 in) — excessive dip makes strike depth unpredictable.`);
  }

  const deltaImp = m.spineDeltaDeg[p.impact] as number;
  if (deltaImp > 8) {
    add("spine_retention", "Loss of Spine Angle", "minor", "downswing", deltaImp, 8, "deg",
      `Your spine angle changed ${deltaImp.toFixed(1)}° between address and impact (tolerance ≤ 8°).`);
  }

  // 2. Shoulders & torso
  const leanIn =
    ((shoX[p.top_of_backswing] as number) - (hipX[p.top_of_backswing] as number)
      - ((shoX[p.setup] as number) - (hipX[p.setup] as number))) / IN;
  if (leanIn > 1.5) {
    add("reverse_spine", "Reverse Spine Angle", "major", "top_of_backswing", leanIn, 1.5, "in",
      `Your upper body tilted ${leanIn.toFixed(1)} in TOWARD the target at the top (tolerance ≤ 1.5 in) — the classic reverse-pivot pattern.`);
  }

  const rotRange = Math.max(...m.shoulderRotationDeg.map(Math.abs));
  if (rotRange > 125) {
    add("overswing", "Overswing", "major", "top_of_backswing", rotRange, 125, "deg",
      `Your shoulders turned ${rotRange.toFixed(0)}° (tolerance ≤ 125°, camera-perspective safe) — past parallel the structure breaks down.`);
  }

  const shoRange = Math.abs((m.shoulderRotationDeg[p.impact] as number) - (m.shoulderRotationDeg[p.top_of_backswing] as number)) || 1e-9;
  const hipRange = Math.abs((m.hipRotationDeg[p.impact] as number) - (m.hipRotationDeg[p.top_of_backswing] as number)) || 1e-9;
  for (let t = p.top_of_backswing + 1; t < p.impact; t++) {
    const shoFrac = Math.abs((m.shoulderRotationDeg[t] as number) - (m.shoulderRotationDeg[p.top_of_backswing] as number)) / shoRange;
    if (shoFrac >= 0.1) {
      const hipFrac = Math.abs((m.hipRotationDeg[t] as number) - (m.hipRotationDeg[p.top_of_backswing] as number)) / hipRange;
      if (hipFrac < 0.02) {
        add("shoulder_snatch", "Lead Shoulder Snatch", "major", "downswing", 10, 2, "%",
          "Your shoulders started uncoiling before your hips moved — transition must sequence from the ground up.");
      }
      break;
    }
  }

  // 3. Arms, wrists & lag
  const cock = signedWristCock(F, L, p.top_of_backswing);
  const wristAngle = cock.map((c) => 180 - Math.abs(c));

  // Casting / early release — REFACTORED (V4.1): theta = arccos(v_f·v_h /
  // |v_f||v_h|), evaluated ONLY between the top and mid-downswing (P5 proxy),
  // never at the top itself or post-impact. Threshold 165° (15° grace below
  // full extension). GATE: if no wrist cock was measurable at the top (angle
  // already ~180°, e.g. hand landmarks unresolved on real footage) the metric
  // is meaningless and the rule stays silent — the fix for the false 179.5°
  // "cast" on tour benchmark video.
  // Hand-landmark resolution gate: if the hand centroid sits essentially ON
  // the wrist (< 1.2 in separation), the hand direction is tracking noise and
  // every wrist-angle metric is meaningless — casting AND flip stay silent.
  const handsIdx = L ? [LM.LEFT_PINKY, LM.LEFT_INDEX, LM.LEFT_THUMB] : [LM.RIGHT_PINKY, LM.RIGHT_INDEX, LM.RIGHT_THUMB];
  const wrIdx = L ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
  let sepSum = 0;
  for (let t = 0; t < T; t++) {
    const w = at(F, t, wrIdx);
    let hx = 0, hy = 0, hz = 0;
    for (const h of handsIdx) {
      const pt = at(F, t, h);
      hx += pt[0] / 3; hy += pt[1] / 3; hz += pt[2] / 3;
    }
    sepSum += Math.hypot(hx - w[0], hy - w[1], hz - w[2]);
  }
  const handsResolved = sepSum / Math.max(T, 1) > 1.2 * IN;

  const topAngle =
    ((wristAngle[Math.max(0, p.top_of_backswing - 1)] as number) +
      (wristAngle[p.top_of_backswing] as number) +
      (wristAngle[Math.min(wristAngle.length - 1, p.top_of_backswing + 1)] as number)) / 3;
  const castMax = maxIn(wristAngle, downLo + 2, Math.max(downLo + 3, midDown + 1));
  if (handsResolved && topAngle < 150 && castMax > 165) {
    add("casting", "Casting / Early Release", "critical", "downswing", castMax, 165, "deg",
      `Your wrist angle opened to ${castMax.toFixed(0)}° before mid-downswing (hold ≤ 165° until the shaft reaches horizontal) — the lag you built at the top (${topAngle.toFixed(0)}°) was thrown away early.`);
  }

  // Chicken wing — V5 leniency: lead-elbow flex must exceed 52° AND persist
  // for ≥ 3 consecutive frames post-impact. Single-frame blips never trigger.
  const elTriple = L
    ? ([LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST] as const)
    : ([LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST] as const);
  const elbowAngle = savgolSmooth(
    F.map((_, t) => jointAngle3dDeg(at(F, t, elTriple[0]), at(F, t, elTriple[1]), at(F, t, elTriple[2]))),
    5,
  );
  {
    let run = 0;
    let fired = false;
    let peak = 0;
    for (let t = Math.max(0, p.impact - 1); t <= Math.min(p.follow_through, elbowAngle.length - 1); t++) {
      const flex = 180 - (elbowAngle[t] as number);
      peak = Math.max(peak, flex);
      run = flex > 52 ? run + 1 : 0;
      if (run >= 3) fired = true;
    }
    if (fired) {
      add("chicken_wing", "Chicken Wing", "major", "impact", peak, 52, "deg",
        `Your lead elbow flexed ${peak.toFixed(0)}° through impact and held it for 3+ frames (tolerance ≤ 52° sustained) — it must extend down the target line, not break outward.`);
    }
  }

  // Flip/scoop — gated exactly like casting: only meaningful when a real
  // wrist cock was measurable at the top.
  const flipDeg = minIn(cock, Math.max(0, p.impact - 1), p.impact + 2);
  if (handsResolved && topAngle < 150 && flipDeg < -10) {
    add("flip_scoop", "Flip / Scoop at Impact", "critical", "impact", Math.abs(flipDeg), 10, "deg",
      `Your wrists flipped ${Math.abs(flipDeg).toFixed(0)}° past neutral at contact — loft is added instead of compressed.`);
  }

  // 4. Hips & pelvis
  const slideIn = (maxIn(hipX, downLo, downHi) - leadAnkleX) / IN;
  if (slideIn > 1.0) {
    add("hip_slide", "Hip Slide", "major", "downswing", slideIn, 1.0, "in",
      `Your pelvis slid ${slideIn.toFixed(1)} in past your lead ankle (tolerance ≤ 1.0 in) — rotate around the lead hip, don't slide through it.`);
  }

  const setupThrust = m.hipThrust[p.setup] as number;
  let thrustMax = 0;
  for (let t = downLo; t < Math.min(downHi, m.hipThrust.length); t++) {
    thrustMax = Math.max(thrustMax, Math.abs((m.hipThrust[t] as number) - setupThrust));
  }
  const thrustIn = thrustMax * PLAYER_HEIGHT_IN;
  const spineGain = (m.spineAngleDeg[p.impact] as number) - (m.spineAngleDeg[p.top_of_backswing] as number);
  if (thrustIn > 2.5 || spineGain > 8) {
    add("early_extension", "Early Extension", "critical", "downswing", Math.max(thrustIn, 0), 2.5, "in",
      `Your hips moved ${thrustIn.toFixed(1)} in toward the ball during the downswing (tolerance ≤ 2.5 in). This forces a stand-up delivery.`);
  }

  const hipsVel = m.kinematicVelocity.hips;
  const stallLo = downLo + Math.floor(0.6 * (p.impact - downLo));
  const downPeak = maxIn(hipsVel, downLo, downHi) || 1e-9;
  let run = 0;
  for (let t = stallLo; t <= Math.min(p.impact, hipsVel.length - 1); t++) {
    run = (hipsVel[t] as number) < 0.15 * downPeak ? run + 1 : 0;
    if (run >= 3) {
      add("hip_stall", "Hip Stall", "minor", "downswing", 15, 15, "%",
        "Your pelvis rotation stalled before impact — when the engine stops, the hands must flip to square the face.");
      break;
    }
  }

  // 5. Legs, knees & weight
  const heelRiseIn = (maxIn(trailHeelY, downLo, midDown + 1) - (trailHeelY[p.setup] as number)) / IN;
  if (heelRiseIn > 2.5) {
    add("trail_heel_lift", "Premature Trail Heel Lift", "minor", "downswing", heelRiseIn, 2.5, "in",
      `Your trail heel rose ${heelRiseIn.toFixed(1)} in early in the downswing (tolerance ≤ 2.5 in) — stay grounded.`);
  }

  const collapseIn = ((leadKneeX[p.setup] as number) - minIn(leadKneeX, p.setup, p.top_of_backswing + 1)) / IN;
  if (collapseIn > 2.0) {
    add("lead_knee_collapse", "Lead Knee Collapse", "major", "top_of_backswing", collapseIn, 2.0, "in",
      `Your lead knee dove ${collapseIn.toFixed(1)} in toward the trail leg in the backswing (tolerance ≤ 2.0 in).`);
  }

  // V2 carry-overs
  const swayBwIn = -minIn(m.hipSway, p.setup, p.top_of_backswing + 1) * PLAYER_HEIGHT_IN;
  if (swayBwIn > 2.5) {
    add("sway", "Hip Sway (Backswing)", "major", "top_of_backswing", swayBwIn, 2.5, "in",
      `Your hips slid ${swayBwIn.toFixed(1)} in away from the target going back (tolerance ≤ 2.5 in) — coil into the trail hip instead.`);
  }

  const seq = kinematicSequenceReport(m, p.top_of_backswing, p.impact);
  if (!seq.sequenceCorrect) {
    const orderStr = Object.entries(seq.peakFrames)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k)
      .join(" → ");
    add("kinematic_sequence", "Kinematic Sequence Out of Order", "major", "downswing", 0, 0, "order",
      `Your peak-speed order was ${orderStr}; the efficient chain is hips → torso → arms → hands.`);
  }

  const sevOrder: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  faults.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
  void T;
  return faults;
}

/** Body-group label for a fault code (used by the diagnostics UI). */
export function faultGroup(code: string): string {
  const groups: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["Head & Spine", ["head_sway", "head_lift", "head_dip", "spine_retention"]],
    ["Shoulders & Torso", ["reverse_spine", "overswing", "shoulder_snatch"]],
    ["Arms & Wrists", ["casting", "chicken_wing", "flip_scoop"]],
    ["Hips & Pelvis", ["hip_slide", "early_extension", "hip_stall", "sway"]],
    ["Legs & Weight", ["trail_heel_lift", "lead_knee_collapse"]],
    ["Sequencing", ["kinematic_sequence"]],
  ];
  for (const [name, codes] of groups) if (codes.includes(code)) return name;
  return "Other";
}
