/**
 * SwingAI app shell (V2) — phone frame, 5-view navigation (Home, Journal,
 * upload, Drill Studio, Progress + the player), MediaPipe upload flows for
 * both the analyzed swing and the reference swing, session persistence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DrillStudio } from "./components/DrillStudio.tsx";
import { HomeScreen } from "./components/HomeScreen.tsx";
import { ProgressScreen } from "./components/ProgressScreen.tsx";
import { ReferenceModal } from "./components/ReferenceModal.tsx";
import { SwingDetailScreen } from "./components/SwingDetailScreen.tsx";
import { SwingJournal } from "./components/SwingJournal.tsx";
import { TabBar, type Screen } from "./components/TabBar.tsx";
import { useMediaPipe } from "./hooks/useMediaPipe.ts";
import { useSwingAnalysis } from "./hooks/useSwingAnalysis.ts";
import { REFERENCE_LIBRARY, demoDashboard } from "./lib/demoData.ts";
import { loadJournal, loadSessions, saveSession } from "./lib/sessionStore.ts";
import type { JournalEntry, PhaseName, SessionRecord, SwingSequence } from "./types/pose.ts";

const USER_NAME = "Sameen";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [openPhase, setOpenPhase] = useState<PhaseName | null>(null);
  const [uploadMenu, setUploadMenu] = useState(false);
  const [refModal, setRefModal] = useState(false);
  const uploadTargetRef = useRef<"user" | "reference">("user");
  const swing = useSwingAnalysis();
  const mediapipe = useMediaPipe();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dashboard = useRef(demoDashboard()).current;

  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [journal, setJournal] = useState<JournalEntry[]>(() => loadJournal());

  // auto-save each newly analyzed swing (once per swing) into the library
  const lastSavedRef = useRef<SwingSequence | null>(null);
  useEffect(() => {
    if (!swing.analysis || swing.analyzing) return;
    if (lastSavedRef.current === swing.user) return;
    lastSavedRef.current = swing.user;
    const label = swing.isDemo ? "Demo Swing" : "My Swing";
    const rec = saveSession(label, swing.user, swing.analysis);
    if (rec) setSessions((prev) => [rec, ...prev].slice(0, 12));
  }, [swing.analysis, swing.analyzing, swing.user, swing.isDemo]);

  const goDetail = useCallback((phase?: PhaseName) => {
    setOpenPhase(phase ?? null);
    setScreen("detail");
  }, []);

  const onPickFile = useCallback(
    async (file: File) => {
      const target = uploadTargetRef.current;
      const seq = await mediapipe.extract(file, "left");
      if (!seq) return;
      const makeVideo = (): HTMLVideoElement => {
        const v = document.createElement("video");
        v.src = URL.createObjectURL(file);
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        return v;
      };
      if (target === "reference") {
        swing.setReference(seq, file.name.replace(/\.[^.]+$/, ""), makeVideo());
      } else {
        swing.replaceUserSwing(seq, makeVideo());
      }
      setScreen("detail");
    },
    [mediapipe, swing],
  );

  const startUpload = useCallback((target: "user" | "reference") => {
    uploadTargetRef.current = target;
    setUploadMenu(false);
    setRefModal(false);
    fileInputRef.current?.click();
  }, []);

  const loadLibraryReference = useCallback(
    (id: string) => {
      const clip = REFERENCE_LIBRARY.find((c) => c.id === id);
      if (!clip) return;
      swing.setReference(clip.make(), clip.name, null);
      setRefModal(false);
      setScreen("detail");
    },
    [swing],
  );

  const openSession = useCallback(
    (s: SessionRecord) => {
      if (s.swing.frames.length === 0) return;
      swing.replaceUserSwing(s.swing, null, s.label === "Demo Swing" ? "demo" : undefined);
      setScreen("detail");
    },
    [swing],
  );

  const busy =
    mediapipe.status.state === "loading-model" || mediapipe.status.state === "extracting";

  return (
    <div className="phone">
      {screen === "home" && (
        <HomeScreen
          userName={USER_NAME}
          dashboard={dashboard}
          analysis={swing.analysis}
          onOpenSwing={goDetail}
        />
      )}
      {screen === "detail" && (
        <SwingDetailScreen
          user={swing.user}
          reference={swing.reference}
          referenceName={swing.referenceName}
          mode={swing.mode}
          analysis={swing.analysis}
          analyzing={swing.analyzing}
          isDemo={swing.isDemo}
          video={swing.video}
          referenceVideo={swing.referenceVideo}
          initialPhase={openPhase}
          playerName={USER_NAME}
          onBack={() => setScreen("home")}
          onSetMode={swing.setMode}
          onNeedReference={() => setRefModal(true)}
        />
      )}
      {screen === "journal" && (
        <SwingJournal
          entries={journal}
          sessions={sessions}
          latestSessionId={sessions[0]?.id ?? null}
          onEntriesChanged={setJournal}
        />
      )}
      {screen === "studio" && (
        <DrillStudio analysis={swing.analysis} onLoadReference={loadLibraryReference} />
      )}
      {screen === "progress" && (
        <ProgressScreen
          sessions={sessions}
          onOpenSession={openSession}
          onSessionsChanged={setSessions}
        />
      )}

      {busy && (
        <div className="sheet-backdrop" style={{ display: "grid", placeItems: "center" }}>
          <div className="loading-shimmer" style={{ padding: 0 }}>
            {mediapipe.status.state === "loading-model"
              ? "LOADING POSE MODEL…"
              : `EXTRACTING POSE ${Math.round(
                  (mediapipe.status.state === "extracting" ? mediapipe.status.progress : 0) * 100,
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
            background: "rgba(255,59,48,0.14)",
            color: "#FF3B30",
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
                Upload your swing video — pose is extracted on-device and analyzed instantly.
              </span>
            </button>
            <button
              className="upload-option"
              onClick={() => {
                setUploadMenu(false);
                setRefModal(true);
              }}
            >
              <span className="uo-title">
                Set Reference Swing
                {swing.reference && <span className="pill accent">{swing.referenceName}</span>}
              </span>
              <span className="uo-sub">
                Pick a model swing from the library or upload any clip — used by Dual
                Comparison, the ghost overlay, and DTW deviations.
              </span>
            </button>
          </div>
        </>
      )}

      {refModal && (
        <ReferenceModal
          onPickLibrary={loadLibraryReference}
          onUpload={() => startUpload("reference")}
          onClose={() => setRefModal(false)}
        />
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
        onGo={setScreen}
        onUpload={() => setUploadMenu(true)}
      />
    </div>
  );
}
