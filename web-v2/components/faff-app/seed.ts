/**
 * Server-side seed builder for the Faff Web App design, wired to
 * web-v2's real data loaders. Returns a FaffSeed envelope the Shell
 * + every view reads from.
 *
 * Single user via DEFAULT_USER_ID env (David's UUID by default).
 * Every loader is wrapped in try/catch so the page renders even if
 * a single signal is unavailable (e.g. Strava reauth needed, plan
 * not yet authored, HealthKit hasn't synced today).
 */

import type {
  FaffSeed, Readiness, GoalRace, VolumeBar, PR, RaceLite,
  ShoeRec, ConnectionRow, HealthSnapshot, HealthMetric,
  ActivityData, RecentRun,
} from './types';
import type { PlannedDay, CompletedRun, EffortKey } from './constants';
import { predictRaceTime, formatRaceTime, parseRaceTime } from '@/lib/training/vdot';

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

/* ─────────────────────────  Pure helpers  ───────────────────────── */

function todayLabel(): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
}
function niceLong(iso: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}
function mapType(t: string | null | undefined): EffortKey {
  const low = (t ?? '').toLowerCase();
  if (low.includes('rest')) return 'rest';
  if (low.includes('long')) return 'long';
  if (low.includes('tempo') || low.includes('threshold')) return 'tempo';
  if (low.includes('interval') || low.includes('vo2') || low.includes('track')) return 'intervals';
  if (low.includes('recovery') || low.includes('shake')) return 'recovery';
  return 'easy';
}
function humanName(eff: EffortKey, distMi: number): string {
  if (eff === 'rest') return 'Rest Day';
  if (eff === 'long') return 'Long Run';
  if (eff === 'tempo') return 'Tempo Run';
  if (eff === 'intervals') return 'Track Intervals';
  if (eff === 'recovery') return 'Recovery Jog';
  if (distMi >= 10) return 'Long Aerobic';
  return 'Easy Aerobic';
}
const EFFORT_COLOR: Record<EffortKey, string> = {
  recovery: '#27B4E0', easy: '#14C08C', long: '#F3AD38', tempo: '#FF8847', intervals: '#FC4D64', rest: '#8A90A0',
};

/* ─────────────────────────  Fallbacks  ───────────────────────── */

const FALLBACK_WEEK: PlannedDay[] = [
  { dw: 'MON', dn: 1,  full: 'Monday',    type: 'easy',     name: 'Easy Aerobic',  dist: '6.0', pace: '8:45', est: '~52 min', done: false },
  { dw: 'TUE', dn: 2,  full: 'Tuesday',   type: 'tempo',    name: 'Tempo Run',     dist: '8.0', pace: '6:38', est: '~54 min', today: true },
  { dw: 'WED', dn: 3,  full: 'Wednesday', type: 'recovery', name: 'Recovery Jog',  dist: '4.0', pace: '9:30', est: '~38 min' },
  { dw: 'THU', dn: 4,  full: 'Thursday',  type: 'rest',     name: 'Rest Day',      dist: ' · ', pace: 'Rest', est: ' · '     },
  { dw: 'FRI', dn: 5,  full: 'Friday',    type: 'easy',     name: 'Easy Aerobic',  dist: '5.0', pace: '8:50', est: '~44 min' },
  { dw: 'SAT', dn: 6,  full: 'Saturday',  type: 'long',     name: 'Long Run',      dist: '16.0', pace: '7:40', est: '~2:03'  },
  { dw: 'SUN', dn: 7,  full: 'Sunday',    type: 'recovery', name: 'Recovery Jog',  dist: '4.0', pace: '9:30', est: '~36 min' },
];

/* ─────────────────────────  Loader wrappers  ───────────────────────── */

type LoadResult<T> = { ok: true; value: T } | { ok: false; error: string };
async function safe<T>(fn: () => Promise<T>): Promise<LoadResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

async function loadGlance()   { return safe(async () => (await import('@/lib/coach/glance-state')).loadGlanceState(DEFAULT_USER_ID)); }
async function loadHealth()   { return safe(async () => (await import('@/lib/coach/health-state')).loadHealthState(DEFAULT_USER_ID)); }
async function loadTraining() { return safe(async () => (await import('@/lib/coach/training-state')).loadTrainingState(DEFAULT_USER_ID)); }
async function loadRaces()    { return safe(async () => (await import('@/lib/coach/races-state')).loadRacesState(DEFAULT_USER_ID)); }
async function loadLog()      { return safe(async () => (await import('@/lib/coach/log-state')).loadLogState(DEFAULT_USER_ID, { filters: { source: null, type: null, phase: null, shoe: null } })); }
async function loadProfile()  { return safe(async () => (await import('@/lib/coach/profile-state')).loadProfileState(DEFAULT_USER_ID)); }

/** Form-metric series straight from health_samples. Pulls 30-day series
 *  for the running-form signals HealthKit ships (cadence, GCT, vertical
 *  oscillation, stride length, vertical ratio) plus 30-day VO2 if present.
 *  The Faff Health view renders these in the FORM strip. */
async function loadFormMetrics() {
  return safe(async () => {
    const { pool } = await import('@/lib/db/pool');
    const rows = await pool.query(
      `SELECT sample_type, sample_date::date AS d, value
         FROM health_samples
        WHERE user_id = $1
          AND sample_type IN ('cadence','ground_contact_time','vertical_oscillation','stride_length','vertical_ratio')
          AND sample_date >= NOW() - interval '30 days'
        ORDER BY sample_date ASC`,
      [DEFAULT_USER_ID]
    );
    const acc: Record<string, Array<{ date: string; value: number }>> = {};
    for (const r of rows.rows) {
      const key = r.sample_type;
      (acc[key] ??= []).push({
        date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d),
        value: Number(r.value),
      });
    }
    return acc;
  });
}
type Form = Awaited<ReturnType<typeof loadFormMetrics>>;

type Glance   = Awaited<ReturnType<typeof import('@/lib/coach/glance-state').loadGlanceState>>;
type Health   = Awaited<ReturnType<typeof import('@/lib/coach/health-state').loadHealthState>>;
type Training = Awaited<ReturnType<typeof import('@/lib/coach/training-state').loadTrainingState>>;
type Races    = Awaited<ReturnType<typeof import('@/lib/coach/races-state').loadRacesState>>;
type LogT     = Awaited<ReturnType<typeof import('@/lib/coach/log-state').loadLogState>>;
type Profile  = Awaited<ReturnType<typeof import('@/lib/coach/profile-state').loadProfileState>>;

/* ─────────────────────────  Adapters  ───────────────────────── */

function adaptWeek(glance: Glance | null): { week: PlannedDay[]; todayIdx: number; results: Record<number, CompletedRun | undefined> } {
  if (!glance || !glance.weekDays?.length) {
    return { week: FALLBACK_WEEK, todayIdx: 1, results: {} };
  }
  const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  // Canonical pace defaults per effort type (used when the plan workout
  // didn't carry a paceTargetSPerMi — e.g. long runs with mixed blocks).
  const PACE_DEFAULT: Record<EffortKey, number | null> = {
    easy: 525, recovery: 570, long: 460, tempo: 398, intervals: 365, rest: null,
  };
  const week: PlannedDay[] = glance.weekDays.map((d): PlannedDay => {
    const eff = mapType(d.plannedType);
    const dist = d.plannedMi > 0 ? d.plannedMi.toFixed(1) : ' · ';
    const fullDate = new Date(d.date + 'T12:00:00Z');
    const fullLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(fullDate);
    const paceSec = (d as { paceTargetSPerMi?: number | null }).paceTargetSPerMi ?? PACE_DEFAULT[eff];
    const paceStr = paceSec != null && paceSec > 0
      ? `${Math.floor(paceSec / 60)}:${String(Math.round(paceSec % 60)).padStart(2, '0')}`
      : (eff === 'rest' ? 'Rest' : '·');
    // Real estimated duration from pace × distance (was a flat 9 min/mi).
    const estMin = d.plannedMi > 0 && paceSec && paceSec > 0 ? Math.round(d.plannedMi * paceSec / 60) : null;
    const est = estMin != null
      ? (estMin >= 60 ? `~${Math.floor(estMin/60)}:${String(estMin%60).padStart(2,'0')}` : `~${estMin} min`)
      : (d.plannedMi > 0 ? `~${Math.round(d.plannedMi * 9)} min` : ' · ');
    return {
      dw: DOW[(d.dow + 6) % 7],
      dn: fullDate.getUTCDate(),
      full: fullLabel,
      type: eff,
      name: d.plannedLabel || humanName(eff, d.plannedMi),
      dist,
      pace: paceStr,
      est,
      done: d.isPast && d.doneMi > 0,
      today: d.isToday,
      activityId: d.activityId,
    };
  });
  const todayIdx = Math.max(0, week.findIndex(w => w.today));

  const results: Record<number, CompletedRun | undefined> = {};
  glance.weekDays.forEach((d, i) => {
    if (!d.isPast || d.doneMi <= 0) return;
    results[i] = {
      win: d.doneMi >= d.plannedMi * 0.95 ? 'Honest & on plan' : 'Done',
      winx: `${d.doneMi.toFixed(1)} of ${d.plannedMi.toFixed(1)} mi`,
      time: '·', apace: '·', hr: 0, peak: 0,
      zones: [0, 0, 0, 0, 0],
      weather: ' · ', shoe: ' · ', cal: 0, gain: 0,
      splits: [],
      recap: 'Real per-run telemetry surfaces from /runs/[id]; the daily tile shows the headline.',
    };
  });
  return { week, todayIdx, results };
}

function adaptReadiness(glance: Glance | null, health: Health | null): Readiness {
  const r = glance?.readiness;
  if (!r) {
    return {
      score: 70, label: 'STEADY', baseline: 70,
      trend: [70, 70, 70, 70, 70, 70, 70],
      trendDays: ['MON','TUE','WED','THU','FRI','SAT','SUN'],
      drivers: [],
      coach: 'Building the picture. Connect Apple Health + Strava to see your readiness.',
    };
  }
  const label = r.label || 'READY';
  const baseline = health?.hrv.baseline ?? 60;
  const trendRaw = (health?.hrvSeries.slice(-7) ?? []).map(d => {
    const delta = d.ms - (health?.hrv.baseline ?? d.ms);
    return Math.min(100, Math.max(0, 70 + delta * 0.8));
  });
  const trend = trendRaw.length === 7 ? trendRaw : Array(7).fill(r.score);
  const trendDays = (health?.hrvSeries.slice(-7) ?? []).map(d => new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase());
  // Filter the 'subjective' check-in input — that surface was removed from
  // the app (no daily mood/wellness check-in in production any more).
  const drivers = (r.inputs || [])
    .filter(i => i.key !== 'subjective')
    .map(i => {
      const dir: 'pos' | 'neg' = i.weight >= 0 ? 'pos' : 'neg';
      const pct = Math.min(100, Math.abs(i.weight) * 5);
      return { name: (i.label.split(' ·')[0] || i.key).toUpperCase(), why: `${i.observedV} · ${i.observedSub}`.trim(), pct, pts: Math.abs(i.weight), dir };
    });
  return {
    score: r.score, label, baseline,
    trend, trendDays: trendDays.length === 7 ? trendDays : ['MON','TUE','WED','THU','FRI','SAT','SUN'],
    drivers,
    coach: (r.inputs[0]?.meaning) || 'Readiness derived from sleep, HRV, RHR, and load.',
  };
}

function adaptGoalRace(glance: Glance | null, races: Races | null, profile: Profile | null, training: Training | null): GoalRace | null {
  const aRace = races?.aRace ?? null;
  // Real VDOT-based projection. Profile already carries the best
  // recent VDOT from races; turn that into a predicted time at the
  // goal race's distance.
  let projected = aRace?.goal ?? null;
  let onTrack = true;
  let delta = 'on track';
  if (aRace && profile?.physiology.vdot && aRace.distance_mi) {
    try {
      const predicted = predictRaceTime(profile.physiology.vdot, aRace.distance_mi);
      const goalSec = parseRaceTime(aRace.goal);
      if (predicted) projected = formatRaceTime(predicted) ?? aRace.goal;
      if (predicted && goalSec) {
        const diff = goalSec - predicted;
        onTrack = diff >= -30; // 30s grace before flipping to behind
        const m = Math.abs(Math.round(diff / 60));
        const sec = Math.abs(Math.round(diff % 60));
        delta = diff >= 0
          ? (m > 0 ? `${m} min ahead` : `${sec} sec ahead`)
          : (m > 0 ? `${m} min behind` : `${sec} sec behind`);
      }
    } catch { /* swallow */ }
  }
  // Real phase label from plan_phases when training-state has it.
  const phaseLabel = training?.currentPhase && training.currentWeekIdx != null
    ? `${training.currentPhase} phase · wk ${training.currentWeekIdx + 1} / ${training.weeks.length}`
    : 'In active block';

  if (aRace) {
    const days = aRace.days;
    const goal = aRace.goal || '·';
    return {
      slug: aRace.slug, name: aRace.name, date: aRace.date,
      daysAway: Math.max(0, days), goal,
      projected: projected ?? goal,
      onTrack, delta,
      phaseLabel,
      goalPct: Math.min(100, Math.max(0, 100 - (days / 365) * 100)),
      location: aRace.location ?? null,
    };
  }
  if (glance?.nextARaceName && glance.daysToARace != null) {
    return {
      slug: 'a-race', name: glance.nextARaceName, date: '',
      daysAway: Math.max(0, glance.daysToARace),
      goal: '·', projected: '·', onTrack: true, delta: 'on track',
      phaseLabel: glance.phaseLabel || '·', goalPct: 50,
      location: null,
    };
  }
  return null;
}

function adaptVolumeBars(log: LogT | null, training: Training | null): { bars: VolumeBar[]; thisWeek: number; avg: number } {
  // Prefer real Strava-driven weeks (log-state) for trailing-8 volume —
  // they reflect ACTUAL run mileage and span back well before the active
  // plan started. Fall back to training weeks (plan_workouts.distance_mi
  // + done miles) when there is no Strava history.
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dow);

  // Build 8 contiguous Mon-Sun buckets ending on the current week.
  const weeks: { monday: Date; mi: number; isCurrent: boolean }[] = [];
  for (let i = 7; i >= 0; i--) {
    const m = new Date(monday); m.setDate(monday.getDate() - i * 7);
    weeks.push({ monday: m, mi: 0, isCurrent: i === 0 });
  }

  if (log?.weeks?.length) {
    // log-state's weeks have a `monday` field — index by ISO date for fast lookup.
    const byMon: Record<string, number> = {};
    for (const w of log.weeks) byMon[w.monday] = (byMon[w.monday] ?? 0) + (w.totalMi || 0);
    for (const w of weeks) {
      const iso = w.monday.toISOString().slice(0, 10);
      w.mi = Math.round(byMon[iso] ?? 0);
    }
  } else if (training?.weeks?.length) {
    const byMon: Record<string, number> = {};
    for (const tw of training.weeks) {
      const totalDone = (tw.days ?? []).reduce((s, d) => s + (d.doneMi || 0), 0);
      byMon[tw.startDate] = Math.round(totalDone || tw.plannedMi || 0);
    }
    for (const w of weeks) {
      const iso = w.monday.toISOString().slice(0, 10);
      w.mi = byMon[iso] ?? 0;
    }
  }

  const bars: VolumeBar[] = weeks.map(w => ({
    mi: w.mi,
    label: w.isCurrent ? 'this week' : `wk of ${shortDate(w.monday.toISOString())}`,
    current: w.isCurrent,
  }));
  const thisWeek = bars.at(-1)?.mi ?? 0;
  const prior = bars.slice(0, -1).filter(b => b.mi > 0);
  const avg = prior.length ? Math.round(prior.reduce((s, b) => s + b.mi, 0) / prior.length) : 0;
  return { bars, thisWeek, avg };
}

function adaptSeason(training: Training | null) {
  if (!training?.weeks?.length) return { nowIdx: 0, raceIdx: 0, miles: [0], maxMi: 1, weekDays: [] };
  const miles = training.weeks.map(w => Math.round(w.plannedMi || 0));
  const nowIdx = Math.max(0, Math.min(miles.length - 1, training.currentWeekIdx ?? 0));
  const raceIdx = miles.length - 1;
  const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  // Lookup canonical pace per effort type for non-current weeks (training-
  // state doesn't ship the per-row pace_target_s_per_mi; we backfill from
  // the effort-typed default so rows render with a representative pace).
  const PACE_DEFAULT: Record<string, number | null> = {
    easy: 525, recovery: 570, long: 460, tempo: 398, intervals: 365, rest: null,
  };
  const weekDays = training.weeks.map(w => (w.days ?? []).map(d => {
    const t = mapType(d.type);
    return {
      dow: DOW[(d.dow + 6) % 7],
      type: t as import('./constants').EffortKey,
      name: d.label || humanName(t, d.mi),
      mi: d.mi || 0,
      paceSec: PACE_DEFAULT[t] ?? null,
      done: !!d.activityId,
      activityId: d.activityId,
    };
  }));
  return { nowIdx, raceIdx, miles, maxMi: Math.max(1, ...miles) + 5, weekDays };
}

function adaptHealth(health: Health | null, form: Form | null): HealthSnapshot {
  const series = (arr: Array<{ date: string } & Record<string, unknown>> | undefined, field: string): number[] => {
    if (!arr || arr.length === 0) return [];
    const xs = arr.map(d => Number((d as Record<string, unknown>)[field])).filter(v => Number.isFinite(v));
    if (xs.length === 0) return [];
    while (xs.length < 30) xs.unshift(xs[0]);
    return xs.slice(-30);
  };
  const hrvSeries    = series(health?.hrvSeries,    'ms');
  const rhrSeries    = series(health?.rhrSeries,    'bpm');
  const sleepSeries  = series(health?.sleepSeries,  'hours');
  const weightSeries = series(health?.weightSeries, 'lb');

  const mk = (k: string, label: string, unit: string, cur: number, target: number | undefined, dom: [number, number], s: number[], status: 'good' | 'warn' | 'neutral', decimals = 0, clock = false): HealthMetric => ({
    k, label, unit, current: cur, target, dom, series: s, status, decimals, clock,
  });

  const hrvCurrent = health?.hrv.current ?? 0;
  const rhrCurrent = health?.rhr.current ?? 0;
  const sleepAvg = health?.sleep.avg7n ?? 0;
  const weightCurrent = health?.weight.current ?? 0;
  const vo2Current = health?.vo2.current ?? 0;
  const cadenceCurrent = health?.cadence.baseline ?? 0;

  const body: HealthMetric[] = [
    mk('hrv',    'HRV',        'ms',  hrvCurrent,    health?.hrv.baseline ?? undefined,
       [Math.max(20, (hrvCurrent || 60) - 30), (hrvCurrent || 60) + 30],
       hrvSeries, hrvCurrent >= (health?.hrv.baseline ?? hrvCurrent) ? 'good' : 'warn'),
    mk('rhr',    'RESTING HR', 'bpm', rhrCurrent,    health?.rhr.baseline ?? undefined,
       [Math.max(35, (rhrCurrent || 50) - 10), (rhrCurrent || 50) + 10],
       rhrSeries, rhrCurrent <= (health?.rhr.baseline ?? rhrCurrent) ? 'good' : 'warn'),
    mk('sleep',  'SLEEP',      'h',   sleepAvg,      7.5,
       [4, 10], sleepSeries, sleepAvg >= 7 ? 'good' : 'warn', 1, true),
    mk('weight', 'WEIGHT',     'lb',  weightCurrent, undefined,
       [Math.max(120, (weightCurrent || 180) - 10), (weightCurrent || 180) + 10],
       weightSeries, 'good', 1),
    mk('vo2',    'VO₂ MAX',    '',    vo2Current,    undefined,
       [Math.max(30, (vo2Current || 50) - 8), (vo2Current || 50) + 6],
       Array(30).fill(vo2Current || 0), 'good'),
  ];
  // Real form metrics from health_samples (HealthKit ingest).
  const formRaw = (form?.ok ? form.value : null) ?? {};
  const formSeries = (k: string): { last: number; series: number[] } => {
    const rows = formRaw[k] ?? [];
    if (rows.length === 0) return { last: 0, series: [] };
    const xs = rows.map(r => r.value).filter(Number.isFinite);
    return { last: xs.at(-1) ?? 0, series: xs };
  };
  const cadenceForm = formSeries('cadence');
  const gctForm     = formSeries('ground_contact_time');
  const voscForm    = formSeries('vertical_oscillation');
  const strideForm  = formSeries('stride_length');
  const cadCurrent  = cadenceForm.last || cadenceCurrent;
  const form_: HealthMetric[] = [
    mk('cadence', 'CADENCE',        'spm', cadCurrent, 170,
       [Math.max(140, (cadCurrent || 170) - 20), (cadCurrent || 170) + 15],
       cadenceForm.series.length ? cadenceForm.series : Array(30).fill(cadCurrent || 0),
       cadCurrent >= 170 ? 'good' : 'warn'),
    mk('gct',     'GROUND CONTACT', 'ms',  Math.round(gctForm.last), undefined,
       [Math.max(160, (gctForm.last || 220) - 30), (gctForm.last || 220) + 30],
       gctForm.series.map(v => Math.round(v)),
       gctForm.last > 0 && gctForm.last < 240 ? 'good' : 'neutral'),
    mk('vosc',    'VERTICAL OSC',   'cm',  voscForm.last, undefined,
       [Math.max(4, (voscForm.last || 8) - 3), (voscForm.last || 8) + 3],
       voscForm.series,
       voscForm.last > 0 && voscForm.last < 9 ? 'good' : 'neutral', 1),
    mk('stride',  'STRIDE LENGTH',  'm',   strideForm.last, undefined,
       [Math.max(0.8, (strideForm.last || 1.1) - 0.3), (strideForm.last || 1.1) + 0.3],
       strideForm.series, 'neutral', 2),
    { k: 'balance', label: 'L / R BALANCE', unit: '', current: 0, dom: [0, 0], series: [], status: 'neutral', special: 'balance' },
  ];
  return { readiness: adaptReadiness(null, health), body, form: form_ };
}

function adaptPRs(races: Races | null, log: LogT | null): PR[] {
  // 1. Race finish times when the runner has logged them.
  const byDist: Record<string, { val: string; date: string; source: 'race' | 'training' }> = {};
  for (const r of (races?.past ?? [])) {
    if (!r.finishTime) continue;
    const lbl = (r.distance_label || '').toUpperCase();
    const key = lbl.includes('5K') ? '5K'
      : lbl.includes('10K') ? '10K'
      : lbl.includes('HALF') || lbl.includes('HM') ? 'HALF'
      : (r.distance_mi != null && r.distance_mi >= 25) ? 'MARATHON' : null;
    if (!key) continue;
    const cur = byDist[key];
    if (!cur || compareTimes(r.finishTime, cur.val) < 0) {
      byDist[key] = { val: r.finishTime, date: niceLong(r.date), source: 'race' };
    }
  }
  // 2. Training-derived PRs from log runs for any bucket the races
  //    didn't fill. Looks for runs whose distance lands in the bucket
  //    and picks the one with the fastest overall finish time.
  const allRuns = (log?.weeks ?? []).flatMap(w => w.runs);
  const buckets: { key: string; lo: number; hi: number }[] = [
    { key: '5K',       lo: 3.05, hi: 3.30 },
    { key: '10K',      lo: 6.10, hi: 6.50 },
    { key: 'HALF',     lo: 12.9, hi: 13.5 },
    { key: 'MARATHON', lo: 25.5, hi: 27.0 },
  ];
  for (const b of buckets) {
    if (byDist[b.key]) continue;
    const cands = allRuns.filter(r => r.distance_mi >= b.lo && r.distance_mi <= b.hi && r.pace);
    if (!cands.length) continue;
    // Pick by fastest pace × distance (= total time).
    cands.sort((a, c) => paceSec(a.pace!) * a.distance_mi - paceSec(c.pace!) * c.distance_mi);
    const best = cands[0];
    const canonicalMi = b.key === 'MARATHON' ? 26.2188 : b.key === 'HALF' ? 13.1094 : b.key === '10K' ? 6.21371 : 3.10686;
    const totalSec = paceSec(best.pace!) * canonicalMi;
    byDist[b.key] = {
      val: hms(Math.round(totalSec)),
      date: `${niceLong(best.date)} · training`,
      source: 'training',
    };
  }
  return ['5K','10K','HALF','MARATHON']
    .filter(k => byDist[k])
    .map(k => ({ k, v: byDist[k].val, date: byDist[k].date }));
}
function paceSec(p: string): number {
  if (!p) return 0;
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
function hms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
function compareTimes(a: string, b: string): number {
  const toSec = (t: string) => {
    const parts = t.split(':').map(x => parseInt(x, 10) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  };
  return toSec(a) - toSec(b);
}

function adaptRaces(races: Races | null): RaceLite[] {
  if (!races) return [];
  const today = Date.now();
  const upcoming = [
    ...races.aRaces.map(r => ({ ...r, tag: 'GOAL' as const })),
    ...races.upcomingBs.map(r => ({ ...r, tag: 'TUNE-UP' as const })),
    ...races.upcomingCs.map(r => ({ ...r, tag: 'TUNE-UP' as const })),
  ];
  return upcoming.map(r => ({
    slug: r.slug, name: r.name,
    meta: `${shortDate(r.date)}${r.location ? ' · ' + r.location : ''}`,
    tag: r.tag,
    days: `${Math.max(0, Math.round((Date.parse(r.date) - today) / 86_400_000))} days`,
  }));
}

function adaptActivity(log: LogT | null): ActivityData {
  const recent: RecentRun[] = (log?.weeks.flatMap(w => w.runs) ?? []).slice(0, 8).map(r => {
    const eff = mapType(r.type);
    const niceDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(r.date + 'T12:00:00Z')).toUpperCase();
    const meta = `${r.distance_mi.toFixed(1)} mi${r.pace ? ' · ' + r.pace : ''}`;
    let badge: RecentRun['badge'] | undefined;
    if (r.distance_mi >= 18) badge = 'LONGEST';
    return { date: niceDate, effort: eff, color: EFFORT_COLOR[eff], name: r.name || 'Run', meta, badge, slug: r.id };
  });
  const allRuns = (log?.weeks ?? []).flatMap(w => w.runs);
  return {
    ranges: {
      month: buildRange(allRuns, 'month'),
      year:  buildRange(allRuns, 'year'),
      all:   buildRange(allRuns, 'all'),
    },
    recent,
  };
}

type LogRun = LogT['weeks'][number]['runs'][number];

function buildRange(runs: LogRun[], range: 'month'|'year'|'all'): ActivityData['ranges']['year'] {
  const now = new Date();
  const cutoff = range === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
    : range === 'year' ? new Date(now.getFullYear(), 0, 1)
    : new Date(2020, 0, 1);
  const subset = runs.filter(r => Date.parse(r.date) >= cutoff.getTime());
  const totalMiles = subset.reduce((s, r) => s + r.distance_mi, 0);
  const totalElev  = subset.reduce((s, r) => s + (r.elev_gain_ft || 0), 0);
  const eyebrow = range === 'month' ? `THIS MONTH · ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now).toUpperCase()}`
    : range === 'year' ? `THIS YEAR · ${now.getFullYear()}`
    : 'ALL TIME';
  const big = Math.round(totalMiles).toLocaleString();
  const sub = `${subset.length} runs logged`;
  const totals: [string, string][] = [
    ['RUNS', String(subset.length)],
    ['DISTANCE', `${Math.round(totalMiles).toLocaleString()}<small> mi</small>`],
    ['ELEV GAIN', `${(totalElev / 1000).toFixed(1)}k<small> ft</small>`],
    [range === 'all' ? 'AVG / YEAR' : 'AVG / WEEK', `${avgPerBucket(subset, range)}<small> mi</small>`],
  ];
  let vol: { l: string; v: number }[];
  let volT: string, volS: string;
  if (range === 'month') {
    volT = 'Weekly mileage'; volS = `${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)}, by week`;
    const monday = mondayOf(new Date());
    vol = [];
    for (let i = 4; i >= 0; i--) {
      const start = new Date(monday); start.setDate(monday.getDate() - i * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const mi = subset.filter(r => Date.parse(r.date) >= start.getTime() && Date.parse(r.date) < end.getTime())
        .reduce((s, r) => s + r.distance_mi, 0);
      vol.push({ l: shortDate(start.toISOString()).toUpperCase(), v: Math.round(mi) });
    }
  } else if (range === 'year') {
    volT = 'Monthly mileage'; volS = `${now.getFullYear()}, by month`;
    vol = Array.from({ length: 12 }, (_, m) => {
      const start = new Date(now.getFullYear(), m, 1);
      const end = new Date(now.getFullYear(), m + 1, 1);
      const mi = subset.filter(r => Date.parse(r.date) >= start.getTime() && Date.parse(r.date) < end.getTime())
        .reduce((s, r) => s + r.distance_mi, 0);
      return { l: 'JFMAMJJASOND'[m], v: Math.round(mi) };
    });
  } else {
    volT = 'Yearly mileage'; volS = 'since first run';
    const years = Array.from(new Set(subset.map(r => new Date(r.date).getFullYear()))).sort();
    vol = years.map(y => {
      const mi = subset.filter(r => new Date(r.date).getFullYear() === y).reduce((s, r) => s + r.distance_mi, 0);
      return { l: String(y), v: Math.round(mi) };
    });
  }
  return {
    eyebrow, big, sub, totals, volT, volS, vol,
    mix: effortMix(subset),
    recs: recordsFromRuns(subset),
    heat: heatGrid(subset, 18),
    heatLabels: monthLabelsFromHeat(),
    facts: factsFromRuns(subset, totalMiles, totalElev),
  };
}

function mondayOf(d: Date): Date {
  const day = new Date(d); day.setHours(0,0,0,0);
  const dow = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - dow);
  return day;
}
function avgPerBucket(runs: LogRun[], range: 'month'|'year'|'all'): number {
  if (!runs.length) return 0;
  const totalMi = runs.reduce((s, r) => s + r.distance_mi, 0);
  if (range === 'all') {
    const years = new Set(runs.map(r => new Date(r.date).getFullYear()));
    return Math.round(totalMi / Math.max(1, years.size));
  }
  const dates = runs.map(r => Date.parse(r.date));
  const earliest = Math.min(...dates), latest = Math.max(...dates);
  const weeks = Math.max(1, Math.round((latest - earliest) / (7 * 86_400_000)) + 1);
  return Math.round(totalMi / weeks);
}
function effortMix(runs: LogRun[]): [string, string, number][] {
  if (!runs.length) return [['easy','Easy',0]];
  const buckets: Record<EffortKey, number> = { recovery:0, easy:0, long:0, tempo:0, intervals:0, rest:0 };
  let total = 0;
  for (const r of runs) {
    const e = mapType(r.type);
    buckets[e] += r.distance_mi;
    total += r.distance_mi;
  }
  if (total <= 0) return [['easy','Easy',0]];
  const order: EffortKey[] = ['easy','long','tempo','intervals','recovery'];
  return order.map(k => [k, k[0].toUpperCase() + k.slice(1), Math.round(buckets[k] / total * 100)] as [string, string, number]);
}
function heatGrid(runs: LogRun[], weeks = 18): import('./types').HeatCell[][] {
  const today = new Date(); today.setHours(0,0,0,0);
  // Index runs by date so each cell can carry name + type + run id.
  type DayBucket = { mi: number; name: string; type: string | null; id: string };
  const byDay: Record<string, DayBucket> = {};
  for (const r of runs) {
    const cur = byDay[r.date];
    if (!cur) byDay[r.date] = { mi: r.distance_mi, name: r.name || 'Run', type: r.type ?? null, id: r.id };
    else { cur.mi += r.distance_mi; }
  }
  const fmtDay = (d: Date) => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  };
  const titleCase = (s: string | null) => {
    if (!s) return '';
    const low = s.toLowerCase();
    return low[0].toUpperCase() + low.slice(1);
  };
  const cols: import('./types').HeatCell[][] = [];
  for (let c = weeks - 1; c >= 0; c--) {
    const col: import('./types').HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(today);
      day.setDate(today.getDate() - (c * 7 + (6 - d)));
      const iso = day.toISOString().slice(0, 10);
      const bucket = byDay[iso];
      const mi = bucket?.mi ?? 0;
      const lv: 0|1|2|3|4 = mi <= 0 ? 0 : mi < 4 ? 1 : mi < 8 ? 2 : mi < 14 ? 3 : 4;
      const label = mi <= 0
        ? `${fmtDay(day)} · Rest`
        : `${fmtDay(day)} · ${mi.toFixed(1)} mi${bucket?.type ? ' · ' + titleCase(bucket.type) : ''}`;
      col.push({ lv, date: iso, mi: Math.round(mi * 10) / 10, label, runId: bucket?.id });
    }
    cols.push(col);
  }
  return cols;
}
function monthLabelsFromHeat(): string[] {
  const now = new Date();
  const labels: string[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d).toUpperCase());
  }
  return labels;
}
function recordsFromRuns(runs: LogRun[]): ActivityData['ranges']['year']['recs'] {
  if (!runs.length) {
    return [
      { k: 'FASTEST 5K',   v: '·', c: 'No 5K yet',   t: 'tempo' },
      { k: 'FASTEST 10K',  v: '·', c: 'No 10K yet',  t: 'tempo' },
      { k: 'LONGEST RUN',  v: '·', c: '·',           t: 'long'  },
      { k: 'BIGGEST WEEK', v: '·', c: '·',           t: 'long'  },
    ];
  }
  const longest = runs.reduce((p, c) => c.distance_mi > p.distance_mi ? c : p);
  const wmap: Record<string, number> = {};
  for (const r of runs) {
    const dt = new Date(r.date);
    const dow = (dt.getDay() + 6) % 7;
    const mon = new Date(dt); mon.setDate(dt.getDate() - dow);
    const key = mon.toISOString().slice(0, 10);
    wmap[key] = (wmap[key] ?? 0) + r.distance_mi;
  }
  const bigWeek = Object.entries(wmap).sort((a, b) => b[1] - a[1])[0];
  const fastestNear = (min: number, max: number) => {
    const cands = runs.filter(r => r.distance_mi >= min && r.distance_mi <= max && r.pace);
    cands.sort((a, b) => paceToSec(a.pace!) - paceToSec(b.pace!));
    return cands[0] ?? null;
  };
  const fast5K = fastestNear(3.0, 3.4);
  const fast10K = fastestNear(6.0, 6.6);
  const records: ActivityData['ranges']['year']['recs'] = [];
  records.push(fast5K
    ? { k: 'FASTEST 5K',  v: fast5K.pace!,  c: niceLong(fast5K.date),  t: 'tempo' }
    : { k: 'FASTEST 5K',  v: '·',           c: 'No 5K yet',            t: 'tempo' });
  records.push(fast10K
    ? { k: 'FASTEST 10K', v: fast10K.pace!, c: niceLong(fast10K.date), t: 'tempo' }
    : { k: 'FASTEST 10K', v: '·',           c: 'No 10K yet',           t: 'tempo' });
  records.push({ k: 'LONGEST RUN', v: `${longest.distance_mi.toFixed(1)}<small> mi</small>`, c: `${longest.name} · ${niceLong(longest.date)}`, t: 'race' });
  records.push(bigWeek
    ? { k: 'BIGGEST WEEK', v: `${bigWeek[1].toFixed(1)}<small> mi</small>`, c: `wk of ${shortDate(bigWeek[0])}`, t: 'long' }
    : { k: 'BIGGEST WEEK', v: '·', c: '·', t: 'long' });
  return records;
}
function paceToSec(p: string): number {
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 9999;
}
function factsFromRuns(runs: LogRun[], miles: number, elev: number): ActivityData['ranges']['year']['facts'] {
  // Real moving time: sum each run's pace × distance when available, else
  // approximate at 9 min/mi.
  let totalSec = 0;
  for (const r of runs) {
    const paceSec = paceToSec(r.pace ?? '');
    totalSec += paceSec < 9999 ? paceSec * r.distance_mi : r.distance_mi * 9 * 60;
  }
  const hours = Math.round(totalSec / 3600);

  // Find the dominant day-of-week for "long" runs. Threshold = 60th
  // percentile of all run distances (or 10 mi, whichever is greater).
  const distances = runs.map(r => r.distance_mi).sort((a, b) => a - b);
  const p60 = distances[Math.floor(distances.length * 0.6)] ?? 10;
  const longThresh = Math.max(10, p60);
  const longs = runs.filter(r => r.distance_mi >= longThresh);
  const dowCount = new Array(7).fill(0);
  for (const r of longs) {
    const d = new Date(r.date + 'T12:00:00Z');
    dowCount[d.getUTCDay()]++;
  }
  const totalLongs = longs.length;
  let bestDow = 6, bestN = 0;
  for (let i = 0; i < 7; i++) if (dowCount[i] > bestN) { bestN = dowCount[i]; bestDow = i; }
  const DOW_PLURAL = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
  const longDayName = totalLongs >= 3 ? DOW_PLURAL[bestDow] : 'Long runs';
  const longPct = totalLongs > 0 ? Math.round((bestN / totalLongs) * 100) : 0;
  const longCopy = totalLongs >= 3
    ? `your long-run anchor. ${longPct}% of long runs land there.`
    : 'will surface once a long-run pattern emerges.';

  return [
    { i: 'mtn',   v: `${Math.round(elev).toLocaleString()} ft`, c: 'climbed. Stairs to the moon, give or take.' },
    { i: 'route', v: `${Math.round(miles).toLocaleString()} mi`, c: 'on the legs.' },
    { i: 'clock', v: `${hours.toLocaleString()} hours`, c: 'moving. A workweek every couple months.' },
    { i: 'cal',   v: longDayName, c: longCopy },
  ];
}

function adaptShoes(profile: Profile | null): ShoeRec[] {
  if (!profile?.shoes?.length) return [];
  return profile.shoes.filter(s => !s.retired).map(s => ({
    id: Number(s.id),
    brand: s.brand,
    model: s.model,
    nm: s.name || `${s.brand} ${s.model}`.trim(),
    role: (s.runTypes?.[0] ?? 'easy').toString().toUpperCase().replace(/[^A-Z]/g, ''),
    mi: Math.round(s.mileage || 0),
    max: Math.round(s.cap || 400),
  }));
}
function adaptConnections(profile: Profile | null): ConnectionRow[] {
  const strava = profile?.connections.strava.connected ?? false;
  const health = profile?.connections.appleHealth.connected ?? false;
  const watch = profile?.connections.appleWatch.connected ?? false;
  return [
    { id: 'health',     nm: 'Apple Health', sub: profile?.connections.appleHealth.note || 'HRV, sleep, RHR, weight', bg: 'linear-gradient(135deg,#ff5a6e,#ff2d55)', gl: '♥', on: health },
    { id: 'strava',     nm: 'Strava',       sub: profile?.connections.strava.note      || 'Run history',             bg: 'linear-gradient(135deg,#fc7e3c,#fc4c02)', gl: '▲', on: strava },
    { id: 'watch',      nm: 'Apple Watch',  sub: profile?.connections.appleWatch.note  || 'Live workouts',           bg: 'linear-gradient(135deg,#3aa0e0,#0a66a8)', gl: '⌚', on: watch },
    { id: 'finalsurge', nm: 'FinalSurge',   sub: 'Coming soon',                                                       bg: 'linear-gradient(135deg,#5b8def,#2a5fd0)', gl: 'FS', on: false },
  ];
}
function adaptForm(training: Training | null, glance: Glance | null): FaffSeed['form'] {
  const acwr = glance?.loadAcwr ?? null;
  const fitness = training?.weeks ? Math.round(training.weeks.reduce((s, w) => s + (w.plannedMi || 0), 0) / Math.max(1, training.weeks.length)) : 0;
  const fatigue = Math.round(glance?.weekDone ?? 0);
  const delta = fitness - fatigue;
  const label = acwr != null
    ? (acwr > 1.5 ? 'OVER-REACH' : acwr > 1.1 ? 'BUILDING' : acwr > 0.7 ? 'STEADY' : 'FRESH')
    : (delta > 5 ? 'BUILDING' : delta < -5 ? 'LOADED' : 'STEADY');
  return { fitness, fatigue, delta, label };
}

/* ─────────────────────────  Public entry point  ───────────────────────── */

export async function buildSeed(): Promise<FaffSeed> {
  const [gRes, hRes, tRes, rRes, lRes, pRes, fRes] = await Promise.all([
    loadGlance(), loadHealth(), loadTraining(), loadRaces(), loadLog(), loadProfile(), loadFormMetrics(),
  ]);
  const glance   = gRes.ok ? gRes.value : null;
  const health   = hRes.ok ? hRes.value : null;
  const training = tRes.ok ? tRes.value : null;
  const races    = rRes.ok ? rRes.value : null;
  const log      = lRes.ok ? lRes.value : null;
  const profile  = pRes.ok ? pRes.value : null;
  const formMetrics: Form = fRes;

  const { week, todayIdx, results } = adaptWeek(glance);
  const readiness = adaptReadiness(glance, health);
  const goalRace = adaptGoalRace(glance, races, profile, training);
  const { bars: volumeBars, thisWeek: thisWeekMiles, avg: weeklyAvg } = adaptVolumeBars(log, training);
  const season = adaptSeason(training);
  const healthSnapshot = adaptHealth(health, formMetrics);
  healthSnapshot.readiness = readiness;
  const prs = adaptPRs(races, log);
  const racesList = adaptRaces(races);
  const activity = adaptActivity(log);
  const shoes = adaptShoes(profile);
  const connections = adaptConnections(profile);
  const form = adaptForm(training, glance);

  const fullName = profile?.identity.full_name ?? glance?.greetingName ?? null;
  const user = {
    name: fullName ? fullName.split(' ')[0] : 'You',
    city: profile?.identity.city ?? '',
    initial: (fullName?.[0] ?? 'F').toUpperCase(),
    pro: true,
  };
  const weekOf = goalRace
    ? `Week ${season.nowIdx + 1} of ${Math.max(1, season.raceIdx + 1)} · ${(glance?.phaseLabel ?? 'Active block')}`
    : (glance?.phaseLabel ?? 'Active training');

  return {
    todayISO: new Date().toISOString(),
    topDate: todayLabel(),
    weekOf,
    user,
    week, todayIdx, results,
    readiness,
    goalRace,
    volumeBars,
    thisWeekMiles,
    weeklyAvg,
    form,
    season,
    health: healthSnapshot,
    prs,
    races: racesList,
    activity,
    shoes,
    connections,
  };
}
