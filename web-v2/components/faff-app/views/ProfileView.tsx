'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, ShoeRec } from '../types';
import { ROLECOL } from '../constants';
import {
  CoachActivityTimeline,
  ConnectionRow as ToolkitConnectionRow,
  NotificationPrefsList,
  ProvenanceLine,
  StatTile,
  ToggleRow,
  useGlossaryDrawer,
} from '../toolkit';
import { StravaConnectionCard } from '@/components/profile/StravaConnectionCard';

const ROLES = ['EASY','LONG','TEMPO','INTERVALS','RACE','RECOVERY'];

export function ProfileView({ seed, onOpenPro, onOpenPaywall }: { seed: FaffSeed; onOpenPro: () => void; onOpenPaywall: () => void }) {
  const router = useRouter();
  const [garage, setGarage] = useState<ShoeRec[]>(seed.shoes);
  const [editing, setEditing] = useState<number | null>(null);
  const [units, setUnits] = useState('Miles · °F');
  const [pending, setPending] = useState(false);

  // Pick up server-seed updates so refreshes reflect the truth.
  useEffect(() => { setGarage(seed.shoes); }, [seed.shoes]);

  async function persistAdd(rec: ShoeRec) {
    setPending(true);
    try {
      // Split nm into brand + first word, rest is model.
      const parts = rec.nm.trim().split(/\s+/);
      const brand = parts[0] || 'Brand';
      const model = parts.slice(1).join(' ') || rec.nm;
      const res = await fetch('/api/shoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand, model,
          run_types: rec.roles.map(r => r.toLowerCase()),
          mileage_cap: rec.max,
          baseline_mi: rec.baseline_mi ?? 0,
        }),
      });
      if (!res.ok) throw new Error(`POST /api/shoe ${res.status}`);
      router.refresh();
    } catch { /* keep UI optimistic; refresh will reconcile */ }
    finally { setPending(false); }
  }

  async function persistPatch(rec: ShoeRec) {
    if (rec.id == null) return persistAdd(rec);
    setPending(true);
    try {
      const res = await fetch('/api/shoe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rec.id,
          brand: rec.nm.trim().split(/\s+/)[0] || 'Brand',
          model: rec.nm.trim().split(/\s+/).slice(1).join(' ') || rec.nm.trim(),
          mileage_cap: rec.max,
          baseline_mi: rec.baseline_mi ?? 0,
          run_types: rec.roles.map(r => r.toLowerCase()),
          preferred: rec.preferred,
        }),
      });
      if (!res.ok) throw new Error(`PATCH /api/shoe ${res.status}`);
      router.refresh();
    } catch { /* swallow */ }
    finally { setPending(false); }
  }

  async function persistDelete(rec: ShoeRec) {
    if (rec.id == null) { setGarage(g => g.filter(s => s !== rec)); return; }
    setPending(true);
    try {
      const res = await fetch('/api/shoe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rec.id }),
      });
      if (!res.ok) throw new Error(`DELETE /api/shoe ${res.status}`);
      router.refresh();
    } catch { /* swallow */ }
    finally { setPending(false); }
  }

  return (
    <>
      <div className="top">
        <div>
          <div className="date">Profile</div>
          <div className="wk">Account &amp; settings</div>
        </div>
      </div>

      <div className="pfhead">
        <div className="pfav">{seed.user.initial}</div>
        <div className="pfid">
          <div className="pfn">{seed.user.name}</div>
          <div className="pfm">{seed.user.city ? `${seed.user.city} · ` : ''}{prettyExperience(seed.user.experienceLevel)}</div>
        </div>
        <span className="pfpro" onClick={onOpenPro} style={{ cursor: 'pointer' }}>FAFF PRO</span>
      </div>

      <div className="band">
      <div className="fll">SHOE GARAGE</div>
      <div className="garage">
        {garage.map((s, i) => {
          const pct = Math.min(100, Math.round((s.mi / s.max) * 100));
          const col = ROLECOL[s.role] ?? '#14C08C';
          const worn = s.mi >= s.max;
          return (
            <div className="shoe" key={i} onClick={() => setEditing(i)} role="button" tabIndex={0}>
              <span className="shedit">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </span>
              <div className="shrow">
                <span className="shn">{s.nm} <i className="shr">{s.role}</i></span>
                <span className="shm" style={worn ? { color: '#FC6076' } : undefined}>{s.mi}<small> / {s.max} mi</small></span>
              </div>
              <div className="shtrk"><div className="shfill" style={{ width: `${pct}%`, background: col }} /></div>
            </div>
          );
        })}
      </div>
      <button className="shoe-add" onClick={() => setEditing(-1)}>
        <span>+</span> Add a shoe
      </button>
      </div>{/* .band */}

      {/* Physiology block · LTHR / HRmax / VDOT / RHR with provenance.
          Closes coverage row 1480 (HRmax + LTHR provenance) and gives
          ProvenanceLine its primary home on the WEB. */}
      <div className="band">
      <div className="fll">PHYSIOLOGY</div>
      <PhysiologyBlock />
      </div>{/* .band */}

      <div className="band">
      <div className="fll">DOCTRINE</div>
      <div className="setlist">
        <a className="setr" href="/learn" style={{ textDecoration: 'none', color: 'inherit', display: 'flex' }}>
          <span className="setk">LEARN</span><span className="setv">Coach research</span><span className="sgo">›</span>
        </a>
        <a className="setr" href="/workouts" style={{ textDecoration: 'none', color: 'inherit', display: 'flex' }}>
          <span className="setk">WORKOUT LIBRARY</span><span className="setv">Full catalog</span><span className="sgo">›</span>
        </a>
      </div>
      </div>{/* .band */}

      <div className="band">
      <div className="fll">SETTINGS</div>
      <div className="setlist">
        <div className="setr" onClick={() => setUnits(units === 'Miles · °F' ? 'Kilometers · °C' : 'Miles · °F')}>
          <span className="setk">UNITS</span><span className="setv">{units}</span><span className="sgo">›</span>
        </div>
        <div className="setr">
          <span className="setk">EXPERIENCE</span><span className="setv">{prettyExperience(seed.user.experienceLevel)}</span><span className="sgo">›</span>
        </div>
        <div className="setr" onClick={onOpenPaywall}>
          <span className="setk">SUBSCRIPTION</span><span className="setv">{seed.user.subscriptionLabel}</span><span className="sgo">›</span>
        </div>
        <div className="setr danger">
          <span className="setk">SIGN OUT</span><span className="setv"></span>
        </div>
      </div>
      </div>{/* .band */}

      {/* Connection rows · per-source connection state with sync timestamp.
          Closes coverage line 1816 (connected sources management). */}
      <div className="band">
      <div className="fll">CONNECTIONS</div>

      {/* StravaConnectionCard · live state from /api/strava/status with
          the full connect / reconnect / disconnect CTA. Lives at the top
          of CONNECTIONS so the runner sees what's wrong AND the fix in
          one place. Auto-focuses the Reconnect button when the page is
          loaded with the /me#strava-card hash. */}
      <div id="strava-card">
        <StravaConnectionCard initial={{ connected: false }} />
      </div>

      <div className="fa-rows">
        {seed.connections.map(c => (
          <ToolkitConnectionRow
            key={c.id}
            name={c.nm}
            connected={c.on}
            lastSyncIso={c.lastSyncIso}
            logo={
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: c.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                {c.gl}
              </div>
            }
          />
        ))}
      </div>
      </div>{/* .band */}

      {/* Pro toggles · phone_hr_alerts + strava_auto_push. Closes
          coverage line 2034 (per-user phone HR alerts toggle) + line 1546
          (strava_auto_push). Lazy-fetched/patched via /api/profile. */}
      <div className="band">
      <div className="fll">PRO TOGGLES</div>
      <div className="fa-rows">
        <ProfileToggleRows />
      </div>
      </div>{/* .band */}

      {/* Notification preferences · live GET + PATCH against
          /api/profile/notifications. Closes coverage line 1806 (notification
          taxonomy) + line 1468 (per-category prefs). */}
      <div className="band">
      <div className="fll">NOTIFICATIONS</div>
      <NotificationPrefsList />
      </div>{/* .band */}

      {/* Coach activity log · last 30 days of coach_intents rows in plain
          English. Closes coverage line 1999 (coach_intents activity log). */}
      <div className="band">
      <div className="fll">COACH ACTIVITY</div>
      <CoachActivityTimeline limit={20} />
      </div>{/* .band */}

      <ShoeEditor
        editing={editing}
        garage={garage}
        pending={pending}
        onClose={() => setEditing(null)}
        onSave={(rec) => {
          if (editing == null) return;
          if (editing >= 0) {
            const existing = garage[editing];
            const updated: ShoeRec = { ...existing, ...rec, id: existing.id };
            setGarage(g => g.map((s, i) => i === editing ? updated : s));
            void persistPatch(updated);
          } else {
            setGarage(g => [...g, rec]);
            void persistAdd(rec);
          }
          setEditing(null);
        }}
        onDelete={() => {
          if (editing == null || editing < 0) return;
          const rec = garage[editing];
          setGarage(g => g.filter((_, i) => i !== editing));
          void persistDelete(rec);
          setEditing(null);
        }}
      />
    </>
  );
}

/* ============================================================
   ProfileToggleRows · phone_hr_alerts + strava_auto_push toggles
   Lazy GET /api/profile, PATCH back on change.
   ============================================================ */
function ProfileToggleRows() {
  const [phoneHrAlerts, setPhoneHrAlerts] = useState<boolean | null>(null);
  const [autoPush, setAutoPush] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!alive || !j) return;
        setPhoneHrAlerts(Boolean(j.phone_hr_alerts));
        setAutoPush(Boolean(j.strava_auto_push));
      })
      .catch(() => { /* fail soft */ });
    return () => { alive = false; };
  }, []);

  async function patch(field: 'phone_hr_alerts' | 'strava_auto_push', next: boolean) {
    setBusy(field); setErr(null);
    try {
      const r = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (field === 'phone_hr_alerts') setPhoneHrAlerts(next);
      else setAutoPush(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ToggleRow
        label="Phone HR alerts"
        sub="Buzz when watch HR drifts beyond zone during a run"
        checked={phoneHrAlerts ?? false}
        busy={busy === 'phone_hr_alerts'}
        onChange={(n) => void patch('phone_hr_alerts', n)}
      />
      <ToggleRow
        label="Auto-push to Strava"
        sub="Push completed watch runs to Strava without a manual tap"
        checked={autoPush ?? false}
        busy={busy === 'strava_auto_push'}
        onChange={(n) => void patch('strava_auto_push', n)}
      />
      {err ? <p className="fa-prov" style={{ color: 'var(--over)', padding: '8px 16px' }}>{err}</p> : null}
    </>
  );
}

/* ============================================================
   PhysiologyBlock · LTHR / HRmax / RHR / VDOT readout with
   ProvenanceLine sublines. Fetches /api/profile/state (not
   /api/profile) so max_hr is the RESOLVED value (ratchet +
   observed) and vdot is computed — both were blank when this
   read the raw profile table. Cluster 3 fix.
   ============================================================ */
interface ProfilePhysiology {
  max_hr: number | null;   // resolved via loadEffectiveMaxHr
  max_hr_source: string | null;
  rhr: number | null;
  lthr: number | null;
  lthr_method: string | null;
  lthr_set_at: string | null;
  vdot: number | null;
}

function PhysiologyBlock() {
  const [p, setP] = useState<ProfilePhysiology | null>(null);
  const [loading, setLoading] = useState(true);
  const { openTerm, drawerEl } = useGlossaryDrawer();

  useEffect(() => {
    let alive = true;
    fetch('/api/profile/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        const ph = j?.physiology ?? {};
        setP({
          max_hr:        typeof ph.max_hr        === 'number' ? ph.max_hr        : null,
          max_hr_source: typeof ph.max_hr_source === 'string' ? ph.max_hr_source : null,
          rhr:           typeof ph.rhr           === 'number' ? ph.rhr           : null,
          lthr:          typeof ph.lthr          === 'number' ? ph.lthr          : null,
          lthr_method:   typeof ph.lthr_method   === 'string' ? ph.lthr_method   : null,
          lthr_set_at:   typeof ph.lthr_set_at   === 'string' ? ph.lthr_set_at   : null,
          vdot:          typeof ph.vdot          === 'number' ? ph.vdot          : null,
        });
      })
      .catch(() => { /* fail soft */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="fa-rows" style={{ padding: 14, color: 'var(--fa-mute)' }}>Loading…</div>;
  }
  if (!p) {
    return <div className="fa-rows" style={{ padding: 14, color: 'var(--fa-mute)' }}>Sign in to see your physiology.</div>;
  }

  // Resolve provenance + freshness for each metric. Stale at >120d.
  const lthrSetDate = p.lthr_set_at ? new Date(p.lthr_set_at) : null;
  const lthrSetLabel = lthrSetDate && Number.isFinite(lthrSetDate.getTime())
    ? lthrSetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const lthrStale = lthrSetDate
    ? Date.now() - lthrSetDate.getTime() > 120 * 86400000
    : false;
  const lthrMethodLabel = (() => {
    switch (p.lthr_method) {
      case 'race_half':    return 'From a half marathon';
      case 'race_full':    return 'From a marathon';
      case 'race_marathon':return 'From a marathon';
      case 'manual':       return 'Entered manually';
      default:             return p.lthr_method ?? 'Source unknown';
    }
  })();
  const hrmaxLabel =
    p.max_hr_source === 'observed'     ? 'From Apple Watch data' :
    p.max_hr_source === 'manual'       ? 'Entered manually' :
    p.max_hr_source === 'lthr-derived' ? 'Estimated from LTHR' :
    p.max_hr_source === 'formula'      ? 'Estimated from formula' :
    'Not set';

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <div>
          <StatTile value={p.lthr ?? '·'} unit={p.lthr ? 'bpm' : ''} label="LTHR (threshold HR)" onExplain={() => openTerm('LTHR')} />
          <div style={{ padding: '0 16px 12px' }}>
            {p.lthr
              ? <ProvenanceLine set={lthrSetLabel ?? undefined} method={lthrMethodLabel} stale={lthrStale} />
              : <ProvenanceLine method="Run a half or marathon to anchor this." />}
          </div>
        </div>
        <div>
          <StatTile value={p.max_hr ?? '·'} unit={p.max_hr ? 'bpm' : ''} label="HRmax" onExplain={() => openTerm('HRmax')} />
          <div style={{ padding: '0 16px 12px' }}>
            <ProvenanceLine method={hrmaxLabel} />
          </div>
        </div>
        <div>
          <StatTile value={p.rhr ?? '·'} unit={p.rhr ? 'bpm' : ''} label="RHR" onExplain={() => openTerm('RHR')} />
          <div style={{ padding: '0 16px 12px' }}>
            <ProvenanceLine method={p.rhr ? 'Daily from Apple Health' : 'Connect a source for daily RHR.'} />
          </div>
        </div>
        <div>
          <StatTile value={p.vdot ?? '·'} label="VDOT" onExplain={() => openTerm('VDOT')} />
          <div style={{ padding: '0 16px 12px' }}>
            <ProvenanceLine method={p.vdot ? 'Daniels formula · derived from your best recent race' : 'Run a race to anchor this.'} />
          </div>
        </div>
      </div>
      {drawerEl}
    </>
  );
}

/** Map profile.experience_level enum to the runner-facing label. */
function prettyExperience(lvl: string | null): string {
  switch (lvl) {
    case 'beginner':      return 'Beginner runner';
    case 'intermediate':  return 'Intermediate runner';
    case 'advanced':      return 'Advanced runner';
    case 'advanced_plus': return 'Elite runner';
    default:              return 'Runner';
  }
}

function ShoeEditor({
  editing, garage, pending, onClose, onSave, onDelete,
}: {
  editing: number | null;
  garage: ShoeRec[];
  pending: boolean;
  onClose: () => void;
  onSave: (s: ShoeRec) => void;
  onDelete: () => void;
}) {
  const isAdd = editing === -1;
  const initial: ShoeRec = editing != null && editing >= 0
    ? garage[editing]
    : { nm: '', role: 'EASY', roles: ['EASY'], preferred: true, mi: 0, max: 400 };
  const [nm, setNm]               = useState(initial.nm);
  const [roles, setRoles]         = useState<string[]>(initial.roles);
  const [preferred, setPreferred] = useState(initial.preferred);
  const [max, setMax]             = useState(initial.max);
  const [baselineMi, setBaselineMi] = useState(initial.baseline_mi ?? 0);

  /** Toggle a role on/off. Prevents deselecting the last one. */
  function toggleRole(r: string) {
    setRoles(cur => cur.includes(r)
      ? (cur.length > 1 ? cur.filter(x => x !== r) : cur)
      : [...cur, r]
    );
  }

  useEffect(() => {
    const cur = editing != null && editing >= 0
      ? garage[editing]
      : { nm: '', role: 'EASY', roles: ['EASY'], preferred: true, mi: 0, max: 400 };
    setNm(cur.nm);
    setRoles(cur.roles ?? [cur.role ?? 'EASY']);  // fallback: build from role if roles absent
    setPreferred(cur.preferred ?? true);
    setMax(cur.max);
    setBaselineMi(cur.baseline_mi ?? 0);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing == null) return null;
  return (
    <div className="ov open">
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard shoe-ed">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="se-title">{isAdd ? 'Add a shoe' : 'Edit shoe'}</div>
        <div className="se-lbl">SHOE NAME</div>
        <input className="se-input" value={nm} placeholder="e.g. Vaporfly 3" onChange={(e) => setNm(e.target.value)} spellCheck={false} />
        <div className="se-lbl">FOR THESE RUN TYPES</div>
        <div className="se-roles">
          {ROLES.map(r => (
            <button
              key={r}
              className={`se-role${roles.includes(r) ? ' on' : ''}`}
              style={{ borderColor: roles.includes(r) ? ROLECOL[r] ?? '#14C08C' : 'transparent' }}
              onClick={() => toggleRole(r)}
            >
              <span className="sd" style={{ background: ROLECOL[r] ?? '#14C08C' }} />{r}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={preferred}
            onChange={(e) => setPreferred(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: '#14C08C', cursor: 'pointer' }}
          />
          <span className="se-lbl" style={{ margin: 0, color: preferred ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.28)' }}>
            PRIMARY SHOE FOR THESE TYPES
          </span>
        </label>
        <div className="se-two">
          <div>
            <div className="se-lbl">MILES BEFORE APP</div>
            <input className="se-input" type="number" inputMode="numeric" min={0} value={baselineMi} onChange={(e) => setBaselineMi(Math.max(0, parseInt(e.target.value || '0', 10)))} />
          </div>
          <div>
            <div className="se-lbl">RETIRE AT</div>
            <input className="se-input" type="number" inputMode="numeric" min={50} value={max} onChange={(e) => setMax(parseInt(e.target.value || '400', 10))} />
          </div>
        </div>
        <div className="se-acts">
          {!isAdd && <button className="se-del" onClick={onDelete} disabled={pending}>Remove shoe</button>}
          <button className="se-save" disabled={pending} onClick={() => onSave({ nm: nm.trim() || 'New shoe', role: roles[0] ?? 'EASY', roles, preferred, mi: initial.mi, max: Math.max(50, max), baseline_mi: baselineMi })}>{pending ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
