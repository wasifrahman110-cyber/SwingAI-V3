/**
 * useSwingAnalysis — owns the swing pair (bundled demo or live-extracted) and
 * the analysis lifecycle. Backend-first, in-browser engine fallback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeSwings } from "../lib/api.ts";
import { demoSwings } from "../lib/demoData.ts";
import type { AnalysisResult, SwingSequence } from "../types/pose.ts";

export interface SwingAnalysisState {
  user: SwingSequence;
  pro: SwingSequence;
  analysis: AnalysisResult | null;
  analyzing: boolean;
  error: string | null;
  isDemo: boolean;
  proIsDemo: boolean;
  replaceUserSwing: (seq: SwingSequence, video: HTMLVideoElement | null) => void;
  replaceProSwing: (seq: SwingSequence) => void;
  video: HTMLVideoElement | null;
}

export function useSwingAnalysis(): SwingAnalysisState {
  const demoRef = useRef(demoSwings());
  const [user, setUser] = useState<SwingSequence>(demoRef.current.user);
  const [pro, setPro] = useState<SwingSequence>(demoRef.current.pro);
  const [proIsDemo, setProIsDemo] = useState(true);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [isDemo, setIsDemo] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    setAnalyzing(true);
    setError(null);
    analyzeSwings(user, pro)
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
  }, [user, pro]);

  const replaceUserSwing = useCallback(
    (seq: SwingSequence, vid: HTMLVideoElement | null) => {
      setUser(seq);
      setVideo(vid);
      setIsDemo(false);
    },
    [],
  );

  const replaceProSwing = useCallback((seq: SwingSequence) => {
    setPro(seq);
    setProIsDemo(false);
  }, []);

  return {
    user,
    pro,
    analysis,
    analyzing,
    error,
    isDemo,
    proIsDemo,
    replaceUserSwing,
    replaceProSwing,
    video,
  };
}
