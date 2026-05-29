'use client';

/**
 * NotificationSettings — /profile section that wires the master + per-category
 * toggles + race-day wake-time + weekly check-in time + quiet hours range.
 *
 * Source: docs/2026-05-28-notifications.html §SETTINGS SURFACE.
 *
 * Backed by /api/profile/notifications (GET/PATCH). The race-day toggle is
 * intentionally rendered semi-disabled per the deck "Race day is the one
 * we'll never mute on you" copy — the runner can change the wake time but
 * the notification itself stays on.
 *
 * Styling matches the existing /profile cards (no new component lib —
 * inline styles + Theme vars).
 */

import { useEffect, useState } from 'react';

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

const DEFAULTS: NotificationPrefs = {
  master_enabled: true,
  race_day_enabled: true,
  race_eve_enabled: true,
  skip_recovery_enabled: true,
  weekly_checkin_enabled: true,
  niggle_sick_enabled: true,
  streak_enabled: false, // deck §SETTINGS PER-CATEGORY DEFAULTS: F = OFF
  strava_reconnect_enabled: true,
  race_day_wake_time: '05:30',
  weekly_checkin_time: '20:00',
  quiet_hours_start: '22:00',
  quiet_hours_end: '06:00',
};

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busyField, setBusyField] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/profile/notifications', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (data?.prefs) setPrefs((p) => ({ ...p, ...data.prefs }));
      } catch { /* fall through to defaults */ }
      setLoading(false);
    })();
  }, []);

  async function patch(partial: Partial<NotificationPrefs>, fieldName: string) {
    setBusyField(fieldName);
    const before = prefs;
    setPrefs((p) => ({ ...p, ...partial })); // optimistic
    try {
      const r = await fetch('/api/profile/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (!r.ok) {
        setPrefs(before); // rollback
      } else {
        const data = await r.json();
        if (data?.prefs) setPrefs((p) => ({ ...p, ...data.prefs }));
      }
    } catch {
      setPrefs(before);
    } finally {
      setBusyField(null);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '24px 26px', fontSize: 13, color: 'var(--mute)' }}>
        Loading notification preferences…
      </div>
    );
  }

  const dim = !prefs.master_enabled ? 0.45 : 1;

  return (
    <div className="card" style={{ padding: '6px 0 0', overflow: 'hidden' }}>
      {/* Master toggle */}
      <Row
        title="All notifications"
        sub="Master toggle · turns everything off"
        right={
          <Toggle
            on={prefs.master_enabled}
            busy={busyField === 'master_enabled'}
            onClick={() => patch({ master_enabled: !prefs.master_enabled }, 'master_enabled')}
          />
        }
      />

      <SubLabel>Categories</SubLabel>

      <Row
        title="Race day morning"
        sub="Cannot be muted · wake time below"
        opacity={dim}
        right={<Toggle on={prefs.race_day_enabled} disabled busy={false} onClick={() => {}} />}
      />
      <Row
        title="Race eve"
        sub="Night before race · 9pm"
        opacity={dim}
        right={
          <Toggle
            on={prefs.race_eve_enabled}
            busy={busyField === 'race_eve_enabled'}
            onClick={() => patch({ race_eve_enabled: !prefs.race_eve_enabled }, 'race_eve_enabled')}
          />
        }
      />
      <Row
        title="Skip recovery"
        sub="Morning after a missed day"
        opacity={dim}
        right={
          <Toggle
            on={prefs.skip_recovery_enabled}
            busy={busyField === 'skip_recovery_enabled'}
            onClick={() => patch({ skip_recovery_enabled: !prefs.skip_recovery_enabled }, 'skip_recovery_enabled')}
          />
        }
      />
      <Row
        title="Weekly check-in"
        sub="Sunday night"
        opacity={dim}
        right={
          <Toggle
            on={prefs.weekly_checkin_enabled}
            busy={busyField === 'weekly_checkin_enabled'}
            onClick={() => patch({ weekly_checkin_enabled: !prefs.weekly_checkin_enabled }, 'weekly_checkin_enabled')}
          />
        }
      />
      <Row
        title="Niggle / sick check"
        sub="Daily while a niggle is active"
        opacity={dim}
        right={
          <Toggle
            on={prefs.niggle_sick_enabled}
            busy={busyField === 'niggle_sick_enabled'}
            onClick={() => patch({ niggle_sick_enabled: !prefs.niggle_sick_enabled }, 'niggle_sick_enabled')}
          />
        }
      />
      <Row
        title="Streaks & milestones"
        sub="7 · 14 · 30 · 100 days · race countdowns"
        opacity={dim}
        right={
          <Toggle
            on={prefs.streak_enabled}
            busy={busyField === 'streak_enabled'}
            onClick={() => patch({ streak_enabled: !prefs.streak_enabled }, 'streak_enabled')}
          />
        }
      />
      <Row
        title="Strava reconnect"
        sub="When sync breaks · recommended"
        opacity={dim}
        right={
          <Toggle
            on={prefs.strava_reconnect_enabled}
            busy={busyField === 'strava_reconnect_enabled'}
            onClick={() => patch({ strava_reconnect_enabled: !prefs.strava_reconnect_enabled }, 'strava_reconnect_enabled')}
          />
        }
      />

      <SubLabel>Schedule</SubLabel>

      <Row
        title="Race-day wake time"
        sub="Used by Category A only"
        opacity={dim}
        right={
          <TimePicker
            value={prefs.race_day_wake_time}
            busy={busyField === 'race_day_wake_time'}
            onCommit={(v) => patch({ race_day_wake_time: v }, 'race_day_wake_time')}
          />
        }
      />
      <Row
        title="Weekly check-in time"
        sub="Sunday local"
        opacity={dim}
        right={
          <TimePicker
            value={prefs.weekly_checkin_time}
            busy={busyField === 'weekly_checkin_time'}
            onCommit={(v) => patch({ weekly_checkin_time: v }, 'weekly_checkin_time')}
          />
        }
      />
      <Row
        title="Quiet hours"
        sub="Nothing fires inside this window"
        opacity={dim}
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TimePicker
              value={prefs.quiet_hours_start}
              busy={busyField === 'quiet_hours_start'}
              onCommit={(v) => patch({ quiet_hours_start: v }, 'quiet_hours_start')}
            />
            <span style={{ color: 'var(--mute)', fontSize: 12 }}>—</span>
            <TimePicker
              value={prefs.quiet_hours_end}
              busy={busyField === 'quiet_hours_end'}
              onCommit={(v) => patch({ quiet_hours_end: v }, 'quiet_hours_end')}
            />
          </div>
        }
      />

      <div style={{ padding: '14px 24px 18px', fontSize: 12, color: 'var(--mute)', lineHeight: 1.55 }}>
        Race day is the one we won&apos;t let you mute. You can change the wake time but the notification will fire.
      </div>
    </div>
  );
}

function Row({
  title, sub, right, opacity = 1,
}: {
  title: string;
  sub?: string;
  right: React.ReactNode;
  opacity?: number;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 16,
      padding: '14px 24px',
      alignItems: 'center',
      borderTop: '1px solid var(--line-2)',
      opacity,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--mute)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div>{right}</div>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase',
      color: 'var(--mute)', padding: '20px 24px 4px',
    }}>{children}</div>
  );
}

function Toggle({
  on, disabled, busy, onClick,
}: { on: boolean; disabled?: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        width: 44, height: 26, borderRadius: 999,
        background: on ? 'var(--green, #3EBD41)' : 'var(--dim, #4b505e)',
        position: 'relative',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
      aria-pressed={on}
    >
      <span
        style={{
          position: 'absolute',
          width: 22, height: 22,
          borderRadius: '50%',
          background: '#fff',
          top: 2,
          left: on ? 'auto' : 2,
          right: on ? 2 : 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transition: 'left 0.15s, right 0.15s',
        }}
      />
    </button>
  );
}

function TimePicker({
  value, busy, onCommit,
}: { value: string; busy: boolean; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      type="time"
      value={local}
      disabled={busy}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local); }}
      style={{
        background: 'rgba(255,136,71,0.08)',
        color: 'var(--race, #FF8847)',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'var(--f-body)',
        fontVariantNumeric: 'tabular-nums',
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(255,136,71,0.16)',
      }}
    />
  );
}
