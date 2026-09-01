/**
 * SwingAI — analysis API client (V2).
 *
 * Prefers the FastAPI backend (exact NumPy pipeline); transparently falls
 * back to the in-browser TypeScript engine when the service is unreachable.
 * Supports solo mode (no reference swing) and dual mode.
 */

import type {
  Alignment,
  AnalysisResult,
  DeviationFrame,
  DrillCard,
  Fault,
  KinematicSegment,
  PhaseName,
  Phases,
  SwingSequence,
  WarpStep,
} from "../types/pose.ts";
import { analyzeLocally } from "./engine.ts";

const API_TIMEOUT_MS = 12_000;

interface BackendDeviation {
  user_frame: number;
  pro_frame: number;
  spine_angle_delta: number;
  lead_arm_delta: number;
  hip_sway_delta: number;
  hip_thrust_delta: number;
  hip_rotation_delta: number;
  flagged_joints: number[];
}

interface BackendResponse {
  mode: "solo" | "dual";
  alignment: {
    path: [number, number][];
    cost: number;
    normalized_cost: number;
    user_to_pro: number[];
    pro_to_user: number[];
  } | null;
  phases: {
    user: Record<PhaseName, number>;
    pro?: Record<PhaseName, number>;
  };
  kinematic_sequence: {
    order: string[];
    peak_frames: Record<string, number>;
    sequence_correct: boolean;
    window: { start: number; end: number };
    tolerance_frames: number;
  };
  kinematic_velocity: Record<KinematicSegment, number[]>;
  spine_delta_deg: number[];
  deviations: BackendDeviation[];
  faults: {
    code: string;
    name: string;
    severity: "critical" | "major" | "minor";
    phase: PhaseName;
    measured: number;
    target: number;
    unit: string;
    summary: string;
  }[];
  drills: {
    fault_code: string;
    drill_name: string;
    markdown: string;
    title?: string;
    description?: string;
    focus_key?: string;
    recommended_reps?: string;
  }[];
  swing_index: number;
}

const toWire = (s: SwingSequence) => ({
  fps: s.fps,
  lead_side: s.leadSide,
  frames: s.frames.map((f) =>
    f.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility })),
  ),
});

function fromWire(r: BackendResponse): AnalysisResult {
  const alignment: Alignment | null = r.alignment
    ? {
        path: r.alignment.path.map((p): WarpStep => [p[0] ?? 0, p[1] ?? 0]),
        cost: r.alignment.cost,
        normalizedCost: r.alignment.normalized_cost,
        userToPro: r.alignment.user_to_pro,
        proToUser: r.alignment.pro_to_user,
      }
    : null;
  const deviations: DeviationFrame[] = r.deviations.map((d) => ({
    userFrame: d.user_frame,
    proFrame: d.pro_frame,
    spineAngleDelta: d.spine_angle_delta,
    leadArmDelta: d.lead_arm_delta,
    hipSwayDelta: d.hip_sway_delta,
    hipThrustDelta: d.hip_thrust_delta,
    hipRotationDelta: d.hip_rotation_delta,
    flaggedJoints: d.flagged_joints,
  }));
  const faults: Fault[] = r.faults;
  const drills: DrillCard[] = r.drills.map((d) => ({
    faultCode: d.fault_code,
    drillName: d.drill_name,
    markdown: d.markdown,
    ...(d.title !== undefined && { title: d.title }),
    ...(d.description !== undefined && { description: d.description }),
    ...(d.focus_key !== undefined && { focusKey: d.focus_key }),
    ...(d.recommended_reps !== undefined && { recommendedReps: d.recommended_reps }),
  }));
  return {
    mode: r.mode,
    alignment,
    phases: {
      user: r.phases.user as Phases,
      pro: (r.phases.pro as Phases | undefined) ?? null,
    },
    kinematicSequence: {
      order: r.kinematic_sequence.order,
      peakFrames: r.kinematic_sequence.peak_frames,
      sequenceCorrect: r.kinematic_sequence.sequence_correct,
      window: r.kinematic_sequence.window,
      toleranceFrames: r.kinematic_sequence.tolerance_frames,
    },
    kinematicVelocity: r.kinematic_velocity,
    spineDeltaDeg: r.spine_delta_deg,
    deviations,
    faults,
    drills,
    swingIndex: r.swing_index,
    source: "backend",
  };
}

export async function analyzeSwings(
  user: SwingSequence,
  reference: SwingSequence | null,
): Promise<AnalysisResult> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    const body: Record<string, unknown> = { user_swing: toWire(user) };
    if (reference) body["pro_swing"] = toWire(reference);
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`backend ${resp.status}`);
    return fromWire((await resp.json()) as BackendResponse);
  } catch {
    // Backend unreachable — run the identical pipeline in-browser.
    return analyzeLocally(user, reference);
  }
}
