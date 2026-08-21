'use client';

/* ============================================================
   SettingsPanel · the consolidated, fully-wired settings surface.
   Replaces the old dead SETTINGS band (fake units toggle, inert
   experience row, dead sign-out). Every row reads from and writes
   to the backend:
     · profile/users fields  → PATCH /api/profile
     · day-of-week prefs     → PATCH /api/settings
   Plan-shaping edits (days/week, long-run/rest/quality day, weekly
   target, experience) trigger a server-side plan
   rebuild; we surface a "plan updating" ack when the API reports it.
   Units intentionally omitted (David 2026-06-12: hidden until the
   display layer can actually render km/°C).
   ============================================================ */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaError } from '../toolkit';

type Endpoint = '/api/profile' | '/api/settings';
type Kind = 'text' | 'number' | 'select' | 'day' | 'multiday' | 'multi' | 'date' | 'height' | 'weight' | 'tzmode';

interface FieldSpec {
  key: string;
  label: string;
  endpoint: Endpoint;
  kind: Kind;
  options?: { value: string; label: string }[];
  unit?: string;
  hint?: string;
  planShaping?: boolean;
  placeholder?: string;
}

const DAYS = [
  { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' }, { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' }, { value: 'fri', label: 'Fri' }, { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];
const EXPERIENCE = [
  { value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' }, { value: 'advanced_plus', label: 'Elite' },
];
const SEX = [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }];
// STRENGTH-3 (2026-08-17) · the CROSS options list and the
// cross_training_modes field are removed from TRAINING. faff shapes
// running weeks; it no longer asks what else you do. The profile column
// still exists and existing values are left in place.
// Curated IANA list for the manual-timezone picker (common runner zones).
const ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Australia/Sydney', 'Asia/Tokyo', 'Asia/Singapore', 'UTC',
];

interface Group { title: string; fields: FieldSpec[]; }
const GROUPS: Group[] = [
  { title: 'YOU', fields: [
    { key: 'full_name', label: 'Name', endpoint: '/api/profile', kind: 'text', placeholder: 'Your name' },
    { key: 'gender', label: 'Sex', endpoint: '/api/profile', kind: 'select', options: SEX, hint: 'Used for readiness adjustments.' },
    { key: 'birthday', label: 'Birthday', endpoint: '/api/profile', kind: 'date' },
    { key: 'height_cm', label: 'Height', endpoint: '/api/profile', kind: 'height', hint: 'Unlocks cadence coaching.' },
    { key: 'weight_kg', label: 'Weight', endpoint: '/api/profile', kind: 'weight', hint: 'Falls back to Apple Health when unset.' },
    { key: 'experience_level', label: 'Experience', endpoint: '/api/profile', kind: 'select', options: EXPERIENCE, planShaping: true },
  ]},
  { title: 'TRAINING', fields: [
    { key: 'weekly_frequency', label: 'Days per week', endpoint: '/api/profile', kind: 'number', planShaping: true, hint: '3 to 7.' },
    { key: 'long_run_day', label: 'Long run', endpoint: '/api/settings', kind: 'day', planShaping: true },
    { key: 'rest_day', label: 'Rest day', endpoint: '/api/settings', kind: 'day', planShaping: true },
    { key: 'quality_days', label: 'Quality days', endpoint: '/api/settings', kind: 'multiday', planShaping: true },
    { key: 'weekly_mileage_target', label: 'Weekly target', endpoint: '/api/profile', kind: 'number', unit: 'mi', planShaping: true },
  ]},
  { title: 'PHYSIOLOGY', fields: [
    { key: 'lthr', label: 'LTHR', endpoint: '/api/profile', kind: 'number', unit: 'bpm', hint: 'Sets your training zones.' },
    { key: 'max_hr_override', label: 'Max HR', endpoint: '/api/profile', kind: 'number', unit: 'bpm', hint: 'Overrides the observed ceiling.' },
  ]},
  { title: 'TIMEZONE', fields: [
    { key: 'tz_mode', label: 'Auto-update on travel', endpoint: '/api/profile', kind: 'tzmode' },
    { key: 'timezone', label: 'Time zone', endpoint: '/api/profile', kind: 'select', options: ZONES.map(z => ({ value: z, label: z.split('/').pop()!.replace(/_/g, ' ') })) },
  ]},
  { title: 'RACE FUELING', fields: [
    { key: 'fuel_brand', label: 'Gel brand', endpoint: '/api/profile', kind: 'text', placeholder: 'e.g. Maurten' },
    { key: 'fuel_gel_carbs_g', label: 'Carbs per gel', endpoint: '/api/profile', kind: 'number', unit: 'g' },
    { key: 'fuel_target_g_per_hr', label: 'Target intake', endpoint: '/api/profile', kind: 'number', unit: 'g/hr' },
  ]},
];

// ── display formatting ──────────────────────────────────────────
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function cmToImperial(cm: number): string {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return `${ft}'${inch}"`;
}
function displayValue(spec: FieldSpec, v: any): string {
  if (v == null || v === '') return 'Not set';
  switch (spec.kind) {
    case 'select': {
      const opt = spec.options?.find(o => o.value === String(v));
      return opt ? opt.label : String(v);
    }
    case 'day': return cap(String(v));
    case 'multiday': return Array.isArray(v) && v.length ? v.map((d: string) => cap(d)).join(' · ') : 'Not set';
    case 'multi': {
      if (!Array.isArray(v) || !v.length) return 'None';
      return v.map((m: string) => spec.options?.find(o => o.value === m)?.label ?? cap(m)).join(' · ');
    }
    case 'height': return cmToImperial(Number(v));
    case 'weight': return `${Math.round(Number(v) * 2.2046)} lb`;
    case 'date': {
      const d = new Date(String(v) + 'T12:00:00');
      return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : String(v);
    }
    default: return spec.unit ? `${v} ${spec.unit}` : String(v);
  }
}

export function SettingsPanel({ email, subscriptionLabel, onOpenPaywall }: {
  email?: string | null;
  subscriptionLabel?: string;
  onOpenPaywall: () => void;
}) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, any>>({});
  /**
   * RULE THREE · a refusal is a correct answer; a failure is not a fact.
   *
   * ── 2026-08-21 · web audit · THE TRUST BUG, second instance ─────────────
   *
   * This was `loaded: boolean`, filled by
   *
   *     fetch('/api/profile').then(r => r.ok ? r.json() : {}).catch(() => ({}))
   *
   * so a 401, a 500, a dropped connection and a genuinely empty profile all
   * collapsed into `{}` — and then `displayValue` rendered EVERY ROW as
   * "Not set". Observed live: a page whose own header read "David · Los
   * Angeles · Advanced runner" listed Name, Sex, Experience, Days per week,
   * Long run and eleven more as "Not set", and offered CONNECT STRAVA to an
   * account whose runs were already syncing.
   *
   * `ProfileView.tsx`'s `PhysiologyBlock` names this exact bug in its own
   * comment and fixed it on 2026-08-17 with four states. This is the
   * sibling panel that did not get the fix, and it is the worse place for
   * it: these rows are EDITABLE. A runner who believes "Days per week ·
   * Not set" taps it, gets an empty editor, and PATCHes a value over
   * settings that were fine.
   *
   * Four states, same as the sibling. A failure says so and offers a retry;
   * it never answers the question it could not read.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'signed-out'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<FieldSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const loaded = status === 'ready';

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    // `read` keeps the three outcomes apart instead of flattening them: the
    // object on success, and a marker otherwise so the caller can tell
    // "signed out" from "broke" from "empty".
    const read = (url: string) =>
      fetch(url)
        .then(async (r) => {
          if (r.status === 401 || r.status === 403) return { __state: 'signed-out' as const };
          if (!r.ok) return { __state: 'error' as const };
          return { __state: 'ok' as const, body: await r.json().catch(() => ({})) };
        })
        .catch(() => ({ __state: 'error' as const }));

    Promise.all([read('/api/profile'), read('/api/settings')]).then(([prof, sett]) => {
      if (!alive) return;
      if (prof.__state === 'signed-out' || sett.__state === 'signed-out') {
        setStatus('signed-out');
        return;
      }
      // EITHER read failing means the merged picture is incomplete, and half
      // a settings page rendered as whole is the bug in miniature.
      if (prof.__state === 'error' || sett.__state === 'error') {
        setStatus('error');
        return;
      }
      setVals({ ...(prof.body ?? {}), ...(sett.body ?? {}) });
      setStatus('ready');
    });
    return () => { alive = false; };
  }, [reloadKey]);

  async function save(spec: FieldSpec, value: any) {
    // Optimistic local update.
    setVals(v => ({ ...v, [spec.key]: value }));
    setEditing(null);
    try {
      const r = await fetch(spec.endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [spec.key]: value }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json().catch(() => ({}));
      if (j?.replanned) {
        setToast('Plan updated');
        setTimeout(() => setToast(null), 2600);
      }
      // Pull canonical values back (server may normalize, e.g. sex→sex).
      router.refresh();
    } catch {
      // Re-pull on failure so the row reflects truth, not the optimistic guess.
      fetch(spec.endpoint).then(r => r.ok ? r.json() : null).then(j => {
        if (j) setVals(v => ({ ...v, [spec.key]: j[spec.key] }));
      }).catch(() => {});
      setToast('Could not save');
      setTimeout(() => setToast(null), 2600);
    }
  }

  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = '/';
  }

  // A failure is stated, not answered around. The rows are editable, so
  // showing them at all while the real values are unknown invites a runner
  // to overwrite settings that were fine — the panel stands down instead.
  if (status === 'error') {
    return (
      <div className="band">
        <div className="fll">SETTINGS</div>
        <div className="setlist" style={{ padding: 14 }}>
          <FaError
            text="Could not load your settings. They are stored, not lost."
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </div>
    );
  }
  if (status === 'signed-out') {
    return (
      <div className="band">
        <div className="fll">SETTINGS</div>
        <div className="setlist" style={{ padding: 14, color: 'var(--fa-mute)' }}>
          Sign in to see your settings.
        </div>
      </div>
    );
  }

  return (
    <>
      {GROUPS.map(group => (
        <div className="band" key={group.title}>
          <div className="fll">{group.title}</div>
          <div className="setlist">
            {group.fields.map(spec => {
              // The manual-zone row is only meaningful when not in auto mode.
              if (spec.key === 'timezone' && String(vals.tz_mode ?? 'auto') === 'auto') return null;
              return (
                <div className="setr" key={spec.key} onClick={() => setEditing(spec)} role="button" tabIndex={0}>
                  <span className="setk">{spec.label}</span>
                  <span className="setv">{loaded ? displayValue(spec, vals[spec.key]) : '…'}</span>
                  <span className="sgo">›</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="band">
        <div className="fll">ACCOUNT</div>
        <div className="setlist">
          <div className="setr"><span className="setk">EMAIL</span><span className="setv">{email ?? vals.email ?? '—'}</span></div>
          <div className="setr" onClick={onOpenPaywall} role="button" tabIndex={0}>
            <span className="setk">SUBSCRIPTION</span><span className="setv">{subscriptionLabel ?? 'Free'}</span><span className="sgo">›</span>
          </div>
          <div className="setr danger" onClick={signOut} role="button" tabIndex={0}>
            <span className="setk">SIGN OUT</span>
          </div>
        </div>
      </div>

      {editing && (
        <FieldEditor
          spec={editing}
          value={vals[editing.key]}
          autoMode={String(vals.tz_mode ?? 'auto') === 'auto'}
          onClose={() => setEditing(null)}
          onSave={(v) => save(editing, v)}
        />
      )}

      {toast && <div className="settoast">{toast}</div>}
    </>
  );
}

/* ── the generic editor modal (reuses the .ov / .se-* shoe-editor look) ── */
function FieldEditor({ spec, value, autoMode, onClose, onSave }: {
  spec: FieldSpec; value: any; autoMode: boolean;
  onClose: () => void; onSave: (v: any) => void;
}) {
  // Seed local editor state per kind.
  const [text, setText] = useState<string>(value == null ? '' : String(value));
  const [day, setDay] = useState<string>(typeof value === 'string' ? value : '');
  const [multi, setMulti] = useState<string[]>(Array.isArray(value) ? value.map(String) : []);
  const [ft, setFt] = useState<number>(value ? Math.floor((Number(value) / 2.54) / 12) : 5);
  const [inch, setInch] = useState<number>(value ? Math.round((Number(value) / 2.54) - Math.floor((Number(value) / 2.54) / 12) * 12) : 9);
  const [lb, setLb] = useState<number>(value ? Math.round(Number(value) * 2.2046) : 150);
  const [autoOn, setAutoOn] = useState<boolean>(autoMode);

  function toggleMulti(v: string, single: boolean) {
    if (single) { setDay(v); return; }
    setMulti(cur => cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]);
  }

  function commit() {
    switch (spec.kind) {
      case 'number': onSave(text === '' ? null : Number(text)); break;
      case 'height': onSave(Math.round((ft * 12 + inch) * 2.54)); break;
      case 'weight': onSave(Math.round((lb / 2.2046) * 10) / 10); break;
      case 'day': onSave(day); break;
      case 'multiday':
      case 'multi': onSave(multi); break;
      case 'tzmode': onSave(autoOn ? 'auto' : 'manual'); break;
      default: onSave(text.trim() === '' ? null : text.trim());
    }
  }

  const chips = (opts: { value: string; label: string }[], single: boolean) => (
    <div className="se-roles">
      {opts.map(o => {
        const on = single ? day === o.value : multi.includes(o.value);
        return (
          <button key={o.value} className={`se-role${on ? ' on' : ''}`}
            style={{ borderColor: on ? '#3EBD41' : 'transparent' }}
            onClick={() => toggleMulti(o.value, single)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );

  return (
    // position:fixed (overriding .ov's absolute) so the editor pins to the
    // viewport — settings rows sit deep in the scroll, where an absolute
    // overlay would render off-screen at the top of the content column.
    <div className="ov open" style={{ position: 'fixed', zIndex: 100 }}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard shoe-ed">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </div>
        <div className="se-title">{spec.label}</div>
        {spec.hint && <p className="se-lbl" style={{ marginTop: -4, color: 'rgba(255,255,255,.45)' }}>{spec.hint}</p>}

        {(spec.kind === 'text') && (
          <input className="se-input" value={text} placeholder={spec.placeholder} onChange={e => setText(e.target.value)} spellCheck={false} autoFocus />
        )}
        {spec.kind === 'number' && (
          <input className="se-input" type="number" inputMode="numeric" value={text} placeholder={spec.unit} onChange={e => setText(e.target.value)} autoFocus />
        )}
        {spec.kind === 'date' && (
          <input className="se-input" type="date" value={text} onChange={e => setText(e.target.value)} autoFocus />
        )}
        {spec.kind === 'select' && (
          <div className="se-roles">
            {spec.options!.map(o => (
              <button key={o.value} className={`se-role${text === o.value ? ' on' : ''}`}
                style={{ borderColor: text === o.value ? '#3EBD41' : 'transparent' }}
                onClick={() => setText(o.value)}>{o.label}</button>
            ))}
          </div>
        )}
        {spec.kind === 'day' && chips(DAYS, true)}
        {(spec.kind === 'multiday') && chips(DAYS, false)}
        {spec.kind === 'multi' && chips(spec.options!, false)}
        {spec.kind === 'height' && (
          <div className="se-two">
            <div><div className="se-lbl">FEET</div><input className="se-input" type="number" min={3} max={8} value={ft} onChange={e => setFt(Number(e.target.value))} /></div>
            <div><div className="se-lbl">INCHES</div><input className="se-input" type="number" min={0} max={11} value={inch} onChange={e => setInch(Number(e.target.value))} /></div>
          </div>
        )}
        {spec.kind === 'weight' && (
          <div><div className="se-lbl">POUNDS</div><input className="se-input" type="number" min={50} max={500} value={lb} onChange={e => setLb(Number(e.target.value))} autoFocus /></div>
        )}
        {spec.kind === 'tzmode' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoOn} onChange={e => setAutoOn(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#3EBD41' }} />
            <span className="se-lbl" style={{ margin: 0 }}>{autoOn ? 'Following your device on travel' : 'Pinned · set the zone below'}</span>
          </label>
        )}

        <div className="se-acts">
          <button className="se-save" onClick={commit}>Save</button>
        </div>
      </div>
    </div>
  );
}
