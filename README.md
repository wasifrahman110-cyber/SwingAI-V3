# SwingAI

A computer-vision golf swing analyzer that turns a single phone-camera video into a full biomechanical breakdown: 17 rule-based fault checks, drill recommendations grounded in published swing research, a synchronized dual-swing comparison player, and a freehand telestrator — all running client-side in the browser, with an optional FastAPI service that mirrors the exact same analysis pipeline in NumPy/SciPy.

No footage ever has to leave the device: pose extraction, smoothing, kinematics, and fault detection all run in-browser by default, and the app keeps working with zero network access after the pose model is cached.

 System architecture

```
Video upload
     │
     ▼
MediaPipe Pose Landmarker (BlazePose-lite, WASM)   — hooks/useMediaPipe.ts
  33 landmarks/frame · GPU delegate w/ automatic CPU fallback
     │
     ▼
Height-normalization                                — lib/engine.ts / analytics/metrics.py
  scale by median torso+limb length, re-center on the setup-frame pelvis,
  flip Y so +y = up
     │
     ▼
Savitzky-Golay smoothing (window 5 / 7)             — lib/vectorMath.ts / analytics/metrics.py
  suppresses frame-to-frame landmark jitter without flattening real
  velocity peaks the way a moving average does
     │
     ▼
Kinematic vector geometry                           — lib/engine.ts / analytics/metrics.py
  joint angles via θ = arccos(u·v / |u||v|), signed wrist-cock angle,
  per-segment angular velocity (hips → torso → arms → hands)
     │
     ├──► 17-rule fault detector (self-referential)  — engine/diagnostics.ts / analytics/biomechanics.py
     │      each rule compares the golfer against their OWN address posture,
     │      never a reference swing — works identically in solo mode
     │
     ├──► Dynamic Time Warping (dual mode only)      — lib/engine.ts / analytics/dtw_aligner.py
     │      O(N·M) DP with a Sakoe-Chiba band, aligns two swings recorded
     │      at different tempos frame-for-frame
     │
     └──► Canvas-based swing player + telestrator    — components/SwingCanvas.tsx,
            rAF-driven skeleton overlay, freehand/line/circle annotations   TelestratorCanvas.tsx
```

The frontend (`lib/engine.ts`) and backend (`backend/analytics/`) are independent, line-for-line ports of the same math — the app calls the FastAPI service when it's reachable and transparently falls back to the in-browser engine otherwise (`lib/api.ts`), so the UI behaves identically either way.

## Key technical features

**Biomechanical fault diagnostics (17 rules, 5 body groups).** Head & spine (sway, early lift, dip, spine-angle retention), shoulders & torso (reverse spine angle, overswing, lead-shoulder snatch), arms & wrists (casting/early release, chicken wing, flip/scoop), hips & pelvis (hip slide, early extension, hip stall), and legs & weight (trail-heel lift, lead-knee collapse) — plus backswing sway and kinematic-sequence ordering. Every rule runs on SavGol-smoothed series and is regression-tested to stay silent on a clean model swing; casting and flip/scoop are additionally gated on resolved hand landmarks so noisy tracking can never fire a false positive.

**Dynamic Time Warping for dual comparison.** A from-scratch NumPy DTW implementation (no external DTW dependency) non-linearly warps the user's swing timeline onto a reference swing so "top of backswing" lines up with "top of backswing" regardless of tempo, then reports a per-frame deviation matrix (spine angle, lead-arm extension, hip sway/thrust/rotation) with the joints to highlight.

**Camera-derived impact metrics.** Forward shaft lean, a center-of-pressure estimate (proxy from pelvis position relative to the ankles, not force plates), and a smash-factor heuristic derived from the detected faults — clearly labeled as estimates in the UI, since there's no ball tracking.

**Local-first persistence.** Every analyzed swing and journal entry is saved to `localStorage` and reloads straight into the player — no account, no server database.

**Dual-video synchronization.** Upload a second, down-the-line clip of the same swing and the player renders face-on + DTL side by side on one synchronized timeline, with an auto-derived or manually offset impact alignment.

**Freehand telestrator.** Pen (Catmull-Rom spline through sampled points), line, and circle annotation tools with draggable handles; drawings persist across scrubbing and playback and can lock to a single frame or stay global.

## Engineering focus

- **Client-side inference, zero mandatory backend.** The FastAPI service exists to run the identical analysis pipeline server-side (useful for batch processing or a future mobile client), but the product works fully offline in the browser after the first model download.
- **One math pipeline, two runtimes.** Normalization, Savitzky-Golay smoothing, joint-angle geometry, DTW, and all 17 fault rules are implemented twice — once in TypeScript, once in NumPy — deliberately kept in lockstep so a fix in one is a fix in both.
- **Self-referential fault detection.** Faults are computed entirely from a golfer's own address posture and published biomechanical tolerances. This means single-swing mode produces the exact same diagnostics as dual mode; no reference swing is required to get a real analysis.
- **Regression-tested against false positives.** The backend test suite (`backend/tests/test_engine.py`) asserts that a clean tour-benchmark swing trips zero of the 17 rules, and specifically regression-tests edge cases like unresolved hand landmarks and 3× injected sensor noise, since a diagnostic tool that cries wolf is worse than no tool at all.

## Project layout

```
frontend/src/
  components/SwingCanvas.tsx        rAF-driven dual-stream player
  components/TelestratorCanvas.tsx  annotation overlay (pen / line / circle)
  components/TelestratorToolbar.tsx tool rail: swatches, undo/redo, lock toggle
  components/KinematicsChart.tsx    angular-velocity chart (hips/torso/arms/hands)
  components/Scrubber.tsx           timeline with phase keyframes
  components/SwingDetailScreen.tsx  player screen (mode selector, controls)
  components/HomeScreen.tsx / SwingJournal.tsx / DrillStudio.tsx / ProgressScreen.tsx
  engine/diagnostics.ts             17-rule fault detector
  engine/drills.ts                  drill + pro-model-reference library
  engine/scoring.ts                 Swing Index + impact-metric estimates
  hooks/useMediaPipe.ts             pose extraction (monotonic timestamps, GPU→CPU fallback)
  hooks/useSwingAnalysis.ts         solo/dual analysis lifecycle
  lib/engine.ts                     normalization, kinematics, DTW, phase segmentation
  lib/vectorMath.ts                 3-D vector math + Savitzky-Golay primitives
  lib/sessionStore.ts               localStorage sessions + journal
  lib/api.ts                        backend client with local-engine fallback
backend/
  main.py                           FastAPI /api/analyze (solo + dual)
  analytics/metrics.py              normalization, SavGol, kinematics (NumPy mirror)
  analytics/dtw_aligner.py          DTW + phase segmentation
  analytics/biomechanics.py         the 17 fault rules
  analytics/drills.py               drill card generation
  tests/test_engine.py              regression suite for the analytics pipeline
```

## Setup

**Frontend** (fully standalone — a bundled synthetic demo swing drives the whole UI with no backend and no uploads):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

**Backend** (optional — the identical pipeline in NumPy/SciPy; the frontend auto-detects it via the `/api` proxy and falls back to the in-browser engine if it's unreachable):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Analytics test suite:**

```bash
cd backend
python -m tests.test_engine
```

**Type-check the frontend:**

```bash
cd frontend
npm run typecheck    # or: npm run build (typecheck + vite build)
```

## Notes

- The MediaPipe pose model and WASM runtime load from a CDN on first video upload; every other feature (demo data, journal, drills, telestrator, previously analyzed sessions) runs fully offline.
- The dev server proxies `/api` to `localhost:8000`, so both pieces can run side by side with no CORS configuration needed in development.
- Reference/model swings used for comparison are synthetically generated (`lib/demoData.ts`) — no licensed footage is bundled with the app.
