'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ConnectionRow, FaffSeed } from '@/components/faff-app/types';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge, type BadgeTone } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { Input } from '@/components/redesign/core/Input';
import { Select } from '@/components/redesign/core/Select';
import { Switch } from '@/components/redesign/core/Switch';
import { Checkbox } from '@/components/redesign/core/Checkbox';
import { SegmentBar } from '@/components/redesign/nav/SegmentBar';
import { Dialog } from '@/components/redesign/feedback/Dialog';

/**
 * components/redesign/settings/SettingsClient.tsx
 *
 * The redesigned Settings screen. Structurally ported from the
 * outside-studio handoff's WebSettings.jsx (designs/design-review-0818/
 * ui_kits/web/WebSettings.jsx, 49 lines: Account / Appearance / Units /
 * Gear / Notifications / Account actions, all local useState with no
 * backend) — but the mock is read here as the visual GRAMMAR (Section
 * kicker + field list, inline-edit rows, immediate-effect switches), not
 * as a cap on scope. Per this task's brief and the Activity screen's own
 * precedent (components/redesign/activity/ActivityClient.tsx's doc
 * comment), the app already has a mature, real settings surface —
 * components/faff-app/views/SettingsPanel.tsx (YOU / TRAINING /
 * PHYSIOLOGY / TIMEZONE / RACE FUELING groups, PATCH /api/profile +
 * /api/settings) plus components/faff-app/toolkit/Settings.tsx's
 * NotificationPrefsList (7-category PATCH /api/profile/notifications)
 * and components/profile/StravaConnectionCard.tsx (tri-state connect /
 * reconnect / disconnect + push prefs). This file re-renders that SAME
 * real scope through the redesign's component library instead of the old
 * `.setr`/`.se-*` classes — no new data path, no new field invented.
 *
 * Data sources (three client fetches on mount, matching SettingsPanel's
 * own fetch shape exactly — Settings has never lived on FaffSeed, it is
 * not a Today/Train/Activity-shaped read):
 *   · GET /api/profile              — identity, physiology, plan-shaping
 *     numbers, timezone, race fueling, Strava push prefs, email.
 *   · GET /api/settings             — long_run_day / rest_day /
 *     quality_days (lib/coach/settings.ts UserSettings).
 *   · GET /api/profile/notifications — the 7 real push categories +
 *     apns_configured (delivery honesty signal).
 *   · GET /api/strava/status        — tri-state connection health
 *     (connected / needs_reauth / disconnected), same call
 *     StravaConnectionCard makes, for the Reconnect/Disconnect CTA.
 * `connections` (seed.connections, ConnectionRow[]) arrives as a prop —
 * it is already real and already server-rendered by every other redesign
 * route's buildSeed() call (components/faff-app/seed.ts#adaptConnections
 * off lib/coach/profile-state.ts), so it is not re-fetched client-side.
 *
 * Writes, each mirroring the live, already-shipping handler exactly:
 *   · PATCH /api/profile              — text/select/number rows below.
 *     A PLAN_SHAPING field (experience_level, weekly_frequency,
 *     weekly_mileage_target) triggers a server-side replan; the ack
 *     (`{replanned:true}`) surfaces as a toast, same as SettingsPanel.
 *   · PATCH /api/settings             — long_run_day / rest_day /
 *     quality_days. Also plan-shaping; same replan-ack toast.
 *   · PATCH /api/profile/notifications — one boolean per toggle.
 *   · GET  /api/auth/strava?action=connect  → {url}, navigate to it
 *     (real OAuth redirect, identical to StravaConnectionCard's
 *     startReconnect).
 *   · POST /api/auth/strava?action=disconnect — behind a destructive
 *     Dialog confirm (this revokes + clears real tokens).
 *   · POST /api/auth/logout — sign out, then hard-navigate to '/'.
 *
 * HONESTY GAPS (rows the mock has that this page does NOT wire, because
 * no real endpoint backs them):
 *   · "Units" section (mi/km Select) — dropped, not just unported. David
 *     ruled 2026-06-12 (SettingsPanel.tsx's own header comment) that
 *     units stay hidden until the display layer can actually render
 *     km/°C; reproducing the mock's Select here would be decorative,
 *     writing to no real field.
 *   · "Manage" gear/shoes row — dropped. No shoe-list editor exists on
 *     this route (shoe management lives on Run Detail's retire flow,
 *     already ported); inventing a "Manage" destination here would be a
 *     dead link.
 *   · "Export training data" button — dropped. No GET /api/export or
 *     equivalent exists anywhere in app/api; the mock's button has no
 *     real backend today.
 *   · Apple Health / Apple Watch / FinalSurge rows render status only,
 *     no Connect button — HealthKit and Watch pairing are native-only
 *     flows (no web OAuth endpoint), and FinalSurge is honestly
 *     "Coming soon" per seed.ts's own adaptConnections().
 */

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAY_OPTIONS: { value: DayKey; label: string }[] = [
  { value: 'mon', label: 'Monday' }, { value: 'tue', label: 'Tuesday' }, { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' }, { value: 'fri', label: 'Friday' }, { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];
const EXPERIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' }, { value: 'advanced_plus', label: 'Elite' },
];
const SEX_OPTIONS = [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }];
// Curated IANA list for the manual-timezone picker — same set SettingsPanel.tsx ships (common runner zones).
const ZONE_OPTIONS = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Australia/Sydney', 'Asia/Tokyo', 'Asia/Singapore', 'UTC',
].map((z) => ({ value: z, label: z.split('/').pop()!.replace(/_/g, ' ') }));

interface ProfileVals {
  full_name?: string | null;
  gender?: string | null;
  birthday?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  experience_level?: string | null;
  weekly_frequency?: number | null;
  weekly_mileage_target?: number | null;
  lthr?: number | null;
  max_hr_override?: number | null;
  tz_mode?: 'auto' | 'manual';
  timezone?: string | null;
  fuel_brand?: string | null;
  fuel_gel_carbs_g?: number | null;
  fuel_target_g_per_hr?: number | null;
  email?: string | null;
  strava_auto_push?: boolean;
  strava_push_privacy?: 'private' | 'followers' | 'public';
  strava_push_title_format?: 'type_phases' | 'tod_type_dist';
}
interface SettingsVals {
  long_run_day?: DayKey;
  rest_day?: DayKey;
  quality_days?: DayKey[];
}
interface NotificationPrefs {
  master_enabled: boolean;
  race_day_enabled: boolean;
  race_eve_enabled: boolean;
  skip_recovery_enabled: boolean;
  weekly_checkin_enabled: boolean;
  niggle_sick_enabled: boolean;
  strava_reconnect_enabled: boolean;
}
const NOTIF_ROWS: Array<{ key: keyof NotificationPrefs; label: string; sub: string }> = [
  { key: 'master_enabled', label: 'All notifications', sub: 'Master switch — turns everything off when off' },
  { key: 'race_day_enabled', label: 'Race day', sub: 'Race-morning wake and start window' },
  { key: 'race_eve_enabled', label: 'Race eve', sub: 'Evening-before brief' },
  { key: 'skip_recovery_enabled', label: 'Workout reminders', sub: 'Pre-run brief on planned days' },
  { key: 'weekly_checkin_enabled', label: 'Weekly check-in', sub: 'Sunday recap and week-ahead context' },
  { key: 'niggle_sick_enabled', label: 'Niggle or sick check', sub: 'Daily check-in when something is active' },
  { key: 'strava_reconnect_enabled', label: 'Strava reconnect', sub: 'Nudge when the token goes stale' },
];

type StravaState = 'connected' | 'needs_reauth' | 'disconnected' | null;

function relativeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function cmToIn(cm: number | null | undefined): number | null { return cm != null ? Math.round(cm / 2.54) : null; }
function kgToLb(kg: number | null | undefined): number | null { return kg != null ? Math.round(kg * 2.2046) : null; }

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
      <div style={{
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
      }}>{label}</div>
      {children}
    </div>
  );
}

/** Text/number field that commits on blur, not on every keystroke — a
 *  PATCH per character is both wasteful and, for something like a name
 *  or a target that shapes a plan rebuild, needless server churn. React
 *  normalizes blur to bubble like `focusout`, so a wrapper div's onBlur
 *  fires once the inner <input> loses focus. */
function CommitField({ label, value, unit, type = 'text', helper, onCommit }: {
  label: string; value: string; unit?: string; type?: 'text' | 'number' | 'date'; helper?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div onBlur={() => { if (local !== value) onCommit(local); }}>
      <Input label={label} value={local} unit={unit} type={type} helper={helper} onChange={setLocal} />
    </div>
  );
}

export function SettingsClient({ connections, userHint }: {
  connections: ConnectionRow[];
  userHint: FaffSeed['user'];
}) {
  const [profile, setProfile] = useState<ProfileVals>({ full_name: userHint.name, experience_level: userHint.experienceLevel });
  const [settings, setSettings] = useState<SettingsVals>({});
  const [notifs, setNotifs] = useState<NotificationPrefs | null>(null);
  const [apnsConfigured, setApnsConfigured] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stravaState, setStravaState] = useState<StravaState>(null);
  const [stravaConnecting, setStravaConnecting] = useState(false);
  const [stravaDisconnecting, setStravaDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/profile').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('/api/settings').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('/api/profile/notifications').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/strava/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([prof, sett, notif, strava]) => {
      if (!alive) return;
      setProfile((p) => ({ ...p, ...prof }));
      setSettings((s) => ({ ...s, ...sett }));
      if (notif?.prefs) setNotifs(notif.prefs as NotificationPrefs);
      if (typeof notif?.apns_configured === 'boolean') setApnsConfigured(notif.apns_configured);
      if (strava?.state === 'connected' || strava?.state === 'needs_reauth' || strava?.state === 'disconnected') {
        setStravaState(strava.state);
      }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  async function saveProfile(patch: Record<string, unknown>) {
    setProfile((p) => ({ ...p, ...patch }) as ProfileVals);
    try {
      const r = await fetch('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(() => ({}));
      if (j?.replanned) flash('Plan updated');
    } catch {
      flash('Could not save');
      fetch('/api/profile').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setProfile((p) => ({ ...p, ...j })); }).catch(() => {});
    }
  }

  async function saveSettings(patch: Record<string, unknown>) {
    setSettings((s) => ({ ...s, ...patch }) as SettingsVals);
    try {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(() => ({}));
      if (j?.replanned) flash('Plan updated');
    } catch {
      flash('Could not save');
      fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setSettings((s) => ({ ...s, ...j })); }).catch(() => {});
    }
  }

  async function saveNotif(key: keyof NotificationPrefs, value: boolean) {
    if (!notifs) return;
    const previous = notifs[key];
    setNotifs({ ...notifs, [key]: value });
    try {
      const r = await fetch('/api/profile/notifications', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(() => ({}));
      if (j?.prefs) setNotifs(j.prefs as NotificationPrefs);
    } catch {
      setNotifs((n) => (n ? { ...n, [key]: previous } : n));
      flash('Could not save');
    }
  }

  function toggleQualityDay(d: DayKey) {
    const cur = settings.quality_days ?? [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    saveSettings({ quality_days: next });
  }

  async function startStravaConnect() {
    if (stravaConnecting) return;
    setStravaConnecting(true);
    try {
      const r = await fetch('/api/auth/strava?action=connect');
      const j = await r.json().catch(() => ({}));
      if (j?.url) { window.location.href = j.url; return; }
    } catch { /* fall through to reset below */ }
    setStravaConnecting(false);
  }

  async function confirmStravaDisconnect() {
    setStravaDisconnecting(true);
    try {
      const r = await fetch('/api/auth/strava?action=disconnect', { method: 'POST' });
      if (r.ok) { setStravaState('disconnected'); flash('Strava disconnected'); }
      else flash('Could not disconnect');
    } catch {
      flash('Could not disconnect');
    } finally {
      setStravaDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* proceed regardless */ }
    window.location.href = '/';
  }

  const strava = connections.find((c) => c.id === 'strava');
  // Fall back to the seed-rendered `.on` boolean until /api/strava/status
  // resolves client-side — same first-paint fallback StravaConnectionCard
  // uses (`initial.connected` before its own status fetch lands).
  const effectiveStravaState: StravaState = stravaState ?? (strava?.on ? 'connected' : 'disconnected');

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 880, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <header style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <div className="faff-kicker">Account and training</div>
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Settings</div>
        <div style={{ color: 'var(--text-quiet)', fontSize: 'var(--type-body-s)' }}>Every row here writes to your real account.</div>
      </header>

      <Tile pad="lg" radius="2xl" style={{ display: 'grid', gap: 'var(--sp-10)' }}>
        <Section label="You">
          <CommitField label="Name" value={profile.full_name ?? ''} helper={loaded ? undefined : 'Loading…'}
            onCommit={(v) => saveProfile({ full_name: v.trim() === '' ? null : v.trim() })} />
          <Select label="Sex" value={profile.gender ?? ''} options={[{ value: '', label: 'Not set' }, ...SEX_OPTIONS]}
            helper="Used for readiness adjustments." onChange={(v) => saveProfile({ gender: v || null })} />
          <CommitField label="Birthday" type="date" value={profile.birthday ?? ''} onCommit={(v) => saveProfile({ birthday: v || null })} />
          <CommitField label="Height" unit="in" type="number" value={cmToIn(profile.height_cm) != null ? String(cmToIn(profile.height_cm)) : ''}
            helper="Unlocks cadence coaching."
            onCommit={(v) => saveProfile({ height_cm: v.trim() === '' ? null : Math.round(Number(v) * 2.54) })} />
          <CommitField label="Weight" unit="lb" type="number" value={kgToLb(profile.weight_kg) != null ? String(kgToLb(profile.weight_kg)) : ''}
            helper="Falls back to Apple Health when unset."
            onCommit={(v) => saveProfile({ weight_kg: v.trim() === '' ? null : Math.round((Number(v) / 2.2046) * 10) / 10 })} />
          <Select label="Experience" value={profile.experience_level ?? ''} options={[{ value: '', label: 'Not set' }, ...EXPERIENCE_OPTIONS]}
            helper="Shapes the plan." onChange={(v) => saveProfile({ experience_level: v || null })} />
        </Section>

        <Section label="Training">
          <CommitField label="Days per week" unit="days" type="number" value={profile.weekly_frequency != null ? String(profile.weekly_frequency) : ''}
            helper="3 to 7. Reshapes the plan."
            onCommit={(v) => saveProfile({ weekly_frequency: v.trim() === '' ? null : Math.round(Number(v)) })} />
          <Select label="Long run" value={settings.long_run_day ?? ''} options={DAY_OPTIONS}
            onChange={(v) => saveSettings({ long_run_day: v })} />
          <Select label="Rest day" value={settings.rest_day ?? ''} options={DAY_OPTIONS}
            onChange={(v) => saveSettings({ rest_day: v })} />
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <span style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>Quality days</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--sp-3)' }}>
              {DAY_OPTIONS.map((d) => (
                <Checkbox key={d.value} label={d.label} checked={(settings.quality_days ?? []).includes(d.value)}
                  onChange={() => toggleQualityDay(d.value)} />
              ))}
            </div>
          </div>
          <CommitField label="Weekly target" unit="mi" type="number" value={profile.weekly_mileage_target != null ? String(profile.weekly_mileage_target) : ''}
            onCommit={(v) => saveProfile({ weekly_mileage_target: v.trim() === '' ? null : Number(v) })} />
        </Section>

        <Section label="Physiology">
          <CommitField label="LTHR" unit="bpm" type="number" value={profile.lthr != null ? String(profile.lthr) : ''}
            helper="Sets your training zones."
            onCommit={(v) => saveProfile({ lthr: v.trim() === '' ? null : Math.round(Number(v)) })} />
          <CommitField label="Max HR" unit="bpm" type="number" value={profile.max_hr_override != null ? String(profile.max_hr_override) : ''}
            helper="Overrides the observed ceiling."
            onCommit={(v) => saveProfile({ max_hr_override: v.trim() === '' ? null : Math.round(Number(v)) })} />
        </Section>

        <Section label="Timezone">
          <Switch label="Auto-update on travel" checked={(profile.tz_mode ?? 'auto') === 'auto'}
            onChange={(v) => saveProfile({ tz_mode: v ? 'auto' : 'manual' })} />
          {(profile.tz_mode ?? 'auto') === 'manual' && (
            <Select label="Time zone" value={profile.timezone ?? ''} options={ZONE_OPTIONS}
              onChange={(v) => saveProfile({ timezone: v })} />
          )}
        </Section>

        <Section label="Race fueling">
          <CommitField label="Gel brand" value={profile.fuel_brand ?? ''} helper="e.g. Maurten"
            onCommit={(v) => saveProfile({ fuel_brand: v.trim() === '' ? null : v.trim() })} />
          <CommitField label="Carbs per gel" unit="g" type="number" value={profile.fuel_gel_carbs_g != null ? String(profile.fuel_gel_carbs_g) : ''}
            onCommit={(v) => saveProfile({ fuel_gel_carbs_g: v.trim() === '' ? null : Math.round(Number(v)) })} />
          <CommitField label="Target intake" unit="g/hr" type="number" value={profile.fuel_target_g_per_hr != null ? String(profile.fuel_target_g_per_hr) : ''}
            onCommit={(v) => saveProfile({ fuel_target_g_per_hr: v.trim() === '' ? null : Math.round(Number(v)) })} />
        </Section>
      </Tile>

      <Tile pad="lg" radius="2xl" style={{ display: 'grid', gap: 'var(--sp-6)' }}>
        <Section label="Notifications">
          {apnsConfigured === false && (
            <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>
              Delivery is not enabled yet — notifications will start when it is.
            </div>
          )}
          {notifs ? NOTIF_ROWS.map((row) => (
            <Switch key={row.key} label={row.label} sub={row.sub} checked={notifs[row.key]}
              onChange={(v) => saveNotif(row.key, v)} />
          )) : (
            <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)' }}>Loading…</div>
          )}
        </Section>
      </Tile>

      <Tile pad="lg" radius="2xl" style={{ display: 'grid', gap: 'var(--sp-7)' }}>
        <Section label="Connections">
          <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
            {connections.map((c) => (
              <ConnectionCard key={c.id} row={c}
                overrideState={c.id === 'strava' ? effectiveStravaState : null} />
            ))}
          </div>

          {strava && (
            <div style={{ display: 'grid', gap: 'var(--sp-6)', paddingTop: 'var(--sp-4)' }}>
              {effectiveStravaState === 'needs_reauth' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-secondary)' }}>
                    Your Strava token expired or scopes changed.
                  </div>
                  <Button variant="secondary" size="sm" disabled={stravaConnecting} onClick={startStravaConnect}>
                    {stravaConnecting ? 'Opening…' : 'Reconnect Strava'}
                  </Button>
                </div>
              )}
              {effectiveStravaState === 'disconnected' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-secondary)' }}>
                    Push your runs to Strava automatically.
                  </div>
                  <Button variant="secondary" size="sm" disabled={stravaConnecting} onClick={startStravaConnect}>
                    {stravaConnecting ? 'Opening…' : 'Connect Strava'}
                  </Button>
                </div>
              )}
              {effectiveStravaState === 'connected' && (
                <>
                  <Switch label="Auto-push every run" sub="Pushes to Strava about 30 seconds after Faff finishes processing a run."
                    checked={!!profile.strava_auto_push} onChange={(v) => saveProfile({ strava_auto_push: v })} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--type-body-s)' }}>Default privacy</span>
                    <SegmentBar value={profile.strava_push_privacy ?? 'private'}
                      options={[{ value: 'private', label: 'Private' }, { value: 'followers', label: 'Followers' }, { value: 'public', label: 'Public' }]}
                      onChange={(v) => saveProfile({ strava_push_privacy: v })} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--type-body-s)' }}>Title format</span>
                    <SegmentBar value={profile.strava_push_title_format ?? 'type_phases'}
                      options={[{ value: 'type_phases', label: 'Workout' }, { value: 'tod_type_dist', label: 'Time of day' }]}
                      onChange={(v) => saveProfile({ strava_push_title_format: v })} />
                  </div>
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)}>Disconnect Strava</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Section>
      </Tile>

      <Tile pad="lg" radius="2xl" style={{ display: 'grid', gap: 'var(--sp-6)' }}>
        <Section label="Account">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 'var(--type-body)' }}>{profile.email ?? '—'}</div>
              <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>{userHint.subscriptionLabel}</div>
            </div>
          </div>
          <Button variant="ghost" full disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
        </Section>
      </Tile>

      <Dialog open={confirmDisconnect} title="Disconnect Strava?" destructive
        confirmLabel={stravaDisconnecting ? 'Disconnecting…' : 'Disconnect'} cancelLabel="Keep it connected"
        onCancel={() => setConfirmDisconnect(false)} onConfirm={confirmStravaDisconnect}>
        Auto-push stops immediately. You can reconnect any time.
      </Dialog>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 'var(--sp-9)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--material-tile-raised)', color: 'var(--text-primary)', padding: '10px 20px',
          borderRadius: 'var(--radius-pill)', boxShadow: 'var(--elevation-overlay)', fontSize: 'var(--type-label-s)', zIndex: 200,
        }}>{toast}</div>
      )}
    </div>
  );
}

/** One connection's status row — name, real gradient chip (from
 *  seed.connections' `bg`/`gl`, the same values the live CONNECTIONS band
 *  paints with), a factual Badge (never a colorful "praise" tone for the
 *  mere fact of being connected — Badge's own doc: "never use tone to
 *  praise"), and a last-sync relative time when connected. `overrideState`
 *  lets Strava's row reflect the tri-state /api/strava/status read
 *  instead of the coarser seed-rendered boolean once it resolves. */
function ConnectionCard({ row, overrideState }: { row: ConnectionRow; overrideState: StravaState }) {
  const state: 'connected' | 'needs_reauth' | 'disconnected' = overrideState ?? (row.on ? 'connected' : 'disconnected');
  const tone: BadgeTone = state === 'connected' ? 'neutral' : state === 'needs_reauth' ? 'attention' : 'quiet';
  const label = state === 'connected' ? 'Connected' : state === 'needs_reauth' ? 'Needs reauth' : 'Not connected';
  const ago = state === 'connected' ? relativeAgo(row.lastSyncIso) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)' }}>
      <div style={{
        width: 40, height: 40, borderRadius: 'var(--radius-m)', flex: '0 0 auto', background: row.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15,
      }}>{row.gl}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--type-body)' }}>{row.nm}</div>
        <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>
          {ago ? `Synced ${ago}` : row.sub}
        </div>
      </div>
      <Badge tone={tone}>{label}</Badge>
    </div>
  );
}
