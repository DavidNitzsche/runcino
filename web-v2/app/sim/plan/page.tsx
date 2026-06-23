'use client';

/**
 * Plan simulator · /sim/plan · 2026-06-22
 *
 * Internal tool. Twist the onboarding variables on the left; the right side
 * re-runs the REAL plan engine (POST /api/plan/simulate → composePlan) and
 * redraws the full-arc week grid live. Nothing is persisted.
 *
 * SimInputs / response shapes are defined locally (not imported) so this client
 * bundle never pulls in lib/plan/generate.ts (which imports the DB pool). Keep
 * them in sync with lib/plan/sim-inputs.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

type Distance = '5k' | '10k' | 'half' | 'marathon';
type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
type Level = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

interface SimInputs {
  distance: Distance;
  raceDateISO: string;
  goalTimeSec: number | null;
  startDateISO: string;
  level: Level;
  weeklyFrequency: number | null;
  longRunDay: DayKey;
  recentWeeklyMi: number;
  recentLongMi: number;
  bestRecentVdot?: number | null;
  easyDayMedianMi?: number | null;
  isMidBlock?: boolean;
  restDay?: DayKey | null;
  availableDays?: DayKey[] | null;
  lthr?: number | null;
  maxHr?: number | null;
}

interface SimDay {
  dow: number;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  notes: string;
}
interface SimWeek {
  startISO: string;
  phase: string;
  weeklyMi: number;
  isRaceWeek: boolean;
  tPaceSec: number | null;
  days: SimDay[];
}
interface SimResult {
  ok: boolean;
  reason?: string;
  derived?: {
    raceDistanceMi: number;
    goalPaceSec: number | null;
    tPaceSec: number;
    longRunDow: number;
    restDow: number;
    qualityDows: number[];
    trainingDaysPerWeek: number | null;
    runwayWeeks: number;
    distanceCategory: string;
  };
  validation?: { valid: boolean; violations: string[] };
  plan?: { totalWeeks: number; vols: number[]; weeks: SimWeek[] };
}

// ── palette · mirrors app/globals.css locked ten-color tokens ──────────────
const C = {
  bg: '#0A0C10', card: '#11141A', line: 'rgba(255,255,255,.08)',
  txt: '#F6F7F8', mute: '#8A90A0', dim: '#4B505E',
  green: '#3EBD41', gold: '#F3AD38', pink: '#FC4D64', cyan: '#27B4E0',
  red: '#D03F3F', brightGold: '#F0DF47',
};

const TYPE_STYLE: Record<string, { color: string; tag: string }> = {
  easy: { color: C.green, tag: 'EASY' },
  long: { color: C.gold, tag: 'LONG' },
  threshold: { color: C.red, tag: 'THR' },
  tempo: { color: C.red, tag: 'TMP' },
  intervals: { color: C.pink, tag: 'INT' },
  shakeout: { color: C.cyan, tag: 'SHAKE' },
  race_week_tuneup: { color: C.brightGold, tag: 'TUNE' },
  race: { color: C.red, tag: 'RACE' },
  rest: { color: C.dim, tag: '' },
};
const PHASE_COLOR: Record<string, string> = {
  BASE: C.green, QUALITY: C.gold, 'RACE-SPECIFIC': C.pink, SHARPEN: C.pink, TAPER: C.cyan,
};

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ── date + time helpers ────────────────────────────────────────────────────
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function plusDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}
const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const domOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDate();

function fmtClock(sec: number | null): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function parseClock(str: string): number | null {
  const parts = str.trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return null;
}
const fmtPace = (secPerMi: number | null) => (secPerMi == null ? '—' : `${fmtClock(secPerMi)}/mi`);

const DISTANCE_LABEL: Record<Distance, string> = { '5k': '5K', '10k': '10K', half: 'Half', marathon: 'Marathon' };

export default function PlanSimulatorPage() {
  const today = useMemo(() => isoOf(new Date()), []);
  const [sim, setSim] = useState<SimInputs>(() => ({
    distance: 'marathon',
    raceDateISO: plusDays(isoOf(new Date()), 126),
    goalTimeSec: 12600, // 3:30:00
    startDateISO: isoOf(new Date()),
    level: 'intermediate',
    weeklyFrequency: 5,
    longRunDay: 'sun',
    recentWeeklyMi: 30,
    recentLongMi: 12,
    bestRecentVdot: null,
    easyDayMedianMi: null,
    isMidBlock: false,
    restDay: 'sat',
    availableDays: null,
    lthr: null,
    maxHr: null,
  }));
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const [goalText, setGoalText] = useState(fmtClock(12600));
  const seq = useRef(0);

  const set = <K extends keyof SimInputs>(k: K, v: SimInputs[K]) => setSim((s) => ({ ...s, [k]: v }));

  // Debounced re-simulate on every change.
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/plan/simulate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sim),
        });
        if (!res.ok) {
          if (id === seq.current) {
            setResult(null);
            setNetError(res.status === 401
              ? 'Sign in required — the simulator needs a logged-in session.'
              : `server error ${res.status}`);
          }
          return;
        }
        const json = (await res.json()) as SimResult;
        if (id === seq.current) { setResult(json); setNetError(null); }
      } catch (e: any) {
        if (id === seq.current) setNetError(e?.message ?? 'request failed');
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [sim]);

  const plan = result?.plan;
  const derived = result?.derived;
  const validation = result?.validation;

  // Column order: every week starts on the same dow (startDateISO's dow).
  const cols = useMemo(() => {
    const startDow = plan?.weeks?.[0] ? dowOf(plan.weeks[0].startISO) : dowOf(sim.startDateISO);
    return Array.from({ length: 7 }, (_, k) => (startDow + k) % 7);
  }, [plan, sim.startDateISO]);

  const peakMi = plan ? Math.max(0, ...plan.weeks.map((w) => w.weeklyMi)) : 0;
  const totalMi = plan ? Math.round(plan.weeks.reduce((s, w) => s + w.weeklyMi, 0)) : 0;

  return (
    <div className="sim-root">
      <style>{CSS}</style>

      {/* ── CONTROL RAIL ─────────────────────────────────────────────── */}
      <aside className="sim-rail">
        <div className="sim-railhead">
          <div className="sim-kicker">Plan Simulator</div>
          <div className="sim-railsub">Onboarding variables → live schedule</div>
        </div>

        <Group title="Goal">
          <Field label="Race distance">
            <Seg
              options={(['5k', '10k', 'half', 'marathon'] as Distance[]).map((d) => ({ v: d, label: DISTANCE_LABEL[d] }))}
              value={sim.distance}
              onChange={(v) => set('distance', v)}
            />
          </Field>
          <Field label="Goal time" hint="blank = by feel (no goal pace)">
            <div className="sim-inline">
              <input
                className="sim-text"
                value={goalText}
                placeholder="h:mm:ss"
                onChange={(e) => {
                  setGoalText(e.target.value);
                  const parsed = e.target.value.trim() === '' ? null : parseClock(e.target.value);
                  set('goalTimeSec', parsed);
                }}
              />
              <button className="sim-mini" onClick={() => { setGoalText(''); set('goalTimeSec', null); }}>by feel</button>
            </div>
          </Field>
          <Field label="Race date">
            <input className="sim-text" type="date" value={sim.raceDateISO} min={sim.startDateISO}
              onChange={(e) => set('raceDateISO', e.target.value)} />
          </Field>
          <Field label="Start date" hint="week-0 anchor">
            <input className="sim-text" type="date" value={sim.startDateISO} min={today}
              onChange={(e) => set('startDateISO', e.target.value)} />
          </Field>
        </Group>

        <Group title="Runner">
          <Field label="Experience">
            <Seg
              options={[
                { v: 'beginner', label: 'Beg' }, { v: 'intermediate', label: 'Int' },
                { v: 'advanced', label: 'Adv' }, { v: 'advanced_plus', label: 'Adv+' }, { v: null, label: 'Auto' },
              ]}
              value={sim.level}
              onChange={(v) => set('level', v as Level)}
            />
          </Field>
          <Field label="Days per week" hint={sim.weeklyFrequency == null ? 'legacy fill-every-slot' : '0 = couch-to-X floor of 3'}>
            <div className="sim-chiprow">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button key={n} className={`sim-chip ${sim.weeklyFrequency === n ? 'on' : ''}`}
                  onClick={() => set('weeklyFrequency', n)}>{n}</button>
              ))}
              <button className={`sim-chip ${sim.weeklyFrequency == null ? 'on' : ''}`}
                onClick={() => set('weeklyFrequency', null)}>—</button>
            </div>
          </Field>
          <Field label="Long run day">
            <DayPicker value={sim.longRunDay} onChange={(d) => set('longRunDay', d)} />
          </Field>
          <Field label="Recent weekly mileage" value={`${sim.recentWeeklyMi} mi`}>
            <input className="sim-range" type="range" min={0} max={90} step={1} value={sim.recentWeeklyMi}
              onChange={(e) => set('recentWeeklyMi', Number(e.target.value))} />
          </Field>
          <Field label="Recent longest run" value={`${sim.recentLongMi} mi`}>
            <input className="sim-range" type="range" min={0} max={24} step={1} value={sim.recentLongMi}
              onChange={(e) => set('recentLongMi', Number(e.target.value))} />
          </Field>
        </Group>

        <details className="sim-adv">
          <summary>Derived signals <span className="sim-advnote">normally from Strava / runs</span></summary>
          <div className="sim-advbody">
            <Field label="Current fitness VDOT" value={sim.bestRecentVdot ? String(sim.bestRecentVdot) : 'none'}
              hint="none = goal-pace plan; set it to ramp from current fitness">
              <div className="sim-inline">
                <input className="sim-range" type="range" min={28} max={85} step={1}
                  value={sim.bestRecentVdot ?? 28}
                  onChange={(e) => set('bestRecentVdot', Number(e.target.value))} />
                <button className="sim-mini" onClick={() => set('bestRecentVdot', null)}>none</button>
              </div>
            </Field>
            <Field label="Easy-day median" value={`${sim.easyDayMedianMi ?? 0} mi`} hint="0 = cold start">
              <input className="sim-range" type="range" min={0} max={12} step={1} value={sim.easyDayMedianMi ?? 0}
                onChange={(e) => set('easyDayMedianMi', Number(e.target.value))} />
            </Field>
            <Field label="Rest day">
              <DayPicker value={sim.restDay ?? 'sat'} onChange={(d) => set('restDay', d)} />
            </Field>
            <Field label="Available days" hint="≥2 selected → runs land only on these">
              <DayMulti value={sim.availableDays ?? []} onChange={(days) => set('availableDays', days.length ? days : null)} />
            </Field>
            <Field label="Mid-block runner">
              <Toggle on={!!sim.isMidBlock} onChange={(v) => set('isMidBlock', v)} />
            </Field>
            <div className="sim-twocol">
              <Field label="LTHR" value={sim.lthr ? `${sim.lthr}` : '—'}>
                <input className="sim-text" type="number" min={120} max={200} placeholder="bpm"
                  value={sim.lthr ?? ''} onChange={(e) => set('lthr', e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <Field label="Max HR" value={sim.maxHr ? `${sim.maxHr}` : '—'}>
                <input className="sim-text" type="number" min={140} max={220} placeholder="bpm"
                  value={sim.maxHr ?? ''} onChange={(e) => set('maxHr', e.target.value ? Number(e.target.value) : null)} />
              </Field>
            </div>
          </div>
        </details>
      </aside>

      {/* ── RESULTS ──────────────────────────────────────────────────── */}
      <main className="sim-main">
        <header className="sim-summary">
          <div className="sim-sumleft">
            <h1 className="sim-title">
              {DISTANCE_LABEL[sim.distance]} build
              {loading && <span className="sim-spin" aria-label="loading" />}
            </h1>
            <div className="sim-statrow">
              <Stat label="Weeks" value={plan ? String(plan.totalWeeks) : '—'} />
              <Stat label="Peak" value={plan ? `${peakMi} mi` : '—'} />
              <Stat label="Total" value={plan ? `${totalMi} mi` : '—'} />
              <Stat label="Goal pace" value={fmtPace(derived?.goalPaceSec ?? null)} />
              <Stat label="T pace" value={fmtPace(derived?.tPaceSec ?? null)} />
              <Stat label="Cat" value={derived?.distanceCategory?.toUpperCase() ?? '—'} />
            </div>
          </div>
          <div className="sim-verdict">
            {result && !result.ok && <div className="sim-badge err">{result.reason}</div>}
            {netError && <div className="sim-badge err">network: {netError}</div>}
            {validation?.valid && <div className="sim-badge ok">VALID</div>}
            {validation && !validation.valid && (
              <div className="sim-badge warn" title={validation.violations.join('\n')}>
                {validation.violations.length} VIOLATION{validation.violations.length === 1 ? '' : 'S'}
              </div>
            )}
          </div>
        </header>

        {validation && !validation.valid && (
          <ul className="sim-violations">
            {validation.violations.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        )}

        {plan ? (
          <div className="sim-grid" style={{ gridTemplateColumns: `148px repeat(7, minmax(48px, 1fr))` }}>
            <div className="sim-ghead sim-wkhead">Week</div>
            {cols.map((dow, i) => (
              <div key={i} className={`sim-ghead ${dow === derived?.longRunDow ? 'islong' : ''}`}>{DAY_ABBR[dow]}</div>
            ))}

            {plan.weeks.map((w, wi) => {
              const byDow = new Map<number, SimDay>();
              for (const d of w.days) byDow.set(d.dow, d);
              const phaseColor = w.isRaceWeek ? C.red : (PHASE_COLOR[w.phase] ?? C.mute);
              return (
                <Row key={wi}>
                  <div className="sim-wklabel">
                    <span className="sim-wknum">W{wi + 1}</span>
                    <span className="sim-phase" style={{ color: phaseColor, borderColor: phaseColor }}>
                      {w.isRaceWeek ? 'RACE' : w.phase}
                    </span>
                    <span className="sim-wkmi">{w.weeklyMi}<i>mi</i></span>
                  </div>
                  {cols.map((dow, ci) => {
                    const d = byDow.get(dow);
                    const date = plusDays(w.startISO, ci);
                    return <Cell key={ci} day={d} dom={domOf(date)} />;
                  })}
                </Row>
              );
            })}
          </div>
        ) : (
          <div className="sim-empty">{netError ?? (result && !result.ok ? result.reason : 'Adjusting…')}</div>
        )}

        <Legend />
      </main>
    </div>
  );
}

// ── small components ────────────────────────────────────────────────────────
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sim-group">
      <div className="sim-grouptitle">{title}</div>
      {children}
    </section>
  );
}
function Field({ label, hint, value, children }: { label: string; hint?: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="sim-field">
      <div className="sim-fieldhead">
        <span className="sim-label">{label}</span>
        {value !== undefined && <span className="sim-value">{value}</span>}
      </div>
      {children}
      {hint && <div className="sim-hint">{hint}</div>}
    </div>
  );
}
function Seg<T extends string | null>({ options, value, onChange }: {
  options: { v: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="sim-seg">
      {options.map((o) => (
        <button key={String(o.v)} className={`sim-segbtn ${value === o.v ? 'on' : ''}`} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function DayPicker({ value, onChange }: { value: DayKey; onChange: (d: DayKey) => void }) {
  return (
    <div className="sim-daypick">
      {DAY_KEYS.map((d, i) => (
        <button key={d} className={`sim-day ${value === d ? 'on' : ''}`} onClick={() => onChange(d)} title={DAY_ABBR[i]}>
          {DAY_LETTER[i]}
        </button>
      ))}
    </div>
  );
}
function DayMulti({ value, onChange }: { value: DayKey[]; onChange: (d: DayKey[]) => void }) {
  const has = (d: DayKey) => value.includes(d);
  return (
    <div className="sim-daypick">
      {DAY_KEYS.map((d, i) => (
        <button key={d} className={`sim-day ${has(d) ? 'on' : ''}`}
          onClick={() => onChange(has(d) ? value.filter((x) => x !== d) : [...value, d])} title={DAY_ABBR[i]}>
          {DAY_LETTER[i]}
        </button>
      ))}
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`sim-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="sim-stat"><div className="sim-statval">{value}</div><div className="sim-statlabel">{label}</div></div>;
}
function Row({ children }: { children: React.ReactNode }) { return <>{children}</>; }
function Cell({ day, dom }: { day: SimDay | undefined; dom: number }) {
  if (!day || day.type === 'rest' || day.distanceMi <= 0) {
    return <div className="sim-cell rest"><span className="sim-dom">{dom}</span><span className="sim-restdash">·</span></div>;
  }
  const st = TYPE_STYLE[day.type] ?? { color: C.mute, tag: day.type.slice(0, 4).toUpperCase() };
  const isRace = day.type === 'race';
  return (
    <div className={`sim-cell ${isRace ? 'race' : ''}`}
      style={{ background: isRace ? st.color : st.color + '1E', borderColor: st.color + (isRace ? 'FF' : '55') }}
      title={[day.subLabel, day.notes].filter(Boolean).join(' · ') || st.tag}>
      <span className="sim-dom">{dom}</span>
      <span className="sim-dist" style={{ color: isRace ? '#fff' : st.color }}>
        {Number.isInteger(day.distanceMi) ? day.distanceMi : day.distanceMi.toFixed(1)}
      </span>
      <span className="sim-tag" style={{ color: isRace ? '#fff' : st.color }}>{day.isLong && !isRace ? 'LONG' : st.tag}</span>
    </div>
  );
}
function Legend() {
  const items: { t: string; label: string }[] = [
    { t: 'easy', label: 'Easy' }, { t: 'long', label: 'Long' }, { t: 'threshold', label: 'Threshold' },
    { t: 'intervals', label: 'Intervals' }, { t: 'tempo', label: 'Tempo' }, { t: 'shakeout', label: 'Shakeout' },
    { t: 'race_week_tuneup', label: 'Tune-up' }, { t: 'race', label: 'Race' },
  ];
  return (
    <div className="sim-legend">
      {items.map((it) => {
        const st = TYPE_STYLE[it.t];
        return <span key={it.t} className="sim-legitem"><i style={{ background: st.color }} />{it.label}</span>;
      })}
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────
const CSS = `
.sim-root{display:flex;min-height:100vh;background:var(--bg,#0A0C10);color:var(--txt,#F6F7F8);
  font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
.sim-rail{width:340px;flex:0 0 340px;border-right:1px solid var(--line,rgba(255,255,255,.08));
  padding:20px 18px 60px;overflow-y:auto;height:100vh;position:sticky;top:0;background:#0C0E13;}
.sim-railhead{margin-bottom:18px;}
.sim-kicker{font-family:Oswald,sans-serif;font-weight:600;font-size:20px;letter-spacing:.3px;}
.sim-railsub{font-size:12px;color:var(--mute,#8A90A0);margin-top:2px;}
.sim-group{margin-bottom:22px;}
.sim-grouptitle{font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--mute,#8A90A0);margin-bottom:12px;}
.sim-field{margin-bottom:15px;}
.sim-fieldhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
.sim-label{font-size:13px;color:#D6D9E0;}
.sim-value{font-family:Oswald,sans-serif;font-size:14px;color:var(--txt);}
.sim-hint{font-size:11px;color:var(--dim,#4B505E);margin-top:5px;line-height:1.3;}
.sim-inline{display:flex;gap:8px;align-items:center;}
.sim-twocol{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.sim-text{width:100%;background:#0A0C10;border:1px solid var(--line);border-radius:8px;color:var(--txt);
  padding:8px 10px;font-size:13px;font-family:inherit;}
.sim-text:focus{outline:none;border-color:#3a4150;}
input.sim-text[type=date]{color-scheme:dark;}
.sim-mini{background:#0A0C10;border:1px solid var(--line);border-radius:8px;color:var(--mute);
  padding:8px 10px;font-size:12px;cursor:pointer;white-space:nowrap;}
.sim-mini:hover{color:var(--txt);border-color:#3a4150;}
.sim-seg{display:flex;background:#0A0C10;border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px;}
.sim-segbtn{flex:1;background:transparent;border:none;color:var(--mute);font-size:12px;font-weight:600;
  padding:7px 4px;border-radius:6px;cursor:pointer;font-family:inherit;}
.sim-segbtn.on{background:#1C212B;color:var(--txt);}
.sim-segbtn:hover:not(.on){color:#C0C5D0;}
.sim-chiprow{display:flex;gap:5px;flex-wrap:wrap;}
.sim-chip{width:30px;height:30px;background:#0A0C10;border:1px solid var(--line);border-radius:7px;
  color:var(--mute);font-size:13px;cursor:pointer;font-family:Oswald,sans-serif;}
.sim-chip.on{background:#1C212B;color:var(--txt);border-color:#39414f;}
.sim-daypick{display:flex;gap:5px;}
.sim-day{width:34px;height:32px;background:#0A0C10;border:1px solid var(--line);border-radius:7px;
  color:var(--mute);font-size:12px;font-weight:700;cursor:pointer;}
.sim-day.on{background:#1C212B;color:var(--gold,#F3AD38);border-color:#39414f;}
.sim-range{width:100%;accent-color:var(--gold,#F3AD38);}
.sim-toggle{width:44px;height:26px;border-radius:13px;background:#1C212B;border:1px solid var(--line);
  cursor:pointer;position:relative;padding:0;}
.sim-toggle span{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#5a6171;
  transition:.18s;}
.sim-toggle.on{background:#2a3a2a;}
.sim-toggle.on span{left:20px;background:var(--green,#3EBD41);}
.sim-adv{margin-top:6px;border-top:1px solid var(--line);padding-top:14px;}
.sim-adv summary{font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--mute);cursor:pointer;list-style:none;}
.sim-adv summary::-webkit-details-marker{display:none;}
.sim-advnote{font-weight:500;letter-spacing:.2px;text-transform:none;color:var(--dim);margin-left:6px;}
.sim-advbody{margin-top:14px;}

.sim-main{flex:1;padding:24px 28px 60px;overflow-x:auto;height:100vh;overflow-y:auto;}
.sim-summary{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:18px;}
.sim-title{font-family:Oswald,sans-serif;font-weight:600;font-size:26px;margin:0 0 12px;display:flex;align-items:center;gap:10px;}
.sim-spin{width:13px;height:13px;border:2px solid var(--line);border-top-color:var(--gold);border-radius:50%;
  display:inline-block;animation:simspin .7s linear infinite;}
@keyframes simspin{to{transform:rotate(360deg);}}
.sim-statrow{display:flex;gap:22px;flex-wrap:wrap;}
.sim-stat{}
.sim-statval{font-family:Oswald,sans-serif;font-size:22px;font-weight:500;line-height:1;}
.sim-statlabel{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--mute);margin-top:5px;}
.sim-verdict{display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.sim-badge{font-size:12px;font-weight:800;letter-spacing:.8px;padding:6px 11px;border-radius:7px;white-space:nowrap;}
.sim-badge.ok{background:rgba(62,189,65,.14);color:var(--green,#3EBD41);}
.sim-badge.warn{background:rgba(243,173,56,.14);color:var(--gold,#F3AD38);cursor:help;}
.sim-badge.err{background:rgba(208,63,63,.16);color:#ff7a7a;max-width:280px;white-space:normal;text-align:right;}
.sim-violations{margin:0 0 18px;padding:12px 16px;background:rgba(243,173,56,.07);border:1px solid rgba(243,173,56,.2);
  border-radius:10px;list-style:none;}
.sim-violations li{font-size:12.5px;color:#E7C982;padding:2px 0;}
.sim-violations li::before{content:"· ";color:var(--gold);}

.sim-grid{display:grid;gap:4px;align-items:stretch;min-width:560px;}
.sim-ghead{font-size:11px;font-weight:700;letter-spacing:.5px;color:var(--mute);text-align:center;padding:2px 0 8px;}
.sim-ghead.islong{color:var(--gold,#F3AD38);}
.sim-wkhead{text-align:left;}
.sim-wklabel{display:flex;align-items:center;gap:8px;padding:0 6px;height:46px;}
.sim-wknum{font-family:Oswald,sans-serif;font-size:14px;color:var(--mute);width:30px;}
.sim-phase{font-size:9.5px;font-weight:800;letter-spacing:.6px;border:1px solid;border-radius:5px;
  padding:2px 5px;white-space:nowrap;}
.sim-wkmi{margin-left:auto;font-family:Oswald,sans-serif;font-size:14px;color:#C0C5D0;}
.sim-wkmi i{font-size:9px;color:var(--dim);font-style:normal;margin-left:1px;}
.sim-cell{height:46px;border:1px solid var(--line);border-radius:8px;position:relative;
  display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;}
.sim-cell.rest{background:#0C0E13;}
.sim-dom{position:absolute;top:3px;left:5px;font-size:8.5px;color:var(--dim);}
.sim-dist{font-family:Oswald,sans-serif;font-size:18px;font-weight:500;line-height:1;}
.sim-cell.race .sim-dist{font-size:15px;}
.sim-tag{font-size:7.5px;font-weight:800;letter-spacing:.5px;margin-top:2px;}
.sim-restdash{color:var(--dim);font-size:16px;}
.sim-empty{padding:60px;text-align:center;color:var(--mute);}

.sim-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:22px;padding-top:16px;border-top:1px solid var(--line);}
.sim-legitem{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mute);}
.sim-legitem i{width:11px;height:11px;border-radius:3px;display:inline-block;}
`;
