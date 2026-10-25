/**
 * Home-screen figures derived from the sessions actually stored on this
 * device.
 *
 * Everything here comes from real analyses. A profile with no swings yet
 * reports no data at all rather than a stand-in number, so the home screen
 * can say so plainly instead of showing a score nobody has earned.
 */

import type { SessionRecord } from "../types/pose.ts";

/** Sessions needed before a trend line means anything. */
const MIN_TREND_POINTS = 2;
/** How many of the most recent sessions the framework chart plots. */
const TREND_WINDOW = 7;
/** Target score drawn against the trend. */
export const SCORE_GOAL = 6.0;

export interface DashboardData {
  /** Latest Swing Index; null when nothing has been analyzed yet. */
  readonly swingIndex: number | null;
  /** Change against the previous session; null when there isn't one. */
  readonly swingIndexDelta: number | null;
  readonly analyzedCount: number;
  readonly goal: number;
  /** Empty until there are enough sessions to plot. */
  readonly scoreSeries: readonly number[];
  readonly dayLabels: readonly string[];
  readonly weekLabel: string;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${`${d.getMonth() + 1}`.padStart(2, "0")}/${`${d.getDate()}`.padStart(2, "0")}`;
}

function rangeLabel(firstISO: string, lastISO: string): string {
  const a = new Date(firstISO);
  const b = new Date(lastISO);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const short = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const full = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return a.toDateString() === b.toDateString() ? full(b) : `${short(a)} – ${full(b)}`;
}

/**
 * `sessions` arrives newest-first, the order the session store keeps it in.
 */
export function buildDashboard(sessions: readonly SessionRecord[]): DashboardData {
  const latest = sessions[0];
  const previous = sessions[1];

  // oldest-first within the window, so the chart reads left to right
  const window = sessions.slice(0, TREND_WINDOW).slice().reverse();
  const plottable = window.length >= MIN_TREND_POINTS;
  const first = window[0];
  const last = window[window.length - 1];

  return {
    swingIndex: latest ? latest.swingIndex : null,
    swingIndexDelta: latest && previous ? latest.swingIndex - previous.swingIndex : null,
    analyzedCount: sessions.length,
    goal: SCORE_GOAL,
    scoreSeries: plottable ? window.map((s) => s.swingIndex) : [],
    dayLabels: plottable ? window.map((s) => dayLabel(s.dateISO)) : [],
    weekLabel: plottable && first && last ? rangeLabel(first.dateISO, last.dateISO) : "",
  };
}
