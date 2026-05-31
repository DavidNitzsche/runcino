'use client';

/**
 * Faff Toolkit · Family C · Coach Transparency
 *
 * The highest-leverage family in the toolkit (Coverage Recommendations §01).
 * Three views of the same `coach_intents` audit log:
 *
 *   CoachActivityTimeline · the full 30-day history. Lives on Profile or
 *                           a dedicated /coach surface.
 *   WhatChangedExpander   · collapsed count pill → rows. Lives on /plan
 *                           filtered to reason LIKE 'plan_adapt_%'.
 *   AdaptationCard        · the single most-recent override. Lives on
 *                           Today when last_adapted_at < 24h.
 *
 * Backed by GET /api/coach/intents (see app/api/coach/intents/route.ts).
 *
 * Coverage rows closed:
 *   Today · "Adaptation events on Today" (line 238)
 *   Plan  · "Plan mutation history" (line 487)
 *   Plan  · "9 adaptation trigger types · per-trigger transparency" (line 580)
 *   Cross · "coach_intents activity log" (line 1999)
 */
import { useEffect, useMemo, useState } from 'react';
import { FaEmpty, FaError, FaSkeleton } from './atoms';

type Severity = 'info' | 'warn' | 'override';

export interface IntentRow {
  ts: string;
  reason: string;
  severity: Severity;
  summary: string;
  field: string | null;
  value: unknown;
}

interface IntentsResponse {
  ok: boolean;
  rows: IntentRow[];
}

function useIntents({
  limit,
  reasonPrefix,
  initial,
}: {
  limit?: number;
  reasonPrefix?: string;
  initial?: IntentRow[] | null;
}) {
  const [rows, setRows] = useState<IntentRow[] | null>(initial ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    setState('loading');
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (reasonPrefix) params.set('reason_prefix', reasonPrefix);
    fetch(`/api/coach/intents${params.toString() ? '?' + params.toString() : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: IntentsResponse) => {
        if (alive) {
          setRows(Array.isArray(j.rows) ? j.rows : []);
          setState('idle');
        }
      })
      .catch((e) => {
        if (alive) {
          setErr(e instanceof Error ? e.message : String(e));
          setState('error');
        }
      });
    return () => { alive = false; };
  }, [limit, reasonPrefix, initial]);

  return { rows, state, err };
}

/* ============================================================
   AdaptationCard · single most-recent override, with CTA into
   the WhatChangedExpander. Lives on Today.
   Renders nothing when there's no recent intent — the surface
   stays clean on uneventful days.
   ============================================================ */
export function AdaptationCard({
  initial,
  onOpenHistory,
  recencyHours = 36,
}: {
  initial?: IntentRow[] | null;
  onOpenHistory?: () => void;
  recencyHours?: number;
}) {
  const { rows, state } = useIntents({ limit: 5, initial });

  if (state === 'loading') {
    return (
      <div className="fa-adapt" aria-busy="true">
        <span className="badge">COACH</span>
        <div className="adapt-body" style={{ flex: 1 }}>
          <FaSkeleton lines={2} />
        </div>
      </div>
    );
  }
  if (state === 'error' || !rows) return null;

  const cutoff = Date.now() - recencyHours * 3600 * 1000;
  const recent = rows.find((r) => new Date(r.ts).getTime() >= cutoff);
  if (!recent) return null;

  const isOverride = recent.severity === 'override';
  return (
    <div className="fa-adapt" style={isOverride ? { borderColor: 'rgba(252,77,100,.4)' } : undefined}>
      <span className="badge">{isOverride ? 'COACH · OVERRIDE' : 'COACH · ADAPTED'}</span>
      <div className="adapt-body">
        <p className="ttl">{recent.summary}</p>
        <p className="why">{relativeTime(recent.ts)}</p>
        {onOpenHistory ? (
          <button className="act" type="button" onClick={onOpenHistory}>
            See what changed →
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================
   WhatChangedExpander · "your plan has been adjusted N times".
   Lives on /plan. Filters to reason LIKE 'plan_adapt_%' so the
   list is plan-mutations only.
   ============================================================ */
export function WhatChangedExpander({
  initial,
  reasonPrefix = 'plan_adapt',
  label = 'WHAT CHANGED',
}: {
  initial?: IntentRow[] | null;
  reasonPrefix?: string;
  label?: string;
}) {
  const { rows, state, err } = useIntents({ limit: 30, reasonPrefix, initial });

  if (state === 'loading') {
    return (
      <details className="fa-expander" aria-busy="true">
        <summary>
          <span className="cnt">…</span>
          <span className="lbl">{label}</span>
          <Chevron />
        </summary>
      </details>
    );
  }
  if (state === 'error') {
    return <FaError text={`Couldn't load adaptation history. ${err ?? ''}`.trim()} />;
  }
  if (!rows || rows.length === 0) {
    return (
      <FaEmpty text="No plan adaptations in the last 30 days." />
    );
  }

  return (
    <details className="fa-expander">
      <summary>
        <span className="cnt">{rows.length}</span>
        <span className="lbl">{label}</span>
        <Chevron />
      </summary>
      <div className="body">
        <ol className="fa-timeline" style={{ marginTop: 8, listStyle: 'none', padding: 0, paddingLeft: 22 }}>
          {rows.map((r, i) => (
            <li key={i} className={`ev sev-${r.severity}`}>
              <div className="when">{relativeTime(r.ts)}</div>
              <div className="what">{r.summary}</div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

/* ============================================================
   CoachActivityTimeline · full 30-day timeline.
   Lives on Profile or a dedicated /coach surface.
   Groups by day so the eye can scan "what happened this week."
   ============================================================ */
export function CoachActivityTimeline({
  initial,
  limit = 30,
}: {
  initial?: IntentRow[] | null;
  limit?: number;
}) {
  const { rows, state, err } = useIntents({ limit, initial });

  const grouped = useMemo(() => {
    if (!rows) return [];
    const buckets = new Map<string, IntentRow[]>();
    for (const r of rows) {
      const day = r.ts.slice(0, 10);
      if (!buckets.has(day)) buckets.set(day, []);
      buckets.get(day)!.push(r);
    }
    return Array.from(buckets.entries());
  }, [rows]);

  if (state === 'loading') {
    return (
      <div className="fa-timeline" aria-busy="true">
        <FaSkeleton lines={5} />
      </div>
    );
  }
  if (state === 'error') {
    return <FaError text={`Couldn't load coach activity. ${err ?? ''}`.trim()} />;
  }
  if (!rows || rows.length === 0) {
    return (
      <FaEmpty text="No coach activity yet · check back after a few workouts." />
    );
  }

  return (
    <ol className="fa-timeline" style={{ listStyle: 'none', padding: 0, paddingLeft: 22 }}>
      {grouped.flatMap(([day, list]) =>
        list.map((r, i) => (
          <li key={`${day}-${i}`} className={`ev sev-${r.severity}`}>
            <div className="when">{formatDay(r.ts)}</div>
            <div className="what">{r.summary}</div>
          </li>
        ))
      )}
    </ol>
  );
}

/* ────────── helpers ────────── */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days}D AGO`;
  return formatDay(iso);
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function Chevron() {
  return (
    <svg className="car" viewBox="0 0 16 16" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6l3 3 3-3" />
    </svg>
  );
}
