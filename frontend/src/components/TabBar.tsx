/** Bottom navigation bar: home / library / (+) analyze / player / progress. */

import { Book, Chart, Home, PlayerNav, Plus } from "./icons.tsx";

export type Screen = "home" | "detail";

interface TabBarProps {
  screen: Screen;
  busy: boolean;
  onGoHome: () => void;
  onGoDetail: () => void;
  onUpload: () => void;
}

export function TabBar({ screen, busy, onGoHome, onGoDetail, onUpload }: TabBarProps) {
  return (
    <nav className="tabbar">
      <button
        className={`nav-ico ${screen === "home" ? "active" : ""}`}
        onClick={onGoHome}
        aria-label="home"
      >
        <Home />
      </button>
      <button className="nav-ico" aria-label="library">
        <Book />
      </button>
      <button className="fab" onClick={onUpload} disabled={busy} aria-label="analyze a swing">
        <Plus />
      </button>
      <button
        className={`nav-ico ${screen === "detail" ? "active" : ""}`}
        onClick={onGoDetail}
        aria-label="swing player"
      >
        <PlayerNav />
      </button>
      <button className="nav-ico" aria-label="progress">
        <Chart />
      </button>
    </nav>
  );
}
