/**
 * SwingAI app shell — phone frame, screen routing, video upload → MediaPipe
 * extraction → analysis, bottom tab bar.
 */

import { useCallback, useRef, useState } from "react";
import { HomeScreen } from "./components/HomeScreen.tsx";
import { SwingDetailScreen } from "./components/SwingDetailScreen.tsx";
import { TabBar, type Screen } from "./components/TabBar.tsx";
import { useMediaPipe } from "./hooks/useMediaPipe.ts";
import { useSwingAnalysis } from "./hooks/useSwingAnalysis.ts";
import { demoDashboard } from "./lib/demoData.ts";
import type { PhaseName } from "./types/pose.ts";

const USER_NAME = "Sameen";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [openPhase, setOpenPhase] = useState<PhaseName | null>(null);
  const [uploadMenu, setUploadMenu] = useState(false);
  const uploadTargetRef = useRef<"user" | "pro">("user");
  const swing = useSwingAnalysis();
  const mediapipe = useMediaPipe();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dashboard = useRef(demoDashboard()).current;

  const goDetail = useCallback((phase?: PhaseName) => {
    setOpenPhase(phase ?? null);
    setScreen("detail");
  }, []);

  const onPickFile = useCallback(
    async (file: File) => {
      const target = uploadTargetRef.current;
      const seq = await mediapipe.extract(file, "left");
      if (!seq) return;
      if (target === "pro") {
        // The pro baseline only feeds the analysis + ghost skeleton; no
        // backdrop video needed.
        swing.replaceProSwing(seq);
      } else {
        // Keep a hidden, seekable video element around for the canvas backdrop.
        const video = document.createElement("video");
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        swing.replaceUserSwing(seq, video);
      }
      setScreen("detail");
    },
    [mediapipe, swing],
  );

  const startUpload = useCallback((target: "user" | "pro") => {
    uploadTargetRef.current = target;
    setUploadMenu(false);
    fileInputRef.current?.click();
  }, []);

  const busy =
    mediapipe.status.state === "loading-model" || mediapipe.status.state === "extracting";

  return (
    <div className="phone">
      {screen === "home" ? (
        <HomeScreen
          userName={USER_NAME}
          dashboard={dashboard}
          analysis={swing.analysis}
          onOpenSwing={goDetail}
        />
      ) : (
        <SwingDetailScreen
          user={swing.user}
          pro={swing.pro}
          analysis={swing.analysis}
          analyzing={swing.analyzing}
          isDemo={swing.isDemo}
          proIsDemo={swing.proIsDemo}
          video={swing.video}
          initialPhase={openPhase}
          onBack={() => setScreen("home")}
        />
      )}

      {busy && (
        <div className="sheet-backdrop" style={{ display: "grid", placeItems: "center" }}>
          <div className="loading-shimmer" style={{ padding: 0 }}>
            {mediapipe.status.state === "loading-model"
              ? "LOADING POSE MODEL…"
              : `EXTRACTING POSE ${Math.round(
                  (mediapipe.status.state === "extracting"
                    ? mediapipe.status.progress
                    : 0) * 100,
                )}%`}
          </div>
        </div>
      )}
      {mediapipe.status.state === "error" && (
        <div
          className="pill"
          style={{
            position: "absolute",
            bottom: 96,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            background: "rgba(224,86,75,0.15)",
            color: "var(--anomaly-red)",
            maxWidth: "86%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "block",
            padding: "7px 14px",
          }}
          title={mediapipe.status.message}
        >
          {mediapipe.status.message.length > 90
            ? `${mediapipe.status.message.slice(0, 90)}…`
            : mediapipe.status.message}{" "}
          — keeping previous data
        </div>
      )}

      {uploadMenu && (
        <>
          <div className="sheet-backdrop" onClick={() => setUploadMenu(false)} />
          <div className="upload-menu" role="menu" aria-label="upload a swing video">
            <div className="grabber" />
            <button className="upload-option" onClick={() => startUpload("user")}>
              <span className="uo-title">Analyze My Swing</span>
              <span className="uo-sub">
                Upload your swing video — it becomes the analyzed swing on the player.
              </span>
            </button>
            <button className="upload-option" onClick={() => startUpload("pro")}>
              <span className="uo-title">
                Set Pro Baseline
                {!swing.proIsDemo && <span className="pill accent">custom</span>}
              </span>
              <span className="uo-sub">
                Upload a professional's swing to replace the bundled model — the ghost
                overlay, DTW alignment, and deviations all compare against it.
              </span>
            </button>
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void onPickFile(f);
          e.currentTarget.value = "";
        }}
      />

      <TabBar
        screen={screen}
        busy={busy}
        onGoHome={() => setScreen("home")}
        onGoDetail={() => goDetail()}
        onUpload={() => setUploadMenu(true)}
      />
    </div>
  );
}
