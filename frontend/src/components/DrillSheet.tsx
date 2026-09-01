/**
 * DrillSheet — bottom sheet that typesets the recommended drill's markdown
 * for the selected fault, with target-vs-actual callout.
 */

import type { AnalysisResult, Fault } from "../types/pose.ts";
import { PRO_MODELS, proModelEmbedUrl } from "../engine/drills.ts";
import { renderMarkdown } from "../lib/markdown.tsx";

interface DrillSheetProps {
  fault: Fault;
  analysis: AnalysisResult;
  onClose: () => void;
}

export function DrillSheet({ fault, analysis, onClose }: DrillSheetProps) {
  const drill = analysis.drills.find((d) => d.faultCode === fault.code);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="drill-sheet" role="dialog" aria-label={`drill for ${fault.name}`}>
        <div className="grabber" />
        {drill?.focusKey && (
          <div className="drill-meta">
            <span className="drill-meta-chip focus">◎ {drill.focusKey}</span>
            {drill.recommendedReps && (
              <span className="drill-meta-chip reps">↻ {drill.recommendedReps}</span>
            )}
          </div>
        )}
        {drill ? (
          renderMarkdown(drill.markdown)
        ) : (
          <div className="md">
            <h3>{fault.name}</h3>
            <p>{fault.summary}</p>
          </div>
        )}
        {PRO_MODELS[fault.code] && (
          <div className="pro-model" aria-label="watch pro model swing">
            <div className="pro-model-head">
              ▶ WATCH PRO MODEL SWING
              <span className="pro-model-name">
                {PRO_MODELS[fault.code]!.pro} — {PRO_MODELS[fault.code]!.focus}
              </span>
            </div>
            <iframe
              className="pro-model-frame"
              src={proModelEmbedUrl(PRO_MODELS[fault.code]!)}
              title={`${PRO_MODELS[fault.code]!.pro} model swing`}
              allow="accelerometer; encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}
      </div>
    </>
  );
}
