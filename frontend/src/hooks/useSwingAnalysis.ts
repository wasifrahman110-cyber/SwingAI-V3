/**
 * useSwingAnalysis (V2) — owns the analyzed swing, the optional reference
 * swing, and the SINGLE / DUAL mode. Backend-first, in-browser fallback.
 * No forced pro baseline: the app boots in solo mode.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeSwings } from "../lib/api.ts";
import { demoSwings } from "../lib/demoData.ts";
import type { AnalysisMode, AnalysisResult, SwingSequence } from "../types/pose.ts";

export interface SwingAnalysisState {
  user: SwingSequence;
  reference: SwingSequence | null;
  referenceName: string | null;
  mode: AnalysisMode;
  analysis: AnalysisResult | null;
  analyzing: boolean;
  error: string | null;
  isDemo: boolean;
  video: HTMLVideoElement | null;
  referenceVideo: HTMLVideoElement | null;
  setMode: (mode: AnalysisMode) => void;
  replaceUserSwing: (
    seq: SwingSequence,
    video: HTMLVideoElement | null,
    label?: string,
  ) => void;
  setReference: (
    seq: SwingSequence,
    name: string,
    video: HTMLVideoElement | null,
  ) => void;
  clearReference: () => void;
}

export function useSwingAnalysis(): SwingAnalysisState {
  const demoRef = useRef(demoSwings());
  const [user, setUser] = useState<SwingSequence>(demoRef.current.user);
  const [reference, setReferenceSeq] = useState<SwingSequence | null>(null);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [mode, setModeState] = useState<AnalysisMode>("solo");
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<HTMLVideoElement | null>(null);
  const [isDemo, setIsDemo] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    setAnalyzing(true);
    setError(null);
    const ref = mode === "dual" ? reference : null;
    analyzeSwings(user, ref)
      .then((result) => {
        if (runIdRef.current === runId) setAnalysis(result);
      })
      .catch((err: unknown) => {
        if (runIdRef.current === runId) {
          setError(err instanceof Error ? err.message : "analysis failed");
        }
      })
      .finally(() => {
        if (runIdRef.current === runId) setAnalyzing(false);
      });
  }, [user, reference, mode]);

  const setMode = useCallback((m: AnalysisMode) => setModeState(m), []);

  const replaceUserSwing = useCallback(
    (seq: SwingSequence, vid: HTMLVideoElement | null, label?: string) => {
      setUser(seq);
      setVideo(vid);
      setIsDemo(label === "demo");
    },
    [],
  );

  const setReference = useCallback(
    (seq: SwingSequence, name: string, vid: HTMLVideoElement | null) => {
      setReferenceSeq(seq);
      setReferenceName(name);
      setReferenceVideo(vid);
      setModeState("dual");
    },
    [],
  );

  const clearReference = useCallback(() => {
    setReferenceSeq(null);
    setReferenceName(null);
    setReferenceVideo(null);
    setModeState("solo");
  }, []);

  return {
    user,
    reference,
    referenceName,
    mode,
    analysis,
    analyzing,
    error,
    isDemo,
    video,
    referenceVideo,
    setMode,
    replaceUserSwing,
    setReference,
    clearReference,
  };
}
