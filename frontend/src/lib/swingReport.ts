/**
 * Coaching report export.
 *
 * The telemetry PNG is a nice thing to post, but it is not something a golfer
 * can take to the range and act on. This builds a self-contained HTML file
 * with the Swing Index, every detected fault (what was measured against what
 * the tolerance was), and the matched drill steps for each one. It opens in
 * any browser and prints straight to PDF, with no extra dependency.
 */

import type { AnalysisResult, Fault, SwingSequence } from "../types/pose.ts";
import { PHASE_LABELS } from "../types/pose.ts";
import { DRILL_LIBRARY, GENERIC_DRILL } from "../engine/drills.ts";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unitSuffix = (u: string): string => (u === "deg" ? "°" : u === "in" ? " in" : u === "%" ? "%" : "");

function scoreVerdict(score: number): string {
  if (score >= 90) return "Tour-adjacent. Keep this pattern and bank it.";
  if (score >= 78) return "Solid ball-striking shape with a couple of leaks to plug.";
  if (score >= 62) return "Repeatable, but the faults below are costing you consistency.";
  return "There are structural issues here. Work the top two faults before anything else.";
}

function faultBlock(f: Fault): string {
  const drill = DRILL_LIBRARY[f.code] ?? GENERIC_DRILL;
  const steps = drill.description.map((d) => `<li>${esc(d)}</li>`).join("");
  return `
  <section class="fault ${esc(f.severity)}">
    <header>
      <span class="sev">${esc(f.severity)}</span>
      <h3>${esc(f.name)}</h3>
      <span class="phase">${esc(PHASE_LABELS[f.phase] ?? f.phase.replace(/_/g, " "))}</span>
    </header>
    <p class="what">${esc(f.summary)}</p>
    <table class="nums">
      <tr><td>Your measurement</td><td><b>${f.measured}${unitSuffix(f.unit)}</b></td></tr>
      <tr><td>Target / tolerance</td><td>${f.target}${unitSuffix(f.unit)}</td></tr>
    </table>
    <div class="fix">
      <h4>How to fix it &middot; ${esc(drill.title)}</h4>
      <ol>${steps}</ol>
      <p class="reps">Suggested dose: ${esc(drill.recommendedReps)}</p>
    </div>
  </section>`;
}

export function buildReportHtml(
  user: SwingSequence,
  analysis: AnalysisResult,
  playerName: string,
): string {
  const date = new Date().toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const score = analysis.swingIndex;
  const faults = analysis.faults;
  const priority = faults.slice(0, 2);

  const priorityHtml = priority.length
    ? `<ol>${priority.map((f) => `<li><b>${esc(f.name)}</b> &mdash; ${esc(f.summary)}</li>`).join("")}</ol>`
    : `<p>No major faults were detected on this swing. Bank the feel and repeat it.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SwingAI Report — ${esc(playerName)} — ${esc(date)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 28px 64px; background: #fff; color: #14141a;
         font: 15px/1.55 -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 2px; letter-spacing: -0.02em; }
  .meta { color: #6b6b76; font-size: 13px; margin-bottom: 26px; }
  .score { display: flex; align-items: baseline; gap: 14px; padding: 20px 22px;
           border: 1px solid #e3e3e8; border-radius: 14px; margin-bottom: 10px; }
  .score b { font-size: 46px; letter-spacing: -0.03em; line-height: 1; }
  .score span { color: #6b6b76; font-size: 13px; }
  .verdict { margin: 0 0 30px; color: #3a3a44; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em;
       color: #6b6b76; margin: 32px 0 12px; }
  .fault { border: 1px solid #e3e3e8; border-left-width: 4px; border-radius: 12px;
           padding: 16px 18px; margin-bottom: 16px; page-break-inside: avoid; }
  .fault.critical { border-left-color: #d93a2f; }
  .fault.major    { border-left-color: #e8890c; }
  .fault.minor    { border-left-color: #c9a800; }
  .fault header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .fault h3 { font-size: 17px; margin: 0; }
  .sev { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
         padding: 3px 8px; border-radius: 999px; background: #f0f0f4; color: #4a4a55; }
  .phase { font-size: 12px; color: #6b6b76; margin-left: auto; }
  .what { margin: 0 0 12px; color: #3a3a44; }
  .nums { border-collapse: collapse; margin-bottom: 14px; font-size: 14px; }
  .nums td { padding: 3px 18px 3px 0; color: #4a4a55; }
  .fix { background: #f7f7fa; border-radius: 10px; padding: 14px 16px; }
  .fix h4 { margin: 0 0 8px; font-size: 14px; }
  .fix ol { margin: 0 0 8px; padding-left: 20px; }
  .fix li { margin-bottom: 5px; }
  .reps { margin: 0; font-size: 13px; color: #6b6b76; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e3e3e8;
           font-size: 12px; color: #8a8a94; }
  @media print { body { padding: 0; } .fault { break-inside: avoid; } }
</style></head>
<body><div class="wrap">
  <h1>Swing Report &middot; ${esc(playerName)}</h1>
  <div class="meta">${esc(date)} &middot; ${user.frames.length} frames analyzed at ${user.fps} fps
    &middot; ${faults.length} fault${faults.length === 1 ? "" : "s"} detected</div>

  <div class="score"><b>${score.toFixed(1)}</b><span>Swing Index / 100</span></div>
  <p class="verdict">${esc(scoreVerdict(score))}</p>

  <h2>Work on this first</h2>
  ${priorityHtml}

  <h2>Full breakdown</h2>
  ${faults.length ? faults.map(faultBlock).join("") : "<p>Nothing flagged on this swing.</p>"}

  <footer>
    Generated by SwingAI. Measurements come from on-device pose estimation and are
    compared against your own address posture, so they are estimates from a single
    camera angle rather than lab-grade motion capture.
  </footer>
</div></body></html>`;
}

export function downloadSwingReport(
  user: SwingSequence,
  analysis: AnalysisResult,
  playerName: string,
): void {
  const html = buildReportHtml(user, analysis, playerName);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `swingai-report-${stamp}.html`;
  a.href = url;
  a.click();
  // give the browser a tick to start the download before reclaiming the URL
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
