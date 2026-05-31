/**
 * Faff Toolkit · atoms (Family A · B · D · J primitives)
 *
 * Drop-in atoms that compose into the larger toolkit views. Every atom
 * here is presentational; data fetching lives in the composite that uses
 * it (RPEEntryCard, ReconnectBanner, AdaptationCard, etc.).
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

type EffortKey = 'recovery' | 'easy' | 'long' | 'tempo' | 'intervals' | 'rest';

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
  };
  return (
    <span className={`fa-effort fa-eff-${effort} ${className}`.trim()}>
      <span className="dot" style={{ background: 'currentColor' }} />
      {label ?? fallback[effort]}
    </span>
  );
}

/* ============================================================
   A · LoadBandChip — ACWR sweet-spot band (closes Today line 405).
   Doctrine bands per glance-state / fact-reciter.loadBand:
     detraining (<0.8)  → watch (amber)
     building (.8-1.0)  → info (blue)
     sweet_spot (1-1.3) → good (green)
     elevated (>1.3)    → watch (amber)
     spike (>1.5)       → off (red)
   ============================================================ */
export type LoadBand = 'detraining' | 'building' | 'sweet_spot' | 'elevated' | 'spike';
export function LoadBandChip({ band }: { band: LoadBand }) {
  const variant = {
    detraining: 'fa-chip--watch',
    building: 'fa-chip--info',
    sweet_spot: 'fa-chip--good',
    elevated: 'fa-chip--watch',
    spike: 'fa-chip--off',
  }[band];
  const label = {
    detraining: 'DETRAINING',
    building: 'BUILDING',
    sweet_spot: 'SWEET SPOT',
    elevated: 'ELEVATED',
    spike: 'SPIKE',
  }[band];
  return (
    <span className={`fa-chip ${variant}`}>
      <span className="dot" />
      LOAD · {label}
    </span>
  );
}

/* ============================================================
   A · RaceStatusDot — race-header status (line 1160).
   on_track → green · watch → amber · off → red.
   ============================================================ */
export type RaceStatus = 'on_track' | 'watch' | 'off';
export function RaceStatusDot({ status, reason }: { status: RaceStatus; reason?: string }) {
  const variant = {
    on_track: 'fa-chip--good',
    watch: 'fa-chip--watch',
    off: 'fa-chip--off',
  }[status];
  const label = {
    on_track: 'ON TRACK',
    watch: 'WATCH',
    off: 'OFF TRACK',
  }[status];
  return (
    <span className={`fa-chip ${variant}`} title={reason}>
      <span className="dot" />
      {label}
    </span>
  );
}

/* ============================================================
   A · DayStatePill — done_ease_off + missed inline pills.
   Closes Today lines 425 (PARTIAL done_ease_off) + 441 (NONE missed).
   ============================================================ */
export type DayStateKind = 'missed' | 'done_ease_off';
export function DayStatePill({
  kind,
  label,
  actions,
}: {
  kind: DayStateKind;
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
   B · ConditionsLine — one weather string for Today, Run Detail,
   Race Detail. Closes line 232 (Today heat tag).
   ============================================================ */
export function ConditionsLine({
  tempF,
  feelsF,
  windMph,
  dewF,
  hotFlag,
  className = '',
}: {
  tempF: number | null;
  feelsF?: number | null;
  windMph?: number | null;
  dewF?: number | null;
  hotFlag?: boolean;
  className?: string;
}) {
  if (tempF === null || tempF === undefined) return null;
  const tClass = hotFlag ? 'hot' : '';
  return (
    <span className={`fa-conditions ${className}`.trim()}>
      <CloudIcon />
      <span className={tClass}>{Math.round(tempF)}°F</span>
      {feelsF !== undefined && feelsF !== null ? (
        <>
          <span className="sep">·</span>
          <span>feels {Math.round(feelsF)}°</span>
        </>
      ) : null}
      {windMph !== undefined && windMph !== null ? (
        <>
          <span className="sep">·</span>
          <span>wind {Math.round(windMph)} mph</span>
        </>
      ) : null}
      {dewF !== undefined && dewF !== null ? (
        <>
          <span className="sep">·</span>
          <span>dew {Math.round(dewF)}°</span>
        </>
      ) : null}
    </span>
  );
}

/* ============================================================
   B · HRTargetPill — HR target + ceiling pill (line 604, 634).
   ============================================================ */
export function HRTargetPill({
  low,
  high,
  zone,
  cap,
}: {
  low: number;
  high: number;
  zone?: string;
  cap?: boolean;
}) {
  return (
    <span className={`fa-target${cap ? ' fa-target--cap' : ''}`}>
      <span className="lbl">{cap ? 'HR CAP' : 'HR'}</span>
      {low}–{high} bpm
      {zone ? <span style={{ color: 'var(--fa-mute)', marginLeft: 4 }}>({zone})</span> : null}
    </span>
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
   I · RunSourceBadge — watch / health / strava / manual indicator.
   ============================================================ */
export type RunSource = 'watch' | 'health' | 'strava' | 'manual';
export function RunSourceBadge({ source }: { source: RunSource }) {
  const Icon = {
    watch: WatchIcon,
    health: HeartIcon,
    strava: StravaIcon,
    manual: PencilIcon,
  }[source];
  const title = {
    watch: 'Apple Watch live',
    health: 'HealthKit',
    strava: 'Strava import',
    manual: 'Manual entry',
  }[source];
  return (
    <span className={`fa-source fa-source--${source}`} title={title} aria-label={title}>
      <Icon />
    </span>
  );
}

/* ============================================================
   I · ProjectionSparkline — VDOT / projection trend over weeks.
   Closes line 1106 (projection_snapshots).
   Renders an SVG sparkline + the latest value + direction.
   ============================================================ */
export function ProjectionSparkline({
  values,
  unitLabel,
  formatValue = (v: number) => String(v),
}: {
  values: Array<{ date: string; value: number }>;
  unitLabel: string;
  formatValue?: (v: number) => string;
}) {
  if (!values || values.length < 2) {
    return (
      <div className="fa-empty" role="status">
        <ChartIcon />
        <div className="t">Trend builds after a few weeks of data.</div>
      </div>
    );
  }
  const W = 120;
  const H = 36;
  const xs = values.map((_, i) => (i / (values.length - 1)) * (W - 4) + 2);
  const ys = values.map((v) => v.value);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const y = H - 4 - ((v.value - min) / span) * (H - 8);
      return `${xs[i]},${y}`;
    })
    .join(' ');
  const last = values[values.length - 1].value;
  const first = values[0].value;
  const delta = last - first;
  const isUp = delta > 0;
  const isFlat = delta === 0;
  return (
    <div className="fa-spark">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline
          points={points}
          fill="none"
          stroke={isUp ? 'var(--mint-readiness)' : isFlat ? 'var(--fa-mute)' : 'var(--over)'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="read">
        <div className="v">{formatValue(last)}</div>
        <div className={`d ${isUp ? 'up' : isFlat ? '' : 'down'}`}>
          {isUp ? '▲' : isFlat ? '·' : '▼'} {unitLabel}
        </div>
      </div>
    </div>
  );
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
function CloudIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a3 3 0 010-6 4 4 0 017.5-1A3.5 3.5 0 0114 12H4z" />
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
function WatchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4" y="3" width="8" height="10" rx="2" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 13s-5-3-5-7a2.5 2.5 0 015-1 2.5 2.5 0 015 1c0 4-5 7-5 7z" />
    </svg>
  );
}
function StravaIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 2l3 6h-2l-1 2-1-2H5l3-6z" />
      <path d="M9 10h2l-1 2-1-2z" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 3l2 2-7 7-2.5.5.5-2.5 7-7z" />
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
function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,11 6,7 9,9 14,4" />
    </svg>
  );
}
