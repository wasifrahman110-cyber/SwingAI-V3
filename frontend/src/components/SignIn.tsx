/**
 * First-launch welcome / sign-in sheet. Local-only: the name is kept in
 * localStorage next to the session records, so nothing is uploaded and the
 * app still works with no network. Handedness is collected here because the
 * whole diagnostic engine is lead-side aware.
 */

import { useState } from "react";

export interface UserProfile {
  name: string;
  leadSide: "left" | "right";
}

const KEY = "swingai.profile.v1";

export function loadProfile(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<UserProfile>;
    if (!p || typeof p.name !== "string" || p.name.trim() === "") return null;
    return { name: p.name, leadSide: p.leadSide === "right" ? "right" : "left" };
  } catch {
    return null;
  }
}

export function saveProfile(p: UserProfile): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) — session still works in memory */
  }
}

export function clearProfile(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function SignIn({ onDone }: { onDone: (p: UserProfile) => void }) {
  const [name, setName] = useState("");
  const [leadSide, setLeadSide] = useState<"left" | "right">("left");
  const valid = name.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    const profile: UserProfile = { name: name.trim().slice(0, 24), leadSide };
    saveProfile(profile);
    onDone(profile);
  };

  return (
    <div className="signin-backdrop" role="dialog" aria-modal="true" aria-label="welcome to SwingAI">
      <div className="signin-card">
        <div className="signin-mark">SwingAI</div>
        <h1 className="signin-title">Let's set up your bag</h1>
        <p className="signin-sub">
          Everything stays on this device. No account, no upload, no network needed.
        </p>

        <label className="signin-label" htmlFor="signin-name">
          What should we call you?
        </label>
        <input
          id="signin-name"
          className="signin-input"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="First name"
          autoComplete="given-name"
          maxLength={24}
          autoFocus
        />

        <span className="signin-label">Which hand leads your swing?</span>
        <div className="signin-seg" role="radiogroup" aria-label="lead side">
          <button
            type="button"
            role="radio"
            aria-checked={leadSide === "left"}
            className={`signin-seg-btn ${leadSide === "left" ? "on" : ""}`}
            onClick={() => setLeadSide("left")}
          >
            Right-handed
            <span className="signin-seg-sub">left arm leads</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={leadSide === "right"}
            className={`signin-seg-btn ${leadSide === "right" ? "on" : ""}`}
            onClick={() => setLeadSide("right")}
          >
            Left-handed
            <span className="signin-seg-sub">right arm leads</span>
          </button>
        </div>

        <button className="signin-go" onClick={submit} disabled={!valid}>
          Start analyzing
        </button>
      </div>
    </div>
  );
}
