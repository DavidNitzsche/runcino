'use client';

/**
 * Faff Toolkit · Family G · Settings rows
 *
 *   NotificationPrefsList · 7-category switch list backed by
 *                           /api/profile/notifications (full GET + PATCH
 *                           on each toggle change). Closes line 1806.
 *   ConnectionRow         · per-source row with sync status dot.
 *                           Closes line 1821.
 *   SettingValueRow       · generic label + value/switch/button.
 *                           Closes line 2034 (phone_hr_alerts toggle).
 */
import { useEffect, useState } from 'react';
import { FaError, FaSkeleton } from './atoms';

interface NotificationPrefs {
  master_enabled: boolean;
  race_day_enabled: boolean;
  race_eve_enabled: boolean;
  skip_recovery_enabled: boolean;
  weekly_checkin_enabled: boolean;
  niggle_sick_enabled: boolean;
  streak_enabled: boolean;
  strava_reconnect_enabled: boolean;
  race_day_wake_time: string;
  weekly_checkin_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

const ROW_DEFS: Array<{
  key: keyof NotificationPrefs;
  label: string;
  sub: string;
}> = [
  { key: 'master_enabled', label: 'All notifications', sub: 'Master switch · turns everything off when off' },
  { key: 'race_day_enabled', label: 'Race day', sub: 'Race-morning wake + start window' },
  { key: 'race_eve_enabled', label: 'Race eve', sub: 'Evening-before brief at T-21h' },
  { key: 'skip_recovery_enabled', label: 'Workout reminders', sub: 'Pre-run brief on planned days' },
  { key: 'weekly_checkin_enabled', label: 'Weekly check-in', sub: 'Sunday recap + week-ahead context' },
  { key: 'niggle_sick_enabled', label: 'Niggle / sick check', sub: 'Daily check-in when something is active' },
  { key: 'streak_enabled', label: 'Streak milestones', sub: '7 · 14 · 30 · 100 day streaks' },
  { key: 'strava_reconnect_enabled', label: 'Strava reconnect', sub: 'Nudge when the token goes stale' },
];

/* ============================================================
   NotificationPrefsList
   ============================================================ */
export function NotificationPrefsList({ initial }: { initial?: NotificationPrefs | null }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(initial ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'error'>(initial ? 'idle' : 'loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    setState('loading');
    fetch('/api/profile/notifications')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (alive) {
          setPrefs((j.prefs ?? null) as NotificationPrefs | null);
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
  }, [initial]);

  async function toggle(key: keyof NotificationPrefs) {
    if (!prefs) return;
    const next = !prefs[key];
    const optimistic = { ...prefs, [key]: next };
    setPrefs(optimistic);
    setState('saving');
    setErr(null);
    try {
      const r = await fetch('/api/profile/notifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.prefs) setPrefs(j.prefs as NotificationPrefs);
      setState('idle');
    } catch (e) {
      // Roll back on failure
      setPrefs(prefs);
      setErr(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  if (state === 'loading') {
    return (
      <div className="fa-rows" aria-busy="true">
        {ROW_DEFS.slice(0, 4).map((r) => (
          <div key={r.key} className="fa-row">
            <div style={{ flex: 1 }}>
              <FaSkeleton lines={1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (state === 'error' && !prefs) {
    return <FaError text={`Couldn't load notification settings. ${err ?? ''}`.trim()} />;
  }
  if (!prefs) return null;

  return (
    <div className="fa-rows">
      {ROW_DEFS.map((row) => (
        <div className="fa-row" key={row.key}>
          <div>
            <div className="lbl">{row.label}</div>
            <div className="sub">{row.sub}</div>
          </div>
          <div className="right">
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(prefs[row.key])}
              className="fa-switch"
              onClick={() => toggle(row.key)}
              aria-label={`Toggle ${row.label}`}
            />
          </div>
        </div>
      ))}
      {state === 'error' && err ? (
        <p className="fa-prov" style={{ color: 'var(--over)', padding: '8px 16px' }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================
   ConnectionRow · per-source line with sync status.
   ============================================================ */
export function ConnectionRow({
  name,
  connected,
  lastSyncIso,
  staleThresholdHours = 24,
  onManage,
  logo,
}: {
  name: string;
  connected: boolean;
  lastSyncIso?: string | null;
  staleThresholdHours?: number;
  onManage?: () => void;
  logo?: React.ReactNode;
}) {
  const isStale = connected && lastSyncIso
    ? Date.now() - new Date(lastSyncIso).getTime() > staleThresholdHours * 3600 * 1000
    : false;
  const status = !connected ? 'Disconnected' : isStale ? `Synced ${relativeAgo(lastSyncIso!)}` : `Synced ${relativeAgo(lastSyncIso ?? new Date().toISOString())}`;
  return (
    <div className="fa-conn">
      <div className="logo">{logo}</div>
      <div>
        <div className="nm">{name}</div>
        <div className={`sync${isStale ? ' is-stale' : ''}`}>
          <span className="dot" style={!connected ? { background: 'var(--fa-mute)' } : undefined} />
          {status}
        </div>
      </div>
      {onManage ? (
        <button type="button" className="manage" onClick={onManage}>
          MANAGE
        </button>
      ) : null}
    </div>
  );
}

/* ============================================================
   SettingValueRow · generic label + value or switch.
   ============================================================ */
export function SettingValueRow({
  label,
  sub,
  value,
  valueMute,
  onClick,
  trailing,
}: {
  label: string;
  sub?: string;
  value?: string | number;
  valueMute?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  const interactive = !!onClick;
  return (
    <Wrapper
      className="fa-row"
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      style={interactive ? { width: '100%', textAlign: 'left', cursor: 'pointer' } : undefined}
    >
      <div>
        <div className="lbl">{label}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="right">
        {value !== undefined ? (
          <span className={`val${valueMute ? ' mute' : ''}`}>{value}</span>
        ) : null}
        {trailing}
      </div>
    </Wrapper>
  );
}

/* ============================================================
   ToggleRow · switch row that fires `onChange` with the new state.
   The caller wires the PATCH to /api/settings.
   ============================================================ */
export function ToggleRow({
  label,
  sub,
  checked,
  onChange,
  busy = false,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
}) {
  return (
    <div className="fa-row">
      <div>
        <div className="lbl">{label}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="right">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-busy={busy}
          className="fa-switch"
          onClick={() => onChange(!checked)}
          aria-label={`Toggle ${label}`}
        />
      </div>
    </div>
  );
}

/* ────────── helpers ────────── */
function relativeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
