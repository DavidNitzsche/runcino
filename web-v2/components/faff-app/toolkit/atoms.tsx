'use client';

/**
 * Faff Toolkit · atoms (Family A · B · D · J primitives)
 *
 * Drop-in atoms that compose into the larger toolkit views. Most atoms
 * here are presentational; a few (StreakPill) lazy-fetch their own data.
 *
 * Source of truth · designs/from Design agent/design_handoff_faff_toolkit
 *   tokens.css     · the .fa-* class system
 *   components.css · per-component shapes + states
 *
 * Legibility laws (non-negotiable, see toolkit README §"Legibility & color"):
 *   1. Guarantee contrast on the mesh.
 *   2. Secondary text is solid (--fa-mute), never faded; hierarchy comes
 *      from weight/size/case, never opacity below ~0.8.
 *   3. Effort & heat colors accent the dot/border/chip, NOT the sentence.
 *   4. Meet contrast floor (body & labels ≥ 4.5:1, large/chip ≥ 3:1).
 */
import React from 'react';

type EffortKey = 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'rest' | 'race';

/* ============================================================
   A · EffortDot — single source of effort color across surfaces.
   Renders the dot + uppercase label using .fa-eff-* token colors.
   ============================================================ */
export function EffortDot({
  effort,
  label,
  className = '',
}: {
  effort: EffortKey;
  label?: string;
  className?: string;
}) {
  const fallback: Record<EffortKey, string> = {
    recovery: 'RECOVERY',
    easy: 'EASY',
    long: 'LONG',
    tempo: 'TEMPO',
    intervals: 'INTERVALS',
    rest: 'REST',
    race: 'RACE',
  };
  return (
    <span className={`fa-effort fa-eff-${effort} ${className}`.trim()}>
      <span className="dot" style={{ background: 'currentColor' }} />
      {label ?? fallback[effort]}
    </span>
  );
}

/* ============================================================
   A · DayStatePill — done_ease_off + missed inline pills.
   Closes Today lines 425 (PARTIAL done_ease_off) + 441 (NONE missed).
   ============================================================ */
export function DayStatePill({
  kind,
  label,
  actions,
}: {
  kind: 'missed' | 'done_ease_off';
  label: string;
  actions?: Array<{ label: string; onClick: () => void }>;
}) {
  const variant = kind === 'missed' ? 'fa-statepill--missed' : 'fa-statepill--ease';
  const tag = kind === 'missed' ? 'MISSED' : 'EASE OFF';
  return (
    <div className={`fa-statepill ${variant}`}>
      <span className="lead">
        <span className="tag">{tag}</span>
        {label}
      </span>
      {actions && actions.length > 0 ? (
        <span className="acts">
          {actions.map((a, i) => (
            <button key={i} type="button" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/* ============================================================
   B · ProvenanceLine — the grey "where this number came from"
   subline. Drop under LTHR, HRmax, VDOT, weight. Closes line 1569.
   "set" is the date string the caller passes (already formatted).
   "method" is the source label (race name, "estimated from MHR", etc).
   "stale" → amber tint when the value is older than the freshness floor.
   ============================================================ */
export function ProvenanceLine({
  set,
  method,
  stale,
}: {
  set?: string | null;
  method: string;
  stale?: boolean;
}) {
  return (
    <p className={`fa-prov${stale ? ' is-stale' : ''}`}>
      {set ? <>Set {set} · </> : null}
      <b>{method}</b>
    </p>
  );
}

/* ============================================================
   B · StatTile — bold Oswald number with optional explainer caret.
   Used in Health/Profile to render LTHR / HRmax / VDOT / Weight tiles.
   ============================================================ */
export function StatTile({
  value,
  unit,
  label,
  onExplain,
  explainText = 'WHY',
}: {
  value: string | number;
  unit?: string;
  label: string;
  onExplain?: () => void;
  explainText?: string;
}) {
  return (
    <div className="fa-stat">
      <div className="v">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      <div className="k">{label}</div>
      {onExplain ? (
        <button className="explain" type="button" onClick={onExplain}>
          {explainText}
          <Caret />
        </button>
      ) : null}
    </div>
  );
}

/* ============================================================
   J · CitationChip — deep-links into /learn/[slug].
   Atom shared by RunPurposeCard, RunRecapCard, WorkoutWhyCard.
   ============================================================ */
export function CitationChip({
  slug,
  label,
}: {
  slug: string;
  label: string;
}) {
  return (
    <a href={`/learn/${slug}`} className="fa-cite-chip">
      <BookIcon />
      {label}
    </a>
  );
}

/* ============================================================
   J · HeatBandChip — neutral / warm / hot / extreme.
   Closes line 384 (heatBand classification).
   ============================================================ */
export type HeatBand = 'neutral' | 'warm' | 'hot' | 'extreme';
export function HeatBandChip({ band, tempF }: { band: HeatBand; tempF?: number }) {
  const label = {
    neutral: 'NEUTRAL',
    warm: 'WARM',
    hot: 'HOT',
    extreme: 'EXTREME HEAT',
  }[band];
  return (
    <span className={`fa-heat fa-heat--${band}`}>
      <FlameIcon />
      {tempF !== undefined ? <>{Math.round(tempF)}°F · </> : null}
      {label}
    </span>
  );
}

/* ============================================================
   I · StreakPill — current consecutive-day streak counter with
   milestone target. Closes coverage row 1281 (now unblocked by
   GET /api/streak landing on main).
   ============================================================ */
export function StreakPill({ initial }: { initial?: StreakPayload | null } = {}) {
  const [data, setData] = React.useState<StreakPayload | null>(initial ?? null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');

  React.useEffect(() => {
    if (initial) return;
    let alive = true;
    fetch('/api/streak')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: StreakPayload) => {
        if (alive) { setData(j); setState('idle'); }
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [initial]);

  if (state !== 'idle' || !data || data.current < 1) return null;

  const ms = data.isMilestoneToday;
  return (
    <span
      className={`fa-chip ${ms ? 'fa-chip--good' : 'fa-chip--info'}`}
      title={
        data.nextMilestone
          ? `Next milestone: ${data.nextMilestone} days (${data.daysToMilestone} to go)`
          : undefined
      }
    >
      <span className="dot" />
      {data.current}-DAY STREAK
      {ms ? ' · MILESTONE' : ''}
    </span>
  );
}

interface StreakPayload {
  ok: boolean;
  current: number;
  longestPrior: number;
  nextMilestone: number | null;
  daysToMilestone: number | null;
  isMilestoneToday: boolean;
}

/* ============================================================
   SHARED STATES · skeleton + empty + error helpers for any
   data-bound consumer.
   ============================================================ */
export function FaSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div role="status" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`fa-skel fa-skel-line ${i === 0 ? 'w80' : i === lines - 1 ? 'w40' : 'w60'}`}
        />
      ))}
    </div>
  );
}

export function FaEmpty({ text, ctaLabel, onCta }: { text: string; ctaLabel?: string; onCta?: () => void }) {
  return (
    <div className="fa-empty" role="status">
      <DotIcon />
      <div className="t">{text}</div>
      {ctaLabel && onCta ? (
        <button className="cta" type="button" onClick={onCta}>
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

export function FaError({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="fa-err" role="alert">
      <AlertIcon />
      <span className="t">{text}</span>
      {onRetry ? (
        <button className="retry" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ────────── inline SVGs (no external deps) ────────── */
function Caret() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 6l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3.5A1.5 1.5 0 014.5 2h6A1.5 1.5 0 0112 3.5V13l-3.5-2L5 13V3.5z" />
    </svg>
  );
}
function FlameIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14c2.8 0 5-2 5-4.5 0-2-1.5-3-2-4-1 1-2 2-3 2-2 0-2.5-2-2.5-2S3 7 3 9.5 5.2 14 8 14z" />
    </svg>
  );
}
function DotIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L2 13h12L8 2z" />
      <line x1="8" y1="7" x2="8" y2="10" />
      <circle cx="8" cy="11.5" r=".5" fill="currentColor" />
    </svg>
  );
}
