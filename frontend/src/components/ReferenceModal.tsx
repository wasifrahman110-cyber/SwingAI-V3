/**
 * ReferenceModal — "Upload Reference Swing (Pro or Personal)": pick from the
 * built-in model-swing library or upload a custom video.
 */

import { REFERENCE_LIBRARY } from "../lib/demoData.ts";

interface ReferenceModalProps {
  onPickLibrary: (id: string) => void;
  onUpload: () => void;
  onClose: () => void;
}

export function ReferenceModal({ onPickLibrary, onUpload, onClose }: ReferenceModalProps) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="upload-menu" role="dialog" aria-label="upload reference swing">
        <div className="grabber" />
        <div className="modal-title">Upload Reference Swing</div>
        <div className="modal-sub">
          Compare against a model swing or your own best move — pro or personal.
        </div>

        {REFERENCE_LIBRARY.map((clip) => (
          <button
            key={clip.id}
            className="upload-option"
            onClick={() => onPickLibrary(clip.id)}
          >
            <span className="uo-title">
              {clip.name}
              <span className="pill accent">library</span>
            </span>
            <span className="uo-sub">{clip.description}</span>
          </button>
        ))}

        <button className="upload-option" onClick={onUpload}>
          <span className="uo-title">Upload Custom Video</span>
          <span className="uo-sub">
            Any face-on or down-the-line clip — pose is extracted on-device and
            becomes the DTW reference.
          </span>
        </button>
      </div>
    </>
  );
}
