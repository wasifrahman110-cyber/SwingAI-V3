/**
 * TelestratorToolbar — floating vertical tool rail: pen / line / circle,
 * 5-swatch technical palette, undo / redo / clear, and the
 * "Lock to Frame" vs "Global Overlay" persistence toggle.
 */

import type { TelestratorTool } from "../types/pose.ts";
import { TELESTRATOR_COLORS } from "../types/pose.ts";

interface ToolbarProps {
  tool: TelestratorTool;
  color: string;
  lockToFrame: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (t: TelestratorTool) => void;
  onColor: (c: string) => void;
  onLockToggle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  /** 🪄 auto-trace the backswing arc into the persistent annotation state. */
  onTrackArc: () => void;
}

const ToolIcon = ({ kind }: { kind: "pen" | "line" | "circle" }) => {
  if (kind === "pen") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 20c4-1 3-4 6-7s7-7 8-6-3 5-6 8-6 2-8 5z" />
      </svg>
    );
  }
  if (kind === "line") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M5 19L19 5" />
        <circle cx="5" cy="19" r="2" fill="currentColor" stroke="none" />
        <circle cx="19" cy="5" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
};

export function TelestratorToolbar({
  tool,
  color,
  lockToFrame,
  canUndo,
  canRedo,
  onTool,
  onColor,
  onLockToggle,
  onUndo,
  onRedo,
  onClear,
  onTrackArc,
}: ToolbarProps) {
  return (
    <div className="tele-toolbar" role="toolbar" aria-label="annotation tools">
      {(["pen", "line", "circle"] as const).map((t) => (
        <button
          key={t}
          className={`tele-btn ${tool === t ? "on" : ""}`}
          onClick={() => onTool(tool === t ? "off" : t)}
          aria-label={`${t} tool`}
          title={t}
        >
          <ToolIcon kind={t} />
        </button>
      ))}

      <div className="tele-sep" />

      {TELESTRATOR_COLORS.map((c) => (
        <button
          key={c}
          className={`tele-swatch ${color === c ? "on" : ""}`}
          style={{ background: c }}
          onClick={() => onColor(c)}
          aria-label={`color ${c}`}
        />
      ))}

      <div className="tele-sep" />

      <button
        className="tele-btn arc"
        onClick={onTrackArc}
        aria-label="track backswing arc"
        title="🪄 Track Backswing Arc — auto-trace the club path address → top"
      >
        🪄
      </button>

      <div className="tele-sep" />

      <button className="tele-btn" onClick={onUndo} disabled={!canUndo} aria-label="undo" title="undo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 010 12h-3" />
        </svg>
      </button>
      <button className="tele-btn" onClick={onRedo} disabled={!canRedo} aria-label="redo" title="redo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H10a6 6 0 000 12h3" />
        </svg>
      </button>
      <button className="tele-btn" onClick={onClear} aria-label="clear all annotations" title="clear all">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13" />
        </svg>
      </button>

      <div className="tele-sep" />

      <button
        className={`tele-btn lock ${lockToFrame ? "on" : ""}`}
        onClick={onLockToggle}
        aria-label={lockToFrame ? "annotations locked to frame" : "annotations persist globally"}
        title={lockToFrame ? "Lock to Frame" : "Global Overlay"}
      >
        {lockToFrame ? "F" : "G"}
      </button>
    </div>
  );
}
