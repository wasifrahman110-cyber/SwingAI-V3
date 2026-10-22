/**
 * SwingJournal — qualitative feels, swing thoughts, and conditions, tied to
 * analyzed sessions. Card layout with #hashtag chips.
 */

import { useCallback, useState } from "react";
import type { JournalEntry, SessionRecord } from "../types/pose.ts";
import { addJournalEntry, deleteJournalEntry } from "../lib/sessionStore.ts";

const QUICK_TAGS = ["#Driver", "#Iron", "#Wedge", "#RangeSession", "#EarlyExtensionFix", "#Tempo"];

interface JournalProps {
  entries: readonly JournalEntry[];
  sessions: readonly SessionRecord[];
  latestSessionId: string | null;
  onEntriesChanged: (entries: JournalEntry[]) => void;
}

export function SwingJournal({
  entries,
  sessions,
  latestSessionId,
  onEntriesChanged,
}: JournalProps) {
  const [draft, setDraft] = useState("");
  const [attachSession, setAttachSession] = useState(true);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const entry = addJournalEntry(text, attachSession ? latestSessionId : null);
    if (entry) {
      onEntriesChanged([entry, ...entries]);
      setDraft("");
    }
  }, [draft, attachSession, latestSessionId, entries, onEntriesChanged]);

  const remove = useCallback(
    (id: string) => {
      deleteJournalEntry(id);
      onEntriesChanged(entries.filter((e) => e.id !== id));
    },
    [entries, onEntriesChanged],
  );

  const sessionLabel = (id: string | null): string | null => {
    if (!id) return null;
    const s = sessions.find((x) => x.id === id);
    return s ? `${s.label} · ${s.swingIndex.toFixed(1)}` : null;
  };

  return (
    <div className="screen">
      <h2 className="section-title">Swing Journal</h2>
      <div className="journal-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={
            "How did it feel? Swing thoughts, conditions, what clicked…\nUse #tags — e.g. #Driver #RangeSession #EarlyExtensionFix"
          }
          rows={10}
          className="journal-input-lg"
          aria-label="journal entry"
        />
        <div className="journal-quick-tags">
          {QUICK_TAGS.map((t) => (
            <button
              key={t}
              className="pill tag-chip"
              onClick={() => setDraft((d) => (d.includes(t) ? d : `${d} ${t}`.trim()))}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="journal-actions">
          <button
            className={`pill ${attachSession && latestSessionId ? "accent" : ""}`}
            onClick={() => setAttachSession((v) => !v)}
            disabled={!latestSessionId}
          >
            {latestSessionId
              ? attachSession
                ? "◉ linked to latest swing"
                : "○ not linked"
              : "no analyzed swing yet"}
          </button>
          <button className="journal-save" onClick={submit} disabled={!draft.trim()}>
            Save Note
          </button>
        </div>
      </div>

      {entries.length === 0 && (
        <div className="empty-note">
          No notes yet. After a range session, capture what the fix felt like —
          future-you will thank you.
        </div>
      )}

      {entries.map((e) => (
        <article className="journal-card" key={e.id}>
          <div className="journal-card-head">
            <span className="journal-date">
              {new Date(e.dateISO).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            {sessionLabel(e.sessionId) && (
              <span className="pill accent">{sessionLabel(e.sessionId)}</span>
            )}
            <button className="journal-delete" onClick={() => remove(e.id)} aria-label="delete note">
              ×
            </button>
          </div>
          <p className="journal-text">{e.text}</p>
          {e.tags.length > 0 && (
            <div className="journal-tags">
              {e.tags.map((t) => (
                <span className="pill tag-chip" key={t}>
                  #{t}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
