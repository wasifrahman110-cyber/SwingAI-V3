# SwingAI V4 — V2 Baseline + Research-Grounded Diagnostics & Drill Engine

Computer-vision golf swing analysis: in-browser MediaPipe pose extraction, single-swing or dual-comparison analysis with DTW synchronization, a telestrator annotation layer, kinematic-sequence telemetry, and a drill recommendation engine — in a mobile-style dark UI (deep slate `#0D0D0E`, surfaces `#18181B`, glass-blur floating layers).

## Quick start

Frontend (fully standalone — a bundled synthetic demo swing drives the whole UI with no backend and no uploads):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Backend (optional — the identical pipeline in NumPy/SciPy; auto-detected via the /api proxy, in-browser engine used as fallback):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Engine test suite (24 checks, including the V2 false-positive regressions):

```bash
cd backend
python -m tests.test_engine
```

## V2 math fixes (false-positive elimination)

**Spine-angle retention** now tracks the posture DELTA from the golfer's own address: θ₀ is measured at setup, the series is Δθₜ = |θₜ − θ₀|, and the fault fires only when Δθ at impact exceeds 8°. A tour pro bent 30° over the ball scores ~0 all swing long — the V1 bug scored the raw global angle against vertical and flagged everyone.

**Kinematic sequence** applies Savitzky-Golay smoothing (w=5 on coordinates, w=7 on the velocity series) before temporal derivatives, measures pelvis/thorax rotation in the horizontal plane but the arm/hand assembly in the swing plane, takes each segment's peak as the centroid of its top-30% velocity mass (stable where a raw argmax jitters), evaluates ordering ONLY inside the downswing window (top → impact), and treats peaks within ~2 frames as ties. Result: clean swings analyzed under 3× sensor noise keep a stable verdict — verified in the test suite.

Fault detection is now fully self-contained (no reference swing needed), so SINGLE SWING mode produces the identical fault set, and the solo Swing Index starts at 10 minus severity-weighted penalties. Dual mode keeps the DTW-similarity-based index.



## V4 (built on the V2 baseline)

V4 deliberately drops the V3 launch-monitor/telemetry-sidebar/video-exporter/IndexedDB layer and returns to the V2 baseline (all V2 features intact: telestrator, dual comparison, kinematics chart, journal, studio, progress with localStorage), then extends it with:

**20-rule diagnostic engine** (`src/engine/diagnostics.ts` + `backend/analytics/biomechanics.py`): head sway / early head lift / head dipping, loss of spine angle, reverse spine angle, flat shoulder turn, overswing, lead-shoulder snatch, casting / early release, chicken wing, lead-arm breakdown, flip/scoop at impact (wrist-compression loss), hip slide, early extension, hip stall, premature trail-heel lift, lead-knee collapse, hanging back — plus backswing sway and the kinematic sequence. Every rule is SavGol-filtered, self-referential, and regression-tested to fire zero false positives on clean model swings.

**Structured drill mapping** (`src/engine/drills.ts` + `backend/analytics/drills.py`): every fault maps to a drill object with `title`, step-by-step `description`, `focusKey`, and `recommendedReps` — Head Against Wall, Chair Behind Glutes, Pump Drill, Head Cover Under Armpit, Step-Through Finish, and 15 more. The coaching copy is grounded in published research: force-plate studies showing tour players carry **75–90% of pressure on the lead foot at impact** (98–100% into the finish) while amateurs hang back, and wrist-sensor data showing pros **reduce lead-wrist extension 20–25° from the top to impact** — the flat-to-flexed lead wrist that compresses the ball, versus the cupped-wrist flip.

**UI integration (additive only):** each detected fault carries a body-group tag (Head & Spine / Shoulders & Torso / Arms & Wrists / Hips & Pelvis / Legs & Weight / Sequencing) in the collapsible fix panels, and the drill sheet leads with Focus and Reps chips. The Drill Studio lists the full 20-drill library. Nothing in the V2 player, telestrator, or telemetry formats was altered.

## The player

The header toggles `[ SINGLE SWING ]` / `[ DUAL COMPARISON ]`. Dual mode prompts for a reference — pick from the built-in model-swing library (synthetic, parametric — no licensed footage) or upload any clip — then renders a synchronized split view driven by one rAF loop: your swing left, reference right, reference frame = DTW time-map + a ±30-frame manual offset slider with an **ALIGN IMPACT** button. GHOST overlays the reference skeleton on your pane at adjustable opacity. Playback runs at 0.1× / 0.25× / 0.5× / 1×, with ←/→ frame stepping, Space play/pause, and horizontal swipe scrubbing on the canvas.

**Telestrator** (DRAW chip): freehand pen rendered as a Catmull-Rom spline, straight line with draggable endpoint handles, and a head circle with center/radius handles; five technical swatches (`#FFB800`, `#00E5FF`, `#30D158`, `#FF3B30`, `#FFFFFF`); undo / redo / clear; annotations lock to the frame they were drawn on or persist globally (F/G toggle).

**Telemetry:** an angular-velocity chart under the scrubber shows hip / torso / arm / hand curves with the downswing window shaded, peak markers, sequence verdict, and a tap-to-seek playhead. The scrubber carries auto-extracted keyframe ticks for Address / Top / Downswing / Impact / Finish. The kebab button exports a 1080×1920 telemetry card PNG (Swing Index, max rotary velocity, spine retention, kinematic order, impact-frame skeleton).

## Navigation

Home (dashboard + framework hex map) · **Swing Journal** (feel notes with #tag chips, linked to analyzed sessions) · (+) upload · **Drill Studio** (drills matched to your detected faults, the full drill library, and the reference library with one-tap "Load into Dual Mode") · **Progress** (swing-index trend, fault-frequency bars, and the session library — every analyzed swing auto-saves locally and reloads into the player).

## Layout

```
frontend/src/
  components/SwingCanvas.tsx        unified rAF dual-stream player
  components/TelestratorCanvas.tsx  annotation overlay (pen/line/circle)
  components/TelestratorToolbar.tsx tool rail: swatches, undo/redo, F/G lock
  components/KinematicsChart.tsx    4-series angular-velocity chart
  components/Scrubber.tsx           timeline: heat-strip, phase keyframes
  components/SwingDetailScreen.tsx  player screen (mode selector, controls)
  components/HomeScreen.tsx / SwingJournal.tsx / DrillStudio.tsx / ProgressScreen.tsx
  components/ReferenceModal.tsx / FixList.tsx / DrillSheet.tsx / TabBar.tsx
  hooks/useMediaPipe.ts             pose extraction (monotonic timestamps, GPU→CPU fallback)
  hooks/useSwingAnalysis.ts         solo/dual analysis lifecycle
  lib/engine.ts                     TS mirror of the full analytics pipeline
  lib/vectorMath.ts                 SavGol, Catmull-Rom-ready primitives, dot-product angles
  lib/sessionStore.ts               localStorage sessions + journal
  lib/telemetryCard.ts              1080×1920 social export renderer
  lib/demoData.ts / api.ts / markdown.tsx
backend/
  main.py                           FastAPI /api/analyze (solo + dual)
  analytics/metrics.py              normalization, SavGol, retention delta, kinematics
  analytics/dtw_aligner.py          DTW + phase segmentation
  analytics/drills.py               self-contained fault rules + drill cards
  tests/test_engine.py              24-check suite incl. V2 regressions
```

Notes: the pose model + WASM load from Google's CDN on first upload (network needed for live extraction only); everything else runs offline. Dev server proxies `/api` to `localhost:8000`.
