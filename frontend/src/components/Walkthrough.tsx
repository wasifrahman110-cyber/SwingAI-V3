/**
 * First-run walkthrough. Runs once after sign-in, keyed separately in
 * localStorage so finishing it survives a reload but a returning user is
 * never shown it again. Deliberately skippable: nobody wants a tour gate
 * between them and their swing.
 */

import { useState } from "react";

const KEY = "swingai.tour.v1";

export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "done";
  } catch {
    return true; // storage blocked: don't trap the user in a tour every load
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(KEY, "done");
  } catch {
    /* ignore */
  }
}

interface Step {
  readonly badge: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
}

const STEPS: readonly Step[] = [
  {
    badge: "Single",
    title: "Analyze one swing on its own",
    body:
      "Upload a face-on clip and SwingAI measures 17 biomechanical checks against your own address posture. No reference swing needed, which means one video is enough for a full diagnosis.",
    points: [
      "Tap the bar above the video to pull down the fault list",
      "Scrub the timeline to step through address, top, impact",
      "Speaker icon reads your top two faults out loud",
    ],
  },
  {
    badge: "Dual",
    title: "Compare against a model swing",
    body:
      "Load a reference from the library or upload any clip. Dynamic time warping lines the two swings up frame for frame, so they stay matched even when the tempos differ.",
    points: [
      "Ghost overlays the reference skeleton on top of yours",
      "Linked / Independent switches the two playheads",
      "Align impact snaps both clips to the strike",
    ],
  },
  {
    badge: "Multi-angle",
    title: "Face-on and down-the-line together",
    body:
      "Add a second clip of the same swing shot from behind. Both angles play side by side on one timeline, phase-matched, so the top of your backswing lines up in both views.",
    points: [
      "Upload via Add Down-the-Line Clip",
      "Both clips stay locked to the same swing phase",
    ],
  },
  {
    badge: "Tools",
    title: "Draw, track and export",
    body:
      "The rail on the right of the video has pen and erase. Below the player you get the kinematic sequence graph and your impact metrics.",
    points: [
      "Swipe from either screen edge to change pages",
      "Export a coaching report with drills for every fault",
      "Every session is saved on-device for progress tracking",
    ],
  },
];

export function Walkthrough({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  if (!step) return null;
  const last = i === STEPS.length - 1;

  const finish = () => {
    markTourSeen();
    onDone();
  };

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="feature walkthrough">
      <div className="tour-card">
        <div className="tour-top">
          <span className="tour-badge">{step.badge}</span>
          <button className="tour-skip" onClick={finish}>
            Skip
          </button>
        </div>

        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <ul className="tour-points">
          {step.points.map((pt) => (
            <li key={pt}>{pt}</li>
          ))}
        </ul>

        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((s2, n) => (
              <span key={s2.badge} className={`tour-dot ${n === i ? "on" : ""}`} />
            ))}
          </div>
          <div className="tour-nav">
            {i > 0 && (
              <button className="tour-back" onClick={() => setI((n) => n - 1)}>
                Back
              </button>
            )}
            <button className="tour-next" onClick={() => (last ? finish() : setI((n) => n + 1))}>
              {last ? "Start swinging" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
