'use client';

/**
 * Faff Toolkit · Family I + D · Run Detail richness
 *
 * Renders the per-run data the backend already decodes but nothing
 * surfaces. Per Coverage Recommendations §01 Queue 02 · the highest
 * data-to-effort ratio in the gap doc.
 *
 *   PhaseBreakdownList · planned-vs-actual phase rows (warmup / work /
 *                        recovery / cooldown). Source: RunDetail.phase_breakdown.
 *   WorkSegmentRow     · work-segment-only pace / HR / cadence averages.
 *                        Source: RunDetail.{pace_work, hr_avg_work, cadence_avg_work}.
 *   FormMetricsGrid    · 8 form metrics with band colors. Source: RunDetail.form.
 *   RPEEntryCard       · Borg CR10 input + notes. GETs prior value from
 *                        /api/runs/[id]/rpe + POSTs new value to same.
 *   ZoneMethodToggle   · LTHR / %MHR zone method picker.
 *
 * Each component is purely presentational except RPEEntryCard (live
 * roundtrip). Source data is passed in by the parent screen (RunDetailModal,
 * /runs/[id] page).
 */
import { useEffect, useState } from 'react';
import { FaError, FaSkeleton } from './atoms';

/* ============================================================
   PhaseBreakdownList
   ============================================================ */
export interface PhaseRow {
  name: string;
  status: 'on' | 'fast' | 'slow' | 'skip';
  targetPace?: string;      // formatted (e.g. "7:45/mi")
  actualPace?: string;
  targetDistanceMi?: number;
  actualDistanceMi?: number;
  targetSeconds?: number;
  actualSeconds?: number;
  delta?: string;           // formatted (e.g. "+8s/mi", "–2s/mi")
}

export function PhaseBreakdownList({ phases }: { phases: PhaseRow[] }) {
  if (!phases || phases.length === 0) return null;
  return (
    <div className="fa-pva">
      {phases.map((p, i) => (
        <div key={i} className={`r ${p.status}`}>
          <span className="st" />
          <div>
            <div className="nm">{p.name}</div>
            <div className="tg">
              {p.targetPace ? <>tgt {p.targetPace}</> : null}
              {p.targetDistanceMi !== undefined ? (
                <> · {p.targetDistanceMi.toFixed(2)} mi</>
              ) : null}
            </div>
          </div>
          <div className="ac">
            <div className="v">{p.actualPace ?? '—'}</div>
            <div className="s">
              {p.delta ?? (p.status === 'on' ? 'ON' : p.status === 'fast' ? 'FAST' : p.status === 'slow' ? 'SLOW' : 'SKIP')}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   WorkSegmentRow · pace · HR · cadence over JUST the work blocks.
   ============================================================ */
export function WorkSegmentRow({
  paceWork,
  hrWork,
  cadenceWork,
  workSeconds,
}: {
  paceWork?: string;
  hrWork?: number;
  cadenceWork?: number;
  workSeconds?: number;
}) {
  if (!paceWork && !hrWork && !cadenceWork) return null;
  return (
    <div className="fa-substat">
      <span className="lead">
        WORK
        {workSeconds !== undefined ? <> · {formatDuration(workSeconds)}</> : null}
      </span>
      {paceWork ? (
        <span className="m">
          <span className="v">{paceWork}</span>
          <span className="k">PACE</span>
        </span>
      ) : null}
      {hrWork !== undefined ? (
        <span className="m">
          <span className="v">{hrWork} <small style={{ fontSize: '.6em', color: 'var(--fa-mute)' }}>bpm</small></span>
          <span className="k">HR</span>
        </span>
      ) : null}
      {cadenceWork !== undefined ? (
        <span className="m">
          <span className="v">{cadenceWork} <small style={{ fontSize: '.6em', color: 'var(--fa-mute)' }}>spm</small></span>
          <span className="k">CAD</span>
        </span>
      ) : null}
    </div>
  );
}

/* ============================================================
   FormMetricsGrid · 4×2 grid of 8 form metrics. Each cell colored
   by band. Caller resolves bands; toolkit doesn't own the thresholds.
   ============================================================ */
export interface FormCell {
  key: string;
  label: string;
  value: string | number | null;
  unit?: string;
  band?: 'good' | 'watch' | 'poor';
  onTap?: () => void;
}

export function FormMetricsGrid({ cells }: { cells: FormCell[] }) {
  const allEmpty = cells.every((c) => c.value === null || c.value === undefined);
  if (allEmpty) return null;
  return (
    <div className="fa-formgrid">
      {cells.map((c) => (
        <div
          key={c.key}
          className="cell"
          onClick={c.onTap}
          role={c.onTap ? 'button' : undefined}
          tabIndex={c.onTap ? 0 : undefined}
        >
          <div className="v">
            {c.value ?? '—'}
            {c.value !== null && c.unit ? <small> {c.unit}</small> : null}
          </div>
          <div className="k">{c.label}</div>
          {c.band ? <div className={`band fa-band-${c.band}`} /> : null}
        </div>
      ))}
    </div>
  );
}

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

/* ============================================================
   ZoneMethodToggle · LTHR / %MHR pill toggle. Pure presentational.
   ============================================================ */
export type ZoneMethod = 'lthr' | 'mhr';
export function ZoneMethodToggle({
  method,
  onChange,
}: {
  method: ZoneMethod;
  onChange: (m: ZoneMethod) => void;
}) {
  return (
    <div className="fa-seg" role="tablist" aria-label="HR zone method">
      <button
        type="button"
        role="tab"
        aria-selected={method === 'lthr'}
        className={method === 'lthr' ? 'sel' : ''}
        onClick={() => onChange('lthr')}
      >
        LTHR
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={method === 'mhr'}
        className={method === 'mhr' ? 'sel' : ''}
        onClick={() => onChange('mhr')}
      >
        %MHR
      </button>
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
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
function formatLoggedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
