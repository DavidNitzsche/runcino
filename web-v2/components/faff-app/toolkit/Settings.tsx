'use client';

/**
 * Faff Toolkit · Family G · Settings rows
 *
 *   NotificationPrefsList · 7-category switch list backed by
 *                           /api/profile/notifications (full GET + PATCH
 *                           on each toggle change). Closes line 1806.
 *   ConnectionRow         · per-source row with sync status dot.
 *                           Closes line 1821.
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
  race_countdown_enabled: boolean;
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
  // 2026-08-21 · watch/push audit · copy corrected to what actually fires.
  // "Workout reminders / Pre-run brief on planned days" described a
  // notification that does not exist; the category is the morning-after
  // check when you skipped a run.
  { key: 'skip_recovery_enabled', label: 'Skipped-run check', sub: 'Morning after a skip · are you good for today' },
  // Fires on your long-run day, not Sunday — the training week ends on
  // user_settings.long_run_day (locked 2026-06-16). And it recaps the week
  // behind you; there is no week-ahead content in it.
  { key: 'weekly_checkin_enabled', label: 'Weekly check-in', sub: 'Evening of your long-run day · the week you just did' },
  { key: 'niggle_sick_enabled', label: 'Niggle / sick check', sub: 'Daily check-in when something is active' },
  // 2026-08-17 · streak row removed from the UI per the standing anti-streak
  // ruling. The streak_enabled pref/column stays untouched server-side —
  // this list just stops offering it.
  //
  // 2026-08-21 · the race countdown used to ride streak_enabled, so deleting
  // that row left it firing with nothing to switch it off. Own flag, own row.
  { key: 'race_countdown_enabled', label: 'Race countdown', sub: 'Sunday morning at 12 · 10 · 8 · 6 · 4 · 2 weeks out' },
  { key: 'strava_reconnect_enabled', label: 'Strava reconnect', sub: 'Nudge when the token goes stale' },
];

/* ============================================================
   NotificationPrefsList
   ============================================================ */
export function NotificationPrefsList({ initial }: { initial?: NotificationPrefs | null }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(initial ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'error'>(initial ? 'idle' : 'loading');
  const [err, setErr] = useState<string | null>(null);
  // 2026-08-17 · delivery honesty. null = unknown (no claim rendered);
  // false = APNs creds absent in this environment, so the toggles save but
  // nothing delivers yet. Sourced from the real apnsIsConfigured() signal
  // on GET /api/profile/notifications.
  const [apnsConfigured, setApnsConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    setState('loading');
    fetch('/api/profile/notifications')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (alive) {
          setPrefs((j.prefs ?? null) as NotificationPrefs | null);
          if (typeof j.apns_configured === 'boolean') setApnsConfigured(j.apns_configured);
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
      {apnsConfigured === false ? (
        <p className="fa-prov" style={{ padding: '8px 16px', color: 'var(--fa-mute, rgba(255,255,255,.55))' }}>
          Delivery is not enabled yet · notifications will start when it is.
        </p>
      ) : null}
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
