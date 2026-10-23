/**
 * DrillStudio — the drill library + reference swing library.
 *
 * Top section: drills matched to the faults detected in the current swing.
 * Middle: the full structured drill library.
 * Bottom: built-in model-swing library, loadable straight into Dual
 * Comparison mode.
 */

import type { AnalysisResult } from "../types/pose.ts";
import { REFERENCE_LIBRARY } from "../lib/demoData.ts";
import { renderMarkdown } from "../lib/markdown.tsx";
import { useState } from "react";

const FULL_LIBRARY: ReadonlyArray<{ code: string; name: string; fixes: string; how: string }> = [
  {
    code: "early_extension",
    name: "Chair Drill (Butt-Back Wall Drill)",
    fixes: "Early Extension",
    how: "Glutes stay on a chair/wall through the downswing; trail glute still brushing at impact.",
  },
  {
    code: "chicken_wing",
    name: "Glove Under Armpit Drill",
    fixes: "Chicken Wing",
    how: "Pin a glove under the lead armpit through half-shots; it only drops after both arms extend.",
  },
  {
    code: "sway",
    name: "Crossed-Arms Stance Pivot Drill",
    fixes: "Hip Sway",
    how: "Arms crossed, rotate to the top keeping the trail hip inside the trail ankle.",
  },
  {
    code: "spine_retention",
    name: "Head-on-Wall Posture Drill",
    fixes: "Spine-Angle Loss",
    how: "Forehead lightly on a pad; rehearse full turns without losing contact.",
  },
  {
    code: "kinematic_sequence",
    name: "Step-Change-of-Direction Drill",
    fixes: "Sequence Order",
    how: "Feet together, swing to the top, step toward the target to force the lower body to fire first.",
  },
];

interface DrillStudioProps {
  analysis: AnalysisResult | null;
  onLoadReference: (id: string) => void;
}

export function DrillStudio({ analysis, onLoadReference }: DrillStudioProps) {
  const [openDrill, setOpenDrill] = useState<string | null>(null);
  const matched = analysis?.drills ?? [];
  const matchedCodes = new Set(matched.map((d) => d.faultCode));

  return (
    <div className="screen">
      <h2 className="section-title">Drill Studio</h2>

      <div className="studio-sub">Matched to your swing</div>
      {matched.length === 0 && (
        <div className="empty-note">
          No active faults — nothing to prescribe. Go hit it pure.
        </div>
      )}
      {matched.map((d) => (
        <section className="line-section" key={d.faultCode}>
          <button
            className="line-head"
            onClick={() => setOpenDrill(openDrill === d.faultCode ? null : d.faultCode)}
          >
            <span className="sev-bar sev-critical" style={{ height: 18 }} />
            <span className="line-num" style={{ fontSize: 14 }}>
              {d.drillName}
            </span>
            <span className={`chev ${openDrill === d.faultCode ? "" : "closed"}`}>▴</span>
          </button>
          {openDrill === d.faultCode && (
            <div className="studio-drill-body">{renderMarkdown(d.markdown)}</div>
          )}
        </section>
      ))}

      <div className="studio-sub">Full drill library</div>
      {FULL_LIBRARY.map((d) => (
        <section className="line-section" key={d.code}>
          <div className="studio-lib-row">
            <div>
              <div className="fix-name">
                {d.name}
                {matchedCodes.has(d.code) && <span className="pill accent">active</span>}
              </div>
              <div className="fix-metric">fixes: {d.fixes}</div>
              <p className="studio-how">{d.how}</p>
            </div>
          </div>
        </section>
      ))}

      <div className="studio-sub">Reference swing library</div>
      {REFERENCE_LIBRARY.map((clip) => (
        <section className="line-section" key={clip.id}>
          <div className="studio-lib-row">
            <div>
              <div className="fix-name">{clip.name}</div>
              <p className="studio-how">{clip.description}</p>
            </div>
            <button className="studio-load" onClick={() => onLoadReference(clip.id)}>
              Load into
              <br />
              Dual Mode
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
