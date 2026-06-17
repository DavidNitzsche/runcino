'use client';
import { useEffect, useState, useCallback } from 'react';

interface Check { label: string; pass: boolean; note: string; }
interface Tester {
  id: string; email: string; name: string;
  createdAt: string; lastSeen: string | null; onboardedAt: string | null;
  connections: { strava: boolean; healthkit: boolean };
  runs30: { count: number; mi: number };
  profile: {
    goalDistance: string | null; goalDate: string | null; goalTime: string | null;
    ttGoalDistance: string | null; ttGoalTime: string | null;
    weeklyFrequency: number | null; weeklyMileageTarget: number | null;
    historyAvgMi: string | null; historyLongest: string | null; historyYears: string | null;
    timezone: string | null; hrmax: number | null; rhr: number | null;
    experienceLevel: string | null; connectionsSkipped: boolean;
    observedMaxHr: number | null; restingHr: number | null; hrv: number | null; vo2maxHk: number | null;
    derivedAvgWkMi: number | null; derivedLongestMi: number | null; runningSinceMonths: number | null;
  } | null;
  plan: {
    mode: string; phaseLabel: string | null; intent: string | null;
    anchorVdot: string | null; anchorSource: string | null;
    authoredIso: string; raceDate: string | null;
    weekCount: number; totalRunDays: number; totalPlanMi: number;
    peakLongRunMi: number; avgRunMi: number; earlyRamp: number[];
  } | null;
  checks: Check[];
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function goalLabel(dist: string | null) {
  const map: Record<string, string> = { marathon: 'Marathon', half: 'Half Marathon', '10k': '10K', '5k': '5K', '1mi': '1 Mile', none: 'Get faster', coached: 'Coached' };
  return dist ? (map[dist] ?? dist) : '—';
}
// A no-race time goal (goal mode) lives in ttGoalDistance/ttGoalTime, not the
// race columns — show THAT instead of the generic "Get faster".
function goalDisplay(p: NonNullable<Tester['profile']>): string {
  if ((!p.goalDistance || p.goalDistance === 'none') && p.ttGoalDistance) {
    return `${goalLabel(p.ttGoalDistance)} · faster`;
  }
  return `${goalLabel(p.goalDistance)}${p.goalDate ? ' · ' + fmtDate(p.goalDate) : ''}`;
}
// The plan's real identity is its phase ("5K BUILD") + fitness anchor, not the
// raw mode column (always 'maintenance' for every no-race plan).
function anchorDisplay(plan: NonNullable<Tester['plan']>): string | null {
  if (!plan.anchorVdot) return null;
  const src = plan.anchorSource === 'measured_run' ? 'measured'
    : plan.anchorSource === 'provisional_mileage' ? 'estimate'
    : plan.anchorSource ?? '';
  return `VDOT ${plan.anchorVdot}${src ? ' · ' + src : ''}`;
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function Ramp({ data }: { data: number[] }) {
  if (!data.length) return <span style={{ color: 'var(--tw-muted)' }}>—</span>;
  const max = Math.max(...data, 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28, marginTop: 8 }}>
        {data.map((mi, i) => (
          <div key={i} title={`Wk ${i + 1}: ${mi}mi`} style={{
            flex: 1, minWidth: 8, borderRadius: '2px 2px 0 0',
            background: '#3cf', opacity: 0.7,
            height: Math.max(Math.round((mi / max) * 28), 3),
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
        {data.map((mi, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--tw-muted)' }}>{mi}</span>
        ))}
      </div>
    </div>
  );
}

function TesterCard({ t }: { t: Tester }) {
  const p = t.profile;
  const plan = t.plan;
  const isOnboarded = !!t.onboardedAt;

  return (
    <div className="tw-card">
      <div className="tw-card-head">
        <div className="tw-avatar">{initials(t.name)}</div>
        <div className="tw-info">
          <div className="tw-name">{t.name}</div>
          <div className="tw-email">{t.email}</div>
        </div>
        <div className="tw-badges">
          {isOnboarded
            ? <span className="tw-badge tw-badge-on">Onboarded</span>
            : <span className="tw-badge tw-badge-pend">Pending</span>}
          {t.connections.strava && <span className="tw-badge tw-badge-strava">Strava</span>}
          {t.connections.healthkit && <span className="tw-badge tw-badge-hk">HealthKit</span>}
          {p?.connectionsSkipped && <span className="tw-badge tw-badge-skip">No connections</span>}
        </div>
      </div>

      <div className="tw-card-body">
        {/* Profile */}
        <div className="tw-section">
          <div className="tw-sec-title">Profile</div>
          {p ? (<>
            <KV k="Goal" v={goalDisplay(p)} hi />
            <KV k="Goal time" v={p.goalTime ?? p.ttGoalTime} />
            <KV k="Frequency" v={p.weeklyFrequency ? `${p.weeklyFrequency}d/wk` : null} />
            <KV k="Mileage target" v={p.weeklyMileageTarget ? `${p.weeklyMileageTarget} mi/wk` : null} />
            <div className="tw-sep" />
            <KV k="History avg" v={p.historyAvgMi ?? (p.derivedAvgWkMi != null ? `${p.derivedAvgWkMi} mi/wk · runs` : null)} />
            <KV k="Longest recent" v={p.historyLongest ?? (p.derivedLongestMi != null ? `${p.derivedLongestMi} mi · runs` : null)} />
            <KV k="Years running" v={p.historyYears ?? (p.runningSinceMonths != null ? (p.runningSinceMonths >= 12 ? `${(p.runningSinceMonths / 12).toFixed(1)} yr · runs` : `${p.runningSinceMonths} mo · runs`) : null)} />
            <div className="tw-sep" />
            <KV k="Timezone" v={p.timezone} />
            <KV k="HRmax" v={p.hrmax ?? (p.observedMaxHr != null ? `${p.observedMaxHr} · observed` : null)} />
            <KV k="RHR" v={p.rhr ?? (p.restingHr != null ? `${p.restingHr} · HealthKit` : null)} />
            <KV k="HRV" v={p.hrv != null ? `${p.hrv} ms · HealthKit` : null} />
            <KV k="VO2max (HK)" v={p.vo2maxHk != null ? `${p.vo2maxHk} · estimate` : null} />
            <KV k="Experience" v={p.experienceLevel} />
          </>) : <div className="tw-empty">Not yet onboarded</div>}
        </div>

        {/* Plan */}
        <div className="tw-section">
          <div className="tw-sec-title">Plan</div>
          {plan ? (<>
            <KV k="Mode" v={plan.phaseLabel ?? plan.mode} hi />
            <KV k="Fitness anchor" v={anchorDisplay(plan)} />
            <KV k="Length" v={`${plan.weekCount} weeks`} />
            <KV k="Race date" v={fmtDate(plan.raceDate)} />
            <KV k="Total mi" v={`${plan.totalPlanMi} mi`} />
            <KV k="Peak long run" v={`${plan.peakLongRunMi} mi`} />
            <KV k="Avg run" v={`${plan.avgRunMi} mi`} />
            <KV k="Total run days" v={plan.totalRunDays} />
            <div className="tw-sep" />
            <div className="tw-sec-title" style={{ marginTop: 4 }}>Early ramp (wk 1–4)</div>
            <Ramp data={plan.earlyRamp} />
          </>) : <div className="tw-empty">{isOnboarded ? 'No active plan' : 'Not yet onboarded'}</div>}
        </div>

        {/* Activity */}
        <div className="tw-section">
          <div className="tw-sec-title">Activity</div>
          <KV k="Joined" v={fmtDate(t.createdAt)} />
          <KV k="Onboarded" v={t.onboardedAt ? fmtDateTime(t.onboardedAt) : null} />
          <KV k="Last seen" v={t.lastSeen ? fmtDateTime(t.lastSeen) : null} />
          <div className="tw-sep" />
          <KV k="Runs (30d)" v={t.runs30.count ?? 0} hi />
          <KV k="Miles (30d)" v={t.runs30.mi ? `${t.runs30.mi} mi` : '0 mi'} />
          <div className="tw-sep" />
          <KV k="Strava" v={t.connections.strava ? '✓ connected' : null} />
          <KV k="HealthKit" v={t.connections.healthkit ? '✓ connected' : null} />
        </div>
      </div>

      {t.checks.length > 0 && (
        <div className="tw-checks">
          {t.checks.map((c, i) => (
            <div key={i} className={`tw-check tw-check-${c.pass ? 'pass' : 'fail'}`} title={c.note}>
              {c.pass ? '✓' : '✗'} {c.label}{c.note ? ` · ${c.note}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KV({ k, v, hi }: { k: string; v: string | number | null | undefined; hi?: boolean }) {
  return (
    <div className="tw-kv">
      <span className="tw-k">{k}</span>
      <span className={`tw-v${hi ? ' hi' : ''}`}>{v ?? '—'}</span>
    </div>
  );
}

export function TesterList() {
  const [testers, setTesters] = useState<Tester[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/admin/tester-watch');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setTesters(json.testers ?? []);
      setUpdatedAt(new Date().toLocaleTimeString());
      setStatus('ok');
    } catch (e: any) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = testers.filter(t =>
    !filter || t.email.toLowerCase().includes(filter.toLowerCase()) || t.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <style>{css}</style>
      <div className="tw-toolbar">
        <button className="tw-btn" onClick={load} disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
        <input
          className="tw-filter"
          type="text"
          placeholder="Filter by name or email…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {updatedAt && <span className="tw-ts">Updated {updatedAt}</span>}
      </div>

      {status === 'error' && <div className="tw-msg tw-err">Error: {error}</div>}
      {status === 'ok' && !visible.length && <div className="tw-msg">No testers found.</div>}
      {visible.map(t => <TesterCard key={t.id} t={t} />)}
    </>
  );
}

const css = `
:root {
  --tw-muted: #666;
  --tw-border: #2a2a2a;
  --tw-surface: #141414;
  --tw-surface2: #1c1c1c;
  --tw-accent: #e8ff47;
  --tw-active: #3cf;
  --tw-pass: #4caf50;
  --tw-fail: #f44336;
  --tw-warn: #f90;
}
.tw-toolbar {
  display: flex; align-items: center; gap: 10px; margin-bottom: 24px;
}
.tw-btn {
  background: var(--tw-accent); border: none; border-radius: 8px;
  color: #000; cursor: pointer; font-size: 13px; font-weight: 700;
  padding: 9px 16px;
}
.tw-btn:disabled { opacity: .5; cursor: default; }
.tw-filter {
  background: var(--tw-surface2); border: 1px solid var(--tw-border);
  border-radius: 8px; color: #f0f0f0; font-size: 13px;
  padding: 9px 12px; outline: none; width: 280px;
}
.tw-filter:focus { border-color: var(--tw-accent); }
.tw-ts { margin-left: auto; color: var(--tw-muted); font-size: 12px; }
.tw-msg { color: var(--tw-muted); padding: 40px; text-align: center; font-size: 13px; }
.tw-err { color: var(--tw-fail); }

.tw-card {
  background: var(--tw-surface); border: 1px solid var(--tw-border);
  border-radius: 12px; margin-bottom: 20px; overflow: hidden;
}
.tw-card-head {
  padding: 16px 20px; border-bottom: 1px solid var(--tw-border);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.tw-avatar {
  width: 36px; height: 36px; background: var(--tw-surface2);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: var(--tw-accent); flex-shrink: 0;
}
.tw-info { flex: 1; }
.tw-name { font-weight: 600; font-size: 15px; }
.tw-email { color: var(--tw-muted); font-size: 12px; font-family: 'SF Mono', monospace; }
.tw-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.tw-badge {
  border-radius: 4px; font-size: 10px; font-weight: 700;
  letter-spacing: .06em; padding: 2px 7px; text-transform: uppercase;
}
.tw-badge-on  { background: #4caf5020; color: var(--tw-pass); border: 1px solid #4caf5040; }
.tw-badge-pend{ background: #f9900020; color: var(--tw-warn); border: 1px solid #f9900040; }
/* #fc4c02 = --strava (brand orange); #fc6a2a = lighter text companion */
.tw-badge-strava { background: #fc4c0220; color: #fc6a2a; border: 1px solid #fc4c0235; }
.tw-badge-hk  { background: #f4433620; color: #ff7070;  border: 1px solid #f4433635; }
.tw-badge-skip{ background: #66666620; color: var(--tw-muted); border: 1px solid var(--tw-border); }

.tw-card-body {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
}
@media (max-width: 860px) { .tw-card-body { grid-template-columns: 1fr; } }

.tw-section {
  padding: 16px 20px; border-right: 1px solid var(--tw-border);
}
.tw-section:last-child { border-right: none; }
.tw-sec-title {
  font-size: 10px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--tw-muted); margin-bottom: 10px;
}
.tw-empty { color: var(--tw-muted); font-size: 12px; }
.tw-sep { border: none; border-top: 1px solid var(--tw-border); margin: 8px 0; }

.tw-kv {
  display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px;
}
.tw-k { color: var(--tw-muted); font-size: 12px; }
.tw-v {
  font-size: 12px; font-weight: 500; text-align: right;
  font-family: 'SF Mono', monospace; color: #f0f0f0;
}
.tw-v.hi { color: var(--tw-accent); }

.tw-checks {
  padding: 12px 20px; border-top: 1px solid var(--tw-border);
  display: flex; flex-wrap: wrap; gap: 7px;
}
.tw-check {
  border-radius: 6px; font-size: 11px; padding: 4px 10px;
}
.tw-check-pass {
  background: #4caf5015; border: 1px solid #4caf5030; color: var(--tw-pass);
}
.tw-check-fail {
  background: #f4433615; border: 1px solid #f4433630; color: var(--tw-fail);
}
`;
