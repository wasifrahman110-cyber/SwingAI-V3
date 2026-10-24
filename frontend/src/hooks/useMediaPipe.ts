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

/** Where the downloaded .task model is kept between visits. */
const MODEL_CACHE = "swingai-pose-model-v1";
/**
 * How long to let the GPU delegate initialise before falling back to CPU.
 * Mobile Safari can leave that call pending indefinitely rather than
 * rejecting, so the fallback cannot rely on catching a thrown error alone.
 */
const GPU_INIT_TIMEOUT_MS = 15_000;
/** Ceiling on the whole load so a stalled network surfaces instead of hanging. */
const MODEL_LOAD_TIMEOUT_MS = 180_000;
/** Ceiling on one video seek; iOS sometimes never fires "seeked". */
const SEEK_TIMEOUT_MS = 15_000;
/** Ceiling on getting the clip decodable at all. */
const VIDEO_READY_TIMEOUT_MS = 30_000;

export type MediaPipeStatus =
  | { state: "idle" }
  | { state: "loading-model"; progress: number | null }
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

/** Reject with `message` if `work` has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Fetch the model ourselves instead of handing MediaPipe a URL.
 *
 * The runtime and the model together are a ~15 MB cold download, which on a
 * phone over mobile data can take a minute or more. Streaming it here gives
 * the UI a real percentage instead of a static label that is indistinguishable
 * from a dead connection, and keeping the bytes in the Cache API makes every
 * later visit instant. Degrades to a plain buffered read wherever streaming or
 * Cache Storage is missing (older Safari, private browsing).
 */
async function loadModelBytes(
  onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
  try {
    const cached = await (await caches.open(MODEL_CACHE)).match(MODEL_URL);
    if (cached) {
      onProgress(1);
      return new Uint8Array(await cached.arrayBuffer());
    }
  } catch {
    // Cache Storage unavailable — download directly.
  }

  const resp = await fetch(MODEL_URL);
  if (!resp.ok) throw new Error(`pose model download failed (HTTP ${resp.status})`);

  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body?.getReader();

  let bytes: Uint8Array;
  if (!reader) {
    bytes = new Uint8Array(await resp.arrayBuffer());
  } else {
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress(received / total);
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }

  try {
    await (await caches.open(MODEL_CACHE)).put(
      MODEL_URL,
      new Response(bytes.buffer as ArrayBuffer),
    );
  } catch {
    // Not cacheable here; this visit still has the bytes.
  }
  return bytes;
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
    setStatus({ state: "loading-model", progress: null });

    const load = (async (): Promise<PoseLandmarkerLike> => {
      const { FilesetResolver, PoseLandmarker } = await import(
        "@mediapipe/tasks-vision"
      );
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const modelBytes = await loadModelBytes((fraction) =>
        setStatus({ state: "loading-model", progress: Math.min(1, fraction) }),
      );
      const make = (delegate: "GPU" | "CPU") =>
        PoseLandmarker.createFromOptions(fileset, {
          // a fresh view each attempt: the underlying buffer may be
          // transferred into the worker by the first call
          baseOptions: { modelAssetBuffer: new Uint8Array(modelBytes), delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return (await withTimeout(
          make("GPU"),
          GPU_INIT_TIMEOUT_MS,
          "gpu delegate did not initialise",
        )) as unknown as PoseLandmarkerLike;
      } catch {
        // No usable WebGL context, or initialisation stalled (headless
        // browsers, some VMs, mobile Safari) — CPU inference.
        return (await make("CPU")) as unknown as PoseLandmarkerLike;
      }
    })();

    const landmarker = await withTimeout(
      load,
      MODEL_LOAD_TIMEOUT_MS,
      "Pose model did not finish loading. Check your connection and try again.",
    );
    landmarkerRef.current = landmarker;
    return landmarker;
  }, []);

  const extract = useCallback(
    async (
      file: File,
      leadSide: "left" | "right" = "left",
    ): Promise<SwingSequence | null> => {
      cancelledRef.current = false;
      let cleanup: (() => void) | null = null;
      try {
        const landmarker = await loadLandmarker();

        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        /*
         * iOS refuses to decode a <video> that is not in the document, and
         * treats display:none as not renderable, so the element has to be
         * present and merely invisible.
         */
        video.setAttribute("aria-hidden", "true");
        video.style.cssText =
          "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(video);
        video.src = url;
        cleanup = () => {
          video.pause();
          video.removeAttribute("src");
          video.load();
          video.remove();
          URL.revokeObjectURL(url);
        };
        video.load();

        // Metadata alone is not enough to seek against: wait for actual frame
        // data (HAVE_CURRENT_DATA) before touching currentTime.
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            if (video.readyState >= 2) {
              resolve();
              return;
            }
            video.addEventListener("loadeddata", () => resolve(), { once: true });
            video.addEventListener(
              "error",
              () => reject(new Error("could not decode video")),
              { once: true },
            );
          }),
          VIDEO_READY_TIMEOUT_MS,
          "could not read that video — try re-saving or trimming it",
        );

        // Priming the decoder with a muted play/pause makes seeking reliable
        // on mobile Safari. Refusal is harmless, so the failure is ignored.
        try {
          await video.play();
          video.pause();
        } catch {
          // autoplay blocked — seeking generally still works
        }

        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error("video has no readable duration");
        }
        const step = 1 / EXTRACT_FPS;
        const totalFrames = Math.min(Math.floor(duration / step), 600);
        const frames: PoseFrame[] = [];

        const seekTo = (t: number) =>
          new Promise<void>((resolve, reject) => {
            const target = Math.min(t, Math.max(duration - 1e-3, 0));
            /*
             * Assigning the time the clip is already parked at is a no-op, and
             * Safari fires no "seeked" for a seek it never performed. The loop
             * below starts at t=0 on a video already at 0, so it sat waiting
             * for an event that was never coming. Chrome happens to fire one
             * anyway, which is why this only ever failed on a phone.
             */
            if (
              video.readyState >= 2 &&
              Math.abs(video.currentTime - target) < step / 2
            ) {
              resolve();
              return;
            }

            let guard: ReturnType<typeof setTimeout> | undefined;
            let poll: ReturnType<typeof setInterval> | undefined;
            const finish = (err?: Error) => {
              clearTimeout(guard);
              if (poll !== undefined) clearInterval(poll);
              video.removeEventListener("seeked", onSeek);
              video.removeEventListener("error", onError);
              if (err) reject(err);
              else resolve();
            };
            const onSeek = () => finish();
            const onError = () => finish(new Error("seek failed"));

            video.addEventListener("seeked", onSeek);
            video.addEventListener("error", onError);
            // Safari also drops "seeked" outright on some clips, so watching
            // the clock settle is the backstop.
            poll = setInterval(() => {
              if (
                !video.seeking &&
                video.readyState >= 2 &&
                Math.abs(video.currentTime - target) < step
              ) {
                finish();
              }
            }, 60);
            guard = setTimeout(
              () =>
                finish(
                  new Error("timed out reading the video — try a shorter clip"),
                ),
              SEEK_TIMEOUT_MS,
            );
            video.currentTime = target;
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

        cleanup();
        cleanup = null;
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
        cleanup?.();
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
