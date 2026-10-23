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
  setup: "Address",
  top_of_backswing: "Top",
  downswing: "Downswing",
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
  /** Structured drill fields (additive — markdown remains the full card). */
  readonly title?: string;
  readonly description?: string;
  readonly focusKey?: string;
  readonly recommendedReps?: string;
}

export interface KinematicSequence {
  readonly order: readonly string[];
  readonly peakFrames: Record<string, number>;
  readonly sequenceCorrect: boolean;
  /** Downswing evaluation window (frames) and the tie tolerance used. */
  readonly window: { readonly start: number; readonly end: number };
  readonly toleranceFrames: number;
}

export type KinematicSegment = "hips" | "torso" | "arms" | "hands";

export type AnalysisMode = "solo" | "dual";

/** Full analysis payload consumed by the UI. */
export interface AnalysisResult {
  readonly mode: AnalysisMode;
  /** null in solo mode — there is no reference swing to align against. */
  readonly alignment: Alignment | null;
  readonly phases: { readonly user: Phases; readonly pro: Phases | null };
  readonly kinematicSequence: KinematicSequence;
  /** |deg/frame| angular-velocity series per segment (chart + export card). */
  readonly kinematicVelocity: Record<KinematicSegment, readonly number[]>;
  /** |theta_t − theta_setup| spine-posture delta series (degrees). */
  readonly spineDeltaDeg: readonly number[];
  readonly deviations: readonly DeviationFrame[];
  readonly faults: readonly Fault[];
  readonly drills: readonly DrillCard[];
  readonly swingIndex: number;
  readonly source: "backend" | "local";
}

// Telestrator annotations
export interface AnnoPoint {
  readonly x: number; // normalized 0..1 within the player
  readonly y: number;
}

export type Annotation =
  | {
      readonly id: string;
      readonly tool: "pen";
      readonly color: string;
      /** null = global overlay; number = locked to that video frame. */
      readonly frame: number | null;
      readonly points: readonly AnnoPoint[];
    }
  | {
      readonly id: string;
      readonly tool: "line";
      readonly color: string;
      readonly frame: number | null;
      readonly a: AnnoPoint;
      readonly b: AnnoPoint;
    }
  | {
      readonly id: string;
      readonly tool: "circle";
      readonly color: string;
      readonly frame: number | null;
      readonly c: AnnoPoint;
      readonly r: number; // normalized to player width
    };

export type TelestratorTool = Annotation["tool"] | "off";

export const TELESTRATOR_COLORS = [
  "#FFB800", // technical amber
  "#00E5FF", // electric cyan
  "#30D158", // pro green
  "#FF3B30", // crimson accent
  "#FFFFFF", // pure white
] as const;

// Sessions & journal (localStorage persistence)
export interface SessionRecord {
  readonly id: string;
  readonly dateISO: string;
  readonly label: string;
  readonly mode: AnalysisMode;
  readonly swingIndex: number;
  readonly faultCodes: readonly string[];
  /** Stored pose data so the session can be reloaded into the player. */
  readonly swing: SwingSequence;
}

export interface JournalEntry {
  readonly id: string;
  readonly dateISO: string;
  readonly sessionId: string | null;
  readonly text: string;
  readonly tags: readonly string[];
}
