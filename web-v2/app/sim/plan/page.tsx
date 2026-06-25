'use client';

/**
 * Plan simulator · /sim/plan · 2026-06-22
 *
 * Mirrors the NATIVE iPhone onboarding + goal-setup flow (the canonical flow):
 *   - Goal-setup mode: Goal (pick a recommended plan-WEEKS option, goal time on
 *     a WHEEL seeded from VDOT) · Race (calendar date) · Just run (no goal).
 *   - Runner profile: experience / days-per-week / weekly mileage / longest run /
 *     race history (distance + finish-time WHEEL + when) / long-run day —
 *     selectable rows + wheels, never free-typed.
 * Every change re-runs the REAL engine via POST /api/plan/simulate. Nothing is
 * persisted. Shapes come from lib/plan/sim-constants (client-safe).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { predictRaceTime, vdotFromRace } from '@/lib/training/vdot';
import {
  SIM_DISTANCE_MI, DISTANCE_LABEL, SHOWS_HOURS, PLAN_OPTIONS,
  EXPERIENCE_OPTIONS, FREQ_OPTIONS, WEEKLY_MI_OPTIONS, LONG_BUCKET_OPTIONS,
  WHEN_OPTIONS, RACE_HISTORY_DISTANCES, DAY_KEYS,
  type SimInputs, type SimDistance, type SimGoalMode, type DayKey,
  type SimRaceHistoryEntry, type SimRaceDistance, type SimWhen, type SimWeeklyMi, type SimLongBucket,
} from '@/lib/plan/sim-constants';

interface SimDay { dow: number; type: string; distanceMi: number; isQuality: boolean; isLong: boolean; subLabel: string | null; notes: string; }
interface SimWeek { startISO: string; phase: string; weeklyMi: number; isRaceWeek: boolean; tPaceSec: number | null; days: SimDay[]; }
interface SimResult {
  ok: boolean; reason?: string; mode?: string;
  derived?: { mode: string; raceDistanceMi: number; raceDateISO: string; goalPaceSec: number | null; tPaceSec: number; bestRecentVdot: number | null; recentWeeklyMi: number; recentLongMi: number; longRunDow: number; restDow: number; qualityDows: number[]; trainingDaysPerWeek: number | null; distanceCategory: string; };
  validation?: { valid: boolean; violations: string[] };
  plan?: { totalWeeks: number; vols: number[]; weeks: SimWeek[] };
}

const C = {
  bg: '#0A0C10', card: '#11141A', line: 'rgba(255,255,255,.08)', txt: '#F6F7F8', mute: '#8A90A0', dim: '#4B505E',
  green: '#3EBD41', gold: '#F3AD38', pink: '#FC4D64', cyan: '#27B4E0', red: '#D03F3F', brightGold: '#F0DF47',
};
const TYPE_STYLE: Record<string, { color: string; tag: string }> = {
  easy: { color: C.green, tag: 'EASY' }, long: { color: C.gold, tag: 'LONG' }, threshold: { color: C.red, tag: 'THR' },
  tempo: { color: C.red, tag: 'TMP' }, intervals: { color: C.pink, tag: 'INT' }, shakeout: { color: C.cyan, tag: 'SHAKE' },
  race_week_tuneup: { color: C.brightGold, tag: 'TUNE' }, race: { color: C.red, tag: 'RACE' }, rest: { color: C.dim, tag: '' },
};
const PHASE_COLOR: Record<string, string> = { BASE: C.green, QUALITY: C.gold, 'RACE-SPECIFIC': C.pink, SHARPEN: C.pink, TAPER: C.cyan, MAINTENANCE: C.cyan, RECOVERY: C.cyan };
const MODE_LABEL: Record<string, string> = { 'race-prep': 'RACE-PREP', maintenance: 'MAINTENANCE', recovery: 'RECOVERY' };
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Native SetGoalSheet default goal times per distance (F_Sheets.swift) — used when
// there is no measured fitness. Native has NO experience→VDOT map (PACE-2).
const NATIVE_DEFAULT_GOAL_SEC: Record<SimDistance, number> = {
  '5k': 1500, '10k': 3000, half: 6300, marathon: 12600, '50k': 18000, '100k': 32400,
};

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function plusDays(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }
const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const domOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDate();
function fmtClock(sec: number | null): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
const fmtPace = (s: number | null) => (s == null ? '—' : `${fmtClock(s)}/mi`);

function bestVdotFromHistory(rh: SimRaceHistoryEntry[]): number | undefined {
  let best: number | undefined;
  for (const e of rh) { const v = vdotFromRace(e.timeSec, SIM_DISTANCE_MI[e.distance]); if (v != null && (best === undefined || v > best)) best = v; }
  return best;
}
/** Seed the goal-time wheel the native way: from measured fitness (best race-history
 *  VDOT) + the plan option's projected gain, else the static per-distance default.
 *  Experience does NOT seed the time — native has no experience→VDOT map (PACE-2). */
function seedGoalSec(distance: SimDistance, weeks: number, rh: SimRaceHistoryEntry[]): number | null {
  const measured = bestVdotFromHistory(rh);
  if (measured != null) {
    const opt = PLAN_OPTIONS[distance].find((o) => o.weeks === weeks) ?? PLAN_OPTIONS[distance][0];
    const t = predictRaceTime(measured + (opt?.vdotGain ?? 0), SIM_DISTANCE_MI[distance]);
    if (t) return Math.floor(t / 5) * 5;
  }
  return NATIVE_DEFAULT_GOAL_SEC[distance];
}

export default function PlanSimulatorPage() {
  const today = useMemo(() => isoOf(new Date()), []);
  const [sim, setSim] = useState<SimInputs>(() => {
    const start = isoOf(new Date());
    return {
      goalMode: 'goal', distance: 'marathon', startDateISO: start,
      planWeeks: 20, goalTimeSec: seedGoalSec('marathon', 20, []),
      raceDateISO: plusDays(start, 112), lastRaceFinishedDaysAgo: null, lastRaceDistance: null,
      experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10',
      raceHistory: [], longRunDay: 'sun', availableDays: null,
      bestRecentVdotOverride: null, easyDayMedianMi: null, isMidBlock: false, restDay: 'sat', lthr: null, maxHr: null,
    };
  });
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const seq = useRef(0);

  const set = <K extends keyof SimInputs>(k: K, v: SimInputs[K]) => setSim((s) => ({ ...s, [k]: v }));

  // Pick a recommended plan-weeks option → also reseed the goal-time wheel (native behavior).
  function pickWeeks(weeks: number) {
    setSim((s) => ({ ...s, planWeeks: weeks, goalTimeSec: seedGoalSec(s.distance, weeks, s.raceHistory) }));
  }
  function pickGoalDistance(distance: SimDistance) {
    setSim((s) => {
      const weeks = PLAN_OPTIONS[distance].find((o) => o.weeks === s.planWeeks)?.weeks ?? PLAN_OPTIONS[distance][Math.min(1, PLAN_OPTIONS[distance].length - 1)].weeks;
      return { ...s, distance, planWeeks: weeks, goalTimeSec: seedGoalSec(distance, weeks, s.raceHistory) };
    });
  }

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/plan/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sim) });
        if (!res.ok) { if (id === seq.current) { setResult(null); setNetError(res.status === 401 ? 'Sign in required — the simulator needs a logged-in session.' : `server error ${res.status}`); } return; }
        const json = (await res.json()) as SimResult;
        if (id === seq.current) { setResult(json); setNetError(null); }
      } catch (e: any) {
        if (id === seq.current) setNetError(e?.message ?? 'request failed');
      } finally { if (id === seq.current) setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [sim]);

  const plan = result?.plan;
  const derived = result?.derived;
  const validation = result?.validation;
  // Re-bucket the plan into fixed Sun→Sat calendar weeks (David: "the week should go
  // sun-sat"). Each plan day is placed on its real date; rows are calendar weeks so
  // dates read left-to-right. Per-row mileage = the SCHEDULED day-sum (FID-3), never
  // the phantom weeklyMi budget.
  const calendar = useMemo(() => {
    type CalRow = { weekNum: number; phase: string; isRaceWeek: boolean; mileage: number; cells: Array<{ date: string; day: SimDay | null }> };
    if (!plan) return [] as CalRow[];
    const byDate = new Map<string, { day: SimDay; phase: string; isRaceWeek: boolean }>();
    let minDate = '', maxDate = '';
    for (const w of plan.weeks) {
      const wStartDow = dowOf(w.startISO);
      for (const d of w.days) {
        const date = plusDays(w.startISO, (d.dow - wStartDow + 7) % 7);
        byDate.set(date, { day: d, phase: w.phase, isRaceWeek: w.isRaceWeek });
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    }
    if (!minDate) return [] as CalRow[];
    const rows: CalRow[] = [];
    let cur = plusDays(minDate, -dowOf(minDate)); // Sunday on/before the first plan day
    let wk = 1;
    while (cur <= maxDate) {
      const cells: Array<{ date: string; day: SimDay | null }> = [];
      let mileage = 0, isRaceWeek = false, longPhase = '';
      const phaseCount: Record<string, number> = {};
      for (let k = 0; k < 7; k++) {
        const date = plusDays(cur, k);
        const entry = byDate.get(date);
        cells.push({ date, day: entry?.day ?? null });
        if (entry) {
          mileage += entry.day.type === 'race' ? 0 : entry.day.distanceMi;
          phaseCount[entry.phase] = (phaseCount[entry.phase] ?? 0) + 1;
          if (entry.isRaceWeek) isRaceWeek = true;
          if (entry.day.isLong) longPhase = entry.phase;
        }
      }
      if (cells.some((c) => c.day && c.day.type !== 'rest')) {
        const phase = longPhase || (Object.entries(phaseCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '');
        rows.push({ weekNum: wk++, phase, isRaceWeek, mileage: Math.round(mileage * 10) / 10, cells });
      }
      cur = plusDays(cur, 7);
    }
    return rows;
  }, [plan]);
  // Stats from the SCHEDULED day-sum, not the phantom weeklyMi budget (FID-3).
  const weekSched = (w: SimWeek) => w.days.reduce((s, d) => s + (d.type !== 'race' ? d.distanceMi : 0), 0);
  const peakMi = plan ? Math.round(Math.max(0, ...plan.weeks.map(weekSched))) : 0;
  const totalMi = plan ? Math.round(plan.weeks.reduce((s, w) => s + weekSched(w), 0)) : 0;
  const modeLabel = derived ? (MODE_LABEL[derived.mode] ?? derived.mode.toUpperCase()) : '';
  const goalDistances: SimDistance[] = ['5k', '10k', 'half', 'marathon', '50k', '100k'];

  return (
    <div className="sim-root">
      <style>{CSS}</style>

      <aside className="sim-rail">
        <div className="sim-railhead">
          <div className="sim-kicker">Plan Simulator</div>
          <div className="sim-railsub">Native onboarding → live schedule</div>
        </div>

        {/* ── GOAL SETUP (native: Goal / Race / Just run) ── */}
        <Group title="Goal setup">
          <Seg
            options={[{ v: 'goal', label: 'Goal' }, { v: 'race', label: 'Race' }, { v: 'justRun', label: 'Just run' }]}
            value={sim.goalMode}
            onChange={(v) => set('goalMode', v as SimGoalMode)}
          />

          {sim.goalMode !== 'justRun' && (
            <Field label="Distance">
              <div className="sim-chiprow">
                {goalDistances.map((d) => (
                  <button key={d} className={`sim-chip wide ${sim.distance === d ? 'on' : ''}`}
                    onClick={() => (sim.goalMode === 'goal' ? pickGoalDistance(d) : set('distance', d))}>
                    {DISTANCE_LABEL[d]}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {sim.goalMode === 'goal' && (
            <Field label="Recommended plan" hint="pick a length — race day = start + weeks">
              <div className="sim-weeks">
                {PLAN_OPTIONS[sim.distance].map((o) => (
                  <button key={o.weeks} className={`sim-weekopt ${sim.planWeeks === o.weeks ? 'on' : ''}`} onClick={() => pickWeeks(o.weeks)}>
                    <div className="sim-weekhead"><span className="sim-weeknum">{o.weeks}</span><span className="sim-weekwk">weeks</span>
                      {derived && sim.planWeeks === o.weeks && <span className="sim-weekproj">{fmtClock(sim.goalTimeSec)}</span>}
                    </div>
                    <div className="sim-weekrat">{o.rationale}</div>
                  </button>
                ))}
              </div>
            </Field>
          )}

          {sim.goalMode === 'race' && (
            <Field label="Race date" hint="weeks are derived from start → race">
              <input className="sim-text" type="date" value={sim.raceDateISO} min={sim.startDateISO} onChange={(e) => set('raceDateISO', e.target.value)} />
            </Field>
          )}

          {sim.goalMode !== 'justRun' && (
            <Field label="Goal time" hint={sim.goalMode === 'goal' ? 'seeded from your fitness — spin to adjust' : 'optional'}>
              <TimeWheel sec={sim.goalTimeSec} showHours={SHOWS_HOURS[sim.distance]} onChange={(s) => set('goalTimeSec', s)} allowNull />
            </Field>
          )}

          {sim.goalMode === 'race' && (
            <details className="sim-adv compact">
              <summary>Recovery scenario</summary>
              <div className="sim-advbody">
                <Field label="Last race finished" value={sim.lastRaceFinishedDaysAgo ? `${sim.lastRaceFinishedDaysAgo}d ago` : 'none'} hint="recent finish → recovery mode">
                  <input className="sim-range" type="range" min={0} max={28} step={1} value={sim.lastRaceFinishedDaysAgo ?? 0}
                    onChange={(e) => set('lastRaceFinishedDaysAgo', Number(e.target.value) || null)} />
                </Field>
                {(sim.lastRaceFinishedDaysAgo ?? 0) > 0 && (
                  <Field label="Last race distance">
                    <div className="sim-chiprow">
                      {RACE_HISTORY_DISTANCES.map((d) => (
                        <button key={d.value} className={`sim-chip ${sim.lastRaceDistance === d.value ? 'on' : ''}`} onClick={() => set('lastRaceDistance', d.value)}>{d.label}</button>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            </details>
          )}

          {sim.goalMode === 'justRun' && (
            <div className="sim-note">No goal. Faff logs runs and tracks readiness — the engine holds a <b>maintenance</b> block. Add a goal or race for a periodized build.</div>
          )}

          <Field label="Start date" hint="plan week-0 anchor">
            <input className="sim-text" type="date" value={sim.startDateISO} min={today} onChange={(e) => set('startDateISO', e.target.value)} />
          </Field>
        </Group>

        {/* ── RUNNER PROFILE (onboarding "Running" step) ── */}
        <Group title="Runner">
          <Field label="Experience">
            <div className="sim-rows">
              {EXPERIENCE_OPTIONS.map((o) => (
                <button key={o.value} className={`sim-row ${sim.experienceLevel === o.value ? 'on' : ''}`} onClick={() => set('experienceLevel', o.value)}>
                  <span className="sim-rowtitle">{o.title}</span><span className="sim-rowdesc">{o.desc}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Days per week" hint={sim.weeklyFrequency === 0 ? 'couch-to-X floor of 3' : undefined}>
            <div className="sim-chiprow">
              {FREQ_OPTIONS.map((f) => (
                <button key={f.value} className={`sim-chip ${sim.weeklyFrequency === f.value ? 'on' : ''}`} onClick={() => set('weeklyFrequency', f.value)} title={f.label}>{f.value}</button>
              ))}
            </div>
          </Field>
          <Field label="Weekly mileage">
            <div className="sim-rows tight">
              {WEEKLY_MI_OPTIONS.map((o) => (
                <button key={o.value} className={`sim-row sm ${sim.weeklyMileageBucket === o.value ? 'on' : ''}`} onClick={() => set('weeklyMileageBucket', o.value as SimWeeklyMi)}>{o.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Longest recent run">
            <div className="sim-rows tight">
              {LONG_BUCKET_OPTIONS.map((o) => (
                <button key={o.value} className={`sim-row sm ${sim.longestRunBucket === o.value ? 'on' : ''}`} onClick={() => set('longestRunBucket', o.value as SimLongBucket)}>{o.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Long run day">
            <DayPicker value={sim.longRunDay} onChange={(d) => set('longRunDay', d)} />
          </Field>
          <Field label="Available days" hint="leave blank for any · runs land only on selected days">
            <DayMulti value={sim.availableDays ?? []} onChange={(days) => set('availableDays', days.length ? days : null)} />
          </Field>
          <Field label="Race history" hint="self-reported PRs → seeds current fitness (VDOT)">
            <RaceHistoryEditor entries={sim.raceHistory} onChange={(e) => setSim((s) => ({ ...s, raceHistory: e, goalTimeSec: s.goalMode === 'goal' ? seedGoalSec(s.distance, s.planWeeks, e) : s.goalTimeSec }))} />
          </Field>
        </Group>

        <details className="sim-adv">
          <summary>Derived signals <span className="sim-advnote">normally from Strava / runs</span></summary>
          <div className="sim-advbody">
            <Field label="Current fitness VDOT" value={sim.bestRecentVdotOverride ? String(sim.bestRecentVdotOverride) : (derived?.bestRecentVdot ? `${derived.bestRecentVdot} (derived)` : 'none')}
              hint="override the VDOT derived from race history">
              <div className="sim-inline">
                <input className="sim-range" type="range" min={28} max={85} step={1} value={sim.bestRecentVdotOverride ?? 28} onChange={(e) => set('bestRecentVdotOverride', Number(e.target.value))} />
                <button className="sim-mini" onClick={() => set('bestRecentVdotOverride', null)}>auto</button>
              </div>
            </Field>
            <Field label="Easy-day median" value={`${sim.easyDayMedianMi ?? 0} mi`} hint="0 = cold start">
              <input className="sim-range" type="range" min={0} max={12} step={1} value={sim.easyDayMedianMi ?? 0} onChange={(e) => set('easyDayMedianMi', Number(e.target.value))} />
            </Field>
            <Field label="Rest day"><DayPicker value={sim.restDay ?? 'sat'} onChange={(d) => set('restDay', d)} /></Field>
            <Field label="Mid-block runner"><Toggle on={!!sim.isMidBlock} onChange={(v) => set('isMidBlock', v)} /></Field>
            <div className="sim-twocol">
              <Field label="LTHR" value={sim.lthr ? `${sim.lthr}` : '—'}><input className="sim-text" type="number" min={120} max={200} placeholder="bpm" value={sim.lthr ?? ''} onChange={(e) => set('lthr', e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="Max HR" value={sim.maxHr ? `${sim.maxHr}` : '—'}><input className="sim-text" type="number" min={140} max={220} placeholder="bpm" value={sim.maxHr ?? ''} onChange={(e) => set('maxHr', e.target.value ? Number(e.target.value) : null)} /></Field>
            </div>
          </div>
        </details>
      </aside>

      {/* ── RESULTS ── */}
      <main className="sim-main">
        <header className="sim-summary">
          <div className="sim-sumleft">
            <h1 className="sim-title">
              {sim.goalMode === 'justRun' ? 'Just running' : `${DISTANCE_LABEL[sim.distance]} ${sim.goalMode === 'race' ? 'race' : 'goal'}`}
              {modeLabel && <span className="sim-modechip">{modeLabel}</span>}
              {loading && <span className="sim-spin" aria-label="loading" />}
            </h1>
            <div className="sim-statrow">
              <Stat label="Weeks" value={plan ? String(plan.totalWeeks) : '—'} />
              <Stat label="Peak" value={plan ? `${peakMi} mi` : '—'} />
              <Stat label="Total" value={plan ? `${totalMi} mi` : '—'} />
              <Stat label="Goal pace" value={fmtPace(derived?.goalPaceSec ?? null)} />
              <Stat label="T pace" value={fmtPace(derived?.tPaceSec ?? null)} />
              <Stat label="VDOT" value={derived?.bestRecentVdot ? String(derived.bestRecentVdot) : '—'} />
            </div>
          </div>
          <div className="sim-verdict">
            {result && !result.ok && <div className="sim-badge err">{result.reason}</div>}
            {netError && <div className="sim-badge err">{netError}</div>}
            {validation?.valid && <div className="sim-badge ok">VALID</div>}
            {validation && !validation.valid && <div className="sim-badge warn" title={validation.violations.join('\n')}>{validation.violations.length} VIOLATION{validation.violations.length === 1 ? '' : 'S'}</div>}
          </div>
        </header>

        {validation && !validation.valid && <ul className="sim-violations">{validation.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>}

        {plan ? (
          <div className="sim-grid" style={{ gridTemplateColumns: `156px repeat(7, minmax(48px, 1fr))` }}>
            <div className="sim-ghead sim-wkhead">Week</div>
            {[0, 1, 2, 3, 4, 5, 6].map((dow) => <div key={dow} className={`sim-ghead ${dow === derived?.longRunDow ? 'islong' : ''}`}>{DAY_ABBR[dow]}</div>)}
            {calendar.map((row) => {
              const phaseColor = row.isRaceWeek ? C.red : (PHASE_COLOR[row.phase] ?? C.mute);
              return (
                <Row key={row.weekNum}>
                  <div className="sim-wklabel">
                    <span className="sim-wknum">W{row.weekNum}</span>
                    <span className="sim-phase" style={{ color: phaseColor, borderColor: phaseColor }}>{row.isRaceWeek ? 'RACE' : row.phase}</span>
                    <span className="sim-wkmi">{row.mileage}<i>mi</i></span>
                  </div>
                  {row.cells.map((c, ci) => <Cell key={ci} day={c.day ?? undefined} dom={domOf(c.date)} />)}
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

// ── small components ──
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="sim-group"><div className="sim-grouptitle">{title}</div>{children}</section>;
}
function Field({ label, hint, value, children }: { label: string; hint?: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="sim-field">
      <div className="sim-fieldhead"><span className="sim-label">{label}</span>{value !== undefined && <span className="sim-value">{value}</span>}</div>
      {children}{hint && <div className="sim-hint">{hint}</div>}
    </div>
  );
}
function Seg<T extends string>({ options, value, onChange }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return <div className="sim-seg">{options.map((o) => <button key={o.v} className={`sim-segbtn ${value === o.v ? 'on' : ''}`} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>;
}
function DayPicker({ value, onChange }: { value: DayKey; onChange: (d: DayKey) => void }) {
  return <div className="sim-daypick">{DAY_KEYS.map((d, i) => <button key={d} className={`sim-day ${value === d ? 'on' : ''}`} onClick={() => onChange(d)} title={DAY_ABBR[i]}>{DAY_LETTER[i]}</button>)}</div>;
}
function DayMulti({ value, onChange }: { value: DayKey[]; onChange: (d: DayKey[]) => void }) {
  const has = (d: DayKey) => value.includes(d);
  return <div className="sim-daypick">{DAY_KEYS.map((d, i) => <button key={d} className={`sim-day ${has(d) ? 'on' : ''}`} onClick={() => onChange(has(d) ? value.filter((x) => x !== d) : [...value, d])} title={DAY_ABBR[i]}>{DAY_LETTER[i]}</button>)}</div>;
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`sim-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="sim-stat"><div className="sim-statval">{value}</div><div className="sim-statlabel">{label}</div></div>;
}
function Row({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/** Wheel-style time entry · h/m/s columns of selectable values (never typed). */
function TimeWheel({ sec, showHours, onChange, allowNull }: { sec: number | null; showHours: boolean; onChange: (s: number | null) => void; allowNull?: boolean }) {
  const v = sec ?? 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60;
  const emit = (hh: number, mm: number, ss: number) => onChange(hh * 3600 + mm * 60 + ss);
  return (
    <div className="sim-wheelwrap">
      <div className="sim-wheel">
        {showHours && <WheelCol value={h} max={9} suffix="h" onChange={(x) => emit(x, m, s)} />}
        <WheelCol value={m} max={59} suffix="m" onChange={(x) => emit(h, x, s)} />
        <WheelCol value={s} max={59} suffix="s" onChange={(x) => emit(h, m, x)} />
      </div>
      {allowNull && (sec == null
        ? <button className="sim-mini" onClick={() => emit(0, showHours ? 30 : 20, 0)}>set</button>
        : <button className="sim-mini" onClick={() => onChange(null)}>by feel</button>)}
    </div>
  );
}
function WheelCol({ value, max, suffix, onChange }: { value: number; max: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <label className="sim-wheelcol">
      <select className="sim-wheelsel" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
      </select>
      <span className="sim-wheelsuf">{suffix}</span>
    </label>
  );
}

function RaceHistoryEditor({ entries, onChange }: { entries: SimRaceHistoryEntry[]; onChange: (e: SimRaceHistoryEntry[]) => void }) {
  const [draft, setDraft] = useState<SimRaceHistoryEntry | null>(null);
  const canAdd = entries.length < 3;
  function commit() {
    if (!draft || draft.timeSec <= 0) return;
    onChange([...entries, draft].slice(0, 3));
    setDraft(null);
  }
  return (
    <div>
      {entries.length > 0 && (
        <div className="sim-rhlist">
          {entries.map((e, i) => (
            <div key={i} className="sim-rhrow">
              <span>{e.distance.toUpperCase()} · {fmtClock(e.timeSec)} <i>{e.whenRaced}</i></span>
              <button className="sim-mini" onClick={() => onChange(entries.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
        </div>
      )}
      {draft ? (
        <div className="sim-rhdraft">
          <div className="sim-chiprow">
            {RACE_HISTORY_DISTANCES.map((d) => (
              <button key={d.value} className={`sim-chip ${draft.distance === d.value ? 'on' : ''}`} onClick={() => setDraft({ ...draft, distance: d.value, timeSec: 0 })}>{d.label}</button>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <TimeWheel sec={draft.timeSec || null} showHours={draft.distance === 'half' || draft.distance === 'marathon'} onChange={(s) => setDraft({ ...draft, timeSec: s ?? 0 })} />
          </div>
          <div className="sim-chiprow" style={{ marginTop: 8 }}>
            {WHEN_OPTIONS.map((w) => (
              <button key={w.value} className={`sim-chip ${draft.whenRaced === w.value ? 'on' : ''}`} onClick={() => setDraft({ ...draft, whenRaced: w.value })}>{w.label}</button>
            ))}
          </div>
          <div className="sim-inline" style={{ marginTop: 8 }}>
            <button className="sim-mini solid" onClick={commit} disabled={!draft.timeSec}>Add</button>
            <button className="sim-mini" onClick={() => setDraft(null)}>cancel</button>
          </div>
        </div>
      ) : (
        canAdd && <button className="sim-mini" onClick={() => setDraft({ distance: '5k', timeSec: 0, whenRaced: '<6mo' })}>+ Add a PR</button>
      )}
    </div>
  );
}

function Cell({ day, dom }: { day: SimDay | undefined; dom: number }) {
  if (!day || day.type === 'rest' || day.distanceMi <= 0) return <div className="sim-cell rest"><span className="sim-dom">{dom}</span><span className="sim-restdash">·</span></div>;
  const st = TYPE_STYLE[day.type] ?? { color: C.mute, tag: day.type.slice(0, 4).toUpperCase() };
  const isRace = day.type === 'race';
  return (
    <div className={`sim-cell ${isRace ? 'is-race' : ''}`} style={{ background: isRace ? st.color : st.color + '1E', borderColor: st.color + (isRace ? 'FF' : '55') }}
      title={[day.subLabel, day.notes].filter(Boolean).join(' · ') || st.tag}>
      <span className="sim-dom">{dom}</span>
      <span className="sim-dist" style={{ color: isRace ? '#fff' : st.color }}>{Number.isInteger(day.distanceMi) ? day.distanceMi : day.distanceMi.toFixed(1)}</span>
      <span className="sim-tag" style={{ color: isRace ? '#fff' : st.color }}>{day.isLong && !isRace ? 'LONG' : st.tag}</span>
    </div>
  );
}
function Legend() {
  const items = [['easy', 'Easy'], ['long', 'Long'], ['threshold', 'Threshold'], ['intervals', 'Intervals'], ['tempo', 'Tempo'], ['shakeout', 'Shakeout'], ['race_week_tuneup', 'Tune-up'], ['race', 'Race']];
  return <div className="sim-legend">{items.map(([t, label]) => <span key={t} className="sim-legitem"><i style={{ background: TYPE_STYLE[t].color }} />{label}</span>)}</div>;
}

const CSS = `
.sim-root{display:flex;min-height:100vh;background:var(--bg,#0A0C10);color:var(--txt,#F6F7F8);font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
.sim-rail{width:360px;flex:0 0 360px;border-right:1px solid var(--line,rgba(255,255,255,.08));padding:20px 18px 60px;overflow-y:auto;height:100vh;position:sticky;top:0;background:#0C0E13;}
.sim-railhead{margin-bottom:18px;}
.sim-kicker{font-family:Oswald,sans-serif;font-weight:600;font-size:20px;letter-spacing:.3px;}
.sim-railsub{font-size:12px;color:var(--mute,#8A90A0);margin-top:2px;}
.sim-group{margin-bottom:22px;}
.sim-grouptitle{font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--mute,#8A90A0);margin-bottom:12px;}
.sim-field{margin-bottom:14px;}
.sim-fieldhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
.sim-label{font-size:13px;color:#D6D9E0;}
.sim-value{font-family:Oswald,sans-serif;font-size:13px;color:var(--txt);}
.sim-hint{font-size:11px;color:var(--dim,#4B505E);margin-top:5px;line-height:1.3;}
.sim-note{font-size:12.5px;line-height:1.5;color:var(--mute);background:rgba(39,180,224,.06);border:1px solid rgba(39,180,224,.18);border-radius:10px;padding:11px 13px;margin:4px 0 12px;}
.sim-note b{color:var(--cyan,#27B4E0);font-weight:700;}
.sim-inline{display:flex;gap:8px;align-items:center;}
.sim-twocol{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.sim-text{width:100%;background:#0A0C10;border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:8px 10px;font-size:13px;font-family:inherit;}
.sim-text:focus{outline:none;border-color:#3a4150;}
input.sim-text[type=date]{color-scheme:dark;}
.sim-mini{background:#0A0C10;border:1px solid var(--line);border-radius:8px;color:var(--mute);padding:7px 11px;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit;}
.sim-mini:hover{color:var(--txt);border-color:#3a4150;}
.sim-mini.solid{background:#1C212B;color:var(--txt);border-color:#39414f;}
.sim-mini:disabled{opacity:.4;cursor:not-allowed;}
.sim-seg{display:flex;background:#0A0C10;border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px;margin-bottom:12px;}
.sim-segbtn{flex:1;background:transparent;border:none;color:var(--mute);font-size:12px;font-weight:600;padding:8px 4px;border-radius:6px;cursor:pointer;font-family:inherit;}
.sim-segbtn.on{background:#1C212B;color:var(--txt);}
.sim-segbtn:hover:not(.on){color:#C0C5D0;}
.sim-chiprow{display:flex;gap:5px;flex-wrap:wrap;}
.sim-chip{min-width:30px;height:30px;padding:0 8px;background:#0A0C10;border:1px solid var(--line);border-radius:7px;color:var(--mute);font-size:12px;cursor:pointer;font-family:inherit;}
.sim-chip.wide{padding:0 11px;}
.sim-chip.on{background:#1C212B;color:var(--txt);border-color:#39414f;}
.sim-rows{display:flex;flex-direction:column;gap:6px;}
.sim-rows.tight{gap:5px;}
.sim-row{text-align:left;background:#0A0C10;border:1px solid var(--line);border-radius:9px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px;font-family:inherit;}
.sim-row.sm{padding:8px 12px;flex-direction:row;font-size:13px;color:#C7CBD4;}
.sim-row.on{background:#1C212B;border-color:#39414f;}
.sim-rowtitle{font-size:13px;color:var(--txt);font-weight:600;}
.sim-rowdesc{font-size:11px;color:var(--mute);line-height:1.3;}
.sim-row.on .sim-row.sm,.sim-row.sm.on{color:var(--txt);}
.sim-weeks{display:flex;flex-direction:column;gap:7px;}
.sim-weekopt{text-align:left;background:#0A0C10;border:1px solid var(--line);border-radius:11px;padding:11px 13px;cursor:pointer;font-family:inherit;}
.sim-weekopt.on{background:#1C212B;border-color:var(--gold,#F3AD38);}
.sim-weekhead{display:flex;align-items:baseline;gap:6px;}
.sim-weeknum{font-family:Oswald,sans-serif;font-size:21px;color:var(--txt);}
.sim-weekwk{font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:1px;}
.sim-weekproj{margin-left:auto;font-family:Oswald,sans-serif;font-size:15px;color:var(--gold,#F3AD38);}
.sim-weekrat{font-size:11.5px;color:var(--mute);line-height:1.4;margin-top:4px;}
.sim-daypick{display:flex;gap:5px;}
.sim-day{width:34px;height:32px;background:#0A0C10;border:1px solid var(--line);border-radius:7px;color:var(--mute);font-size:12px;font-weight:700;cursor:pointer;}
.sim-day.on{background:#1C212B;color:var(--gold,#F3AD38);border-color:#39414f;}
.sim-range{width:100%;accent-color:var(--gold,#F3AD38);}
.sim-wheelwrap{display:flex;align-items:center;gap:10px;}
.sim-wheel{display:flex;gap:6px;}
.sim-wheelcol{display:flex;align-items:center;gap:3px;background:#0A0C10;border:1px solid var(--line);border-radius:8px;padding:2px 4px 2px 6px;}
.sim-wheelsel{background:transparent;border:none;color:var(--txt);font-family:Oswald,sans-serif;font-size:18px;cursor:pointer;outline:none;-webkit-appearance:none;appearance:none;text-align:center;}
.sim-wheelsel option{background:#11141A;color:var(--txt);font-size:14px;}
.sim-wheelsuf{font-size:10px;color:var(--dim);}
.sim-toggle{width:44px;height:26px;border-radius:13px;background:#1C212B;border:1px solid var(--line);cursor:pointer;position:relative;padding:0;}
.sim-toggle span{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#5a6171;transition:.18s;}
.sim-toggle.on{background:#2a3a2a;}
.sim-toggle.on span{left:20px;background:var(--green,#3EBD41);}
.sim-rhlist{display:flex;flex-direction:column;gap:6px;margin-bottom:8px;}
.sim-rhrow{display:flex;align-items:center;justify-content:space-between;background:#0A0C10;border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:12.5px;color:#C7CBD4;}
.sim-rhrow i{color:var(--mute);font-style:normal;font-size:11px;margin-left:4px;}
.sim-rhdraft{background:#0A0C10;border:1px solid var(--line);border-radius:11px;padding:11px;}
.sim-adv{margin-top:6px;border-top:1px solid var(--line);padding-top:14px;}
.sim-adv.compact{border-top:none;padding-top:4px;margin-top:2px;}
.sim-adv summary{font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--mute);cursor:pointer;list-style:none;}
.sim-adv summary::-webkit-details-marker{display:none;}
.sim-advnote{font-weight:500;letter-spacing:.2px;text-transform:none;color:var(--dim);margin-left:6px;}
.sim-advbody{margin-top:14px;}
.sim-main{flex:1;padding:24px 28px 60px;overflow-x:auto;height:100vh;overflow-y:auto;}
.sim-summary{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:18px;}
.sim-title{font-family:Oswald,sans-serif;font-weight:600;font-size:26px;margin:0 0 12px;display:flex;align-items:center;gap:12px;}
.sim-modechip{font-size:10px;font-weight:800;letter-spacing:1px;color:var(--cyan);border:1px solid var(--cyan);border-radius:5px;padding:3px 7px;}
.sim-spin{width:13px;height:13px;border:2px solid var(--line);border-top-color:var(--gold);border-radius:50%;display:inline-block;animation:simspin .7s linear infinite;}
@keyframes simspin{to{transform:rotate(360deg);}}
.sim-statrow{display:flex;gap:22px;flex-wrap:wrap;}
.sim-statval{font-family:Oswald,sans-serif;font-size:22px;font-weight:500;line-height:1;}
.sim-statlabel{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--mute);margin-top:5px;}
.sim-verdict{display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.sim-badge{font-size:12px;font-weight:800;letter-spacing:.8px;padding:6px 11px;border-radius:7px;white-space:nowrap;}
.sim-badge.ok{background:rgba(62,189,65,.14);color:var(--green,#3EBD41);}
.sim-badge.warn{background:rgba(243,173,56,.14);color:var(--gold,#F3AD38);cursor:help;}
.sim-badge.err{background:rgba(208,63,63,.16);color:#ff7a7a;max-width:300px;white-space:normal;text-align:right;}
.sim-violations{margin:0 0 18px;padding:12px 16px;background:rgba(243,173,56,.07);border:1px solid rgba(243,173,56,.2);border-radius:10px;list-style:none;}
.sim-violations li{font-size:12.5px;color:#E7C982;padding:2px 0;}
.sim-violations li::before{content:"· ";color:var(--gold);}
.sim-grid{display:grid;gap:4px;align-items:stretch;min-width:560px;}
.sim-ghead{font-size:11px;font-weight:700;letter-spacing:.5px;color:var(--mute);text-align:center;padding:2px 0 8px;}
.sim-ghead.islong{color:var(--gold,#F3AD38);}
.sim-wkhead{text-align:left;}
.sim-wklabel{display:flex;align-items:center;gap:8px;padding:0 6px;height:46px;}
.sim-wknum{font-family:Oswald,sans-serif;font-size:14px;color:var(--mute);width:30px;}
.sim-phase{font-size:9px;font-weight:800;letter-spacing:.5px;border:1px solid;border-radius:5px;padding:2px 5px;white-space:nowrap;}
.sim-wkmi{margin-left:auto;font-family:Oswald,sans-serif;font-size:14px;color:#C0C5D0;}
.sim-wkmi i{font-size:9px;color:var(--dim);font-style:normal;margin-left:1px;}
.sim-cell{height:46px;border:1px solid var(--line);border-radius:8px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;}
.sim-cell.rest{background:#0C0E13;}
.sim-dom{position:absolute;top:3px;left:5px;font-size:8.5px;color:var(--dim);}
.sim-dist{font-family:Oswald,sans-serif;font-size:18px;font-weight:500;line-height:1;}
.sim-cell.is-race .sim-dist{font-size:15px;}
.sim-tag{font-size:7.5px;font-weight:800;letter-spacing:.5px;margin-top:2px;}
.sim-restdash{color:var(--dim);font-size:16px;}
.sim-empty{padding:60px;text-align:center;color:var(--mute);}
.sim-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:22px;padding-top:16px;border-top:1px solid var(--line);}
.sim-legitem{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mute);}
.sim-legitem i{width:11px;height:11px;border-radius:3px;display:inline-block;}
`;
