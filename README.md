# SwingAI — Golf Motion Analytics Engine

Computer-vision golf swing analysis: in-browser MediaPipe pose extraction, Dynamic Time Warping alignment against a professional baseline, a deviation-detection matrix, and a rules-based drill recommendation engine — wrapped in a mobile-style dark UI (graphite + muted sage) modeled on premium sports-telemetry apps.

## Quick start

Frontend (works fully standalone — a bundled synthetic demo swing pair drives the whole UI even with no backend and no uploads):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Backend (optional — the exact same pipeline in NumPy; the frontend auto-detects it via the /api proxy and falls back to the in-browser engine when absent):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Run the engine test suite:

```bash
cd backend
python -m tests.test_engine
```

## Using the app

The **Home** screen shows the performance dashboard: Swing Index (0–10, DTW similarity minus fault penalties), swings analyzed, the weekly Framework Score chart with your goal line, and the honeycomb framework map — the phase with the worst active fault is marked **Focus Fix**; tap any hex to jump to that checkpoint in the player.

The **swing detail** screen is the player: canvas-rendered skeleton over the footage (or the procedural range backdrop for the demo swing), with the pro's DTW-time-mapped **ghost** skeleton overlaid at adjustable opacity, a trailing lead-wrist swing-plane arc, and joints tinted **amber/red** when a deviation exceeds threshold. Scrub with the timeline (deviation heat-strip + phase ticks), or frame-step with **← / →**; **Space** toggles play. Fixes are grouped into collapsible *Line N* sections per swing phase; tapping one opens the typeset drill card with target-vs-actual parameters. The **(+)** button opens the upload menu with two options: **Analyze My Swing** (your footage becomes the analyzed swing on the player) and **Set Pro Baseline** (a professional's swing replaces the bundled model — the ghost overlay, DTW alignment, and every deviation metric then compare against it). Either way, MediaPipe Pose Landmarker extracts a 33-point series at 30 fps entirely client-side, then the analysis pipeline re-runs. The HUD chips on the player show which sources are active (DEMO/YOUR SWING · PRO: MODEL/CUSTOM).

## How the analysis works

**Normalization** (`backend/analytics/metrics.py`, `frontend/src/lib/engine.ts`): coordinates are scaled by an estimated player height (ankles→hips→shoulders→head chain, median over frames) and anchored to the *setup-frame* pelvis center — deliberately not the per-frame pelvis, which would erase sway and early extension. Y is flipped so +y is up.

**Metrics**: every angle uses θ = arccos((u·v)/(|u||v|)). Spine angle is the trunk vector vs the ground plane; lead-arm extension is the elbow interior angle; hip sway/thrust are lateral/depth pelvis displacement; hip and shoulder rotation are the body-line angles unwrapped in the horizontal plane; the kinematic sequence checks the peak angular-velocity ordering hips → torso → arms → hands.

**DTW** (`dtw_aligner.py`): exact O(N·M) dynamic programming over z-scored 6-feature frame embeddings with a Sakoe–Chiba band, yielding the warp path and monotonic user↔pro frame maps that the ghost overlay and side-by-side sync use. The five phase checkpoints (setup / top / downswing / impact / follow-through) are segmented from the lead-wrist trajectory and cross-checked against the DTW mapping.

**Faults → drills** (`drills.py`): early extension → Chair Drill; chicken wing → Glove Under Armpit; sway → Crossed-Arms Stance Pivot; spine-angle loss → Head-on-Wall; broken kinematic sequence → Step-Change-of-Direction. Each card carries explicit target parameters ("Target ≤ 2.5 in · Yours 4.8 in").

## Layout

```
frontend/src/
  components/SwingCanvas.tsx     rAF canvas player: skeleton, ghost, trail, flags
  components/Scrubber.tsx        canvas timeline: heat-strip, phase ticks, playhead
  components/FrameworkScoreChart.tsx / HexMap.tsx / FixList.tsx / DrillSheet.tsx
  components/HomeScreen.tsx / SwingDetailScreen.tsx / TabBar.tsx
  hooks/useMediaPipe.ts          MediaPipe Pose Landmarker extraction
  hooks/useSwingAnalysis.ts      analysis lifecycle (backend-first, local fallback)
  lib/engine.ts                  TS mirror of the full analytics pipeline
  lib/vectorMath.ts / demoData.ts / api.ts / markdown.tsx
backend/
  main.py                        FastAPI /api/analyze
  analytics/metrics.py           normalization + vector math + deviation matrix
  analytics/dtw_aligner.py       DTW + phase segmentation
  analytics/drills.py            fault rules + drill cards
  tests/test_engine.py           synthetic-swing test suite
```

Notes: the pose model and WASM runtime load from Google's CDN on first upload (network required for live extraction only); the demo pipeline is fully offline. The frontend dev server proxies `/api` to `localhost:8000`.
