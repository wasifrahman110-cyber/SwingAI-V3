/**
 * SwingAI — localStorage persistence for analyzed sessions and journal
 * entries. Pose data is stored rounded to 4 decimals; the session list is
 * capped (oldest evicted) to stay well inside localStorage quotas.
 */

import type {
  AnalysisResult,
  JournalEntry,
  SessionRecord,
  SwingSequence,
} from "../types/pose.ts";

const SESSIONS_KEY = "swingai.sessions.v2";
const JOURNAL_KEY = "swingai.journal.v2";
const MAX_SESSIONS = 12;

const uid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const safeParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // sandboxed iframe / privacy mode — persistence disabled
  }
};

// Sessions
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

const compactSwing = (s: SwingSequence): SwingSequence => ({
  fps: s.fps,
  leadSide: s.leadSide,
  frames: s.frames.map((f) =>
    f.map((lm) => ({
      x: round4(lm.x),
      y: round4(lm.y),
      z: round4(lm.z),
      visibility: round4(lm.visibility),
    })),
  ),
});

export function loadSessions(): SessionRecord[] {
  return safeParse<SessionRecord[]>(storage()?.getItem(SESSIONS_KEY) ?? null, []);
}

export function saveSession(
  label: string,
  swing: SwingSequence,
  analysis: AnalysisResult,
): SessionRecord | null {
  const store = storage();
  if (!store) return null;
  const record: SessionRecord = {
    id: uid(),
    dateISO: new Date().toISOString(),
    label,
    mode: analysis.mode,
    swingIndex: analysis.swingIndex,
    faultCodes: analysis.faults.map((f) => f.code),
    swing: compactSwing(swing),
  };
  const sessions = [record, ...loadSessions()].slice(0, MAX_SESSIONS);
  try {
    store.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // quota exceeded — drop the pose payloads of the oldest half and retry
    const slim = sessions.map((s, i) =>
      i > MAX_SESSIONS / 2 ? { ...s, swing: { ...s.swing, frames: [] } } : s,
    );
    try {
      store.setItem(SESSIONS_KEY, JSON.stringify(slim));
    } catch {
      return null;
    }
  }
  return record;
}

export function deleteSession(id: string): void {
  const store = storage();
  if (!store) return;
  store.setItem(
    SESSIONS_KEY,
    JSON.stringify(loadSessions().filter((s) => s.id !== id)),
  );
}

// Journal
export function loadJournal(): JournalEntry[] {
  return safeParse<JournalEntry[]>(storage()?.getItem(JOURNAL_KEY) ?? null, []);
}

/** Extract #hashtags from free text (e.g. "#Driver #RangeSession"). */
export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/#([A-Za-z0-9_-]+)/g)) {
    const tag = m[1];
    if (tag) tags.add(tag);
  }
  return [...tags];
}

export function addJournalEntry(
  text: string,
  sessionId: string | null,
): JournalEntry | null {
  const store = storage();
  if (!store) return null;
  const entry: JournalEntry = {
    id: uid(),
    dateISO: new Date().toISOString(),
    sessionId,
    text,
    tags: extractTags(text),
  };
  const all = [entry, ...loadJournal()].slice(0, 200);
  try {
    store.setItem(JOURNAL_KEY, JSON.stringify(all));
  } catch {
    return null;
  }
  return entry;
}

export function deleteJournalEntry(id: string): void {
  const store = storage();
  if (!store) return;
  store.setItem(
    JOURNAL_KEY,
    JSON.stringify(loadJournal().filter((e) => e.id !== id)),
  );
}
