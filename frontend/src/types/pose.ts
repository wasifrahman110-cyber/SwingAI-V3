/**
 * SwingAI — strict typings for MediaPipe pose structures, DTW time-mapping
 * indices, and analysis payloads (mirrors the FastAPI schemas 1:1).
 */

/** One MediaPipe landmark: normalized screen x/y, depth z, visibility 0–1. */
export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility: number;
}

/** A single frame = exactly 33 MediaPipe pose landmarks. */
export type PoseFrame = readonly Landmark[];

/** A captured swing: T frames of 33 landmarks plus capture metadata. */
export interface SwingSequence {
  readonly fps: number;
  readonly leadSide: "left" | "right";
  readonly frames: readonly PoseFrame[];
}

/** MediaPipe Pose Landmarker 33-point topology indices. */
export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
} as const;

export type LandmarkIndex = (typeof LM)[keyof typeof LM];

/** Skeleton bone list used by the canvas renderer. */
export const BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
  [LM.NOSE, LM.LEFT_SHOULDER],
  [LM.NOSE, LM.RIGHT_SHOULDER],
] as const;

/** The 5 critical swing phases. */
export type PhaseName =
  | "setup"
  | "top_of_backswing"
  | "downswing"
  | "impact"
  | "follow_through";

export const PHASE_NAMES: readonly PhaseName[] = [
  "setup",
  "top_of_backswing",
  "downswing",
  "impact",
  "follow_through",
] as const;

export const PHASE_LABELS: Record<PhaseName, string> = {
  setup: "Set Up",
  top_of_backswing: "Top",
  downswing: "Mid Swing",
  impact: "Impact",
  follow_through: "Finish",
};

export type Phases = Record<PhaseName, number>;

/** One step of the DTW warp path: [userFrame, proFrame]. */
export type WarpStep = readonly [number, number];

export interface Alignment {
  readonly path: readonly WarpStep[];
  readonly cost: number;
  readonly normalizedCost: number;
  /** userToPro[i] = pro frame matched to user frame i (monotonic). */
  readonly userToPro: readonly number[];
  readonly proToUser: readonly number[];
}

export interface DeviationFrame {
  readonly userFrame: number;
  readonly proFrame: number;
  readonly spineAngleDelta: number;
  readonly leadArmDelta: number;
  readonly hipSwayDelta: number;
  readonly hipThrustDelta: number;
  readonly hipRotationDelta: number;
  readonly flaggedJoints: readonly number[];
}

export type Severity = "critical" | "major" | "minor";

export interface Fault {
  readonly code: string;
  readonly name: string;
  readonly severity: Severity;
  readonly phase: PhaseName;
  readonly measured: number;
  readonly target: number;
  readonly unit: string;
  readonly summary: string;
}

export interface DrillCard {
  readonly faultCode: string;
  readonly drillName: string;
  readonly markdown: string;
}

export interface KinematicSequence {
  readonly order: readonly string[];
  readonly peakFrames: Record<string, number>;
  readonly sequenceCorrect: boolean;
}

/** Full analysis payload consumed by the UI. */
export interface AnalysisResult {
  readonly alignment: Alignment;
  readonly phases: { readonly user: Phases; readonly pro: Phases };
  readonly kinematicSequence: KinematicSequence;
  readonly deviations: readonly DeviationFrame[];
  readonly faults: readonly Fault[];
  readonly drills: readonly DrillCard[];
  readonly swingIndex: number;
  readonly source: "backend" | "local";
}
