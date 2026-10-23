/**
 * Bottom navigation (V2): Home · Journal · (+) analyze · Drill Studio · Progress.
 * The player opens from Home, uploads, or the session library.
 */

import { Book, Chart, Home, Plus } from "./icons.tsx";

export type Screen = "home" | "detail" | "journal" | "studio" | "progress";

interface TabBarProps {
  screen: Screen;
  busy: boolean;
  onGo: (screen: Screen) => void;
  onUpload: () => void;
}

const DrillIcon = ({ size = 24 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </svg>
);

export function TabBar({ screen, busy, onGo, onUpload }: TabBarProps) {
  return (
    <nav className="tabbar">
      <button
        className={`nav-ico ${screen === "home" || screen === "detail" ? "active" : ""}`}
        onClick={() => onGo("home")}
        aria-label="home"
      >
        <Home />
      </button>
      <button
        className={`nav-ico ${screen === "journal" ? "active" : ""}`}
        onClick={() => onGo("journal")}
        aria-label="swing journal"
      >
        <Book />
      </button>
      <button className="fab" onClick={onUpload} disabled={busy} aria-label="analyze a swing">
        <Plus />
      </button>
      <button
        className={`nav-ico ${screen === "studio" ? "active" : ""}`}
        onClick={() => onGo("studio")}
        aria-label="drill studio"
      >
        <DrillIcon />
      </button>
      <button
        className={`nav-ico ${screen === "progress" ? "active" : ""}`}
        onClick={() => onGo("progress")}
        aria-label="progress"
      >
        <Chart />
      </button>
    </nav>
  );
}
