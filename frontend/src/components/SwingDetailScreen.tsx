/**
 * SwingDetailScreen — the swing player screen from the reference UI:
 * canvas player with Swing Index badge, ghost/scrub controls, the
 * Framework Fixes / Bookmarked / All Metrics tabs, and the drill sheet.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, Fault, PhaseName, SwingSequence } from "../types/pose.ts";
import { DrillSheet } from "./DrillSheet.tsx";
import { FixList } from "./FixList.tsx";
import { Scrubber } from "./Scrubber.tsx";
import { SwingCanvas } from "./SwingCanvas.tsx";
import { ChevronLeft, Kebab, Pause, Play } from "./icons.tsx";

type Tab = "fixes" | "bookmarked" | "metrics";

interface SwingDetailScreenProps {
  user: SwingSequence;
  pro: SwingSequence;
  analysis: AnalysisResult | null;
  analyzing: boolean;
  isDemo: boolean;
  proIsDemo: boolean;
  video: HTMLVideoElement | null;
  initialPhase: PhaseName | null;
  onBack: () => void;
}

const fmtClock = (): string => {
  const d = new Date();
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};

export function SwingDetailScreen({
  user,
  pro,
  analysis,
  analyzing,
  isDemo,
  proIsDemo,
  video,
  initialPhase,
  onBack,
}: SwingDetailScreenProps) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ghostOn, setGhostOn] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(0.55);
  const [tab, setTab] = useState<Tab>("fixes");
  const [openFault, setOpenFault] = useState<Fault | null>(null);
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set(["chicken_wing"]));
  const dateLabel = useRef(fmtClock());

  const T = user.frames.length;

  // jump the playhead to a phase when arriving from the hex map
  useEffect(() => {
    if (initialPhase && analysis) {
      setFrame(analysis.phases.user[initialPhase] ?? 0);
      setPlaying(false);
    }
  }, [initialPhase, analysis]);

  // keep the uploaded video element in sync with the playhead for backdrop draws
  useEffect(() => {
    if (video && !playing) {
      const t = frame / user.fps;
      if (Math.abs(video.currentTime - t) > 0.02) video.currentTime = t;
    }
  }, [frame, playing, video, user.fps]);
  useEffect(() => {
    if (!video) return;
    if (playing) {
      video.currentTime = frame / user.fps;
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, video]);

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

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="back">
          <ChevronLeft />
        </button>
        <span className="title">{dateLabel.current}</span>
        <button className="icon-btn" aria-label="more">
          <Kebab />
        </button>
      </div>

      <div className="player-wrap">
        <SwingCanvas
          user={user}
          pro={pro}
          analysis={analysis}
          frame={frame}
          playing={playing}
          ghostOn={ghostOn}
          ghostOpacity={ghostOpacity}
          video={video}
          onFrameChange={onFrameChange}
          onTogglePlay={onTogglePlay}
        />
        <div className="player-hud">
          <button
            className={`hud-chip ${ghostOn ? "on" : ""}`}
            onClick={() => setGhostOn((g) => !g)}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
          >
            GHOST
          </button>
          <span className="hud-chip">{isDemo ? "DEMO SWING" : "YOUR SWING"}</span>
          <span className="hud-chip">{proIsDemo ? "PRO: MODEL" : "PRO: CUSTOM"}</span>
        </div>
        {!playing && (
          <div className="player-overlay">
            <button className="play-btn" onClick={onTogglePlay} aria-label="play">
              <Play />
            </button>
          </div>
        )}
        {playing && (
          <div className="player-overlay" style={{ opacity: 0, pointerEvents: "none" }} />
        )}
        <div className="swing-index-badge">
          <span className="num">{(analysis?.swingIndex ?? 0).toFixed(1)}</span>
          <span className="cap">Swing Index</span>
        </div>
      </div>

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
            {String(frame).padStart(3, "0")}/{String(T - 1).padStart(3, "0")} ·{" "}
            {(frame / user.fps).toFixed(2)}s
          </span>
        </div>
        <div className="row">
          <label htmlFor="ghost-op">Ghost</label>
          <input
            id="ghost-op"
            type="range"
            min={0}
            max={100}
            value={Math.round(ghostOpacity * 100)}
            onChange={(e) => {
              const v = Number(e.currentTarget.value) / 100;
              setGhostOpacity(v);
              if (v > 0 && !ghostOn) setGhostOn(true);
            }}
            aria-label="ghost overlay opacity"
          />
          <span className="frame-readout">{Math.round(ghostOpacity * 100)}%</span>
        </div>
      </div>

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
    analysis.deviations[Math.min(frame, analysis.deviations.length - 1)];
  const seq = analysis.kinematicSequence;
  const proFrame = analysis.alignment.userToPro[frame] ?? 0;

  const cls = (v: number, warn: number, bad: number): string =>
    Math.abs(v) > bad ? "bad" : Math.abs(v) > warn ? "warn" : "ok";

  return (
    <section className="line-section" aria-label="all metrics">
      <div className="metric-row">
        <span className="k">DTW mapped pro frame</span>
        <span className="v">
          #{frame} → #{proFrame}
        </span>
      </div>
      <div className="metric-row">
        <span className="k">Alignment cost (normalized)</span>
        <span className="v">{analysis.alignment.normalizedCost.toFixed(3)}</span>
      </div>
      {dev && (
        <>
          <div className="metric-row">
            <span className="k">Spine-angle Δ vs pro</span>
            <span className={`v ${cls(dev.spineAngleDelta, 4, 8)}`}>
              {dev.spineAngleDelta >= 0 ? "+" : ""}
              {dev.spineAngleDelta.toFixed(1)}°
            </span>
          </div>
          <div className="metric-row">
            <span className="k">Lead-arm extension Δ</span>
            <span className={`v ${dev.leadArmDelta < -20 ? "bad" : dev.leadArmDelta < -10 ? "warn" : "ok"}`}>
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
          <div className="metric-row">
            <span className="k">Hip rotation Δ</span>
            <span className={`v ${cls(dev.hipRotationDelta, 8, 15)}`}>
              {dev.hipRotationDelta >= 0 ? "+" : ""}
              {dev.hipRotationDelta.toFixed(1)}°
            </span>
          </div>
        </>
      )}
      <div className="metric-row">
        <span className="k">Kinematic sequence</span>
        <span className={`v ${seq.sequenceCorrect ? "ok" : "bad"}`}>
          {Object.entries(seq.peakFrames)
            .sort((a, b) => a[1] - b[1])
            .map(([k]) => k)
            .join(" → ")}
        </span>
      </div>
      {(["setup", "top_of_backswing", "downswing", "impact", "follow_through"] as const).map(
        (p) => (
          <div className="metric-row" key={p}>
            <span className="k">Phase · {p.replace(/_/g, " ")}</span>
            <span className="v">
              you #{analysis.phases.user[p]} · pro #{analysis.phases.pro[p]}
            </span>
          </div>
        ),
      )}
    </section>
  );
}
