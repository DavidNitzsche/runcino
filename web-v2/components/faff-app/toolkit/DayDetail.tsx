'use client';

/**
 * Faff Toolkit · Family D · Day Detail disclosure & education
 *
 *   WorkoutWhyCard      · "WHY this workout" expander with citation +
 *                          deep link into /learn/[slug]. Closes line 618.
 *   WatchPreviewTimeline · "what the watch will buzz you through". Live
 *                          fetch from /api/watch/today?date=… Closes line 689.
 *
 * Builds on the Family D `.fa-why`, `.fa-phases`, and shared loading/empty
 * shapes from atoms.tsx.
 */
import { useEffect, useState } from 'react';
import { CitationChip, EffortDot, FaError, FaSkeleton } from './atoms';

/* ============================================================
   WorkoutWhyCard · collapsed Disclosure with citation row.
   Renders inside the existing Day Detail layout (above or below
   the FUELING block).
   ============================================================ */
export function WorkoutWhyCard({
  body,
  citations,
  sourceLabel,
  label = 'WHY THIS WORKOUT',
}: {
  body: string;
  citations: Array<{ slug: string; label: string }>;
  sourceLabel?: string;
  label?: string;
}) {
  if (!body && (!citations || citations.length === 0)) return null;
  return (
    <details className="fa-why">
      <summary>
        {label}
        <Chevron />
      </summary>
      <div className="cite">
        <p>{body}</p>
        {citations && citations.length > 0 ? (
          <div className="fa-cite-row">
            {citations.map((c) => (
              <CitationChip key={c.slug} slug={c.slug} label={c.label} />
            ))}
          </div>
        ) : null}
        {sourceLabel ? <span className="src">{sourceLabel}</span> : null}
      </div>
    </details>
  );
}

/* ============================================================
   WatchPreviewTimeline · phase list mirroring what the watch
   will buzz you through. Pulls from /api/watch/today?date=…
   ============================================================ */
type WatchPhase = {
  type: 'warmup' | 'work' | 'recovery' | 'cooldown';
  label: string;
  durationSec: number;
  targetPaceSPerMi?: number | null;
  tolerancePaceSPerMi?: number | null;
  haptic: string;
  repUnit?: 'time' | 'distance';
  distanceMi?: number | null;
};

interface WatchPayload {
  workout?: {
    name?: string;
    summary?: string;
    phases: WatchPhase[];
  };
  message?: string;
}

export function WatchPreviewTimeline({
  date,
  initial,
}: {
  date?: string;
  initial?: WatchPayload | null;
}) {
  const [data, setData] = useState<WatchPayload | null>(initial ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    setState('loading');
    const qs = date ? `?date=${date}` : '';
    fetch(`/api/watch/today${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: WatchPayload) => {
        if (alive) { setData(j); setState('idle'); }
      })
      .catch((e) => {
        if (alive) {
          setErr(e instanceof Error ? e.message : String(e));
          setState('error');
        }
      });
    return () => { alive = false; };
  }, [date, initial]);

  if (state === 'loading') {
    return (
      <div className="fa-phases" aria-busy="true">
        <FaSkeleton lines={4} />
      </div>
    );
  }
  if (state === 'error') {
    return <FaError text={`Couldn't load watch preview. ${err ?? ''}`.trim()} />;
  }
  if (!data?.workout?.phases?.length) return null;

  return (
    <div className="fa-phases">
      {data.workout.phases.map((p, i) => (
        <div key={i} className="ph" data-eff={effortForPhase(p)}>
          <div className="hap" aria-label={`Haptic · ${p.haptic}`}>
            <HapticIcon type={p.type} />
          </div>
          <div>
            <div className="nm" style={{ color: effortColor(p) }}>{p.label}</div>
            <div className="sub">{phaseTypeLabel(p.type)}</div>
          </div>
          <div className="tgt">
            <div className="p">{formatTarget(p)}</div>
            <div className="d">{phaseDuration(p)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────── helpers ────────── */
function formatTarget(p: WatchPhase): string {
  if (p.targetPaceSPerMi) {
    const m = Math.floor(p.targetPaceSPerMi / 60);
    const s = p.targetPaceSPerMi % 60;
    return `${m}:${String(s).padStart(2, '0')}/mi`;
  }
  return '—';
}
function phaseDuration(p: WatchPhase): string {
  if (p.repUnit === 'distance' && p.distanceMi !== null && p.distanceMi !== undefined) {
    return `${p.distanceMi.toFixed(2)} MI`;
  }
  const m = Math.round(p.durationSec / 60);
  return `${m} MIN`;
}
function phaseTypeLabel(t: WatchPhase['type']): string {
  return { warmup: 'WARM UP', work: 'WORK', recovery: 'RECOVERY', cooldown: 'COOL DOWN' }[t];
}
function effortForPhase(p: WatchPhase): string {
  return { warmup: 'easy', work: 'tempo', recovery: 'recovery', cooldown: 'easy' }[p.type];
}
function effortColor(p: WatchPhase): string {
  return {
    warmup: 'var(--eff-easy)',
    work: 'var(--eff-tempo)',
    recovery: 'var(--eff-recovery)',
    cooldown: 'var(--eff-easy)',
  }[p.type];
}

function Chevron() {
  return (
    <svg className="car" viewBox="0 0 16 16" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6l3 3 3-3" />
    </svg>
  );
}

function HapticIcon({ type }: { type: WatchPhase['type'] }) {
  if (type === 'warmup') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12l4-7 4 7" />
      </svg>
    );
  }
  if (type === 'work') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="4" />
      </svg>
    );
  }
  if (type === 'recovery') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8a5 5 0 0010 0M3 8h10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l4 7 4-7" />
    </svg>
  );
}
