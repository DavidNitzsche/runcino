'use client';

/**
 * MergeToolbox — Recent Runs merge controls.
 *
 * Two affordances bundled together since they share workflow context:
 *
 *   1. "Tidy duplicates" — one-shot button that calls
 *      POST /api/runs/dedupe-backfill. Scans every existing row and folds
 *      auto-detected dupe-pairs (the same logic that runs at Strava ingest,
 *      retroactively applied to rows already in the DB).
 *
 *   2. "Merge mode" — toggle that enables row checkboxes. With 2+ rows
 *      selected, click "Merge selected" and the largest-distance row
 *      becomes the canonical; the rest are folded into it via
 *      POST /api/runs/merge. Lets the user manually merge pairs the
 *      auto-dedupe missed (e.g. crash + restart >15min apart).
 *
 * Selection state lives in React Context so RunRowIsland can read/toggle
 * it per-row without prop drilling. Toolbar sits sticky at the top of the
 * Recent Runs card.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface MergeContextValue {
  mergeMode: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
}

const MergeContext = createContext<MergeContextValue | null>(null);

export function MergeProvider({ children }: { children: ReactNode }) {
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value = useMemo<MergeContextValue>(
    () => ({ mergeMode, selected, toggle }),
    [mergeMode, selected, toggle],
  );

  const runBackfill = async () => {
    if (busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch('/api/runs/dedupe-backfill', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash(`Tidy failed: ${j?.error ?? res.statusText}`);
        return;
      }
      const folded = Number(j?.folded ?? 0);
      setFlash(folded === 0 ? 'No duplicates found — nothing to fold.' : `Folded ${folded} duplicate row${folded === 1 ? '' : 's'}. Reloading…`);
      if (folded > 0 && typeof window !== 'undefined') {
        setTimeout(() => window.location.reload(), 600);
      }
    } catch (e) {
      setFlash(`Tidy failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  const commitMerge = async () => {
    if (busy || selected.size < 2) return;
    setBusy(true);
    setFlash(null);
    try {
      // Pick canonical = the row with the largest distance among selected.
      // That's the read DOM scan — every row carries a data-distance
      // attribute (set in MergeRowCheckbox). Falls back to the first
      // selected id if data attrs are missing.
      const ids = Array.from(selected);
      let canonical = ids[0];
      let best = -1;
      for (const id of ids) {
        const el = document.querySelector(`[data-run-id="${id}"]`);
        const dist = Number(el?.getAttribute('data-run-distance') ?? '0');
        if (dist > best) { best = dist; canonical = id; }
      }
      const sources = ids.filter((id) => id !== canonical);
      const res = await fetch('/api/runs/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: Number(canonical), sourceIds: sources.map(Number) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash(`Merge failed: ${j?.error ?? res.statusText}`);
        return;
      }
      setFlash(`Merged ${sources.length} row${sources.length === 1 ? '' : 's'} into the canonical. Reloading…`);
      if (typeof window !== 'undefined') setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setFlash(`Merge failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  const turnOffMergeMode = () => {
    setMergeMode(false);
    setSelected(new Set());
  };

  return (
    <MergeContext.Provider value={value}>
      <div className="merge-toolbox">
        <button type="button" className="merge-btn ghost" disabled={busy} onClick={runBackfill}>
          Tidy duplicates
        </button>
        {!mergeMode ? (
          <button type="button" className="merge-btn ghost" disabled={busy} onClick={() => setMergeMode(true)}>
            Merge runs
          </button>
        ) : (
          <>
            <span className="merge-hint">
              {selected.size === 0
                ? 'Pick the rows to merge.'
                : selected.size === 1
                  ? '1 selected — pick one more.'
                  : `${selected.size} selected — largest-distance becomes canonical.`}
            </span>
            <button
              type="button"
              className="merge-btn primary"
              disabled={busy || selected.size < 2}
              onClick={commitMerge}
            >
              Merge selected
            </button>
            <button type="button" className="merge-btn ghost" disabled={busy} onClick={turnOffMergeMode}>
              Cancel
            </button>
          </>
        )}
        {flash && <span className="merge-flash">{flash}</span>}
      </div>
      {children}
      <style jsx>{`
        .merge-toolbox {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 28px 0;
          flex-wrap: wrap;
        }
        .merge-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase;
          padding: 8px 14px; border-radius: 6px; cursor: pointer;
          background: transparent; color: rgba(8,8,8,.65);
          border: 1px solid rgba(8,8,8,.16);
          transition: background .15s, color .15s, border-color .15s;
        }
        .merge-btn:hover:not(:disabled) { background: rgba(8,8,8,.04); color: #080808; }
        .merge-btn:disabled { opacity: .45; cursor: not-allowed; }
        .merge-btn.primary {
          background: var(--race, #E88021);
          color: #fff; border-color: var(--race, #E88021);
        }
        .merge-btn.primary:hover:not(:disabled) { background: #cf6e1a; border-color: #cf6e1a; color: #fff; }
        .merge-hint {
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(8,8,8,.6);
        }
        .merge-flash {
          margin-left: auto;
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(8,8,8,.7);
        }
      `}</style>
    </MergeContext.Provider>
  );
}

export function useMergeContext(): MergeContextValue {
  const ctx = useContext(MergeContext);
  if (!ctx) {
    // Outside the provider — return a no-op shape so rows render fine
    // when the page hasn't wrapped them (e.g. legacy callers).
    return { mergeMode: false, selected: new Set(), toggle: () => {} };
  }
  return ctx;
}
