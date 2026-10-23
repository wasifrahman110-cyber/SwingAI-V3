/**
 * FixList — "Framework Fixes" collapsible line sections, exactly the pattern
 * from the reference UI: Line N — phase name, severity bars, bookmark toggles.
 */

import { useState } from "react";
import type { AnalysisResult, Fault, PhaseName } from "../types/pose.ts";
import { PHASE_LABELS, PHASE_NAMES } from "../types/pose.ts";
import { faultGroup } from "../engine/diagnostics.ts";
import { Bookmark, BookmarkFilled, ChevronUp, Golfer } from "./icons.tsx";

export const LINE_NUMBERS: Record<PhaseName, number> = {
  setup: 0,
  top_of_backswing: 2,
  downswing: 5,
  impact: 6,
  follow_through: 8,
};

interface FixListProps {
  analysis: AnalysisResult;
  bookmarks: ReadonlySet<string>;
  onToggleBookmark: (code: string) => void;
  onOpenFault: (fault: Fault) => void;
  filterBookmarked?: boolean;
  openPhase?: PhaseName | null;
}

export function FixList({
  analysis,
  bookmarks,
  onToggleBookmark,
  onOpenFault,
  filterBookmarked = false,
  openPhase = null,
}: FixListProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<PhaseName>>(new Set());

  const toggle = (p: PhaseName) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const faults = filterBookmarked
    ? analysis.faults.filter((f) => bookmarks.has(f.code))
    : analysis.faults;

  const phases = PHASE_NAMES.filter((p) => faults.some((f) => f.phase === p));

  if (phases.length === 0) {
    return (
      <div className="empty-note">
        {filterBookmarked
          ? "No bookmarked fixes yet — tap the bookmark icon on any fix to save it here."
          : "No framework fixes detected in this swing. Clean pass."}
      </div>
    );
  }

  return (
    <>
      {phases.map((phase) => {
        const isOpen = openPhase === phase || !collapsed.has(phase);
        const items = faults.filter((f) => f.phase === phase);
        return (
          <section className="line-section" key={phase}>
            <button className="line-head" onClick={() => toggle(phase)}>
              <span className="pose-ico">
                <Golfer />
              </span>
              <span className="line-num">Line {LINE_NUMBERS[phase]}</span>
              <span className="line-name">— {PHASE_LABELS[phase]}</span>
              <span className={`chev ${isOpen ? "" : "closed"}`}>
                <ChevronUp />
              </span>
            </button>
            {isOpen &&
              items.map((f) => (
                <button className="fix-item" key={f.code} onClick={() => onOpenFault(f)}>
                  <span className={`sev-bar sev-${f.severity}`} />
                  <span>
                    <div className="fix-name">
                      {f.name}
                      <span className="group-tag">{faultGroup(f.code)}</span>
                    </div>
                    <div className="fix-metric">
                      {f.unit === "order"
                        ? "sequence fault"
                        : `yours ${f.measured}${f.unit === "deg" ? "°" : ` ${f.unit}`} · target ${
                            f.code === "chicken_wing" ? "≥" : "≤"
                          } ${f.target}${f.unit === "deg" ? "°" : ` ${f.unit}`}`}
                    </div>
                  </span>
                  <span
                    className={`bookmark ${bookmarks.has(f.code) ? "on" : ""}`}
                    role="button"
                    aria-label={`bookmark ${f.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBookmark(f.code);
                    }}
                  >
                    {bookmarks.has(f.code) ? <BookmarkFilled /> : <Bookmark />}
                  </span>
                </button>
              ))}
          </section>
        );
      })}
    </>
  );
}
