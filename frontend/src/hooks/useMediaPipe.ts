/**
 * SwingAI — MediaPipe Pose Landmarker extraction hook.
 *
 * Loads the WASM runtime + pose model lazily, then extracts a full 33-point
 * landmark time series from an uploaded video file, frame by frame, entirely
 * in the browser. Falls back gracefully (status = "error") when the model
 * CDN is unreachable — the app then keeps running on the bundled demo data.
 */

import { useCallback, useRef, useState } from "react";
import type { Landmark, PoseFrame, SwingSequence } from "../types/pose.ts";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/** Sampling rate for extraction: every video frame at this fps. */
const EXTRACT_FPS = 30;

export type MediaPipeStatus =
  | { state: "idle" }
  | { state: "loading-model" }
  | { state: "extracting"; progress: number }
  | { state: "done"; frames: number }
  | { state: "error"; message: string };

interface PoseLandmarkerLike {
  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): { landmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>> };
  close(): void;
}

export interface UseMediaPipe {
  status: MediaPipeStatus;
  /** Extract the pose time series from a video file. Resolves null on failure. */
  extract: (file: File, leadSide?: "left" | "right") => Promise<SwingSequence | null>;
  cancel: () => void;
}

export function useMediaPipe(): UseMediaPipe {
  const [status, setStatus] = useState<MediaPipeStatus>({ state: "idle" });
  const landmarkerRef = useRef<PoseLandmarkerLike | null>(null);
  const cancelledRef = useRef(false);
  /**
   * MediaPipe's VIDEO running mode requires timestamps to be STRICTLY
   * monotonically increasing across every detectForVideo() call on the same
   * landmarker instance — including across separate extractions. Restarting
   * at 0 for a second video throws "Packet timestamp mismatch on ...
   * norm_rect". This clock only ever moves forward.
   */
  const clockMsRef = useRef(0);

  const loadLandmarker = useCallback(async (): Promise<PoseLandmarkerLike> => {
    if (landmarkerRef.current) return landmarkerRef.current;
    setStatus({ state: "loading-model" });
    const { FilesetResolver, PoseLandmarker } = await import(
      "@mediapipe/tasks-vision"
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    let landmarker: PoseLandmarkerLike;
    try {
      landmarker = (await make("GPU")) as unknown as PoseLandmarkerLike;
    } catch {
      // No usable WebGL context (headless browsers, some VMs) — CPU inference.
      landmarker = (await make("CPU")) as unknown as PoseLandmarkerLike;
    }
    landmarkerRef.current = landmarker;
    return landmarker;
  }, []);

  const extract = useCallback(
    async (
      file: File,
      leadSide: "left" | "right" = "left",
    ): Promise<SwingSequence | null> => {
      cancelledRef.current = false;
      try {
        const landmarker = await loadLandmarker();

        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error("could not decode video"));
        });

        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error("video has no readable duration");
        }
        const step = 1 / EXTRACT_FPS;
        const totalFrames = Math.min(Math.floor(duration / step), 600);
        const frames: PoseFrame[] = [];

        const seekTo = (t: number) =>
          new Promise<void>((resolve, reject) => {
            const onSeek = () => {
              video.removeEventListener("seeked", onSeek);
              resolve();
            };
            video.addEventListener("seeked", onSeek);
            video.onerror = () => reject(new Error("seek failed"));
            video.currentTime = Math.min(t, Math.max(duration - 1e-3, 0));
          });

        // jump the shared clock forward so this extraction's timestamps can
        // never collide with a previous video's
        clockMsRef.current += 1000;

        for (let i = 0; i < totalFrames; i++) {
          if (cancelledRef.current) break;
          await seekTo(i * step);
          clockMsRef.current += step * 1000;
          const result = landmarker.detectForVideo(video, clockMsRef.current);
          const pose = result.landmarks[0];
          if (pose && pose.length === 33) {
            const frame: Landmark[] = pose.map((lm) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 1,
            }));
            frames.push(frame);
          } else if (frames.length > 0) {
            // hold last known pose through brief detection dropouts
            frames.push(frames[frames.length - 1] as PoseFrame);
          }
          if (i % 5 === 0) {
            setStatus({ state: "extracting", progress: i / totalFrames });
          }
        }

        URL.revokeObjectURL(url);
        if (cancelledRef.current || frames.length < 10) {
          setStatus({
            state: "error",
            message:
              frames.length < 10
                ? "No golfer detected — try a clearer, full-body clip."
                : "Extraction cancelled.",
          });
          return null;
        }
        setStatus({ state: "done", frames: frames.length });
        return { fps: EXTRACT_FPS, leadSide, frames };
      } catch (err) {
        // MediaPipe sometimes throws raw strings/objects rather than Errors —
        // surface whatever detail exists instead of a generic message.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "pose extraction failed";
        setStatus({ state: "error", message });
        return null;
      }
    },
    [loadLandmarker],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return { status, extract, cancel };
}
