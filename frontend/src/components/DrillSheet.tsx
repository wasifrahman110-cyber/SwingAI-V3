/**
 * DrillSheet — bottom sheet that typesets the recommended drill's markdown
 * for the selected fault, with target-vs-actual callout.
 */

import type { AnalysisResult, Fault } from "../types/pose.ts";
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
        {drill ? (
          renderMarkdown(drill.markdown)
        ) : (
          <div className="md">
            <h3>{fault.name}</h3>
            <p>{fault.summary}</p>
          </div>
        )}
      </div>
    </>
  );
}
