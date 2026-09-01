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
import { DRILL_LIBRARY, PRO_MODELS } from "../engine/drills.ts";
import { faultGroup } from "../engine/diagnostics.ts";
import { renderMarkdown } from "../lib/markdown.tsx";
import { useState } from "react";

/** The full V4 drill library — one entry per detectable fault code. */
const FULL_LIBRARY = Object.entries(DRILL_LIBRARY).map(([code, spec]) => ({
  code,
  name: spec.title,
  group: faultGroup(code),
  focus: spec.focusKey,
  reps: spec.recommendedReps,
}));

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

      <div className="studio-sub">Full drill library · {FULL_LIBRARY.length} drills</div>
      {FULL_LIBRARY.map((d) => (
        <section className="line-section" key={d.code}>
          <div className="studio-lib-row">
            <div>
              <div className="fix-name">
                {d.name}
                <span className="group-tag">{d.group}</span>
                {matchedCodes.has(d.code) && <span className="pill accent">active</span>}
              </div>
              <p className="studio-how">{d.focus}</p>
              <div className="fix-metric">
                {d.reps}
                {PRO_MODELS[d.code] && ` · watch: ${PRO_MODELS[d.code]!.pro}`}
              </div>
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
