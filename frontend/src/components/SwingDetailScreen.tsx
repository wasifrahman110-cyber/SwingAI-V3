/**
 * SwingDetailScreen (V2) — the analysis player.
 *
 * Header mode selector: [ SINGLE SWING ] vs [ DUAL COMPARISON ].
 * Player: SwingCanvas (+ telestrator overlay), speed chips (0.1–1×),
 * ghost + frame-offset calibration (dual), kinematic velocity chart,
 * Framework Fixes / Bookmarked / All Metrics tabs, telemetry-card export.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
import { DrillSheet } from "./DrillSheet.tsx";
import { FixList } from "./FixList.tsx";
import { KinematicsChart } from "./KinematicsChart.tsx";
import { Scrubber } from "./Scrubber.tsx";
import { SwingCanvas } from "./SwingCanvas.tsx";
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
  onBack: () => void;
  onSetMode: (mode: "solo" | "dual") => void;
  onNeedReference: () => void;
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
  onBack,
  onSetMode,
  onNeedReference,
}: SwingDetailScreenProps) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [ghostOn, setGhostOn] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(0.55);
  const [frameOffset, setFrameOffset] = useState(0);
  const [tab, setTab] = useState<Tab>("fixes");
  const [openFault, setOpenFault] = useState<Fault | null>(null);
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set());
  const dateLabel = useRef(fmtClock());

  // telestrator state: history of annotation snapshots for undo/redo
  const [teleTool, setTeleTool] = useState<TelestratorTool>("off");
  const [teleColor, setTeleColor] = useState<string>(TELESTRATOR_COLORS[0]);
  const [lockToFrame, setLockToFrame] = useState(true);
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

  // keep uploaded videos in sync with the playhead
  useEffect(() => {
    if (video && !playing) {
      const t = frame / user.fps;
      if (Math.abs(video.currentTime - t) > 0.02) video.currentTime = t;
    }
    if (referenceVideo && reference && !playing && analysis?.alignment) {
      const rf = Math.max(
        0,
        Math.min(
          reference.frames.length - 1,
          (analysis.alignment.userToPro[frame] ?? 0) + frameOffset,
        ),
      );
      const rt = rf / reference.fps;
      if (Math.abs(referenceVideo.currentTime - rt) > 0.02) referenceVideo.currentTime = rt;
    }
  }, [frame, playing, video, referenceVideo, reference, analysis, frameOffset, user.fps]);

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
  const annotating = teleTool !== "off";

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="back">
          <ChevronLeft />
        </button>
        <div className="mode-selector" role="tablist" aria-label="analysis mode">
          <button
            role="tab"
            aria-selected={mode === "solo"}
            className={`mode-chip ${mode === "solo" ? "on" : ""}`}
            onClick={() => switchMode("solo")}
          >
            SINGLE SWING
          </button>
          <button
            role="tab"
            aria-selected={mode === "dual"}
            className={`mode-chip ${mode === "dual" ? "on" : ""}`}
            onClick={() => switchMode("dual")}
          >
            DUAL COMPARISON
          </button>
        </div>
        <button
          className="icon-btn"
          aria-label="export telemetry card"
          title="Export telemetry card"
          onClick={() => analysis && downloadTelemetryCard(user, analysis, playerName)}
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
          interactive={!annotating}
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
          />
        )}
        <div className="player-hud">
          {dual && (
            <button
              className={`hud-chip ${ghostOn ? "on" : ""}`}
              onClick={() => setGhostOn((g) => !g)}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
            >
              GHOST
            </button>
          )}
          <button
            className={`hud-chip ${annotating ? "on" : ""}`}
            onClick={() => setTeleTool(annotating ? "off" : "pen")}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
          >
            DRAW
          </button>
          <span className="hud-chip">{isDemo ? "DEMO" : "YOU"}</span>
        </div>
        {!playing && !annotating && (
          <div className="player-overlay">
            <button className="play-btn" onClick={onTogglePlay} aria-label="play">
              <Play />
            </button>
          </div>
        )}
        <div className="swing-index-badge">
          <span className="num">{(analysis?.swingIndex ?? 0).toFixed(1)}</span>
          <span className="cap">Swing Index</span>
        </div>
      </div>

      {dual && referenceName && (
        <div className="ref-name-line">vs {referenceName}</div>
      )}

      <div className="controls">
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
              ALIGN IMPACT
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

      {openFault && analysis && (
        <DrillSheet fault={openFault} analysis={analysis} onClose={() => setOpenFault(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
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
