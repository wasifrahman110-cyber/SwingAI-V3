/**
 * SwingDetailScreen (V2) — the analysis player.
 *
 * Header mode selector: [ SINGLE SWING ] vs [ DUAL COMPARISON ].
 * Player: SwingCanvas (+ telestrator overlay), speed chips (0.1–1×),
 * ghost + frame-offset calibration (dual), kinematic velocity chart,
 * Framework Fixes / Bookmarked / All Metrics tabs, telemetry-card export.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisResult,
  Annotation,
  Fault,
  PhaseName,
  SwingSequence,
  TelestratorTool,
} from "../types/pose.ts";
import { TELESTRATOR_COLORS } from "../types/pose.ts";
import { downloadTelemetryCard } from "../lib/telemetryCard.ts";
import { downloadSwingReport } from "../lib/swingReport.ts";
import { normalizeSwing } from "../lib/engine.ts";
import {
  computeImpactMetrics,
  estimateSmashFactor,
  smashBand,
  type ImpactMetrics,
} from "../engine/scoring.ts";
import { DrillSheet } from "./DrillSheet.tsx";
import { FixList } from "./FixList.tsx";
import { KinematicsChart } from "./KinematicsChart.tsx";
import { Scrubber } from "./Scrubber.tsx";
import { SwingCanvas, mappedReferenceFrame } from "./SwingCanvas.tsx";
import { TelestratorCanvas } from "./TelestratorCanvas.tsx";
import { TelestratorToolbar } from "./TelestratorToolbar.tsx";
import { ChevronLeft, Kebab, Pause, Play } from "./icons.tsx";

type Tab = "fixes" | "bookmarked" | "metrics";

const SPEEDS = [0.1, 0.25, 0.5, 1] as const;

interface SwingDetailScreenProps {
  user: SwingSequence;
  reference: SwingSequence | null;
  referenceName: string | null;
  mode: "solo" | "dual";
  analysis: AnalysisResult | null;
  analyzing: boolean;
  isDemo: boolean;
  video: HTMLVideoElement | null;
  referenceVideo: HTMLVideoElement | null;
  initialPhase: PhaseName | null;
  playerName: string;
  dtl: SwingSequence | null;
  dtlVideo: HTMLVideoElement | null;
  onBack: () => void;
  onSetMode: (mode: "solo" | "dual") => void;
  onNeedReference: () => void;
  onNeedDtl: () => void;
}

const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOISY = /^(img|vid|video|mov|image|clip|pxl|dsc|screen[\s_-]?recording)[\s_-]?[\d._-]*$/i;

/**
 * Phone camera rolls hand us names like "04DBC3C2-1271-4EB1-..." or
 * "IMG_4417". Those are not labels a golfer recognises, so fall back to a
 * readable description instead of printing the raw file name.
 */
function prettyClipName(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.replace(/\.[^.]+$/, "").trim();
  if (t === "" || UUIDISH.test(t) || NOISY.test(t) || /^[0-9a-f-]{16,}$/i.test(t)) {
    return "Uploaded clip";
  }
  return t.replace(/[_-]+/g, " ").slice(0, 32);
}

const fmtClock = (): string => {
  const d = new Date();
  return (
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
};

export function SwingDetailScreen({
  user,
  reference,
  referenceName,
  mode,
  analysis,
  analyzing,
  isDemo,
  video,
  referenceVideo,
  initialPhase,
  playerName,
  dtl,
  dtlVideo,
  onBack,
  onSetMode,
  onNeedReference,
  onNeedDtl,
}: SwingDetailScreenProps) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [ghostOn, setGhostOn] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(0.55);
  const [frameOffset, setFrameOffset] = useState(0);
  const [tab, setTab] = useState<Tab>("fixes");
  const [openFault, setOpenFault] = useState<Fault | null>(null);
  const [viewMulti, setViewMulti] = useState(false);
  const [syncImpact, setSyncImpact] = useState(false);
  // Dual frame-scrub: syncPlayheads=true (default) preserves the existing
  // DTW-linked reference-frame behavior exactly. Setting it false lets
  // refFrameOverride drive the reference pane independently of `frame`.
  const [syncPlayheads, setSyncPlayheads] = useState(true);
  const [refFrameOverride, setRefFrameOverride] = useState<number | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set());
  const dateLabel = useRef(fmtClock());

  // telestrator state: history of annotation snapshots for undo/redo
  const [teleTool, setTeleTool] = useState<TelestratorTool>("off");
  const [teleColor, setTeleColor] = useState<string>(TELESTRATOR_COLORS[0]);
  // V4.1: annotations PERSIST across playback by default (Global Overlay).
  // Frame-lock is an explicit opt-in via the F/G toggle — the old default
  // stamped drawings to the frame under the moving playhead, which made them
  // vanish the instant the video advanced.
  const [lockToFrame, setLockToFrame] = useState(false);
  const [history, setHistory] = useState<Annotation[][]>([[]]);
  const [histIdx, setHistIdx] = useState(0);
  const annotations = history[histIdx] ?? [];

  const pushState = useCallback(
    (next: Annotation[]) => {
      setHistory((h) => [...h.slice(0, histIdx + 1), next]);
      setHistIdx((i) => i + 1);
    },
    [histIdx],
  );

  const addAnnotation = useCallback(
    (a: Annotation) => pushState([...annotations, a]),
    [annotations, pushState],
  );
  const replaceAnnotation = useCallback(
    (a: Annotation) => {
      // live handle-drag: update in place without spamming history
      setHistory((h) => {
        const copy = [...h];
        copy[histIdx] = (copy[histIdx] ?? []).map((x) => (x.id === a.id ? a : x));
        return copy;
      });
    },
    [histIdx],
  );

  const T = user.frames.length;

  useEffect(() => {
    if (initialPhase && analysis) {
      setFrame(analysis.phases.user[initialPhase] ?? 0);
      setPlaying(false);
    }
  }, [initialPhase, analysis]);

  // Keep the uploaded videos locked to the playhead. This runs while PLAYING
  // too: the rAF loop advances `frame` every tick, so driving currentTime from
  // the frame index is what makes the real footage move with the skeleton, and
  // is what makes a synced dual comparison show both swings executing at the
  // same time rather than only shifting the ghost overlay.
  useEffect(() => {
    if (video) {
      const t = frame / user.fps;
      if (Math.abs(video.currentTime - t) > 0.02) video.currentTime = t;
    }
    if (referenceVideo && reference) {
      if (syncPlayheads) {
        const refLen = reference.frames.length;
        // DTW map when we have one, proportional map when we do not, so the
        // reference clip still tracks the playhead before analysis lands.
        const mapped = analysis?.alignment
          ? (analysis.alignment.userToPro[frame] ?? 0)
          : Math.round((frame / Math.max(user.frames.length - 1, 1)) * (refLen - 1));
        const rf = Math.max(0, Math.min(refLen - 1, mapped + frameOffset));
        const rt = rf / reference.fps;
        if (Math.abs(referenceVideo.currentTime - rt) > 0.02) referenceVideo.currentTime = rt;
      } else if (refFrameOverride !== null) {
        // independent playhead: reference video follows refFrameOverride, not `frame`
        const rt = refFrameOverride / reference.fps;
        if (Math.abs(referenceVideo.currentTime - rt) > 0.02) referenceVideo.currentTime = rt;
      }
    }
  }, [
    frame,
    playing,
    video,
    referenceVideo,
    reference,
    analysis,
    frameOffset,
    user.fps,
    user.frames.length,
    syncPlayheads,
    refFrameOverride,
  ]);

  const onFrameChange = useCallback((f: number) => setFrame(f), []);
  const onTogglePlay = useCallback(() => setPlaying((p) => !p), []);
  const onScrub = useCallback((f: number) => {
    setPlaying(false);
    setFrame(f);
  }, []);

  const toggleBookmark = useCallback((code: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const alignImpact = useCallback(() => {
    if (!analysis?.alignment || !analysis.phases.pro) return;
    const userImpact = analysis.phases.user.impact;
    const mapped = analysis.alignment.userToPro[userImpact] ?? 0;
    const wanted = analysis.phases.pro.impact;
    setFrameOffset(Math.max(-30, Math.min(30, wanted - mapped)));
  }, [analysis]);

  const switchMode = useCallback(
    (m: "solo" | "dual") => {
      if (m === "dual" && !reference) {
        onNeedReference();
        return;
      }
      onSetMode(m);
    },
    [reference, onNeedReference, onSetMode],
  );

  const dual = mode === "dual" && reference !== null;
  const multi = viewMulti && dtl !== null;
  const annotating = teleTool !== "off";

  // Dual frame-scrub: the reference frame currently in view, whether linked
  // (DTW + frameOffset, existing behavior) or independently overridden.
  const refLength = reference?.frames.length ?? 0;
  const linkedRefFrame = dual ? mappedReferenceFrame(analysis, frame, frameOffset, refLength) : 0;
  const refFrame = syncPlayheads ? linkedRefFrame : (refFrameOverride ?? linkedRefFrame);

  const stepFrame = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrame((f) => Math.max(0, Math.min(T - 1, f + delta)));
    },
    [T],
  );

  const onScrubRef = useCallback(
    (f: number) => {
      setPlaying(false);
      setRefFrameOverride(Math.max(0, Math.min(Math.max(refLength - 1, 0), f)));
    },
    [refLength],
  );

  const stepRefFrame = useCallback(
    (delta: number) => {
      if (syncPlayheads) return; // stepping only applies while independently scrubbing
      setPlaying(false);
      setRefFrameOverride((prev) => {
        const base = prev ?? linkedRefFrame;
        return Math.max(0, Math.min(Math.max(refLength - 1, 0), base + delta));
      });
    },
    [syncPlayheads, linkedRefFrame, refLength],
  );

  const toggleSyncPlayheads = useCallback(() => {
    setSyncPlayheads((v) => {
      const next = !v;
      if (next) setRefFrameOverride(null); // re-linking: drop the stale override
      return next;
    });
  }, []);

  // face-on impact metrics (CoP, shaft lean, hip lead) — memo on analysis
  const impactMetrics: ImpactMetrics | null = useMemo(() => {
    if (!analysis) return null;
    try {
      const norm = normalizeSwing(user);
      return computeImpactMetrics(
        norm.frames as ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>,
        analysis.phases.user.impact,
        analysis.phases.user.setup,
        user.leadSide,
      );
    } catch {
      return null;
    }
  }, [analysis, user]);

  // SYNC IMPACT toggle: auto-derive the offset from detected impact keyframes
  useEffect(() => {
    if (!syncImpact) return;
    if (analysis?.alignment && analysis.phases.pro) {
      const mapped = analysis.alignment.userToPro[analysis.phases.user.impact] ?? 0;
      setFrameOffset(Math.max(-30, Math.min(30, analysis.phases.pro.impact - mapped)));
    } else {
      setFrameOffset(0);
    }
  }, [syncImpact, analysis]);

  // Voice feedback: broadcast ONLY the top 2 highest-severity errors
  useEffect(() => {
    if (!voiceOn || !analysis || analyzing) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const top = analysis.faults.slice(0, 2);
    const text =
      top.length === 0
        ? "Analysis complete. No major faults detected. Elite swing."
        : `Analysis complete. Top focus ${top.length === 1 ? "area" : "areas"}: ` +
          top.map((f) => `${f.name} in the ${f.phase.replace(/_/g, " ")}`).join(", and ") + ".";
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch {
      /* speech unavailable */
    }
  }, [voiceOn, analysis, analyzing]);

  // 🪄 Track Backswing Arc: hand-centroid trajectory address -> top, plus the
  // shaft-plane extension ray, pushed into the PERSISTENT annotation state.
  const trackBackswingArc = useCallback(() => {
    if (!analysis) return;
    const top = analysis.phases.user.top_of_backswing;
    const setup = analysis.phases.user.setup;
    const half = dual || multi ? 0.5 : 1; // split view: face-on pane is the left half
    const handMid = (t: number): { x: number; y: number } | null => {
      const f = user.frames[t];
      if (!f) return null;
      const idx = user.leadSide === "left" ? [17, 19, 21] : [18, 20, 22];
      let x = 0;
      let y = 0;
      for (const i of idx) {
        const lm = f[i];
        if (!lm) return null;
        x += lm.x / 3;
        y += lm.y / 3;
      }
      return { x: x * half, y };
    };
    const pts: Array<{ x: number; y: number }> = [];
    for (let t = setup; t <= Math.min(top, user.frames.length - 1); t++) {
      const pt = handMid(t);
      if (pt) pts.push(pt);
    }
    if (pts.length < 4) return;
    const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const arc: Annotation = {
      id: uid(), tool: "pen", color: "#FF2D95", frame: null, points: pts,
    };
    // shaft-plane ray: address hand position extended along the club direction
    // down to the turf line (lead-ankle height)
    const f0 = user.frames[setup];
    const wrIdx = user.leadSide === "left" ? 15 : 16;
    const ankleIdx = user.leadSide === "left" ? 27 : 28;
    const w0 = f0?.[wrIdx];
    const h0 = handMid(setup);
    const ankle = f0?.[ankleIdx];
    let ray: Annotation | null = null;
    if (w0 && h0 && ankle) {
      const wx = w0.x * half;
      const dirX = h0.x - wx;
      const dirY = h0.y - w0.y;
      const len = Math.hypot(dirX, dirY);
      if (len > 1e-4) {
        const groundY = ankle.y + 0.02;
        const k = (groundY - w0.y) / (dirY || 1e-6);
        const gx = wx + dirX * Math.max(k, 0);
        ray = {
          id: uid(), tool: "line", color: "#FFB800", frame: null,
          a: { x: wx - dirX * 2, y: w0.y - dirY * 2 },
          b: { x: Math.min(Math.max(gx, 0), 1), y: Math.min(groundY, 1) },
        };
      }
    }
    pushState(ray ? [...annotations, arc, ray] : [...annotations, arc]);
    if (teleTool === "off") setTeleTool("pen"); // reveal the toolbar/overlay
  }, [analysis, user, dual, multi, annotations, pushState, teleTool]);

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="back">
          <ChevronLeft />
        </button>
        <div className="mode-selector" role="tablist" aria-label="analysis mode">
          <button
            role="tab"
            aria-selected={mode === "solo" && !viewMulti}
            className={`mode-chip ${mode === "solo" && !viewMulti ? "on" : ""}`}
            onClick={() => {
              setViewMulti(false);
              switchMode("solo");
            }}
          >
            Single
          </button>
          <button
            role="tab"
            aria-selected={mode === "dual" && !viewMulti}
            className={`mode-chip ${mode === "dual" && !viewMulti ? "on" : ""}`}
            onClick={() => {
              setViewMulti(false);
              switchMode("dual");
            }}
          >
            Dual
          </button>
          <button
            role="tab"
            aria-selected={viewMulti}
            className={`mode-chip ${viewMulti ? "on" : ""}`}
            onClick={() => {
              if (!dtl) {
                onNeedDtl();
                return;
              }
              switchMode("solo");
              setViewMulti(true);
            }}
          >
            Multi-angle
          </button>
        </div>
        <button
          className="icon-btn"
          aria-label="export"
          title="Export"
          onClick={() => analysis && setExportMenu((v) => !v)}
        >
          <Kebab />
        </button>
      </div>
      <div className="date-line">{dateLabel.current}</div>

      <div className="player-wrap">
        <SwingCanvas
          user={user}
          reference={reference}
          analysis={analysis}
          mode={mode}
          frame={frame}
          playing={playing}
          speed={speed}
          frameOffset={frameOffset}
          ghostOn={ghostOn}
          ghostOpacity={ghostOpacity}
          video={video}
          referenceVideo={referenceVideo}
          refFrameOverride={syncPlayheads ? null : refFrame}
          interactive={!annotating}
          multiView={viewMulti}
          dtl={dtl}
          dtlVideo={dtlVideo}
          onFrameChange={onFrameChange}
          onTogglePlay={onTogglePlay}
        />
        <TelestratorCanvas
          active={annotating}
          tool={teleTool}
          color={teleColor}
          lockToFrame={lockToFrame}
          frame={frame}
          annotations={annotations}
          onAdd={addAnnotation}
          onReplace={replaceAnnotation}
        />
        {annotating && (
          <TelestratorToolbar
            tool={teleTool}
            color={teleColor}
            lockToFrame={lockToFrame}
            canUndo={histIdx > 0}
            canRedo={histIdx < history.length - 1}
            onTool={setTeleTool}
            onColor={setTeleColor}
            onLockToggle={() => setLockToFrame((v) => !v)}
            onUndo={() => setHistIdx((i) => Math.max(0, i - 1))}
            onRedo={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))}
            onClear={() => pushState([])}
            onTrackArc={trackBackswingArc}
          />
        )}
        <div className="player-hud">
          {dual && (
            <button
              className={`hud-chip ${ghostOn ? "on" : ""}`}
              onClick={() => setGhostOn((g) => !g)}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
            >
              Ghost
            </button>
          )}
          <button
            className={`hud-chip ${annotating ? "on" : ""}`}
            onClick={() => setTeleTool(annotating ? "off" : "pen")}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
          >
            Draw
          </button>
          <span className="hud-chip">{isDemo ? "Demo" : "You"}</span>
        </div>
        {!playing && !annotating && (
          <div className="player-overlay">
            <button className="play-btn" onClick={onTogglePlay} aria-label="play">
              <Play />
            </button>
          </div>
        )}

        {/* Feedback blanket: a thin bar pinned to the top of the frame that
            pulls a translucent fault panel down over the still-playing video. */}
        {analysis && (
          <div className={`feedback-layer ${feedbackOpen ? "open" : ""}`}>
            <button
              className="feedback-bar"
              onClick={() => setFeedbackOpen((v) => !v)}
              aria-expanded={feedbackOpen}
              aria-label={feedbackOpen ? "hide swing feedback" : "show swing feedback"}
            >
              <span className="fb-dot" data-sev={analysis.faults[0]?.severity ?? "clean"} />
              <span className="fb-text">
                {analysis.faults.length === 0
                  ? "No major faults detected"
                  : `${analysis.faults.length} fault${analysis.faults.length > 1 ? "s" : ""} found`}
                {analysis.faults[0] ? ` · ${analysis.faults[0].name}` : ""}
              </span>
              <span className="fb-caret">{feedbackOpen ? "▲" : "▼"}</span>
            </button>
            <div className="feedback-sheet" aria-hidden={!feedbackOpen}>
              {analysis.faults.length === 0 && (
                <p className="fb-empty">Nothing flagged on this swing. Keep that pattern.</p>
              )}
              {analysis.faults.map((f) => (
                <button key={f.code} className="fb-item" onClick={() => setOpenFault(f)}>
                  <span className={`fb-sev sev-${f.severity}`}>{f.severity}</span>
                  <span className="fb-name">{f.name}</span>
                  <span className="fb-phase">{f.phase.replace(/_/g, " ")}</span>
                  <span className="fb-meas">
                    {f.measured}
                    {f.unit === "deg" ? "°" : f.unit === "in" ? '"' : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* In-frame transport (single view), the way a phone video player works */}
        {!dual && !multi && !annotating && (
          <div className="video-transport">
            <button
              className="vt-play"
              onClick={onTogglePlay}
              aria-label={playing ? "pause" : "play"}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <Scrubber totalFrames={T} frame={frame} analysis={analysis} onScrub={onScrub} />
            <span className="vt-time">
              {String(frame).padStart(3, "0")}/{String(T - 1).padStart(3, "0")}
            </span>
            <button
              className={`vt-audio ${voiceOn ? "on" : ""}`}
              onClick={() => {
                setVoiceOn((v) => {
                  if (v && typeof window !== "undefined" && "speechSynthesis" in window) {
                    window.speechSynthesis.cancel();
                  }
                  return !v;
                });
              }}
              title="voice feedback: reads the top 2 faults after analysis"
              aria-label="toggle voice feedback"
            >
              {voiceOn ? "🔊" : "🔇"}
            </button>
          </div>
        )}

        <div className="swing-index-badge">
          <span className="num">{(analysis?.swingIndex ?? 0).toFixed(1)}</span>
          <span className="cap">Swing Index</span>
        </div>
      </div>

      {dual && referenceName && (
        <div className="ref-name-line">vs {prettyClipName(referenceName)}</div>
      )}

      <div className="controls">
        {(dual || multi) && (
          <div className="row">
            <button
              className="icon-btn"
              onClick={onTogglePlay}
              aria-label={playing ? "pause" : "play"}
              style={{ width: 32, height: 32 }}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <Scrubber totalFrames={T} frame={frame} analysis={analysis} onScrub={onScrub} />
            <span className="frame-readout">
              {String(frame).padStart(3, "0")}/{String(T - 1).padStart(3, "0")}
            </span>
          </div>
        )}
        {(dual || multi) && (
          <div className="row">
            <label>Master</label>
            <input
              type="range"
              min={0}
              max={1000}
              value={T > 1 ? Math.round((frame / (T - 1)) * 1000) : 0}
              onChange={(e) => {
                // normalized t in [0,1] drives BOTH streams simultaneously
                const t = Number(e.currentTarget.value) / 1000;
                setPlaying(false);
                setFrame(Math.round(t * (T - 1)));
              }}
              aria-label="master dual-video scrubber"
            />
            {dual && (
              <button
                className={`align-impact ${syncImpact ? "on-sync" : ""}`}
                onClick={() => setSyncImpact((v) => !v)}
                title="auto-derive the frame offset from detected impact keyframes"
              >
                {syncImpact ? "◉ Sync impact" : "○ Sync impact"}
              </button>
            )}
          </div>
        )}
        {dual && (
          <div className="dual-scrub-block">
            <div className="row">
              <label htmlFor="scrub-a">You</label>
              <button
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                onClick={() => stepFrame(-1)}
                aria-label="user swing: step back one frame"
                title="-1 frame"
              >
                ◀
              </button>
              <input
                id="scrub-a"
                type="range"
                min={0}
                max={Math.max(T - 1, 0)}
                step={1}
                value={frame}
                onChange={(e) => {
                  setPlaying(false);
                  setFrame(Number(e.currentTarget.value));
                }}
                aria-label="user swing frame scrubber"
              />
              <button
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                onClick={() => stepFrame(1)}
                aria-label="user swing: step forward one frame"
                title="+1 frame"
              >
                ▶
              </button>
              <span className="frame-readout">{String(frame).padStart(3, "0")}</span>
            </div>
            <div className="row">
              <label htmlFor="scrub-b">Ref</label>
              <button
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                onClick={() => stepRefFrame(-1)}
                disabled={syncPlayheads}
                aria-label="reference swing: step back one frame"
                title="-1 frame"
              >
                ◀
              </button>
              <input
                id="scrub-b"
                type="range"
                min={0}
                max={Math.max(refLength - 1, 0)}
                step={1}
                value={refFrame}
                onChange={(e) => onScrubRef(Number(e.currentTarget.value))}
                disabled={syncPlayheads}
                aria-label="reference swing frame scrubber"
                title={
                  syncPlayheads
                    ? "turn off Sync Playheads to scrub the reference swing independently"
                    : undefined
                }
              />
              <button
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                onClick={() => stepRefFrame(1)}
                disabled={syncPlayheads}
                aria-label="reference swing: step forward one frame"
                title="+1 frame"
              >
                ▶
              </button>
              <span className="frame-readout">{String(refFrame).padStart(3, "0")}</span>
              <button
                className={`align-impact ${syncPlayheads ? "on-sync" : ""}`}
                onClick={toggleSyncPlayheads}
                title={
                  syncPlayheads
                    ? "playheads are linked (DTW-mapped) — click to scrub independently"
                    : "playheads are independent — click to re-link to the user swing"
                }
              >
                {syncPlayheads ? "◉ Linked" : "○ Independent"}
              </button>
            </div>
          </div>
        )}
        <div className="row">
          <label>Speed</label>
          <div className="speed-chips">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`speed-chip ${speed === s ? "on" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
            {(dual || multi) && (
              <button
                className={`speed-chip ${voiceOn ? "on" : ""}`}
                onClick={() => {
                  setVoiceOn((v) => {
                    if (v && typeof window !== "undefined" && "speechSynthesis" in window) {
                      window.speechSynthesis.cancel();
                    }
                    return !v;
                  });
                }}
                title="voice feedback: reads the top 2 errors after analysis"
                aria-label="toggle voice feedback"
              >
                {voiceOn ? "🔊" : "🔇"}
              </button>
            )}
          </div>
          {dual && (
            <>
              <label htmlFor="ghost-op" style={{ marginLeft: "auto" }}>
                Ghost
              </label>
              <input
                id="ghost-op"
                type="range"
                min={0}
                max={100}
                style={{ maxWidth: 90 }}
                value={Math.round(ghostOpacity * 100)}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value) / 100;
                  setGhostOpacity(v);
                  if (v > 0 && !ghostOn) setGhostOn(true);
                }}
                aria-label="ghost overlay opacity"
              />
            </>
          )}
        </div>
        {dual && (
          <div className="row">
            <label htmlFor="frame-offset">Offset</label>
            <input
              id="frame-offset"
              type="range"
              min={-30}
              max={30}
              value={frameOffset}
              onChange={(e) => setFrameOffset(Number(e.currentTarget.value))}
              aria-label="reference frame offset"
            />
            <span className="frame-readout">
              {frameOffset >= 0 ? "+" : ""}
              {frameOffset}f
            </span>
            <button className="align-impact" onClick={alignImpact}>
              Align impact
            </button>
          </div>
        )}
      </div>

      {analysis && (
        <KinematicsChart
          analysis={analysis}
          fps={user.fps}
          frame={frame}
          totalFrames={T}
          onSeek={onScrub}
        />
      )}

      {analysis && impactMetrics && <CopSmashCard analysis={analysis} metrics={impactMetrics} />}

      <div className="tabs" role="tablist">
        {(
          [
            ["fixes", "Framework Fixes"],
            ["bookmarked", "Bookmarked"],
            ["metrics", "All Metrics"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {analyzing && !analysis && <div className="loading-shimmer">ANALYZING SWING…</div>}

      {analysis && (tab === "fixes" || tab === "bookmarked") && (
        <FixList
          analysis={analysis}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          onOpenFault={setOpenFault}
          filterBookmarked={tab === "bookmarked"}
          openPhase={initialPhase}
        />
      )}

      {analysis && tab === "metrics" && <MetricsTable analysis={analysis} frame={frame} />}

      {exportMenu && analysis && (
        <>
          <div className="sheet-backdrop" onClick={() => setExportMenu(false)} />
          <div className="upload-menu" role="menu" aria-label="export options">
            <div className="grabber" />
            <button
              className="upload-option"
              onClick={() => {
                setExportMenu(false);
                downloadSwingReport(user, analysis, playerName);
              }}
            >
              <span className="uo-title">Coaching Report</span>
              <span className="uo-sub">
                Swing Index, every fault with your measurement against tolerance, and the
                drill steps to fix each one. Opens in any browser, prints to PDF.
              </span>
            </button>
            <button
              className="upload-option"
              onClick={() => {
                setExportMenu(false);
                downloadTelemetryCard(user, analysis, playerName);
              }}
            >
              <span className="uo-title">Telemetry Card (PNG)</span>
              <span className="uo-sub">
                The shareable score card with your skeleton snapshot and phase strip.
              </span>
            </button>
          </div>
        </>
      )}

      {openFault && analysis && (
        <DrillSheet fault={openFault} analysis={analysis} onClose={() => setOpenFault(null)} />
      )}
    </div>
  );
}

/** V5 metric card: CoP load bar + smash-factor estimate, below the errors. */
function CopSmashCard({
  analysis,
  metrics,
}: {
  analysis: AnalysisResult;
  metrics: ImpactMetrics;
}) {
  const smash = estimateSmashFactor(analysis.faults);
  const band = smashBand(smash);
  const bandColor = band === "elite" ? "#30D158" : band === "solid" ? "#FFB800" : "#FF3B30";
  return (
    <section className="line-section cop-card" aria-label="impact load and smash factor">
      <div className="cop-head">
        <span>IMPACT LOAD (CoP est.)</span>
        <span className="cop-smash" style={{ color: bandColor }}>
          SMASH {smash.toFixed(2)}
          <span className="cop-smash-band"> {band === "elite" ? "ELITE" : band === "solid" ? "OK" : "LEAK"} · est</span>
        </span>
      </div>
      <div className="cop-bar" role="img"
        aria-label={`lead ${metrics.cop.leadPct} percent, trail ${metrics.cop.trailPct} percent`}>
        <div className="cop-bar-lead" style={{ width: `${metrics.cop.leadPct}%` }} />
      </div>
      <div className="cop-labels">
        <span>Lead: {metrics.cop.leadPct}%</span>
        <span className="cop-target">tour: 75–90% lead at impact</span>
        <span>Trail: {metrics.cop.trailPct}%</span>
      </div>
      <div className="cop-extra">
        <span>
          Shaft lean:{" "}
          {metrics.shaftLeanDeg === null
            ? "n/a (hands unresolved)"
            : `${metrics.shaftLeanDeg > 0 ? "+" : ""}${metrics.shaftLeanDeg}° ${
                metrics.shaftLeanDeg >= 5 && metrics.shaftLeanDeg <= 12 ? "✓ compressed" : "(target 5–12°)"
              }`}
        </span>
        <span>Hip lead: {metrics.hipLeadIn > 0 ? "+" : ""}{metrics.hipLeadIn} in</span>
      </div>
    </section>
  );
}

function MetricsTable({ analysis, frame }: { analysis: AnalysisResult; frame: number }) {
  const dev =
    analysis.deviations.find((d) => d.userFrame === frame) ??
    (analysis.deviations.length > 0
      ? analysis.deviations[Math.min(frame, analysis.deviations.length - 1)]
      : undefined);
  const seq = analysis.kinematicSequence;
  const spineDelta = analysis.spineDeltaDeg[Math.min(frame, analysis.spineDeltaDeg.length - 1)] ?? 0;

  const cls = (v: number, warn: number, bad: number): string =>
    Math.abs(v) > bad ? "bad" : Math.abs(v) > warn ? "warn" : "ok";

  return (
    <section className="line-section" aria-label="all metrics">
      <div className="metric-row">
        <span className="k">Spine Δ from address (this frame)</span>
        <span className={`v ${cls(spineDelta, 4, 8)}`}>{spineDelta.toFixed(1)}°</span>
      </div>
      <div className="metric-row">
        <span className="k">Kinematic sequence</span>
        <span className={`v ${seq.sequenceCorrect ? "ok" : "bad"}`}>
          {Object.entries(seq.peakFrames)
            .sort((a, b) => a[1] - b[1])
            .map(([k]) => k)
            .join(" → ")}
        </span>
      </div>
      <div className="metric-row">
        <span className="k">Downswing window · tie tolerance</span>
        <span className="v">
          #{seq.window.start}–{seq.window.end} · ±{seq.toleranceFrames}f
        </span>
      </div>
      {analysis.alignment && (
        <>
          <div className="metric-row">
            <span className="k">DTW mapped reference frame</span>
            <span className="v">
              #{frame} → #{analysis.alignment.userToPro[frame] ?? 0}
            </span>
          </div>
          <div className="metric-row">
            <span className="k">Alignment cost (normalized)</span>
            <span className="v">{analysis.alignment.normalizedCost.toFixed(3)}</span>
          </div>
        </>
      )}
      {dev && (
        <>
          <div className="metric-row">
            <span className="k">Spine retention Δ vs reference</span>
            <span className={`v ${cls(dev.spineAngleDelta, 4, 8)}`}>
              {dev.spineAngleDelta >= 0 ? "+" : ""}
              {dev.spineAngleDelta.toFixed(1)}°
            </span>
          </div>
          <div className="metric-row">
            <span className="k">Lead-arm extension Δ</span>
            <span
              className={`v ${dev.leadArmDelta < -20 ? "bad" : dev.leadArmDelta < -10 ? "warn" : "ok"}`}
            >
              {dev.leadArmDelta >= 0 ? "+" : ""}
              {dev.leadArmDelta.toFixed(1)}°
            </span>
          </div>
          <div className="metric-row">
            <span className="k">Hip sway Δ (height units)</span>
            <span className={`v ${cls(dev.hipSwayDelta, 0.03, 0.055)}`}>
              {dev.hipSwayDelta >= 0 ? "+" : ""}
              {dev.hipSwayDelta.toFixed(3)}
            </span>
          </div>
        </>
      )}
      {(["setup", "top_of_backswing", "downswing", "impact", "follow_through"] as const).map(
        (p) => (
          <div className="metric-row" key={p}>
            <span className="k">Phase · {p.replace(/_/g, " ")}</span>
            <span className="v">
              you #{analysis.phases.user[p]}
              {analysis.phases.pro ? ` · ref #${analysis.phases.pro[p]}` : ""}
            </span>
          </div>
        ),
      )}
    </section>
  );
}
