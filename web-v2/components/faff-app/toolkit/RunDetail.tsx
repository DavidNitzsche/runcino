'use client';

/**
 * Faff Toolkit · Family I + D · Run Detail richness
 *
 * Renders the per-run data the backend already decodes but nothing
 * surfaces. Per Coverage Recommendations §01 Queue 02 · the highest
 * data-to-effort ratio in the gap doc.
 *
 *   RPEEntryCard       · Borg CR10 input + notes. GETs prior value from
 *                        /api/runs/[id]/rpe + POSTs new value to same.
 *
 * Each component is purely presentational except RPEEntryCard (live
 * roundtrip). Source data is passed in by the parent screen (RunDetailModal,
 * /runs/[id] page).
 */
import { useEffect, useState } from 'react';
import { FaError, FaSkeleton } from './atoms';

/* ============================================================
   RPEEntryCard · Borg CR10 1-10 scale + notes.
   GET pre-fill, POST submit, GET-pre-fill again on re-open. Closes
   line 727 (PARTIAL) + line 787 (prior RPE on re-open).
   ============================================================ */
type RpeState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function RPEEntryCard({
  runId,
  onSaved,
}: {
  runId: string;
  onSaved?: (rpe: number, notes: string) => void;
}) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [prior, setPrior] = useState<{ rpe: number | null; logged_at: string } | null>(null);
  const [state, setState] = useState<RpeState>('loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    fetch(`/api/runs/${encodeURIComponent(runId)}/rpe`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!alive) return;
        if (j.rpe && typeof j.rpe.rpe === 'number') {
          setRpe(j.rpe.rpe);
          setNotes(typeof j.rpe.notes === 'string' ? j.rpe.notes : '');
          setPrior({ rpe: j.rpe.rpe, logged_at: j.rpe.logged_at });
        }
        setState('idle');
      })
      .catch((e) => {
        if (alive) {
          setErr(e instanceof Error ? e.message : String(e));
          setState('error');
        }
      });
    return () => { alive = false; };
  }, [runId]);

  async function save() {
    if (rpe === null) return;
    setState('saving');
    setErr(null);
    try {
      const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/rpe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rpe, notes }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState('saved');
      onSaved?.(rpe, notes);
      setTimeout(() => setState('idle'), 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  if (state === 'loading') {
    return (
      <div className="fa-rpe" aria-busy="true">
        <FaSkeleton lines={3} />
      </div>
    );
  }

  return (
    <div className="fa-rpe">
      <div className="scale">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            type="button"
            className={`n${rpe === n ? ' sel' : ''}`}
            style={rpe === n ? { background: rpeColor(n) } : undefined}
            onClick={() => setRpe(n)}
            aria-pressed={rpe === n}
            aria-label={`Rate effort ${n} of 10`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="ends">
        <span>VERY EASY</span>
        <span>MAX</span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="How did it feel?"
        maxLength={400}
      />
      {prior && prior.rpe !== null ? (
        <div className="prior">Prior · <b>{prior.rpe}/10</b> logged {formatLoggedAt(prior.logged_at)}</div>
      ) : null}
      <button
        className="fa-submit"
        type="button"
        onClick={save}
        disabled={rpe === null || state === 'saving'}
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save RPE'}
      </button>
      {state === 'error' ? (
        <FaError text={`Couldn't save. ${err ?? ''}`.trim()} onRetry={save} />
      ) : null}
    </div>
  );
}

/* ────────── helpers ────────── */
function rpeColor(n: number): string {
  // Cool → hot ramp following the effort palette
  if (n <= 2) return 'var(--eff-recovery)';
  if (n <= 4) return 'var(--eff-easy)';
  if (n <= 6) return 'var(--eff-long)';
  if (n <= 8) return 'var(--eff-tempo)';
  return 'var(--eff-intervals)';
}
function formatLoggedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
