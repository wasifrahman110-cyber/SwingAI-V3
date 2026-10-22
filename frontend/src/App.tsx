/**
 * SwingAI app shell (V4 = V2 baseline + expanded diagnostics) — phone frame,
 * 5-view navigation (Home, Journal, upload, Drill Studio, Progress + the
 * player), MediaPipe upload flows for both the analyzed swing and the
 * reference swing, localStorage session persistence.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DrillStudio } from "./components/DrillStudio.tsx";
import { HomeScreen } from "./components/HomeScreen.tsx";
import { ProgressScreen } from "./components/ProgressScreen.tsx";
import { ReferenceModal } from "./components/ReferenceModal.tsx";
import { SwingDetailScreen } from "./components/SwingDetailScreen.tsx";
import { SwingJournal } from "./components/SwingJournal.tsx";
import { SignIn, loadProfile, type UserProfile } from "./components/SignIn.tsx";
import { Walkthrough, tourSeen } from "./components/Walkthrough.tsx";
import { TabBar, type Screen } from "./components/TabBar.tsx";
import { useMediaPipe } from "./hooks/useMediaPipe.ts";
import { useSwingAnalysis } from "./hooks/useSwingAnalysis.ts";
import { REFERENCE_LIBRARY, demoDashboard } from "./lib/demoData.ts";
import { prettyClipName } from "./lib/clipName.ts";
import { loadJournal, loadSessions, saveSession } from "./lib/sessionStore.ts";
import type { JournalEntry, PhaseName, SessionRecord, SwingSequence } from "./types/pose.ts";

/** Left-to-right order of the swipeable top-level pages. */
const PAGE_ORDER: Screen[] = ["home", "journal", "studio", "progress"];
/** A swipe only counts when it begins inside this margin (px) of an edge. */
const EDGE_ZONE_PX = 32;
const SWIPE_MIN_PX = 56;

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile());
  const [showTour, setShowTour] = useState(() => !tourSeen());
  const [openPhase, setOpenPhase] = useState<PhaseName | null>(null);
  const [uploadMenu, setUploadMenu] = useState(false);
  const [refModal, setRefModal] = useState(false);
  const uploadTargetRef = useRef<"user" | "reference" | "dtl">("user");
  const [dtlSwing, setDtlSwing] = useState<SwingSequence | null>(null);
  const [dtlVideo, setDtlVideo] = useState<HTMLVideoElement | null>(null);
  const swing = useSwingAnalysis();
  const mediapipe = useMediaPipe();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dashboard = useRef(demoDashboard()).current;

  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [journal, setJournal] = useState<JournalEntry[]>(() => loadJournal());

  // Track every object URL we mint so they are revoked on unmount.
  const objectUrlsRef = useRef<string[]>([]);
  const mintUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.push(url);
    return url;
  }, []);
  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    },
    [],
  );

  // auto-save each newly analyzed swing (once per swing) into the library
  const lastSavedRef = useRef<SwingSequence | null>(null);
  const sessionsRef = useRef<SessionRecord[]>([]);
  sessionsRef.current = sessions;
  useEffect(() => {
    if (!swing.analysis || swing.analyzing) return;
    if (lastSavedRef.current === swing.user) return;
    lastSavedRef.current = swing.user;
    const label = swing.isDemo ? "Demo Swing" : "My Swing";
    // don't re-save an identical demo swing on every app open
    if (
      swing.isDemo &&
      sessionsRef.current.some(
        (s) =>
          s.label === "Demo Swing" &&
          s.swingIndex === swing.analysis?.swingIndex &&
          s.swing.frames.length === swing.user.frames.length,
      )
    ) {
      return;
    }
    const rec = saveSession(label, swing.user, swing.analysis);
    if (rec) setSessions((prev) => [rec, ...prev].slice(0, 12));
  }, [swing.analysis, swing.analyzing, swing.user, swing.isDemo]);

  const goDetail = useCallback((phase?: PhaseName) => {
    setOpenPhase(phase ?? null);
    setScreen("detail");
  }, []);

  const makeVideo = useCallback(
    (blob: Blob): HTMLVideoElement => {
      const v = document.createElement("video");
      v.src = mintUrl(blob);
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      return v;
    },
    [mintUrl],
  );

  const onPickFile = useCallback(
    async (file: File) => {
      const target = uploadTargetRef.current;
      const seq = await mediapipe.extract(file, profile?.leadSide ?? "left");
      if (!seq) return;
      if (target === "reference") {
        swing.setReference(seq, file.name.replace(/\.[^.]+$/, ""), makeVideo(file));
      } else if (target === "dtl") {
        setDtlSwing(seq);
        setDtlVideo(makeVideo(file));
      } else {
        swing.replaceUserSwing(seq, makeVideo(file));
      }
      setScreen("detail");
    },
    [mediapipe, swing, makeVideo, profile],
  );

  const startUpload = useCallback((target: "user" | "reference" | "dtl") => {
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
      lastSavedRef.current = s.swing; // don't re-save what we just loaded
      swing.replaceUserSwing(s.swing, null, s.label === "Demo Swing" ? "demo" : undefined);
      setScreen("detail");
    },
    [swing],
  );

  // Edge-swipe page navigation. The gesture must START within EDGE_ZONE_PX of
  // a screen edge, which keeps it clear of the canvas scrub/telestrator drags
  // that own the middle of the player.
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const onSwipeStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (screen === "detail") return; // player owns its own horizontal drags
    const w = e.currentTarget.clientWidth || window.innerWidth;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (x > EDGE_ZONE_PX && x < w - EDGE_ZONE_PX) return;
    swipeRef.current = { x: e.clientX, y: e.clientY };
  }, [screen]);
  const onSwipeEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = swipeRef.current;
      swipeRef.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const i = PAGE_ORDER.indexOf(screen);
      if (i === -1) return;
      const next = PAGE_ORDER[dx < 0 ? i + 1 : i - 1];
      if (next) setScreen(next);
    },
    [screen],
  );

  const busy =
    mediapipe.status.state === "loading-model" || mediapipe.status.state === "extracting";

  return (
    <div
      className="phone"
      onPointerDown={onSwipeStart}
      onPointerUp={onSwipeEnd}
      onPointerCancel={() => (swipeRef.current = null)}
    >
      {screen === "home" && (
        <HomeScreen
          userName={profile?.name ?? "Golfer"}
          dashboard={dashboard}
          analysis={swing.analysis}
          sessions={sessions}
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
          playerName={profile?.name ?? "Golfer"}
          dtl={dtlSwing}
          dtlVideo={dtlVideo}
          onBack={() => setScreen("home")}
          onSetMode={swing.setMode}
          onNeedReference={() => setRefModal(true)}
          onNeedDtl={() => startUpload("dtl")}
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
                Upload your swing video — pose is extracted on-device and analyzed instantly.
              </span>
            </button>
            <button className="upload-option" onClick={() => startUpload("dtl")}>
              <span className="uo-title">
                Add Down-the-Line Clip
                {dtlSwing && <span className="pill accent">loaded</span>}
              </span>
              <span className="uo-sub">
                A side-view (DTL) recording of the same swing — unlocks Multi-Angle
                mode with the face-on clip.
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
                {swing.reference && <span className="pill accent">{prettyClipName(swing.referenceName)}</span>}
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

      <TabBar screen={screen} busy={busy} onGo={setScreen} onUpload={() => setUploadMenu(true)} />

      {!profile && <SignIn onDone={setProfile} />}
      {profile && showTour && <Walkthrough onDone={() => setShowTour(false)} />}
    </div>
  );
}
