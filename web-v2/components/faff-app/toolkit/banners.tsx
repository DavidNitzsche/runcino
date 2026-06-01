'use client';

/**
 * Faff Toolkit · Family E (Banners & Nudges)
 *
 * ReconnectBanner    · stale Strava + connections-skipped (line 1602)
 * ProfileGapCard     · "tell Faff your weight to tune fueling"
 * DailyCheckChip     · "how's your hamstring today?"
 *
 * ReconnectBanner is the data-bound one (talks to /api/strava/status);
 * the other two are presentational and let the caller wire their POST.
 */
import { useEffect, useState } from 'react';
import { FaError, FaSkeleton } from './atoms';

type StravaStatus =
  | { state: 'connected'; last_push_at: string | null }
  | { state: 'needs_reauth'; last_push_at: string | null; reason: string }
  | { state: 'disconnected'; last_push_at: string | null; reason: string };

/* ============================================================
   ReconnectBanner · talks to /api/strava/status.
   Variants:
     needs_reauth → warn, "RECONNECT" CTA
     disconnected → info, "CONNECT STRAVA" CTA
     connected    → renders nothing
   Optional `kind="connections-skipped"` flips into info mode for
   the onboarding-skipped (profile.connections_skipped=true) case
   covered by coverage row line 1602.
   ============================================================ */
export function ReconnectBanner({
  initialStatus,
  kind = 'strava',
  connectHref = '/api/auth/strava?action=connect&redirect=1',
  onDismiss,
}: {
  initialStatus?: StravaStatus | null;
  kind?: 'strava' | 'connections-skipped';
  connectHref?: string;
  onDismiss?: () => void;
}) {
  const [status, setStatus] = useState<StravaStatus | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(!initialStatus && kind === 'strava');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatus || kind !== 'strava') return;
    let alive = true;
    fetch('/api/strava/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (alive) setStatus(j as StravaStatus);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initialStatus, kind]);

  if (kind === 'connections-skipped') {
    return (
      <div className="fa-banner fa-banner--info">
        <span className="ic"><PlugIcon /></span>
        <span className="tx">
          <b>Connect a source</b> · we work better with Strava or Apple Health data.
        </span>
        <a className="cta" href={connectHref}>CONNECT</a>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              marginLeft: 8,
              background: 'transparent',
              border: 0,
              color: 'var(--fa-mute)',
              cursor: 'pointer',
              fontSize: 18,
              padding: '0 4px',
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fa-banner fa-banner--info" aria-busy="true">
        <span className="ic"><PlugIcon /></span>
        <span className="tx" style={{ flex: 1 }}>
          <FaSkeleton lines={1} />
        </span>
      </div>
    );
  }

  if (err) {
    // Fail soft, the banner is itself a nice-to-have, never alarm
    return null;
  }

  if (!status || status.state === 'connected') return null;

  const isReauth = status.state === 'needs_reauth';
  return (
    <div className={`fa-banner ${isReauth ? 'fa-banner--warn' : 'fa-banner--info'}`}>
      <span className="ic"><PlugIcon /></span>
      <span className="tx">
        <b>{isReauth ? 'Strava connection expired' : 'Strava disconnected'}</b>
        {status.reason ? <> · {status.reason}</> : null}
      </span>
      <a className="cta" href={connectHref}>RECONNECT</a>
    </div>
  );
}

/* ============================================================
   ProfileGapCard · "tell Faff your weight to tune fueling."
   Dashed border, amber-bright accent, dist CTA. Caller wires the
   target href (e.g. /me or a specific Settings row).
   ============================================================ */
export function ProfileGapCard({
  fragment,
  highlight,
  ctaLabel = 'UPDATE',
  ctaHref,
  onCta,
}: {
  fragment: string;
  highlight?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
}) {
  const Inner = ctaHref ? (
    <a className="upd" href={ctaHref}>{ctaLabel}</a>
  ) : (
    <button className="upd" type="button" onClick={onCta}>{ctaLabel}</button>
  );
  return (
    <div className="fa-gap">
      <span className="tx">
        {highlight ? (
          <>
            <b>{highlight}</b> {fragment}
          </>
        ) : (
          fragment
        )}
      </span>
      {Inner}
    </div>
  );
}

/* ============================================================
   DailyCheckChip · daily niggle / recovery prompt.
   The caller passes `question` and a list of options; we surface
   the selected one back through `onSelect`. Empty handler means
   the chip is read-only (e.g. preview state).
   ============================================================ */
export function DailyCheckChip({
  question,
  highlight,
  options,
  selected,
  onSelect,
}: {
  question: string;
  highlight?: string;
  options: string[];
  selected?: string;
  onSelect?: (value: string) => void;
}) {
  return (
    <div className="fa-checkin">
      <div className="q">
        {highlight ? (
          <>
            {question.split(highlight)[0]}
            <b>{highlight}</b>
            {question.split(highlight)[1] ?? ''}
          </>
        ) : (
          question
        )}
      </div>
      <div className="opts">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={selected === o ? 'sel' : ''}
            onClick={() => onSelect?.(o)}
            disabled={!onSelect}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   StateChangeToast · silent state change confirmation.
   Closes line 1236 (race retro auto-recalc VDOT/LTHR surface).
   Caller is in charge of mounting / unmounting + auto-dismiss.
   ============================================================ */
export function StateChangeToast({
  before,
  after,
  label,
  message,
}: {
  before: string | number;
  after: string | number;
  label: string;
  message?: string;
}) {
  return (
    <div className="fa-toast" role="status">
      <span className="ic"><SparkleIcon /></span>
      <span className="tx">
        {message ? (
          <>{message} </>
        ) : (
          <>{label} </>
        )}
        <b>{before} → {after}</b>
      </span>
    </div>
  );
}

/* ────────── inline icons ────────── */
function PlugIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2v3M11 2v3M3 5h10v2a5 5 0 01-5 5 5 5 0 01-5-5V5zM8 12v2" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />
    </svg>
  );
}
