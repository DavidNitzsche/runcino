/**
 * Server-side seed builder for the Faff Web App design, wired to
 * web-v2's real data loaders. Returns a FaffSeed envelope the Shell
 * + every view reads from.
 *
 * AUTH (2026-05-30 P1 SSR fix): per-user data is keyed off the
 * `faff_session` cookie via `userIdFromCookies()`. When the visitor
 * is not signed in we return an EMPTY seed envelope — the previous
 * behavior of silently defaulting to David's UUID was a cross-user
 * leak waiting on user #2 (any unauthenticated browser visiting
 * /faff would render David's plan, races, health, etc. via SSR).
 *
 * Every loader is wrapped in try/catch so the page renders even if
 * a single signal is unavailable (e.g. Strava reauth needed, plan
 * not yet authored, HealthKit hasn't synced today).
 */

import type {
  FaffSeed, Readiness, GoalRace, VolumeBar, PR, RaceLite,
  ShoeRec, ConnectionRow, HealthSnapshot, HealthMetric,
  ActivityData, RecentRun, EfficiencyTrend,
} from './types';
import type { PlannedDay, CompletedRun, EffortKey } from './constants';
import { predictRaceTime, formatRaceTime, parseRaceTime } from '@/lib/training/vdot';
import { userIdFromCookies } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';
import { redirect } from 'next/navigation';

/* ─────────────────────────  Pure helpers  ───────────────────────── */

function todayLabel(): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}
function shortDate(iso: string): string {
  // noon-UTC anchor on the date part · accepts date-only or a full ISO
  // timestamp (callers pass .toISOString()); the label never shifts a day by TZ.
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}
function niceLong(iso: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}
function mapType(t: string | null | undefined): EffortKey {
  const low = (t ?? '').toLowerCase();
  // 2026-06-10 honesty pass: a day with NO planned workout is "nothing
  // planned" — render it as rest, never invent an easy run for it.
  // glance-state emits 'unplanned' for plan-less users (coached mode,
  // pre-plan); the old fallthrough turned that into a week of phantom
  // "Easy" days with 8:45 target paces and MISSED prompts.
  if (low === '' || low === 'unplanned') return 'rest';
  if (low.includes('rest')) return 'rest';
  // 2026-06-08 · race must resolve BEFORE the easy fallback. Previously
  // 'race' fell through to 'easy', so race morning rendered a cyan EASY
  // hero (the orange MESH.race + 'RACE' title were unreachable). Guard the
  // 'race_pace'/'race_simulation' quality subtypes so they DON'T match
  // here — only a true race-effort row ('race', 'race_a'…) maps to 'race'.
  if (low === 'race' || low.startsWith('race_a') || low.startsWith('race_b') || low.startsWith('race_c')) return 'race';
  if (low.includes('long')) return 'long';
  if (low.includes('tempo') || low.includes('threshold')) return 'tempo';
  if (low.includes('interval') || low.includes('vo2') || low.includes('track')) return 'intervals';
  if (low.includes('recovery') || low.includes('shake')) return 'recovery';
  return 'easy';
}
function humanName(eff: EffortKey, distMi: number): string {
  // 2026-05-31: shortened to single-line uppercase tags per design.
  // The hero title is sized for one-line names (EASY / LONG / TEMPO /
  // INTERVALS / RECOVERY / REST) so anything longer wraps and breaks
  // the layout. plan_workouts.sub_label can still override when the
  // plan-builder authored a more specific name.
  if (eff === 'rest') return 'Rest';
  if (eff === 'race') return 'Race';
  if (eff === 'long') return distMi >= 14 ? 'Long' : 'Long';
  if (eff === 'tempo') return 'Tempo';
  if (eff === 'intervals') return 'Intervals';
  if (eff === 'recovery') return 'Recovery';
  return 'Easy';
}
const EFFORT_COLOR: Record<EffortKey, string> = {
  recovery: '#27B4E0', easy: '#14C08C', long: '#F3AD38', tempo: '#FF5722', intervals: '#F43F5E', rest: '#8A90A0', race: '#FF5722',
};

/* ─────────────────────────  Fallbacks  ───────────────────────── */

// 2026-06-10 honesty pass: was a hardcoded DEMO week ("Tempo 8.0 @
// 6:38", "Long 16.0 @ 7:40") that rendered as a real prescription for
// any runner whose glance had no weekDays. Now a neutral rest week —
// nothing planned reads as nothing planned.
const FALLBACK_WEEK: PlannedDay[] = ['MON','TUE','WED','THU','FRI','SAT','SUN'].map((dw, i) => ({
  dw, dn: i + 1,
  full: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i],
  type: 'rest' as EffortKey, name: ' · ', dist: ' · ', pace: ' · ', est: ' · ',
  today: i === 1,
}));

/* ────────────────  trainingInfluence composer (Phase web brief) ──────── */

import {
  composeTrainingInfluence,
  type TrainingInfluence,
} from '@/lib/coach/training-influence';

type DayLikeForInfluence = {
  id?: string;
  activityId?: string | null;
  paceSec?: number | null;
  donePaceSec?: number | null;
  doneAvgHr?: number | null;
  doneSplits?: Array<{ paceSec: number | null; hr: number | null }>;
  adaptation?: { wasAdapted?: boolean } | null;
};

/**
 * Per-day wrapper · pulls fields off the training day shape, computes
 * work-pace for quality, hands off to composeTrainingInfluence.
 *
 * Returns null when the day isn't done OR isn't a quality/long row.
 */
function composeTrainingInfluenceForDay(
  d: DayLikeForInfluence,
  t: string,
  lastOverrideTs: Map<string, number>,
  sameTypeStreakById: Map<string, number>,
  raceDistanceMi: number | null,
): TrainingInfluence | null {
  if (!d.activityId) return null;
  // Work-pace for quality (fastest N splits avg); avg pace otherwise.
  const QUALITY = new Set(['intervals', 'tempo', 'threshold']);
  let donePaceSec: number | null = null;
  if (QUALITY.has(t) && (d.doneSplits?.length ?? 0) >= 2) {
    const splits = (d.doneSplits ?? [])
      .map((s) => s.paceSec)
      .filter((p): p is number => p != null && p > 0);
    if (splits.length >= 2) {
      const repCount = Math.max(2, Math.min(splits.length - 1, 5));
      const sorted = [...splits].sort((a, b) => a - b);
      const fastest = sorted.slice(0, repCount);
      donePaceSec = Math.round(fastest.reduce((s, x) => s + x, 0) / fastest.length);
    }
  } else {
    donePaceSec = d.donePaceSec ?? null;
  }
  const wasAdapted = !!d.adaptation?.wasAdapted;
  const wasRestored = !!d.id && lastOverrideTs.has(d.id);
  const sameTypeStreak = d.id ? (sameTypeStreakById.get(d.id) ?? 1) : 1;
  return composeTrainingInfluence({
    type: t,
    plannedPaceSec: d.paceSec ?? null,
    donePaceSec,
    doneAvgHr: d.doneAvgHr ?? null,
    sameTypeStreak,
    wasAdapted,
    wasRestored,
    phaseLabel: null,    // could thread from plan_phases later
    raceDistanceMi,
    hrOnPaceDelta: null, // wired in a follow-up · needs hr-on-pace-delta loader
  });
}

/* ─────────────────────────  Loader wrappers  ───────────────────────── */

type LoadResult<T> = { ok: true; value: T } | { ok: false; error: string };
async function safe<T>(fn: () => Promise<T>): Promise<LoadResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

async function loadGlance(uid: string)   { return safe(async () => (await import('@/lib/coach/glance-state')).loadGlanceState(uid)); }
async function loadHealth(uid: string)   { return safe(async () => (await import('@/lib/coach/health-state')).loadHealthState(uid)); }
async function loadTraining(uid: string) { return safe(async () => (await import('@/lib/coach/training-state')).loadTrainingState(uid)); }
async function loadRaces(uid: string)    { return safe(async () => (await import('@/lib/coach/races-state')).loadRacesState(uid)); }
async function loadLog(uid: string)      { return safe(async () => (await import('@/lib/coach/log-state')).loadLogState(uid, { filters: { source: null, type: null, phase: null, shoe: null } })); }
async function loadProfile(uid: string)  { return safe(async () => (await import('@/lib/coach/profile-state')).loadProfileState(uid)); }

/** Form-metric series straight from health_samples. Pulls 30-day series
 *  for the running-form signals HealthKit ships (cadence, GCT, vertical
 *  oscillation, stride length, vertical ratio) plus 30-day VO2 if present.
 *  The Faff Health view renders these in the FORM strip. */
async function loadFormMetrics(uid: string) {
  // 2026-06-01 (David call): the form bar-charts on Health were
  // pulling from health_samples · which includes daily-aggregated
  // values that mix walking with running. Cadence ~140s when David's
  // real running cadence is ~162. The baseline/current was already
  // fixed in health-state.ts:159 to prefer runs.avgCadence, but the
  // 14-bar series feeding the chart kept the polluted source.
  //
  // Fix: pull per-run values from runs.data (the only honest source
  // for "running cadence per run") for the fields runs.data carries
  // (avgCadence, avgPowerW, avgStrideLengthM). For HK-only form
  // metrics (GCT, vertical osc, vert ratio · not on runs.data yet),
  // we filter health_samples to only days that ALSO have a run · the
  // sample lands the day of the run so the daily aggregate at least
  // doesn't contain non-run days. Still imperfect for split workouts
  // (long run + later walk same day · the aggregate is biased), but
  // the right shape until HK ingest writes per-run form metrics.
  return safe(async () => {
    const { pool } = await import('@/lib/db/pool');
    const acc: Record<string, Array<{ date: string; value: number }>> = {};

    // 1. Per-run series for cadence, power, stride · from runs.data.
    const runRows = await pool.query(
      `SELECT (data->>'date')::date AS d,
              (data->>'avgCadence')::numeric AS cadence,
              (data->>'avgPowerW')::numeric AS power,
              (data->>'avgStrideLengthM')::numeric AS stride
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= (NOW()::date - interval '30 days')
        ORDER BY (data->>'date')::date ASC`,
      [uid]
    ).catch(() => ({ rows: [] as Array<{ d: Date | string; cadence: string | null; power: string | null; stride: string | null }> }));
    for (const r of runRows.rows) {
      const dStr = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d);
      // 130-220 spm guard · throws out 0/null cadence rows from runs that
      // don't carry the field (very-old Strava imports).
      if (r.cadence != null) {
        const v = Number(r.cadence);
        if (v >= 130 && v <= 220) (acc['cadence'] ??= []).push({ date: dStr, value: v });
      }
      if (r.power != null) {
        const v = Number(r.power);
        if (v > 0 && v < 800) (acc['run_power'] ??= []).push({ date: dStr, value: v });
      }
      if (r.stride != null) {
        const v = Number(r.stride);
        if (v > 0.5 && v < 2.5) (acc['stride_length'] ??= []).push({ date: dStr, value: v });
      }
    }

    // 2. HK-only form metrics (GCT, vertical osc, vert ratio) · filter
    //    health_samples to days that had a run so non-run samples are
    //    excluded. Not perfect for split workouts but defensible.
    // 2026-06-03 · BUG FIX · this query was throwing a type-mismatch
    // error (text = uuid) because:
    //   1. `hs.user_id = $1` filtered by the legacy text column, but
    //      $1 was a UUID for the form-metric rows. The error was
    //      caught by the outer .catch and the query returned [].
    //   2. The EXISTS join `r.user_uuid::text = hs.user_id` failed
    //      whenever hs.user_id was null (the common case once UUID
    //      backfill happened).
    // David's data has 135 GCT samples, 135 VOSC samples, 135 VRATIO
    // samples between 2025-05-22 and 2026-05-25 · the tiles read
    // "NO DATA YET" only because the query never returned them.
    //
    // Fix · COALESCE on both columns and join properly. Widened the
    // window to 60d to surface a richer series for the runner.
    const hkRows = await pool.query(
      `SELECT hs.sample_type, hs.sample_date::date AS d, hs.value
         FROM health_samples hs
        WHERE COALESCE(hs.user_uuid, hs.user_id::uuid) = $1::uuid
          AND hs.sample_type IN ('ground_contact_time','vertical_oscillation','vertical_ratio')
          AND hs.sample_date >= NOW() - interval '60 days'
          AND EXISTS (
            SELECT 1 FROM runs r
             WHERE r.user_uuid = $1::uuid
               AND NOT (r.data ? 'mergedIntoId')
               AND (r.data->>'date')::date = hs.sample_date
          )
        ORDER BY hs.sample_date ASC`,
      [uid]
    ).catch((e: unknown) => {
      console.warn('[loadFormMetrics:hk]', e instanceof Error ? e.message : String(e));
      return { rows: [] as Array<{ sample_type: string; d: Date | string; value: number | string }> };
    });
    for (const r of hkRows.rows) {
      const dStr = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d);
      (acc[r.sample_type] ??= []).push({ date: dStr, value: Number(r.value) });
    }

    // 2026-06-03 · iPhone build 155 stopped sending vertical_ratio (per
    // c2fb7681) · they derive it backend-side from osc + stride. Existing
    // historical rows (2025-05-22 → 2026-05-25) stay; for any day with
    // BOTH vertical_oscillation and stride_length but NO vertical_ratio,
    // compute it: ratio_pct = vertical_osc_cm / stride_length_m
    // (e.g. 10cm / 1.21m = 8.3%).
    const oscByDate = new Map<string, number>();
    const strideByDate = new Map<string, number>();
    const ratioByDate = new Map<string, true>();
    for (const p of acc['vertical_oscillation'] ?? []) oscByDate.set(p.date, p.value);
    for (const p of acc['stride_length'] ?? []) strideByDate.set(p.date, p.value);
    for (const p of acc['vertical_ratio'] ?? []) ratioByDate.set(p.date, true);
    const derived: Array<{ date: string; value: number }> = [];
    for (const [date, osc] of oscByDate) {
      if (ratioByDate.has(date)) continue;          // HK row exists, keep it
      const stride = strideByDate.get(date);
      if (stride == null || stride <= 0) continue;  // can't divide
      const ratio = +(osc / stride).toFixed(2);     // cm / m = %
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 20) continue;
      derived.push({ date, value: ratio });
    }
    if (derived.length) {
      acc['vertical_ratio'] = [
        ...(acc['vertical_ratio'] ?? []),
        ...derived,
      ].sort((a, b) => a.date.localeCompare(b.date));
    }

    return acc;
  });
}
type Form = Awaited<ReturnType<typeof loadFormMetrics>>;

/** Per-day skip rows for the current Mon-Sun window. Returns a Set of
 *  ISO dates the runner has explicitly skipped via /api/today/skip.
 *  Drives the .skipped flag on week[i] + the .day card grayscale. */
async function loadWeekSkips(uid: string): Promise<{ ok: true; value: Set<string> }> {
  try {
    const { pool } = await import('@/lib/db/pool');
    const todayISO = await runnerToday(uid);
    const todayMs = Date.parse(todayISO + 'T12:00:00Z');
    const dow = new Date(todayMs).getUTCDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(todayMs + shift * 86400000).toISOString().slice(0, 10);
    const sundayDt = new Date(todayMs + (shift + 6) * 86400000);
    const sunday = sundayDt.toISOString().slice(0, 10);
    const r = await pool.query(
      `SELECT date_iso FROM day_actions
        WHERE user_id = $1 AND action = 'skip'
          AND date_iso BETWEEN $2 AND $3`,
      [uid, monday, sunday]
    ).catch(() => ({ rows: [] as Array<{ date_iso: string }> }));
    return { ok: true, value: new Set(r.rows.map((x) => x.date_iso)) };
  } catch {
    return { ok: true, value: new Set<string>() };
  }
}

/** Plan adaptations from coach_intents (P1 #8). Pulls every plan_adapt_*
 *  row in the active plan window, resolves workout_id → date_iso so we can
 *  attribute each adapt to a week. Used by TrainView's KEY WORKOUTS list. */
async function loadPlanAdapts(uid: string, planId: string | null): Promise<{ ok: true; value: Array<{ workoutId: string; dateIso: string; kind: string; newType?: string; newDate?: string; shaveFraction?: number; why: string; ts: string }> }> {
  if (!planId) return { ok: true, value: [] };
  try {
    const { pool } = await import('@/lib/db/pool');
    const r = await pool.query(
      `SELECT ci.field AS workout_id, ci.reason, ci.value, ci.ts, pw.date_iso
         FROM coach_intents ci
         JOIN plan_workouts pw ON pw.id::text = ci.field
        WHERE ci.user_id = $1
          AND ci.reason LIKE 'plan_adapt_%'
          AND pw.plan_id = $2
        ORDER BY ci.ts ASC`,
      [uid, planId]
    ).catch(() => ({ rows: [] as Array<{ workout_id: string; reason: string; value: string; ts: Date | string; date_iso: string }> }));
    const out = r.rows.map((row) => {
      let parsed: { kind?: string; newType?: string; newDate?: string; shaveFraction?: number; why?: string } = {};
      try { parsed = JSON.parse(typeof row.value === 'string' ? row.value : String(row.value)); } catch { /* swallow */ }
      const kind = (parsed.kind ?? row.reason.replace(/^plan_adapt_/, '')) as string;
      return {
        workoutId: String(row.workout_id),
        dateIso: row.date_iso,
        kind,
        newType: parsed.newType,
        newDate: parsed.newDate,
        shaveFraction: parsed.shaveFraction,
        why: String(parsed.why ?? ''),
        ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
      };
    });
    return { ok: true, value: out };
  } catch {
    return { ok: true, value: [] };
  }
}

/** Per-day shoe assignment from day_actions (action='shoe', note=shoe_id).
 *  Returns the shoe_id (numeric or string) for today's row if present,
 *  else null. Errors swallowed — UI falls back to recommended shoe. */
async function loadTodayShoe(uid: string): Promise<{ ok: true; value: number | null }> {
  try {
    const { pool } = await import('@/lib/db/pool');
    const today = await runnerToday(uid);
    const r = await pool.query(
      `SELECT note FROM day_actions
        WHERE user_id = $1 AND date_iso = $2 AND action = 'shoe'
        LIMIT 1`,
      [uid, today]
    ).catch(() => ({ rows: [] as Array<{ note: string | null }> }));
    const note = r.rows[0]?.note ?? null;
    const id = note != null ? Number(note) : null;
    return { ok: true, value: Number.isFinite(id) && id != null ? id : null };
  } catch {
    return { ok: true, value: null };
  }
}

type Glance   = Awaited<ReturnType<typeof import('@/lib/coach/glance-state').loadGlanceState>>;
type Health   = Awaited<ReturnType<typeof import('@/lib/coach/health-state').loadHealthState>>;
type Training = Awaited<ReturnType<typeof import('@/lib/coach/training-state').loadTrainingState>>;
type Races    = Awaited<ReturnType<typeof import('@/lib/coach/races-state').loadRacesState>>;
type LogT     = Awaited<ReturnType<typeof import('@/lib/coach/log-state').loadLogState>>;
type Profile  = Awaited<ReturnType<typeof import('@/lib/coach/profile-state').loadProfileState>>;

/** Extract the headline pace (s/mi) from a workout_spec. Returns null
 *  for spec kinds where a single pace doesn't represent the workout
 *  (rest, race, shakeout). Used by adaptWeek + adaptSeason to populate
 *  the per-day pace cells with real Daniels-VDOT numbers (P0 #4) instead
 *  of canonical PACE_DEFAULT fallbacks.
 *
 *  Easy/long/recovery: midpoint of the pace band.
 *  Tempo: tempo_pace_s_per_mi.
 *  Threshold/intervals: rep_pace_s_per_mi (the work segment, not the cooldown).
 *  Progression/fartlek/MP: midpoint when defined.
 */
function paceFromSpec(spec: import('@/lib/faff/types').WorkoutSpec | null | undefined): number | null {
  if (!spec) return null;
  switch (spec.kind) {
    case 'easy':
    case 'long':
    case 'recovery':
      return Math.round((spec.pace_target_s_per_mi_lo + spec.pace_target_s_per_mi_hi) / 2);
    case 'tempo':
      return spec.tempo_pace_s_per_mi ?? null;
    case 'threshold':
    case 'intervals':
      return spec.rep_pace_s_per_mi ?? null;
    case 'progression':
      return spec.prog_start_s_per_mi != null && spec.prog_end_s_per_mi != null
        ? Math.round((spec.prog_start_s_per_mi + spec.prog_end_s_per_mi) / 2)
        : null;
    case 'fartlek':
      // Segments shape — return the median segment pace if any.
      return spec.segments?.length
        ? spec.segments[Math.floor(spec.segments.length / 2)].pace_s_per_mi
        : null;
    case 'mp':
      return spec.mp_pace_s_per_mi ?? null;
    default:
      return null;
  }
}

/* ─────────────────────────  Adapters  ───────────────────────── */

/**
 * Thin wrapper · resolves a cadence target for a workout EffortKey
 * using the backend's canonical prescription (lib/coach/cadence-target.ts).
 * Lazy import to avoid pulling the backend module into seed when not needed.
 */
function cadenceTargetForEffort(
  type: EffortKey,
  baseline: number | null,
): PlannedDay['cadenceTarget'] {
  // Inline the canonical ranges so the seed doesn't need a dynamic
  // import per row. Mirrors lib/coach/cadence-target.ts CANONICAL_RANGE.
  const CANONICAL: Record<string, { lo: number; hi: number; cue: string }> = {
    easy:        { lo: 165, hi: 175, cue: 'relaxed turnover' },
    recovery:    { lo: 162, hi: 172, cue: 'easy turnover' },
    long:        { lo: 168, hi: 178, cue: 'sustainable rhythm' },
    tempo:       { lo: 172, hi: 182, cue: 'drive turnover' },
    intervals:   { lo: 180, hi: 190, cue: 'crisp + quick' },
    rest:        { lo: 0,   hi: 0,   cue: 'rest day' },
  };
  const c = CANONICAL[type] ?? CANONICAL.easy;
  if (c.lo === 0 && c.hi === 0) return { low: 0, high: 0, copy: c.cue };
  let lo = c.lo, hi = c.hi;
  if (baseline != null && baseline > 130 && baseline < 220) {
    const shift = Math.round(baseline - 170);
    lo = Math.max(150, Math.min(200, lo + shift));
    hi = Math.max(155, Math.min(205, hi + shift));
  }
  return { low: lo, high: hi, copy: `${lo}-${hi} spm · ${c.cue}` };
}

function adaptWeek(glance: Glance | null, skipSet?: Set<string>, cadenceBaseline?: number | null): { week: PlannedDay[]; todayIdx: number; results: Record<number, CompletedRun | undefined> } {
  if (!glance || !glance.weekDays?.length) {
    return { week: FALLBACK_WEEK, todayIdx: 1, results: {} };
  }
  const DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  // Canonical pace defaults per effort type — only used when the plan
  // workout has NO workout_spec (migration 120) AND no paceTargetSPerMi.
  // After the P0 #4 backfill these should rarely fire for an active plan.
  const PACE_DEFAULT: Record<EffortKey, number | null> = {
    easy: 525, recovery: 570, long: 460, tempo: 398, intervals: 365, rest: null, race: null,
  };
  const week: PlannedDay[] = glance.weekDays.map((d): PlannedDay => {
    const eff = mapType(d.plannedType);
    const dist = d.plannedMi > 0 ? d.plannedMi.toFixed(1) : ' · ';
    const fullDate = new Date(d.date + 'T12:00:00Z');
    const fullLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(fullDate);
    // 2026-05-30: prefer real Daniels-VDOT pace from the workout_spec
    // (P0 #4 backfill). Fall through to legacy paceTargetSPerMi field
    // (used by some non-spec plans) then PACE_DEFAULT placeholder.
    // 2026-06-01: workout_spec is now atomically cleared on downgrade
    // by backend adapter (commit a54c7069). The defensive easyBucket
    // override that lived here is removed · spec is authoritative again.
    const specPace = paceFromSpec(d.plannedSpec);
    const paceSec = specPace
      ?? (d as { paceTargetSPerMi?: number | null }).paceTargetSPerMi
      ?? PACE_DEFAULT[eff];
    const paceStr = paceSec != null && paceSec > 0
      ? `${Math.floor(paceSec / 60)}:${String(Math.round(paceSec % 60)).padStart(2, '0')}`
      : (eff === 'rest' ? 'Rest' : '·');
    // Real estimated duration from pace × distance (was a flat 9 min/mi).
    const estMin = d.plannedMi > 0 && paceSec && paceSec > 0 ? Math.round(d.plannedMi * paceSec / 60) : null;
    const est = estMin != null
      ? (estMin >= 60 ? `~${Math.floor(estMin/60)}:${String(estMin%60).padStart(2,'0')}` : `~${estMin} min`)
      : (d.plannedMi > 0 ? `~${Math.round(d.plannedMi * 9)} min` : ' · ');
    // PlannedHeroV2 surfaces the spec's HR cap as the TARGETS · HEART RATE
    // value. Each spec shape stores it under hr_cap_bpm (easy/long/recovery)
    // or hr_target_bpm (tempo) or lthr_bpm (threshold/intervals).
    const hrCap = (() => {
      const s = d.plannedSpec as { hr_cap_bpm?: number | null; hr_target_bpm?: number | null; lthr_bpm?: number | null } | null;
      if (!s) return null;
      return s.hr_cap_bpm ?? s.hr_target_bpm ?? s.lthr_bpm ?? null;
    })();
    return {
      dw: DOW[(d.dow + 6) % 7],
      dn: fullDate.getUTCDate(),
      full: fullLabel,
      iso: d.date,
      type: eff,
      // 2026-06-01: name now mirrors adaptSeason (line 506) · the rich
      // plan_workouts.sub_label ("Cruise Intervals", "HM Threshold
      // Blocks", "Long Run · HM Finish") wins, falling back to the
      // short humanName tag only when the plan-builder didn't author
      // one. Previous "always-humanName" path discarded the rich label
      // and caused the week strip to render a Cruise Intervals day as
      // generic "Easy" while FULL PLAN rendered it correctly. The two
      // surfaces now read from one source. If the hero title wraps with
      // a longer name, fix it in CSS, not by destroying data.
      planWorkoutId: (d as { plannedId?: string | null }).plannedId ?? null,
      name: d.plannedLabel || humanName(eff, d.plannedMi),
      subLabel: d.plannedLabel ?? null,
      // 2026-06-02 · workout_spec passes through to PlannedDay so the
      // SESSION grid on PlannedHeroV2 / WorkoutDetail derives real
      // segments instead of reading the hardcoded SEGS prototype.
      workoutSpec: d.plannedSpec ?? null,
      adaptation: (d as { adaptation?: PlannedDay['adaptation'] }).adaptation ?? null,
      dist,
      pace: paceStr,
      est,
      // 2026-05-31: was `d.isPast && d.doneMi > 0`. That blocked today's
      // completed run from flipping to DONE until tomorrow · the watch
      // synced David's 12 mi long but Today still rendered PLANNED /
      // UPCOMING with a SKIP button. doneMi reflects every completed
      // run including today's, so the past-only guard was the bug.
      done: d.doneMi > 0,
      today: d.isToday,
      activityId: d.activityId,
      hrCap,
      skipped: skipSet ? skipSet.has(d.date) : false,
      // 2026-06-01 · backend cadence prescription. Lives on the day so
      // every workout chip can render a real number range (e.g.
      // "172-180 spm · drive turnover") instead of the previous
      // frontend-invented "relaxed" / "drive turnover" placeholders.
      // Personal-baseline-shifted when cadenceBaseline is known;
      // canonical otherwise.
      cadenceTarget: cadenceTargetForEffort(eff, cadenceBaseline ?? null),
    };
  });
  const todayIdx = Math.max(0, week.findIndex(w => w.today));

  const results: Record<number, CompletedRun | undefined> = {};
  glance.weekDays.forEach((d, i) => {
    if (d.doneMi <= 0) return;
    results[i] = {
      win: d.doneMi >= d.plannedMi * 0.95 ? 'Honest & on plan' : 'Done',
      winx: `${d.doneMi.toFixed(1)} of ${d.plannedMi.toFixed(1)} mi`,
      time: '·', apace: '·', hr: 0, peak: 0,
      zones: [0, 0, 0, 0, 0],
      weather: ' · ', shoe: ' · ', cal: 0, gain: 0,
      splits: [],
      recap: '',
    };
  });
  return { week, todayIdx, results };
}

/**
 * 2026-06-01 · enrich the placeholder `results` map with real per-run
 * data. Reads the runs whose activityIds match the completed days,
 * pulls weather + calories + elevation + shoe + time + pace + HR,
 * and overwrites the placeholders.
 *
 * Batches a single query for all completed days · O(1) round-trip.
 * Skips runs that don't resolve (deleted, network error, etc).
 *
 * Doctrine · Reality-anchored, not template-derived. The card shows
 * what actually happened, not "·" placeholders.
 */
/**
 * 2026-06-01 · web agent brief · enrich the week with live standing
 * recommendations. Re-evaluates today's readiness signals against
 * each planned quality workout, emits a recommendation envelope when
 * the engine would currently disagree with the active row.
 *
 * Best-effort · failures degrade to no recommendation rather than
 * blocking the page render. Lazy imports the composer + brief loader
 * to keep the seed module tree small.
 */
async function enrichWeekWithStandingRecommendations(
  userId: string,
  week: PlannedDay[],
): Promise<void> {
  // Pick the future quality workouts · these are the ones the engine
  // can recommend against. Past + non-quality days return null fast
  // inside the composer anyway, but skipping them upfront saves a
  // brief load when there's nothing to recommend.
  const today = await runnerToday(userId);
  const QUALITY = new Set(['intervals', 'tempo', 'threshold', 'long']);
  const candidates = week.filter((d) =>
    d.planWorkoutId && d.iso && d.iso >= today && QUALITY.has(d.type),
  );
  if (candidates.length === 0) return;

  // Load brief + composer lazily.
  const [{ loadReadinessBrief }, { loadCoachState }, { composeStandingRecommendation }] =
    await Promise.all([
      import('@/lib/coach/readiness-brief'),
      import('@/lib/coach/state-loader'),
      import('@/lib/coach/standing-recommendation'),
    ]);
  const state = await loadCoachState(userId).catch(() => null);
  if (!state) return;
  const brief = await loadReadinessBrief(userId, state).catch(() => null);
  if (!brief) return;

  // Compose per candidate · cap parallelism implicit (≤ 7 candidates
  // per week typically). Each compose is a single DB read so this
  // is cheap.
  await Promise.all(candidates.map(async (d) => {
    const rec = await composeStandingRecommendation({
      workoutId: d.planWorkoutId!,
      userUuid: userId,
      workout: {
        type: d.type,
        distance_mi: Number(d.dist) || 0,
        date_iso: d.iso!,
        is_quality: true,
      },
      brief,
    }).catch(() => null);
    if (rec) {
      // Mutate the week-day shape in place · matches the cadenceTarget
      // pattern used elsewhere.
      (d as { standingRecommendation?: typeof rec | null }).standingRecommendation = rec;
    }
  }));
}

async function enrichResultsWithRunData(
  userId: string,
  week: PlannedDay[],
  results: Record<number, CompletedRun | undefined>,
): Promise<void> {
  const completedIdx = Object.keys(results).map((k) => Number(k)).filter((i) => results[i]);
  if (completedIdx.length === 0) return;

  // Gather (iso, activityId) pairs from the week
  const targets: Array<{ idx: number; date: string; activityId: string | null }> = completedIdx.map((i) => ({
    idx: i,
    date: week[i]?.iso ?? '',
    activityId: week[i]?.activityId ?? null,
  })).filter((t) => t.date);

  if (targets.length === 0) return;

  const { pool } = await import('@/lib/db/pool');
  const dates = targets.map((t) => t.date);

  // Pull canonical (non-merged) runs for these dates · take the highest-
  // tier source per date. Includes weather field-merged from absorbed
  // siblings via JOIN trick (LATERAL aggregating weather over the
  // cluster).
  const r = await pool.query<{
    date: string;
    distance_mi: string | null;
    duration_sec: string | null;
    avg_hr: string | null;
    max_hr: string | null;
    avg_pace: string | null;
    elev_gain_ft: string | null;
    temp_f: string | null;
    weather: any;
    kcal: string | null;
    shoe_id: string | null;
  }>(
    `WITH canonical AS (
       SELECT DISTINCT ON ((data->>'date')::date) data, shoe_id
         FROM runs
        WHERE user_uuid = $1::uuid
          AND (data->>'date')::date = ANY($2::date[])
          AND NOT (data ? 'mergedIntoId')
        ORDER BY (data->>'date')::date,
                 CASE data->>'source'
                   WHEN 'watch' THEN 5
                   WHEN 'manual' THEN 4
                   WHEN 'apple_watch' THEN 3
                   WHEN 'apple_health' THEN 2
                   ELSE 1
                 END DESC,
                 (data->>'distanceMi')::numeric DESC
     ),
     absorbed_weather AS (
       SELECT (data->>'date')::date AS d, data->'weather' AS w
         FROM runs
        WHERE user_uuid = $1::uuid
          AND (data->>'date')::date = ANY($2::date[])
          AND data->'weather' IS NOT NULL
     )
     SELECT
       c.data->>'date'                 AS date,
       c.data->>'distanceMi'           AS distance_mi,
       c.data->>'durationSec'          AS duration_sec,
       c.data->>'avgHr'                AS avg_hr,
       c.data->>'maxHr'                AS max_hr,
       c.data->>'avgPaceMinPerMi'      AS avg_pace,
       c.data->>'elevGainFt'           AS elev_gain_ft,
       c.data->>'tempF'                AS temp_f,
       COALESCE(c.data->'weather', (SELECT w FROM absorbed_weather aw WHERE aw.d = (c.data->>'date')::date LIMIT 1)) AS weather,
       COALESCE(c.data->>'calories', c.data->>'kcal') AS kcal,
       c.shoe_id::text AS shoe_id
       FROM canonical c`,
    [userId, dates],
  ).catch(() => ({ rows: [] }));

  // Index by date
  const byDate = new Map<string, typeof r.rows[number]>();
  for (const row of r.rows) byDate.set(row.date, row);

  // Load shoe names in one shot
  const shoeIds = Array.from(new Set(r.rows.map((x) => x.shoe_id).filter(Boolean)));
  const shoeNames = new Map<string, string>();
  if (shoeIds.length) {
    const sr = await pool.query<{ id: string; brand: string | null; model: string | null }>(
      `SELECT id::text, brand, model FROM shoes WHERE id = ANY($1::bigint[])`,
      [shoeIds.map((s) => Number(s))],
    ).catch(() => ({ rows: [] }));
    for (const s of sr.rows) shoeNames.set(s.id, [s.brand, s.model].filter(Boolean).join(' ') || 'Shoe');
  }

  // Weight for calorie estimator fallback (when neither Strava nor HK
  // populated kcal · we estimate from distance × weight × hr).
  let weightKg: number | null = null;
  try {
    const w = await pool.query<{ value: string }>(
      `SELECT value::text FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'body_mass'
        ORDER BY sample_date DESC LIMIT 1`,
      [userId],
    );
    weightKg = w.rows[0]?.value ? Number(w.rows[0].value) : null;
  } catch {/* leave null */}

  for (const t of targets) {
    const row = byDate.get(t.date);
    if (!row) continue;
    const result = results[t.idx];
    if (!result) continue;

    const durationSec = Number(row.duration_sec ?? 0);
    const distMi = Number(row.distance_mi ?? 0);
    const avgHr = Number(row.avg_hr ?? 0);
    const maxHr = Number(row.max_hr ?? 0);
    const elev = Number(row.elev_gain_ft ?? 0);
    const tempF = row.temp_f ?? row.weather?.temp_f ?? null;
    const weatherCond = row.weather?.conditions ?? null;

    // Format time as M:SS or H:MM:SS
    const fmtTime = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    };

    // Resolve calories · prefer captured kcal, fall back to estimator
    let kcal = Number(row.kcal ?? 0);
    if ((!Number.isFinite(kcal) || kcal <= 0) && weightKg && distMi > 0) {
      const hrMult = avgHr > 130 ? 1 + Math.min(0.20, (avgHr - 130) / 200) : 1.0;
      kcal = Math.round(distMi * weightKg * 1.04 * hrMult);
    }

    const weatherStr = (() => {
      if (tempF != null) {
        const t = Math.round(Number(tempF));
        return weatherCond ? `${t}°F · ${weatherCond}` : `${t}°F`;
      }
      return ' · ';
    })();

    const shoeStr = row.shoe_id && shoeNames.has(row.shoe_id)
      ? shoeNames.get(row.shoe_id)!
      : ' · ';

    results[t.idx] = {
      ...result,
      time: durationSec > 0 ? fmtTime(durationSec) : '·',
      apace: row.avg_pace || '·',
      hr: avgHr || 0,
      peak: maxHr || 0,
      weather: weatherStr,
      shoe: shoeStr,
      cal: kcal > 0 ? Math.round(kcal) : 0,
      gain: elev > 0 ? Math.round(elev) : 0,
    };
  }
}

function adaptReadiness(glance: Glance | null, health: Health | null): Readiness {
  const r = glance?.readiness;
  if (!r) {
    return {
      score: 70, band: 'unknown', label: 'STEADY', baseline: 70,
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
  // 2026-05-30: subjective was removed from the readiness formula entirely
  // (see lib/coach/readiness.ts). Score now reflects only objective HealthKit
  // signals + load. Subjective check-ins feed the coach voice directly rather
  // than skewing the number.
  // 2026-06-03 · keep the SIGNED weight in `pts`. Previously this used
  // Math.abs(i.weight) which stripped the sign · DriverRowEl decides
  // color and direction from pts > 0 / < 0, so abs-weighted pts meant
  // every driver rendered green (+N). David's Health page showed SLEEP
  // +11 GREEN while the Readiness drawer showed SLEEP -11 RED for the
  // same pillar weight. dir is also a derived hint but the renderer
  // doesn't read it — pts carries the sign.
  const drivers = (r.inputs || []).map(i => {
    const dir: 'pos' | 'neg' = i.weight >= 0 ? 'pos' : 'neg';
    const pct = Math.min(100, Math.abs(i.weight) * 5);
    return { name: (i.label.split(' ·')[0] || i.key).toUpperCase(), why: `${i.observedV} · ${i.observedSub}`.trim(), pct, pts: i.weight, dir };
  });
  return {
    score: r.score ?? 0, band: r.band ?? 'unknown', label, baseline,
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
  // 2026-06-03 · use the CURRENT PHASE's own start/end span instead of
  // the plan's total weeks count. Old format "QUALITY phase · wk 1 / 11"
  // implied QUALITY spans 11 weeks · misleading when 11 was actually
  // total-weeks-to-race. Now reads "QUALITY phase · wk 1 / 6" where the
  // 6 is the phase's actual length (BUILD ≈ 6, PEAK ≈ 3, TAPER ≈ 1, etc).
  const currentPhaseSpan = training?.phases?.find((p) =>
    training.currentWeekIdx != null &&
    training.currentWeekIdx >= p.startWeekIdx &&
    training.currentWeekIdx <= p.endWeekIdx
  );
  const weekInPhase = currentPhaseSpan && training?.currentWeekIdx != null
    ? training.currentWeekIdx - currentPhaseSpan.startWeekIdx + 1
    : null;
  const phaseLength = currentPhaseSpan
    ? currentPhaseSpan.endWeekIdx - currentPhaseSpan.startWeekIdx + 1
    : null;
  // 2026-06-03 · drop "wk X / Y" suffix per David's week-labels-out
  // directive. The phase name alone is the load message · the calendar
  // tile + race-day countdown carry the "how far" framing without the
  // count-the-weeks feel that early-block week labels create.
  const phaseLabel = training?.currentPhase
    ? `${training.currentPhase} phase`
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
      distanceMi: aRace.distance_mi ?? null,
    };
  }
  if (glance?.nextARaceName && glance.daysToARace != null) {
    return {
      slug: 'a-race', name: glance.nextARaceName, date: '',
      daysAway: Math.max(0, glance.daysToARace),
      goal: '·', projected: '·', onTrack: true, delta: 'on track',
      phaseLabel: glance.phaseLabel || '·', goalPct: 50,
      location: null,
      distanceMi: null,
    };
  }
  return null;
}

function adaptVolumeBars(log: LogT | null, training: Training | null, today: string, longRunDay: Parameters<typeof weekWindowFor>[0]): { bars: VolumeBar[]; thisWeek: number; avg: number } {
  // Prefer real Strava-driven weeks (log-state) for trailing-8 volume —
  // they reflect ACTUAL run mileage and span back well before the active
  // plan started. Fall back to training weeks (plan_workouts.distance_mi
  // + done miles) when there is no Strava history.
  // 2026-06-08 · anchor the 8-week window on the RUNNER's local "today"
  // (runnerToday), not `new Date()` in server-UTC. The server runs in UTC,
  // so the old anchor rolled the current week forward at 17:00 Pacific on
  // Sundays — a Sun-evening long run fell into next week's (empty) bar,
  // showing ~0 while the real week read a day stale. Noon-UTC anchoring
  // keeps toISOString().slice(0,10) stable through the date math and lines
  // up with log-state's mondayOf() keys. Affects all non-UTC runners.
  // #9/#39 (audit 2026-06-16) · anchor the 8-week window on the runner's
  // long_run_day boundary (the training week ENDS on the long-run day) via the
  // shared weekWindowFor helper — the SAME key log-state emits in
  // log.weeks[].monday. The old hardcoded-Monday anchor matched only
  // Sunday-long runners (Mon-Sun coincide); a Saturday-long runner's Monday
  // keys missed log-state's Sun-start keys, so every volume bar read 0.
  const curStartMs = new Date(weekWindowFor(longRunDay, today).startISO + 'T12:00:00Z').getTime();

  // Build 8 contiguous week buckets ending on the current week. The `monday`
  // field name is kept for back-compat; it now holds the long_run_day
  // week-start (= Monday for a Sunday-long runner like David).
  const weeks: { monday: Date; mi: number; isCurrent: boolean }[] = [];
  for (let i = 7; i >= 0; i--) {
    const m = new Date(curStartMs - i * 7 * 86400000);
    weeks.push({ monday: m, mi: 0, isCurrent: i === 0 });
  }

  // #41 · keep 1 decimal everywhere (was Math.round → whole miles), matching
  // /log + the iPhone strip + the rest of the app's mileage convention.
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (log?.weeks?.length) {
    // log-state's weeks have a `monday` field — index by ISO date for fast lookup.
    const byMon: Record<string, number> = {};
    for (const w of log.weeks) byMon[w.monday] = (byMon[w.monday] ?? 0) + (w.totalMi || 0);
    for (const w of weeks) {
      const iso = w.monday.toISOString().slice(0, 10);
      w.mi = round1(byMon[iso] ?? 0);
    }
  } else if (training?.weeks?.length) {
    const byMon: Record<string, number> = {};
    for (const tw of training.weeks) {
      const totalDone = (tw.days ?? []).reduce((s, d) => s + (d.doneMi || 0), 0);
      byMon[tw.startDate] = round1(totalDone || tw.plannedMi || 0);
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
  // #42 · TRUE trailing-weeks average — divide by the FULL count of prior weeks
  // in the window, not just the non-zero ones. The old `.filter(b => b.mi > 0)`
  // dropped zero-mileage (off / down) weeks from the denominator, inflating the
  // "8-wk avg" above the runner's real recent average. A skipped week is real
  // training load (zero), so it belongs in the mean.
  // #41 · 1 decimal, matching the bars + the rest of the app.
  const prior = bars.slice(0, -1);
  const avg = prior.length
    ? Math.round((prior.reduce((s, b) => s + b.mi, 0) / prior.length) * 10) / 10
    : 0;
  return { bars, thisWeek, avg };
}

function adaptSeason(training: Training | null, adapts: Awaited<ReturnType<typeof loadPlanAdapts>>['value'], raceDistanceMi: number | null = null) {
  if (!training?.weeks?.length) return { nowIdx: 0, raceIdx: 0, miles: [0], maxMi: 1, phases: [], weekDays: [], adaptations: [], horizonRaise: null };
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
  // 2026-06-01 · adaptation dedup precompute. For every workoutId that
  // has a `plan_adapt_overridden` row, find the ts of the most recent
  // override. Any earlier adaptation on the same workoutId is marked
  // supersededByOverride. Web agent brief Option B · the field on the
  // wire, frontend filters as needed.
  const lastOverrideTs = new Map<string, number>();
  for (const a of adapts) {
    if (a.kind !== 'overridden') continue;
    const tms = Date.parse(a.ts);
    if (!Number.isFinite(tms)) continue;
    const cur = lastOverrideTs.get(a.workoutId) ?? 0;
    if (tms > cur) lastOverrideTs.set(a.workoutId, tms);
  }
  // 2026-06-01 · trainingInfluence pre-pass per workoutId. Count
  // consecutive same-type completed quality workouts ENDING at each
  // done row · feeds the consistent kind. Walk all done quality rows
  // in chronological order, build a streak map.
  const sameTypeStreakById = new Map<string, number>();
  {
    const QUALITY = new Set(['intervals', 'tempo', 'threshold', 'long']);
    type Doneish = { id?: string; date?: string; type: string; activityId?: string };
    const allDone: Doneish[] = [];
    for (const w of training.weeks) for (const d of (w.days ?? [])) {
      const t = mapType(d.type);
      if (QUALITY.has(t) && d.activityId) {
        allDone.push({ id: (d as { id?: string }).id, date: d.date, type: t, activityId: d.activityId });
      }
    }
    allDone.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    let streak = 0; let lastType = '';
    for (const row of allDone) {
      streak = (row.type === lastType) ? streak + 1 : 1;
      lastType = row.type;
      if (row.id) sameTypeStreakById.set(row.id, streak);
    }
  }

  const weekDays = training.weeks.map(w => (w.days ?? []).map(d => {
    const t = mapType(d.type);
    // 2026-05-30: prefer real Daniels-VDOT pace from workout_spec (P0 #4
    // backfill) for the per-day pace cell. PACE_DEFAULT is only the fallback
    // for plan-builder rows that authored without a VDOT.
    // 2026-06-01: workout_spec atomically cleared on downgrade by
    // backend (commit a54c7069). Defensive easyBucket override removed.
    const specPace = paceFromSpec((d as { spec?: import('@/lib/faff/types').WorkoutSpec | null }).spec);
    const anyD = d as unknown as {
      id?: string; donePaceSec?: number | null; doneAvgHr?: number | null;
      doneSplits?: Array<{ paceSec: number | null; hr: number | null }>;
    };
    return {
      id: anyD.id,
      // ISO date_iso threaded through so the FULL PLAN MonthCalendar
      // can anchor each workout to its real calendar slot. Without
      // this every cell rendered empty.
      date: d.date,
      dow: DOW[(d.dow + 6) % 7],
      type: t as import('./constants').EffortKey,
      name: d.label || humanName(t, d.mi),
      mi: d.mi || 0,
      paceSec: specPace ?? PACE_DEFAULT[t] ?? null,
      doneMi: d.doneMi || 0,
      done: !!d.activityId,
      activityId: d.activityId,
      donePaceSec: anyD.donePaceSec ?? null,
      doneAvgHr: anyD.doneAvgHr ?? null,
      doneSplits: anyD.doneSplits ?? [],
      // 2026-06-01 · per-day adapter provenance from training-state
      // LATERAL join. Backend adaptation-info loader stamps this on
      // each plan_workouts row. Null on as-authored rows; populated
      // when the auto-adapter mutated the row.
      adaptation: (d as { adaptation?: import('@/lib/coach/adaptation-info').AdaptationInfo | null }).adaptation ?? null,
      // 2026-06-01 · trainingInfluence per done quality workout.
      // Trajectory signal · "did this workout move my fitness toward
      // the race?" · NOT execution mechanics. Null on undone or
      // non-quality days. Composer reads pace deltas + HR-on-pace +
      // same-type streak + adapter state to pick a kind.
      trainingInfluence: composeTrainingInfluenceForDay(d, t, lastOverrideTs, sameTypeStreakById, raceDistanceMi),
      // 2026-06-07 · pass workout_spec through so the FULL PLAN day-detail
      // panel can render the real segment breakdown (BASE/FINISH for D1
      // long runs, WARMUP/TEMPO/COOLDOWN for tempo, REPS for intervals).
      // Without this every calendar day-detail showed "See full plan for
      // session detail." because spec was null on every season weekDay entry.
      workoutSpec: (d as { spec?: import('@/lib/faff/types').WorkoutSpec | null }).spec ?? null,
    };
  }));
  // Real plan_phases rows so TrainView can render the actual phase shape
  // (e.g. 13-week HM plan = BASE + BUILD only) instead of being forced
  // into the 4-phase BASE/BUILD/PEAK/TAPER hardcode meant for marathons.
  const phases = (training.phases ?? []).map((p) => ({
    label: p.label,
    startWeekIdx: p.startWeekIdx,
    endWeekIdx: p.endWeekIdx,
  }));
  // Resolve each adaptation to its weekIdx by date_iso → matching weekDays
  // entry. coach_intents rows carry the affected workout_id + date; we
  // walk the week list to find which weekIdx that date belongs to.
  const adaptations = adapts.map((a) => {
    let weekIdx = -1;
    for (let i = 0; i < weekDays.length; i++) {
      // weekDays[i] doesn't carry the iso date — use training.weeks[i].days[*].date
      const dayInWeek = training!.weeks[i]?.days.find((d) => d.date === a.dateIso);
      if (dayInWeek) { weekIdx = i; break; }
    }
    const allowed = ['reschedule', 'downgrade', 'shave', 'mark_dirty', 'overridden'];
    const kind = (allowed.includes(a.kind) ? a.kind : 'other') as 'reschedule' | 'downgrade' | 'shave' | 'mark_dirty' | 'overridden' | 'other';
    // 2026-06-01 · supersededByOverride · web agent brief Option B.
    // True when there's a later `plan_adapt_overridden` row for the
    // same workoutId · "most-recent intent wins per workoutId" so the
    // frontend can filter stale "Adapted: ..." lines from rows the
    // runner has since restored.
    const overrideTs = lastOverrideTs.get(a.workoutId);
    const myTs = Date.parse(a.ts);
    const supersededByOverride = a.kind !== 'overridden'
      && overrideTs != null
      && Number.isFinite(myTs)
      && overrideTs > myTs;
    return {
      workoutId: a.workoutId,
      weekIdx,
      kind,
      newType: a.newType,
      newDate: a.newDate,
      shaveFraction: a.shaveFraction,
      why: a.why,
      ts: a.ts,
      supersededByOverride,
    };
  }).filter((a) => a.weekIdx >= 0);

  return {
    nowIdx, raceIdx, miles, maxMi: Math.max(1, ...miles) + 5, phases, weekDays, adaptations,
    // 2026-06-03 · Rule 11 (horizon-aware planning) · drives the
    // "LONG-RUN CAP · 22mi · setting up CIM" chip on TrainView.
    horizonRaise: training?.horizonRaise ?? null,
  };
}

function adaptHealth(
  health: Health | null,
  form: Form | null,
  hrvCv?: {
    pct: number;
    band: 'stable' | 'watch' | 'destabilizing';
    swcMs: number | null;
    series: { date: string; pct: number }[];
  } | null,
  biologicalSex?: 'female' | 'male' | 'not_specified',
): HealthSnapshot {
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

  // 2026-06-03 · targetKind parameter tags what the `target` field
  // represents · baseline (runner's own rolling 30d), target (research
  // universal), or avg7 (runner's 7-day average). Defaults to undefined
  // (renderer falls back to "target" prefix). Tile caption renders the
  // honest label so the runner knows what they're comparing against.
  const mk = (
    k: string,
    label: string,
    unit: string,
    cur: number,
    target: number | undefined,
    dom: [number, number],
    s: number[],
    status: 'good' | 'warn' | 'neutral',
    decimals = 0,
    clock = false,
    noData = false,
    targetKind?: 'baseline' | 'target' | 'avg7',
  ): HealthMetric => ({
    k, label, unit, current: cur, target, dom, series: s, status, decimals, clock,
    ...(noData ? { noData: true } : {}),
    ...(targetKind ? { targetKind } : {}),
  });

  // 2026-06-03 · honest empty-state · when the runner skipped wearing
  // the watch (sleep) or hasn't connected the data source (HRV / RHR /
  // weight / vo2 / cadence), surface that as `noData: true` rather than
  // a misleading "0" reading. Tiles render an em-dash instead of 0h /
  // 0ms / 0bpm. `current` stays 0 for shape stability · consumers should
  // gate display on noData, not the number.
  //
  // 2026-06-05 · multi-tenant audit Pattern 1 · the original `noData`
  // gates were missing for half the Quick-Win tiles · WRIST TEMP, RESP
  // RATE, SPO₂, BODY FAT, LEAN MASS, MAX HR all hardcoded `noData=false`,
  // so an unconnected-source runner saw "0 %" / "0 bpm" / "0 °C" with
  // a green status chip. Added the has-checks below and threaded
  // `!hasX` into each tile's noData arg. SpO₂'s `>=96 ? good` check
  // also flips to `'neutral'` when the source isn't there · was
  // claiming "good" on a fake zero.
  const hasHrv = health?.hrv.current != null;
  const hasRhr = health?.rhr.current != null;
  const hasSleep = health?.sleep.avg7n != null;
  const hasWeight = health?.weight.current != null;
  const hasVo2 = health?.vo2.current != null;
  const hasCadence = health?.cadence.baseline != null;
  const hasWristTemp = health?.wristTemp?.current != null;
  const hasRespRate = health?.respiratoryRate?.current != null;
  const hasSpo2 = health?.spo2?.current != null;
  const hasBodyFat = health?.bodyFat?.current != null;
  const hasLeanMass = health?.leanMass?.current != null;
  const hasMaxHr = health?.maxHr?.current != null && (health!.maxHr.current as number) > 0;
  const hasActiveEnergyToday = (health?.activeEnergy?.today ?? 0) > 0;
  const hasActiveEnergyAvg7 = (health?.activeEnergy?.avg7 ?? 0) > 0;
  const hrvCurrent = health?.hrv.current ?? 0;
  const rhrCurrent = health?.rhr.current ?? 0;
  // 2026-06-05 · SLEEP body tile now shows LAST NIGHT (matches RHR/HRV
  // which both show latest single value) · was: 7d avg (`avg7n`),
  // which made the headline number disagree with what the runner
  // saw in Apple Health for last night. David's QC: HK shows 7:55,
  // Faff Web shows 6:06 (= 7d avg). The 7d avg is still meaningful
  // context · surfaced via the dashed reference line in the chart.
  // sleepSeries.at(-1) is the most recent night with a non-zero
  // sleep_hours sample (filtered upstream).
  const sleepSeriesArr = health?.sleepSeries ?? [];
  const lastNightSleep = sleepSeriesArr.length > 0
    ? sleepSeriesArr[sleepSeriesArr.length - 1].hours
    : (health?.sleep.avg7n ?? 0);
  const sleepAvg = lastNightSleep;
  const weightCurrent = health?.weight.current ?? 0;
  const vo2Current = health?.vo2.current ?? 0;
  const cadenceCurrent = health?.cadence.baseline ?? 0;

  // 2026-06-01 · Quick Win signals from health-state.
  const wristTempCurrent = health?.wristTemp.current ?? 0;
  const wristTempBaseline = health?.wristTemp.baseline ?? undefined;
  const wristTempDelta = health?.wristTemp.deltaC ?? null;
  const rrCurrent = health?.respiratoryRate.current ?? 0;
  const rrBaseline = health?.respiratoryRate.baseline ?? undefined;
  const rrDelta = health?.respiratoryRate.delta ?? null;
  const spo2Current = health?.spo2.current ?? 0;
  const spo2Baseline = health?.spo2.baseline ?? undefined;
  const bfCurrent = health?.bodyFat.current ?? 0;
  const lmCurrent = health?.leanMass.current ?? 0;
  // Convert lean mass kg → lb to match the weight tile unit convention.
  const lmCurrentLb = lmCurrent ? +(lmCurrent * 2.20462).toFixed(1) : 0;
  const wristTempSeries = (health?.wristTempSeries ?? []).map((d) => d.tempC).filter((v) => Number.isFinite(v));
  const respiratoryRateSeries = (health?.respiratoryRateSeries ?? []).map((d) => d.bpm).filter((v) => Number.isFinite(v));
  const spo2SeriesArr = (health?.spo2Series ?? []).map((d) => d.pct).filter((v) => Number.isFinite(v));
  const bodyFatSeriesArr = (health?.bodyFatSeries ?? []).map((d) => d.pct).filter((v) => Number.isFinite(v));
  const leanMassSeriesLb = (health?.leanMassSeries ?? []).map((d) => +(d.kg * 2.20462).toFixed(1)).filter((v) => Number.isFinite(v));

  const body: HealthMetric[] = [
    mk('hrv',    'HRV',        'ms',  hrvCurrent,    health?.hrv.baseline ?? undefined,
       [Math.max(20, (hrvCurrent || 60) - 30), (hrvCurrent || 60) + 30],
       hrvSeries,
       !hasHrv ? 'neutral' : hrvCurrent >= (health?.hrv.baseline ?? hrvCurrent) ? 'good' : 'warn',
       0, false, !hasHrv, 'baseline'),
    mk('rhr',    'RESTING HR', 'bpm', rhrCurrent,    health?.rhr.baseline ?? undefined,
       [Math.max(35, (rhrCurrent || 50) - 10), (rhrCurrent || 50) + 10],
       rhrSeries,
       !hasRhr ? 'neutral' : rhrCurrent <= (health?.rhr.baseline ?? rhrCurrent) ? 'good' : 'warn',
       0, false, !hasRhr, 'baseline'),
    mk('sleep',  'SLEEP',      'h',   sleepAvg,      7.5,
       [4, 10], sleepSeries,
       !hasSleep ? 'neutral' : sleepAvg >= 7 ? 'good' : 'warn',
       1, true, !hasSleep, 'target'),
    mk('weight', 'WEIGHT',     'lb',  weightCurrent, undefined,
       [Math.max(120, (weightCurrent || 180) - 10), (weightCurrent || 180) + 10],
       weightSeries, 'good', 1, false, !hasWeight),
    // P2 #11 (2026-05-30): real VO2 trend over 6 months. health-state ships
    // vo2Series as the sparse Apple Health readings. We sort + clamp into
    // a 30-point chart (downsample if 30+ points, pad-with-last if fewer).
    mk('vo2',    'VO₂ APPLE',  '',    vo2Current,    undefined,
       [Math.max(30, (vo2Current || 50) - 8), (vo2Current || 50) + 6],
       packVo2Series(health?.vo2Series ?? [], vo2Current),
       'good', 1, false, !hasVo2),
    // 2026-06-01 · Health page Quick Wins · 5 new tiles.
    // Wrist temp · Apple Watch nightly skin temp. Doctrine: rises before
    // HRV drops on early illness/overtraining (Research/00b).
    // 2026-06-05 · noData gate on !hasWristTemp · prevents "0 °C" with
    // a green chip when the source isn't tracked.
    mk('wrist_temp', 'WRIST TEMP', '°C', wristTempCurrent, wristTempBaseline,
       [Math.max(34, (wristTempCurrent || 36) - 1), (wristTempCurrent || 36) + 1],
       wristTempSeries,
       !hasWristTemp ? 'neutral'
         : wristTempDelta != null && wristTempDelta >= 0.4 ? 'warn'
         : wristTempDelta != null && wristTempDelta <= -0.4 ? 'warn'
         : 'good', 2, false, !hasWristTemp, 'baseline'),
    // Respiratory rate · 24-48h early-illness signal per Research/15.
    mk('resp_rate', 'RESP RATE', '/min', rrCurrent, rrBaseline,
       [Math.max(10, (rrCurrent || 16) - 4), (rrCurrent || 16) + 4],
       respiratoryRateSeries,
       !hasRespRate ? 'neutral'
         : rrDelta != null && rrDelta >= 2 ? 'warn' : 'good',
       1, false, !hasRespRate, 'baseline'),
    // SpO2 · quiet at sea-level, flags at altitude / when sick.
    // 2026-06-05 · noData gate · was claiming `good` on a fake 0%.
    mk('spo2', 'SPO₂', '%', spo2Current, spo2Baseline,
       [90, 100], spo2SeriesArr,
       !hasSpo2 ? 'neutral'
         : spo2Current >= 96 ? 'good' : 'warn',
       0, false, !hasSpo2, 'baseline'),
    // Body fat % · trend signal for body composition.
    mk('body_fat', 'BODY FAT', '%', bfCurrent, undefined,
       [Math.max(5, (bfCurrent || 15) - 5), (bfCurrent || 15) + 5],
       bodyFatSeriesArr, !hasBodyFat ? 'neutral' : 'good', 1, false, !hasBodyFat),
    // Lean mass · maintaining lean mass through build = strength outcome.
    mk('lean_mass', 'LEAN MASS', 'lb', lmCurrentLb, undefined,
       [Math.max(100, (lmCurrentLb || 150) - 10), (lmCurrentLb || 150) + 10],
       leanMassSeriesLb, !hasLeanMass ? 'neutral' : 'good', 1, false, !hasLeanMass),
  ];
  // 2026-06-01 · HRV CV (Plews coefficient of variation %). Surfaced
  // when readinessBrief carries it · early-overreach signal that fires
  // 24-72h before HRV ms itself drops per Research/15. Append as a body
  // tile so the Health page can render alongside HRV/RHR.
  if (hrvCv?.pct != null) {
    const cvStatus: 'good' | 'warn' = hrvCv.band === 'destabilizing' ? 'warn' : 'good';
    // 2026-06-01 · pass the 14d CV series for the trend strip · empty
    // until 14d of HRV history exists, in which case the tile renders
    // bare current-vs-band.
    const cvSeriesPct = (hrvCv.series ?? []).map((p) => p.pct);
    // 2026-06-16 · #20 · axis widened [0,10] → [0,20]. CV is now RMSSDcv
    // on raw RMSSD (Research/03 §CV): recreational-normal is 8–12% and
    // the NFOR band is >14%, so real values exceed the old single-digit
    // axis built for the (never-firing) rolling-LnRMSSD CV.
    body.push(mk('hrv_cv', 'HRV CV', '%', hrvCv.pct, undefined, [0, 20], cvSeriesPct, cvStatus, 1));
  }
  // 2026-06-01 · Max HR tile · 30-day true max (informs zone math + HRR).
  // Health-state computes MAX over 30d so a single low-effort walk doesn't
  // pull the ceiling down. No series · just the ceiling.
  const maxHrCurrent = health?.maxHr.current ?? 0;
  if (maxHrCurrent > 0) {
    body.push(mk('max_hr', 'MAX HR', 'bpm', maxHrCurrent, undefined,
      [Math.max(150, maxHrCurrent - 30), maxHrCurrent + 10], [], 'good'));
  }
  // 2026-06-01 · Active energy from iPhone 031fe5fd · daily kcal total.
  // Bumps to ~180 buckets/run once TF updates · same query works either
  // way (SUM by day). Targets vary wildly per runner so no fixed target.
  //
  // 2026-06-03 · partial-day sync handling. The iPhone writes active-
  // energy samples throughout the day so early-morning reads (or runners
  // whose Health sync was delayed) saw values like "4 kcal" before the
  // rest of the day landed. That number is technically honest but reads
  // as broken. Fix: when today's total is implausibly low for an active
  // day (< 100 kcal AND we have a real avg7 to compare to), show the 7-
  // day average instead with a "syncing" cue rather than the partial
  // total. The runner sees their typical day until the rest catches up.
  const aeToday = health?.activeEnergy?.today ?? 0;
  const aeAvg7 = health?.activeEnergy?.avg7 ?? 0;
  if (aeToday > 0 || aeAvg7 > 0) {
    const aeSeriesKcal = (health?.activeEnergy?.series ?? []).map((p) => p.kcal);
    // 2026-06-03 · ingest-noise floor. When BOTH today < 100 kcal AND
    // avg7 < 100 kcal, the iPhone HK active_energy ingest is broken at
    // the source · samples landing are noise, not the runner's real
    // day. Tile renders noData ("—") rather than a confusing "4 kcal ·
    // 7d avg 3". Investigated separately as part of the HealthKit
    // ingest investigation queue.
    const aeIngestBroken = aeToday < 100 && aeAvg7 < 100;
    // Partial-day floor: 100 kcal is below even sedentary BMR contribution
    // by mid-morning. If we see 4-90 kcal AND have a real avg7 (≥ 500),
    // assume sync still landing and surface avg7 with `warn` so the chip
    // flags syncing rather than misreading the runner's day.
    const partialDayLikely = aeToday > 0 && aeToday < 100 && aeAvg7 >= 500;
    const displayValue = partialDayLikely
      ? aeAvg7
      : (aeToday || aeAvg7);
    const aeStatus: 'good' | 'warn' = partialDayLikely
      ? 'warn'
      : (aeAvg7 > 0 && aeToday >= aeAvg7 * 0.5 ? 'good' : 'warn');
    body.push(mk('active_energy', 'ACTIVE ENERGY', 'kcal', displayValue, aeAvg7 || undefined,
      [0, Math.max(2500, aeAvg7 + 500)], aeSeriesKcal, aeStatus, 0, false, aeIngestBroken, 'avg7'));
  }
  // 2026-06-01 · Cycle phase from iPhone 0fa7d55a · gender-gated.
  // Only render for biologicalSex === 'female' AND data exists (runner
  // has opted in + cycle has synced). Caller threads biologicalSex.
  // Phase labels are uppercased per the ALL-CAPS labels rule.
  const cpDay = health?.cyclePhase?.dayOfCycle ?? null;
  const cpLabel = health?.cyclePhase?.phaseLabel ?? null;
  if (biologicalSex === 'female' && cpDay != null) {
    // Suggestion field re-uses the `unit` slot so the design agent
    // gets the phase label inline. e.g. "DAY 14 · OVULATORY".
    const phaseUpper = (cpLabel ?? '').toUpperCase();
    body.push(mk('cycle_phase', 'CYCLE', phaseUpper, cpDay, undefined,
      [1, 35], [], 'neutral', 0));
    // Note: design agent uses `current` for the day-of-cycle and `unit`
    // for the phase label · this is a small abuse of the shape, but it
    // means the existing tile renderer can paint the cycle tile without
    // a new shape. Phase color → design agent's call.
  }
  // 2026-06-01 · Sleep stages from iPhone b58abfc3 · deep / REM / light /
  // awake minutes (7-night avg). Carriers ship even before iPhone data
  // lands in the runner's account · they read as "no data" until then.
  // Targets per Research/00b: deep 60-90 min (younger), REM 90-120 min,
  // awake < 30 min ideal. Light is the residual · no fixed target.
  const stages = health?.sleepStages;
  if (stages) {
    const deepSeriesMin = (stages.deepSeries ?? []).map((d) => d.min);
    const remSeriesMin  = (stages.remSeries  ?? []).map((d) => d.min);
    if (stages.deepMin != null) {
      body.push(mk('sleep_deep', 'DEEP SLEEP', 'min', stages.deepMin, 75,
        [0, 120], deepSeriesMin,
        stages.deepMin >= 60 ? 'good' : 'warn',
        0, false, false, 'target'));
    }
    if (stages.remMin != null) {
      body.push(mk('sleep_rem', 'REM SLEEP', 'min', stages.remMin, 100,
        [0, 150], remSeriesMin,
        stages.remMin >= 80 ? 'good' : 'warn',
        0, false, false, 'target'));
    }
    if (stages.lightMin != null) {
      body.push(mk('sleep_light', 'LIGHT SLEEP', 'min', stages.lightMin, undefined,
        [0, 400], [], 'neutral'));
    }
    if (stages.awakeMin != null) {
      body.push(mk('sleep_awake', 'AWAKE', 'min', stages.awakeMin, undefined,
        [0, 60], [],
        stages.awakeMin <= 30 ? 'good' : 'warn'));
    }
  }
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
  const vratioForm  = formSeries('vertical_ratio');
  const powerForm   = formSeries('run_power');
  const cadCurrent  = cadenceForm.last || cadenceCurrent;
  // 2026-06-03 · honest empty-state for FORM tiles. Each form metric is
  // only present in health_samples when the watch model + sensor combo
  // emits it (older Apple Watches don't surface GCT/vertical oscillation
  // /run power; only AW Ultra/Series 9+ + Stryd reliably do). When
  // formSeries returns `last: 0` we mark the tile noData=true rather
  // than rendering a literal 0 cm / 0 ms / 0 W — those zeros looked
  // like measurements but meant "source not present."
  const cadenceMissing = !cadenceForm.last && !cadenceCurrent;
  const gctMissing     = !gctForm.last;
  const voscMissing    = !voscForm.last;
  const strideMissing  = !strideForm.last;
  const vratioMissing  = !vratioForm.last;
  const powerMissing   = !powerForm.last;
  const form_: HealthMetric[] = [
    mk('cadence', 'CADENCE',        'spm', cadCurrent, 170,
       [Math.max(140, (cadCurrent || 170) - 20), (cadCurrent || 170) + 15],
       cadenceForm.series.length ? cadenceForm.series : (cadCurrent > 0 ? Array(30).fill(cadCurrent) : []),
       cadCurrent >= 170 ? 'good' : 'warn',
       0, false, cadenceMissing, 'target'),
    mk('gct',     'GROUND CONTACT', 'ms',  Math.round(gctForm.last), undefined,
       [Math.max(160, (gctForm.last || 220) - 30), (gctForm.last || 220) + 30],
       gctForm.series.map(v => Math.round(v)),
       gctForm.last > 0 && gctForm.last < 240 ? 'good' : 'neutral',
       0, false, gctMissing),
    mk('vosc',    'VERTICAL OSC',   'cm',  voscForm.last, undefined,
       [Math.max(4, (voscForm.last || 8) - 3), (voscForm.last || 8) + 3],
       voscForm.series,
       voscForm.last > 0 && voscForm.last < 9 ? 'good' : 'neutral', 1, false, voscMissing),
    mk('stride',  'STRIDE LENGTH',  'm',   strideForm.last, undefined,
       [Math.max(0.8, (strideForm.last || 1.1) - 0.3), (strideForm.last || 1.1) + 0.3],
       strideForm.series, 'neutral', 2, false, strideMissing),
    // 2026-06-01 · Vertical ratio · vertical-osc / stride-length × 100.
    // Research/16 §form: lower ratio = better economy. 6-7% elite, 8-9%
    // typical recreational. Apple Watch surfaces it directly.
    mk('vratio', 'VERT RATIO', '%', vratioForm.last, undefined,
       [Math.max(4, (vratioForm.last || 8) - 2), (vratioForm.last || 8) + 2],
       vratioForm.series,
       vratioForm.last > 0 && vratioForm.last < 8 ? 'good' : 'neutral', 1, false, vratioMissing),
    // 2026-06-01 · Run power · Stryd / Apple Watch native running power.
    // Research/16 §form: power at threshold pace = running economy
    // proxy. Typical recreational 200-280W, advanced 280-340W.
    mk('power', 'RUN POWER', 'W', Math.round(powerForm.last), undefined,
       [Math.max(150, (powerForm.last || 280) - 50), (powerForm.last || 280) + 50],
       powerForm.series.map(v => Math.round(v)),
       powerForm.last > 0 ? 'good' : 'neutral',
       0, false, powerMissing),
    // 2026-05-30: L/R Balance removed. Apple Health doesn't expose a
    // left/right balance signal — the card had a zero-data source and
    // displayed only as "balanced" with no real underlying value. Bring
    // it back if a sensor (Stryd, Garmin chest dynamics pod) is wired.
  ];
  return {
    readiness: adaptReadiness(null, health),
    body,
    form: form_,
    // 2026-06-01 · Health page redesign · architecture verdict for the
    // SLEEP STAGES section's framing line. Backend (health-state.ts)
    // computes it from the standard deviation of the REM/total ratio
    // across the last 7 nights. Null when fewer than 4 nights of
    // stage data have synced.
    sleepArchitectureVerdict: health?.sleepStages?.architectureVerdict ?? null,
  };
}

function adaptPRs(races: Races | null, log: LogT | null): PR[] {
  // 1. Race finish times when the runner has logged them.
  const byDist: Record<string, { val: string; date: string; source: 'race' | 'training' }> = {};
  for (const r of (races?.past ?? [])) {
    if (!r.finishTime) continue;
    // #29 · skip provisional finishes (auto-filled from a date+distance-matched
    // Strava/HK run, not a curated chip time). Per CLAUDE.md Race-data Rule 3 a
    // Strava-source time must never surface as an authoritative personal record;
    // Rule 4 — the matched run may be a GPS over/under-measured activity. The
    // training-derived fallback below can still fill the bucket (labeled
    // "· training"); the race detail page keeps showing the matched effort.
    if (r.finishProvisional) continue;
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
  // Defensive: callers occasionally pass a number when an upstream writer
  // stored data.avgPaceMinPerMi as a decimal min/mi (e.g. 7.96) instead
  // of "M:SS". Coerce: a number is already minutes-per-mile, scale to
  // seconds. A non-string non-number is 0.
  if (typeof p === 'number') return Math.round((p as number) * 60);
  if (typeof p !== 'string') return 0;
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
    if (typeof t !== 'string') return 0;
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
  // 2026-06-02 · "A RACE" label replaces "GOAL" (David call: AFC / CIM
  // / LA are A races · not abstract goals · they happen to have a goal
  // time but the runner is going there to compete). Sort by date
  // ascending so nearest race is at the top, furthest at the bottom.
  const upcoming = [
    ...races.aRaces.map(r => ({ ...r, tag: 'A RACE' as const })),
    ...races.upcomingBs.map(r => ({ ...r, tag: 'TUNE-UP' as const })),
    ...races.upcomingCs.map(r => ({ ...r, tag: 'TUNE-UP' as const })),
  ];
  upcoming.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return upcoming.map(r => ({
    slug: r.slug, name: r.name,
    meta: `${shortDate(r.date)}${r.location ? ' · ' + r.location : ''}`,
    tag: r.tag,
    days: `${Math.max(0, Math.round((Date.parse(r.date) - today) / 86_400_000))} days`,
  }));
}

function adaptUnloggedRaceAlert(races: Races | null): FaffSeed['unloggedRaceAlert'] {
  if (!races) return null;
  const candidate = races.past.find(
    r => !r.finishTime && (r.priority === 'A' || r.priority === 'B'),
  );
  if (!candidate?.date) return null;
  const daysSince = Math.round(
    (Date.now() - Date.parse(candidate.date + 'T12:00:00Z')) / 86_400_000,
  );
  if (daysSince > 30) return null;
  return { slug: candidate.slug, name: candidate.name, daysSince };
}

function adaptActivity(log: LogT | null): ActivityData {
  const recent: RecentRun[] = (log?.weeks.flatMap(w => w.runs) ?? []).slice(0, 8).map(r => {
    const eff = mapType(r.workoutType ?? r.type);
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
    efficiencyTrend: buildEfficiencyTrend(subset),
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
  const buckets: Record<EffortKey, number> = { recovery:0, easy:0, long:0, tempo:0, intervals:0, rest:0, race:0 };
  let total = 0;
  for (const r of runs) {
    const e = mapType(r.workoutType ?? r.type);
    buckets[e] += r.distance_mi;
    total += r.distance_mi;
  }
  if (total <= 0) return [['easy','Easy',0]];
  // 'race' included so race miles render as their own slice (EC['race']
  // already maps to #D6263C) and the shown shares stay normalized to 100.
  const order: EffortKey[] = ['easy','long','tempo','intervals','recovery','race'];
  return order.map(k => [k, k[0].toUpperCase() + k.slice(1), Math.round(buckets[k] / total * 100)] as [string, string, number]);
}
function heatGrid(runs: LogRun[], weeks = 18): import('./types').HeatCell[][] {
  const today = new Date(); today.setHours(0,0,0,0);
  // Index runs by date so each cell can carry name + type + run id.
  type DayBucket = { mi: number; name: string; type: string | null; id: string };
  const byDay: Record<string, DayBucket> = {};
  for (const r of runs) {
    const cur = byDay[r.date];
    if (!cur) byDay[r.date] = { mi: r.distance_mi, name: r.name || 'Run', type: r.workoutType ?? r.type ?? null, id: r.id };
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
  if (typeof p === 'number') return Math.round((p as number) * 60);
  if (typeof p !== 'string' || !p) return 9999;
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 9999;
}
// Handles both "M:SS" formatted strings ("8:15" → 495) and decimal
// min/mi strings from the DB ("7.96" → 478). Returns 0 for missing data.
function parsePaceToSec(p: string | null): number {
  if (!p) return 0;
  if (p.includes(':')) {
    const parts = p.split(':').map(Number);
    const sec = parts[0] * 60 + (parts[1] || 0);
    return sec > 0 ? sec : 0;
  }
  const n = parseFloat(p);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
}
function buildEfficiencyTrend(runs: LogRun[]): EfficiencyTrend | null {
  const NEEDED = 4;
  // Filter to easy/recovery runs that have both pace and HR data.
  const eligible = runs
    .map(r => {
      const wt = (r.workoutType ?? r.type ?? '').toLowerCase();
      const isEasy = wt === 'easy' || wt === 'recovery' || wt.includes('easy') || wt.includes('recovery');
      if (!isEasy) return null;
      const paceSec = parsePaceToSec(r.pace);
      if (paceSec <= 0 || !r.avg_hr || r.avg_hr <= 0) return null;
      return { date: r.date, paceSec, hrBpm: r.avg_hr };
    })
    .filter((x): x is { date: string; paceSec: number; hrBpm: number } => x !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (eligible.length < NEEDED) {
    return {
      direction: 'flat',
      paceChangeSec: 0,
      hrAvgBpm: 0,
      hrChangeBpm: 0,
      runsUsed: eligible.length,
      runsNeeded: NEEDED,
      periodWeeks: 0,
      points: eligible,
    };
  }

  // Compare first-third vs last-third means to derive direction + delta.
  const third = Math.max(1, Math.floor(eligible.length / 3));
  const first = eligible.slice(0, third);
  const last = eligible.slice(-third);
  const avgPaceFirst = first.reduce((s, p) => s + p.paceSec, 0) / first.length;
  const avgPaceLast  = last.reduce((s, p) => s + p.paceSec, 0) / last.length;
  const avgHrFirst   = first.reduce((s, p) => s + p.hrBpm, 0) / first.length;
  const avgHrLast    = last.reduce((s, p) => s + p.hrBpm, 0) / last.length;

  const paceChangeSec = Math.round(avgPaceLast - avgPaceFirst); // negative = faster
  const hrChangeBpm   = Math.round(avgHrLast - avgHrFirst);
  const hrAvgBpm      = Math.round(eligible.reduce((s, p) => s + p.hrBpm, 0) / eligible.length);

  // 5 s/mi threshold: below that the signal is within normal run-to-run variance.
  const direction: EfficiencyTrend['direction'] =
    paceChangeSec < -5 ? 'improving' : paceChangeSec > 5 ? 'declining' : 'flat';

  const firstDate = new Date(eligible[0].date);
  const lastDate  = new Date(eligible[eligible.length - 1].date);
  const periodWeeks = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (7 * 86_400_000)));

  return {
    direction,
    paceChangeSec,
    hrAvgBpm,
    hrChangeBpm,
    runsUsed: eligible.length,
    runsNeeded: NEEDED,
    periodWeeks,
    points: eligible.slice(-12), // last 12 for the sparkline
  };
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

/** Pack a sparse VO2 series (HealthKit ships ~1-2 readings/week, 6-month
 *  window can be 25-50 points) into a 30-point chart series. Sorted by
 *  date ASC. Downsample with even spacing if > 30 points, pad with the
 *  most recent reading (or 0) if fewer than 2 points exist. */
function packVo2Series(series: Array<{ date: string; v: number }>, current: number): number[] {
  const sorted = series.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return Array(30).fill(current || 0);
  const vals = sorted.map((r) => r.v);
  if (vals.length >= 30) {
    const step = vals.length / 30;
    const out: number[] = [];
    for (let i = 0; i < 30; i++) out.push(vals[Math.floor(i * step)]);
    return out;
  }
  // Fewer than 30 points — pad at the START with the first value so the
  // line starts flat (older history is what it is) and rises into the
  // recent readings on the right.
  const pad = Array(30 - vals.length).fill(vals[0]);
  return [...pad, ...vals];
}

function adaptShoes(profile: Profile | null): ShoeRec[] {
  if (!profile?.shoes?.length) return [];
  return profile.shoes.filter(s => !s.retired).map(s => {
    const rawTypes = Array.isArray(s.runTypes) ? s.runTypes : [];
    const roles = rawTypes.length > 0
      ? rawTypes.map((r: string) => r.toString().toUpperCase().replace(/[^A-Z]/g, ''))
      : ['EASY'];
    return {
      id: Number(s.id),
      brand: s.brand,
      model: s.model,
      nm: s.name || `${s.brand} ${s.model}`.trim(),
      role: roles[0],        // primary role — used for card label + ROLECOL stripe
      roles,                 // full set — editor populates all checkboxes from this
      preferred: s.preferred ?? true,
      mi: Math.round(s.mileage || 0),
      max: Math.round(s.cap || 400),
      baseline_mi: Math.round(s.baseline_mi ?? 0),
    };
  });
}

/** Coach shoe recommendation per effort type. Pulls from the runner's
 *  actual garage and applies recommendShoe (lib/shoe/recommend.ts) —
 *  NOT from Strava. Returns a map of effort-key → display name. */
async function buildShoeRecByType(profile: Profile | null): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!profile?.shoes?.length) return out;
  const { recommendShoe, shoeDisplayName } = await import('@/lib/shoe/recommend');
  // Match the rec rule against each effort type we display.
  // 'rest' has no shoe rec. Map 'race' to the racing flat slot too even
  // though it's not in EffortKey — useful when the race-week view leans on it.
  for (const t of ['easy', 'long', 'recovery', 'tempo', 'intervals', 'race'] as const) {
    const rec = recommendShoe(profile.shoes, t);
    const name = shoeDisplayName(rec);
    if (name) out[t] = name;
  }
  return out;
}
function adaptConnections(profile: Profile | null): ConnectionRow[] {
  const strava = profile?.connections.strava.connected ?? false;
  const health = profile?.connections.appleHealth.connected ?? false;
  const watch = profile?.connections.appleWatch.connected ?? false;
  return [
    { id: 'health',     nm: 'Apple Health', sub: profile?.connections.appleHealth.note || 'HRV, sleep, RHR, weight', bg: 'linear-gradient(135deg,#ff5a6e,#ff2d55)', gl: '♥', on: health, lastSyncIso: profile?.connections.appleHealth.lastSync ?? null },
    { id: 'strava',     nm: 'Strava',       sub: profile?.connections.strava.note      || 'Run history',             bg: 'linear-gradient(135deg,#fc7e3c,#fc4c02)' /* --strava brand gradient */, gl: '▲', on: strava, lastSyncIso: profile?.connections.strava.lastSync ?? null },
    { id: 'watch',      nm: 'Apple Watch',  sub: profile?.connections.appleWatch.note  || 'Live workouts',           bg: 'linear-gradient(135deg,#3aa0e0,#0a66a8)', gl: '⌚', on: watch, lastSyncIso: profile?.connections.appleWatch.lastSync ?? null },
    { id: 'finalsurge', nm: 'FinalSurge',   sub: 'Coming soon',                                                       bg: 'linear-gradient(135deg,#5b8def,#2a5fd0)', gl: 'FS', on: false, lastSyncIso: null },
  ];
}
/**
 * 2026-06-01 · adaptForm now reads REAL Banister TSB from
 * lib/coach/training-form.ts (CTL 42d EWMA / ATL 7d EWMA / TSB
 * = CTL - ATL). Previously this used a placeholder formula:
 *   fitness = avg planned weekly miles
 *   fatigue = this-week's done miles
 *   delta   = fitness - fatigue (meaningless · reset every Monday)
 * which mislabeled "+39 OVER-REACH" simultaneously (the +39 said
 * "very fresh" but the label said "overreached" · contradictory).
 *
 * The new model uses the canonical Coggan operationalization of
 * Banister's impulse-response framework · same model TrainingPeaks /
 * Runalyze / Intervals.icu use. Returned fields:
 *   · fitness  = CTL (chronic training load, 42d EWMA)
 *   · fatigue  = ATL (acute training load, 7d EWMA)
 *   · delta    = TSB (CTL - ATL · signed · negative = fatigued, positive = fresh)
 *   · label    = banded by TSB · OVERREACH / LOADED / PRODUCTIVE / RACE-READY / DETRAINING
 *   · acwr     = retained for back-compat
 */
async function adaptForm(userId: string, glance: Glance | null): Promise<FaffSeed['form']> {
  try {
    const { computeTrainingForm } = await import('@/lib/coach/training-form');
    const tf = await computeTrainingForm(userId);
    if (tf) {
      return {
        fitness: tf.ctl,
        fatigue: tf.atl,
        delta: tf.tsb,
        label: tf.label,
        // 2026-06-03 · always read ACWR from glance (which now uses
        // canonicalMileageByDay clustering, same as Readiness drawer).
        // Previously this surfaced tf.acwr · training-form's MAX-per-day
        // SQL dedupe produced a third independent ACWR number, so the
        // Health page, Readiness drawer, and THE STORY card each read
        // a different value. Glance is the canonical source.
        acwr: glance?.loadAcwr ?? tf.acwr,
      };
    }
  } catch {/* fall through to cold-start */}

  // Cold start · no recoverable run history yet
  const acwr = glance?.loadAcwr ?? null;
  return { fitness: 0, fatigue: 0, delta: 0, label: 'BUILDING', acwr };
}

/**
 * Strength-day picking is now backend-owned.
 *
 * 2026-06-01 · the client-side pickStrengthDays() heuristic was removed
 * once the backend strength-recommender shipped (commit 34bff2a0). The
 * recommendation now flows in via glance.recommendedStrengthDays · an
 * array of ISO dates · which adaptWeek() matches against each day's iso
 * to set PlannedDay.strengthSuggested. The full envelope (reason +
 * habit + coachIntent) rides on FaffSeed.strengthRecommendation so the
 * briefing surface can render the coach voice and the dormant-habit
 * intent.
 *
 * The recommender personalizes on logged history, plan phase, race
 * proximity, ACWR, and the week's run shape · all things the old
 * client-side heuristic couldn't see. See:
 *   · designs/briefs/strength-recommender-backend-brief.md (the ask)
 *   · designs/briefs/strength-recommender-backend-landed.md (the reply)
 *   · web-v2/lib/coach/strength-recommender.ts (the implementation)
 *
 * Doctrine (Research/07) still rules: 2 sessions / wk default, easy or
 * recovery only, never day-before quality or long, race-week 0, taper
 * ≤1, ACWR>1.5 drops to 1. All seven rules are encoded backend-side.
 */

/* ─────────────────────────  Public entry point  ───────────────────────── */

/**
 * Build an empty FaffSeed envelope — every per-user signal is null,
 * every list empty, the Shell renders the public/sign-in shell. This
 * is what unauthenticated SSR requests receive (instead of David's
 * data, which is what the pre-2026-05-30 code returned).
 */
function emptySeed(): FaffSeed {
  const { week, todayIdx, results } = adaptWeek(null, undefined);
  const readiness = adaptReadiness(null, null);
  return {
    todayISO: new Date().toISOString(),
    topDate: todayLabel(),
    weekOf: '·',
    coachedExternally: false,
    coachCalendar: null,
    goalReady: null,
    user: {
      name: 'Guest',
      city: '',
      initial: 'G',
      pro: false,
      experienceLevel: null,
      biologicalSex: 'not_specified' as const,
      subscriptionLabel: 'Sign in',
    },
    week, todayIdx, results,
    readiness,
    readinessBrief: null,
    planProposals: [],
    strengthRecommendation: null,
    strengthWeekStatus: null,
    goalRace: null,
    volumeBars: [],
    thisWeekMiles: 0,
    weeklyAvg: 0,
    form: { fitness: 0, fatigue: 0, delta: 0, label: 'BUILDING', acwr: null },
    season: { nowIdx: 0, raceIdx: 0, miles: [], maxMi: 1, phases: [], weekDays: [], adaptations: [], horizonRaise: null },
    health: { readiness, body: [], form: [], sleepArchitectureVerdict: null },
    prs: [],
    races: [],
    unloggedRaceAlert: null,
    projectionTrend: [],
    activity: {
      ranges: {
        month: { eyebrow: 'SIGN IN', big: '·', sub: '', totals: [], volT: '', volS: '', vol: [], mix: [], efficiencyTrend: null, recs: [], heat: [], heatLabels: [], facts: [] },
        year:  { eyebrow: 'SIGN IN', big: '·', sub: '', totals: [], volT: '', volS: '', vol: [], mix: [], efficiencyTrend: null, recs: [], heat: [], heatLabels: [], facts: [] },
        all:   { eyebrow: 'SIGN IN', big: '·', sub: '', totals: [], volT: '', volS: '', vol: [], mix: [], efficiencyTrend: null, recs: [], heat: [], heatLabels: [], facts: [] },
      },
      recent: [],
    },
    shoes: [],
    todayShoeId: null,
    shoeRecByType: {},
    connections: [
      { id: 'health',     nm: 'Apple Health', sub: 'Sign in to connect', bg: 'linear-gradient(135deg,#ff5a6e,#ff2d55)', gl: '♥',  on: false },
      { id: 'strava',     nm: 'Strava',       sub: 'Sign in to connect', bg: 'linear-gradient(135deg,#fc7e3c,#fc4c02)' /* --strava brand gradient */, gl: '▲',  on: false },
      { id: 'watch',      nm: 'Apple Watch',  sub: 'Sign in to connect', bg: 'linear-gradient(135deg,#3aa0e0,#0a66a8)', gl: '⌚', on: false },
      { id: 'finalsurge', nm: 'FinalSurge',   sub: 'Coming soon',        bg: 'linear-gradient(135deg,#5b8def,#2a5fd0)', gl: 'FS', on: false },
    ],
    pendingProposals: [],
  };
}

export async function buildSeed(): Promise<FaffSeed> {
  // P1 SSR-leak fix (2026-05-30) + sign-in surface (2026-05-31):
  // resolve the runner from the `faff_session` cookie. When the visitor
  // isn't signed in we redirect them to `/login` instead of rendering
  // an empty seed. The empty seed was a 2026-05-30 stopgap so the page
  // wouldn't crash; now that a real sign-in surface exists, the right
  // behavior is to bounce them to it. emptySeed() stays in this module
  // as a defensive fallback (never reached in normal flow).
  const userId = await userIdFromCookies();
  // redirect() throws · the return type is `never`, but TypeScript widens
  // it to Promise<FaffSeed> on the calling line without complaint. The
  // single-statement shape also satisfies the static probe at
  // scripts/_sim_ssr_unauthenticated.mjs which greps for `if (!userId)
  // ... return`. emptySeed() is kept below as a defensive fallback the
  // typecheck sees but the runtime never reaches.
  if (!userId) return redirect('/login');

  const [gRes, hRes, tRes, rRes, lRes, pRes, fRes, sRes, skRes] = await Promise.all([
    loadGlance(userId), loadHealth(userId), loadTraining(userId), loadRaces(userId),
    loadLog(userId), loadProfile(userId), loadFormMetrics(userId), loadTodayShoe(userId),
    loadWeekSkips(userId),
  ]);
  const glance   = gRes.ok ? gRes.value : null;
  const health   = hRes.ok ? hRes.value : null;
  const training = tRes.ok ? tRes.value : null;
  const races    = rRes.ok ? rRes.value : null;
  const log      = lRes.ok ? lRes.value : null;
  const profile  = pRes.ok ? pRes.value : null;
  const formMetrics: Form = fRes;
  const todayShoeId: number | null = sRes.value;
  const weekSkips: Set<string> = skRes.value;

  const { week, todayIdx, results } = adaptWeek(glance, weekSkips, health?.cadence.baseline ?? null);

  // 2026-06-10 · coached mode (fifth onboarding path). The runner's own
  // coach owns the plan; Faff tracks the work and stays out of the
  // prescriptions. profile-state doesn't surface user_settings, so read
  // the flag directly. Best-effort — absence reads false.
  const coachedExternally = await (async () => {
    try {
      const { pool } = await import('@/lib/db/pool');
      const r = await pool.query<{ coached: boolean | null }>(
        `SELECT (user_settings->>'coached_externally')::boolean AS coached
           FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
      );
      return r.rows[0]?.coached === true;
    } catch { return false; }
  })();

  // Coached-mode v2 · the coach's calendar feed (read-only ICS). Serves
  // cache; a stale cache refreshes in the background (never blocks the
  // page on the coach platform's host). Events attach per-day below.
  let coachCalendar: FaffSeed['coachCalendar'] = null;
  if (coachedExternally) {
    try {
      const { getCoachCalendarStatus } = await import('@/lib/coach-calendar/store');
      const cal = await getCoachCalendarStatus(userId);
      coachCalendar = { urlSet: cal.urlSet, fetchedAt: cal.fetchedAt, lastError: cal.lastError };
      if (cal.events.length > 0) {
        const byDate = new Map<string, { title: string; description: string | null }>();
        for (const ev of cal.events) {
          // First event per day wins · coaches occasionally stack notes
          // as extra events; the primary workout is listed first.
          if (!byDate.has(ev.dateISO)) byDate.set(ev.dateISO, { title: ev.title, description: ev.description });
        }
        for (const day of week) {
          if (day.iso && byDate.has(day.iso)) day.coachWorkout = byDate.get(day.iso);
        }
      }
    } catch { coachCalendar = { urlSet: false, fetchedAt: null, lastError: null }; }
  }

  // 2026-06-01 · web agent brief · enrich week with live standing
  // recommendations. Re-evaluates today's signals against each planned
  // quality workout and emits a recommendation envelope when the engine
  // would currently disagree with the active row. Best-effort.
  await enrichWeekWithStandingRecommendations(userId, week).catch(() => {});

  // 2026-06-01 · enrich `results` with real per-run data so the Today
  // EASY/DONE card and week-strip render real weather, calories,
  // elevation, shoe, time, pace, HR. Previously these were hardcoded
  // placeholders ('·' / 0) because adaptWeek only had doneMi +
  // activityId in scope · the runs themselves weren't loaded.
  //
  // Best-effort · failures degrade to the placeholders rather than
  // blocking the page render.
  await enrichResultsWithRunData(userId, week, results).catch(() => {});

  // 2026-06-01 · annotate strength days from the backend recommender
  // (commit 34bff2a0). glance.recommendedStrengthDays is an array of
  // ISO YYYY-MM-DD dates; match each PlannedDay.iso to set the flag.
  // When the backend returns an empty array (race week, dormant plan,
  // no acceptable slot, recommender errored), no day gets the
  // annotation · the week strip shows zero "+ STRENGTH" chips, which
  // is the correct silent state.
  const strengthDays = new Set(glance?.recommendedStrengthDays ?? []);
  // 2026-06-03 · per-day strengthDone flag · reads from strengthWeekStatus
  // confirmed[] (sessions logged on a recommended day) + bonus[] (sessions
  // logged on a non-recommended day · still done). HK pushes from Apple
  // Health land here via POST /api/strength → strength_sessions → reconcile.
  const confirmedDates = new Set<string>(
    (glance?.strengthWeekStatus?.confirmed ?? []).map((c) => c.date)
  );
  const bonusDates = new Set<string>(
    (glance?.strengthWeekStatus?.bonus ?? []).map((b) => b.date)
  );
  for (let i = 0; i < week.length; i++) {
    const iso = week[i].iso;
    week[i].strengthSuggested = !!iso && strengthDays.has(iso!);
    week[i].strengthDone = !!iso && (confirmedDates.has(iso!) || bonusDates.has(iso!));
  }
  const readiness = adaptReadiness(glance, health);
  const goalRace = adaptGoalRace(glance, races, profile, training);
  // 2026-06-08 · pacing-discipline computed ONCE · feeds both the
  // confidence-interval band (computeGoalProjection) and the
  // executionBufferSec GapPanel chunk below. Hoisted to avoid a
  // duplicate 90-day query.
  const { computePacingDiscipline } = await import('@/lib/coach/pacing-discipline');
  const pacing = goalRace && goalRace.slug && goalRace.distanceMi
    ? await computePacingDiscipline(userId, 90).catch(() => null)
    : null;
  // 2026-06-04 · plan-trusts-itself doctrine (David's call). Replace
  // the raw VDOT-derived projection with the goalProjection output ·
  // PROJECTION = GOAL until drift signals fire. See
  // lib/training/goal-projection.ts for the full rule set.
  if (goalRace && goalRace.slug && goalRace.distanceMi) {
    try {
      const goalSecForGP = parseRaceTime(goalRace.goal);
      if (goalSecForGP != null) {
        const { computeGoalProjection, formatGoalTime } = await import('@/lib/training/goal-projection');
        // Series-first VDOT · mirror app/api/targets/projection/route.ts. The
        // cron-written snapshot is the canonical source; profile is the
        // fallback. profile can fail to load (seed.ts safe()→null when
        // loadProfileState throws) — reading the snapshot directly keeps the
        // gap panel alive on the snapshot's VDOT instead of collapsing to the
        // cold "we can't draw your gap" state while the same snapshot is shown
        // as "VDOT 47.9" two lines up. The iPhone surface never had this bug
        // because it already read series-first.
        const { loadLatestVdotWithAnchor } = await import('@/lib/training/projection-snapshots');
        const snap = await loadLatestVdotWithAnchor(userId)
          .catch(() => ({ vdot: null, anchorDateISO: null, anchorDistanceMi: null }));
        const projVdot = snap.vdot ?? profile?.physiology.vdot ?? null;
        const projAnchorDate = snap.anchorDateISO ?? profile?.physiology.vdot_anchor_date ?? null;
        const projAnchorDist = snap.anchorDistanceMi ?? profile?.physiology.vdot_anchor_distance_mi ?? null;
        const gp = await computeGoalProjection({
          userUuid: userId,
          goalSec: goalSecForGP,
          raceDistanceMi: goalRace.distanceMi,
          vdot: projVdot,
          daysToRace: goalRace.daysAway ?? null,
          pacing: pacing ? { cv: pacing.cv, source: pacing.source } : null,
          vdotAnchorDateISO: projAnchorDate,
          vdotAnchorDistanceMi: projAnchorDist,
        });
        // Override projection with plan-trusts-itself value.
        goalRace.projected = formatGoalTime(gp.projectionSec) ?? goalRace.projected;
        // Wire status + drift signals + raw VDOT projection so the
        // frontend can gate panels (only show "math is honest" when
        // OFF TRACK, etc).
        (goalRace as { goalStatus?: string }).goalStatus = gp.status;
        (goalRace as { driftSignals?: unknown }).driftSignals = gp.driftSignals;
        (goalRace as { vdotProjectionSec?: number | null }).vdotProjectionSec = gp.vdotProjectionSec;
        (goalRace as { projectionSummary?: string }).projectionSummary = gp.summary;
        (goalRace as { nextTestPoints?: unknown }).nextTestPoints = gp.nextTestPoints;
        (goalRace as { recentTestPoints?: unknown }).recentTestPoints = gp.recentTestPoints;
        (goalRace as { transitions?: unknown }).transitions = gp.transitions;
        (goalRace as { confidenceInterval?: unknown }).confidenceInterval = gp.confidenceInterval;
        (goalRace as { confidenceLabel?: unknown }).confidenceLabel = gp.confidenceLabel;
        (goalRace as { trajectory?: unknown }).trajectory = gp.trajectory;
        // Recompute onTrack/delta against the new projection.
        const newProjSec = gp.projectionSec;
        const diff = goalSecForGP - newProjSec;
        goalRace.onTrack = diff >= -30;
        const minutes = Math.abs(Math.round(diff / 60));
        const seconds = Math.abs(Math.round(diff % 60));
        goalRace.delta = diff >= 0
          ? (minutes > 0 ? `${minutes} min ahead` : `${seconds} sec ahead`)
          : (minutes > 0 ? `${minutes} min behind` : `${seconds} sec behind`);
      }
    } catch { /* swallow · keep raw VDOT projection from adaptGoalRace */ }
  }
  // 2026-05-31 · enrich the GoalRace with per-race-per-runner GapPanel
  // chunks. See designs/briefs/targets-gap-panel-backend-brief.md §2.
  // Each chunk is null-tolerant · GapPanel hides chunks with null impact.
  if (goalRace && goalRace.slug && goalRace.distanceMi) {
    try {
      const goalSecLocal = parseRaceTime(goalRace.goal) ?? 0;
      const { pool: _pool } = await import('@/lib/db/pool');

      // Pull course_library (elevation) + races (course_geometry bbox
      // for lat/lng) once · both chunks need the same join.
      const [courseLibRes, raceRowRes] = await Promise.all([
        _pool.query(
          `SELECT source, elevation_gain_ft, net_elevation_ft
             FROM course_library WHERE slug = $1`,
          [goalRace.slug],
        ).catch(() => ({ rows: [] as Array<{ source: string | null; elevation_gain_ft: number | null; net_elevation_ft: number | null }> })),
        _pool.query(
          // Gun time: meta.startTime is the inline-editable Gun chip on
          // the race detail page (the canonical field · races-state.ts
          // reads the same COALESCE chain).
          `SELECT course_geometry,
                  COALESCE(meta->>'startTime', meta->>'gun_time', meta->>'start_time') AS start_time_local
             FROM races
            WHERE slug = $1 AND user_uuid = $2 LIMIT 1`,
          [goalRace.slug, userId],
        ).catch(() => ({ rows: [] as Array<{ course_geometry: { bbox?: { minLat?: number; maxLat?: number; minLon?: number; maxLon?: number } } | null; start_time_local: string | null }> })),
      ]);
      const courseLibRow = courseLibRes.rows[0];
      const raceStartTimeLocal = (raceRowRes.rows[0] as { start_time_local?: string | null } | undefined)?.start_time_local ?? null;
      const courseGeom = (raceRowRes.rows[0] as any)?.course_geometry ?? null;
      const bbox = courseGeom?.bbox ?? null;
      const raceLat = bbox?.minLat != null && bbox?.maxLat != null
        ? (Number(bbox.minLat) + Number(bbox.maxLat)) / 2 : null;
      const raceLng = bbox?.minLon != null && bbox?.maxLon != null
        ? (Number(bbox.minLon) + Number(bbox.maxLon)) / 2 : null;

      // When course_library is a stub (or missing), prefer GPS-derived
      // elevation from the uploaded course_geometry. AFC example: library
      // stub says 210 ft gain / 0 net; GPX has 923 ft gain / −130 ft net.
      const libSource = (courseLibRow?.source as 'editorial' | 'crowd' | 'stub' | null) ?? null;
      const libIsStub = libSource == null || libSource === 'stub';
      let elevGainFt: number | null = courseLibRow?.elevation_gain_ft ?? null;
      let netElevFt: number | null = courseLibRow?.net_elevation_ft ?? null;
      let effectiveCourseSource: 'editorial' | 'crowd' | 'stub' | null = libSource;
      if (libIsStub && courseGeom?.elevation_gain_ft != null) {
        elevGainFt = Number(courseGeom.elevation_gain_ft);
        const tp = Array.isArray(courseGeom.trackPoints) ? courseGeom.trackPoints : null;
        if (tp && tp.length >= 2) {
          const firstEle = Number((tp[0] as any).ele ?? 0);
          const lastEle = Number((tp[tp.length - 1] as any).ele ?? 0);
          netElevFt = Math.round((lastEle - firstEle) * 3.28084);
        }
        effectiveCourseSource = 'crowd'; // GPS-measured, not editorially verified
      }

      if (goalSecLocal > 0) {
        // §2.2 · Course chunk · per-race elevation impact
        const { computeCourseImpact } = await import('@/lib/training/course-impact');
        const courseImpact = computeCourseImpact(
          {
            distanceMi: goalRace.distanceMi,
            goalSec: goalSecLocal,
            elevationGainFt: elevGainFt,
            netElevationFt: netElevFt,
          },
          effectiveCourseSource,
        );
        goalRace.courseImpactSec = courseImpact.seconds;
        goalRace.courseSource = courseImpact.source;
        goalRace.courseElevGainFtPerMi = courseImpact.elevGainFtPerMi;

        // §2.1 · Conditions chunk · race-day weather impact.
        // Async (forecast call) · best-effort, never blocks the seed.
        if (goalRace.date) {
          const { computeRaceConditions } = await import('@/lib/training/race-conditions');
          const conditions = await computeRaceConditions({
            raceSlug: goalRace.slug,
            raceDateISO: goalRace.date,
            location: goalRace.location,
            raceLat,
            raceLng,
            distanceMi: goalRace.distanceMi,
            goalSec: goalSecLocal,
            vdot: profile?.physiology.vdot ?? null,
            startTimeLocal: raceStartTimeLocal,
          });
          goalRace.conditionsImpactSec = conditions.seconds;
          goalRace.conditionsSource = conditions.source;
          goalRace.conditionsSafetyMessage = conditions.safetyMessage;
        }
      }

      // §2.3 · Execution chunk · per-runner pacing buffer (CV-based).
      // Always populated · 30s default when fewer than 2 typed
      // race/tempo/threshold runs in the 90-day window. Reuses the
      // pacing computed once above (shared with the CI band).
      if (pacing) {
        goalRace.executionBufferSec = pacing.bufferSec;
        goalRace.executionSource = pacing.source;
      }

      // §2.4 · Hit list · cheapest 2-3 levers to move the projection.
      // Composes per-runner tune-up race candidates, plan-adjacent
      // threshold/sharpen calls, multi-wave cooler-corral options,
      // and the off-track B-target safety lever. Needs the per-chunk
      // gap to rank, so it runs AFTER course/conditions/execution
      // have populated above.
      if (goalSecLocal > 0 && goalRace.date) {
        const projSec = parseRaceTime(goalRace.projected) ?? goalSecLocal;
        const totalGap = Math.max(0, projSec - goalSecLocal);
        const courseImp = goalRace.courseImpactSec ?? 0;
        const condImp = goalRace.conditionsImpactSec ?? 0;
        const execImp = goalRace.executionBufferSec ?? 30;
        const fitnessGap = Math.max(0, totalGap - courseImp - condImp - execImp);

        const { computeProjectionLevers } = await import('@/lib/coach/projection-levers');
        const levers = await computeProjectionLevers({
          userUuid: userId,
          goalRace: {
            slug: goalRace.slug,
            name: goalRace.name,
            date: goalRace.date,
            daysAway: goalRace.daysAway,
            distanceMi: goalRace.distanceMi,
            location: goalRace.location,
          },
          projectionSec: projSec,
          goalSec: goalSecLocal,
          currentVdot: profile?.physiology.vdot ?? null,
          gap: {
            fitness: fitnessGap,
            conditions: condImp,
            course: courseImp,
            execution: execImp,
          },
        });
        goalRace.levers = levers;
      }
    } catch {
      // Enrichment is best-effort · the panel falls back to doctrine
      // placeholders when these fields are absent.
    }
  }
  const volumeToday = await runnerToday(userId);
  const volumeSettings = await loadSettings(userId);
  const { bars: volumeBars, thisWeek: thisWeekMiles, avg: weeklyAvg } = adaptVolumeBars(log, training, volumeToday, volumeSettings.long_run_day);
  // Load plan adapts AFTER training so we have plan_id to scope the query.
  const planAdapts = await loadPlanAdapts(userId, training?.plan_id ?? null);
  const season = adaptSeason(training, planAdapts.value, goalRace?.distanceMi ?? null);
  // 2026-05-31: projection trend series from projection_snapshots
  // (cron-daily rows). Pull 90 days of (vdot, projection_sec) for the
  // goal race's distance so TargetsView can render a sparkline.
  // 2026-06-10 · time-goal runners: "when is my goal time possible".
  // Only meaningful when there's NO goal race (race-anchored runners
  // use the existing GAP projection); the loader itself returns null
  // unless a TT goal is on the profile.
  const goalReady = goalRace
    ? null
    : await (async () => {
        try {
          const { loadGoalReadyProjection } = await import('@/lib/training/goal-ready');
          return await loadGoalReadyProjection(userId);
        } catch { return null; }
      })();

  const goalDistMi = goalRace?.distanceMi ?? null;
  const projectionTrend = goalDistMi
    ? await (async () => {
        try {
          const { loadProjectionSeries } = await import('@/lib/training/projection-snapshots');
          return await loadProjectionSeries(userId, goalDistMi, 90);
        } catch { return [] as Array<{ date: string; projectionSec: number | null; vdot: number | null }>; }
      })()
    : [];
  // 2026-05-31 · daily readiness brief envelope. Composed from CoachState
  // + 60-day health history + readiness_snapshots trend. Returns null when
  // the runner has no recoverable signal (brand-new user). See
  // designs/briefs/readiness-brief-backend-landed.md for the contract.
  // 2026-06-01 · moved above adaptHealth so hrvCv can be threaded in to
  // surface a Plews CV tile on the Health page.
  const readinessBrief = await (async () => {
    try {
      const [{ loadCoachState }, { loadReadinessBrief }] = await Promise.all([
        import('@/lib/coach/state-loader'),
        import('@/lib/coach/readiness-brief'),
      ]);
      const state = await loadCoachState(userId);
      if (!state) return null;
      return await loadReadinessBrief(userId, state);
    } catch { return null; }
  })();

  // 2026-06-01 · canonical biological_sex · resolved once and threaded
  // through to adaptHealth (gates cycle-phase tile) AND to the user
  // envelope below (drives settings UI + iPhone client gates).
  const biologicalSex = await (async () => {
    try {
      const { loadBiologicalSex } = await import('@/lib/coach/biological-sex');
      return await loadBiologicalSex(userId);
    } catch { return 'not_specified' as const; }
  })();

  const healthSnapshot = adaptHealth(health, formMetrics, readinessBrief?.hrvCv, biologicalSex);
  // Stamp the real readiness on top · honestReadiness overrides the
  // stale HRV-baseline-as-readiness-baseline below in the main return.
  healthSnapshot.readiness = readiness;

  // 2026-06-01 · Power moves Waves 2-4 · aerobic-fitness trend, heat
  // acclim, post-session recovery, block comparison, DOW patterns,
  // cycle performance, quality predictors. All best-effort · return
  // null when not enough signal exists. Fired in parallel.
  const [
    aerobicFitness, heatAcclim, recoveryPhase, blockComparison,
    dowPatterns, cyclePerformance, qualityPredictors, vdotAnchor,
    sleepCoaching,
  ] = await Promise.all([
    (async () => { try { const { computeDecouplingTrend } = await import('@/lib/training/decoupling-trend');
      return await computeDecouplingTrend(userId); } catch { return null; } })(),
    (async () => { try { const { computeHeatAcclimatization } = await import('@/lib/coach/heat-acclimatization');
      return await computeHeatAcclimatization(userId); } catch { return null; } })(),
    (async () => { try { const { computeRecoveryPhase } = await import('@/lib/coach/recovery-phase');
      return await computeRecoveryPhase(userId); } catch { return null; } })(),
    (async () => { try { const { computeBlockComparison } = await import('@/lib/coach/block-comparison');
      return await computeBlockComparison(userId); } catch { return null; } })(),
    (async () => { try { const { computeDowPatterns } = await import('@/lib/coach/dow-patterns');
      return await computeDowPatterns(userId); } catch { return null; } })(),
    (async () => {
      // Gender-gated · only compute for female-identified runners.
      if (biologicalSex !== 'female') return null;
      try { const { computeCyclePerformance } = await import('@/lib/coach/cycle-performance');
        return await computeCyclePerformance(userId); } catch { return null; }
    })(),
    (async () => { try { const { computeQualityPredictors } = await import('@/lib/coach/quality-predictors');
      return await computeQualityPredictors(userId); } catch { return null; } })(),
    // 2026-06-09 state-audit · VDOT-anchor provenance for the Health
    // page staleness warning. Reads the newest snapshot that carries
    // anchor columns (migration 125 populates them going forward) and
    // date-matches a races row for the display name. CURRENT_DATE is
    // server UTC · ±1 day of skew is immaterial at a 120-day threshold.
    (async () => {
      try {
        const { pool: _p } = await import('@/lib/db/pool');
        const row = (await _p.query<{
          vdot: string; anchor_date: string; anchor_dist: string | null;
          race_name: string | null; age_days: string;
        }>(
          `SELECT ps.vdot::text,
                  ps.vdot_anchor_date::text AS anchor_date,
                  ps.vdot_anchor_distance_mi::text AS anchor_dist,
                  (SELECT r.meta->>'name' FROM races r
                    WHERE r.user_uuid = ps.user_uuid
                      AND r.meta->>'date' = ps.vdot_anchor_date::text
                    LIMIT 1) AS race_name,
                  (CURRENT_DATE - ps.vdot_anchor_date)::text AS age_days
             FROM projection_snapshots ps
            WHERE ps.user_uuid = $1::uuid
              AND ps.vdot IS NOT NULL
              AND ps.vdot_anchor_date IS NOT NULL
            ORDER BY ps.snapshot_date DESC
            LIMIT 1`,
          [userId],
        )).rows[0];
        if (!row) return null;
        const ageDays = Number(row.age_days);
        if (!Number.isFinite(ageDays)) return null;
        return {
          vdot: Number(row.vdot),
          anchorDateISO: row.anchor_date,
          anchorDistanceMi: row.anchor_dist != null ? Number(row.anchor_dist) : null,
          anchorRaceName: row.race_name,
          ageDays,
          tier: (ageDays < 56 ? 'fresh' : ageDays < 120 ? 'aging' : 'stale') as 'fresh' | 'aging' | 'stale',
        };
      } catch { return null; }
    })(),
    // 2026-06-09 Phase 2 (3.4) · standing sleep flag + race-week banking.
    (async () => {
      try {
        const { computeSleepCoaching } = await import('@/lib/coach/sleep-coaching');
        return await computeSleepCoaching(userId);
      } catch { return null; }
    })(),
  ]);
  // 2026-06-01 · Power moves sidecar fields · HealthSnapshot carries
  // proper optional types for all 7 (components/faff-app/types.ts).
  // Design agent reads seed.health.<field> per the v2 brief.
  healthSnapshot.aerobicFitness = aerobicFitness;
  healthSnapshot.vdotAnchor = vdotAnchor;
  healthSnapshot.sleepCoaching = sleepCoaching;
  healthSnapshot.heatAcclim = heatAcclim;
  healthSnapshot.recoveryPhase = recoveryPhase;
  healthSnapshot.blockComparison = blockComparison;
  healthSnapshot.dowPatterns = dowPatterns;
  healthSnapshot.cyclePerformance = cyclePerformance;
  healthSnapshot.qualityPredictors = qualityPredictors;
  const prs = adaptPRs(races, log);
  const racesList = adaptRaces(races);
  const activity = adaptActivity(log);
  const shoes = adaptShoes(profile);
  const shoeRecByType = await buildShoeRecByType(profile);
  const connections = adaptConnections(profile);
  const form = await adaptForm(userId, glance);
  // 2026-05-31: pending coach_proposals (illness / injury). Dead-code rescue
  // from 2026-05-30 audit — adapt.ts writes these rows; until now the web
  // had no loader. Today view renders accept/decline cards above the
  // workout hero.
  const pendingProposals = await (async () => {
    try {
      const { loadPendingProposals } = await import('@/lib/coach/proposals-state');
      return await loadPendingProposals(userId);
    } catch { return []; }
  })();

  // 2026-06-01 · autonomous plan-adaptation surface. Pending drift
  // proposals + recently auto-applied rebuilds. Today view renders
  // these as accept-or-dismiss cards or "we rebuilt your plan because
  // X" notifications. See lib/plan/drift-monitor.ts + auto-rebuild.ts.
  const planProposals = await (async () => {
    try {
      const { loadPlanProposals } = await import('@/lib/plan/proposals-state');
      return await loadPlanProposals(userId);
    } catch { return []; }
  })();

  // 2026-06-04 · per-workout adapter proposals · "we'd swap tomorrow's
  // tempo to easy unless you object." Replaces the silent-overnight-
  // mutation pattern · runner gates the change via banner buttons.
  // See lib/plan/workout-proposals.ts.
  const pendingWorkoutProposals = await (async () => {
    try {
      const { loadPendingProposals: loadWoP } = await import('@/lib/plan/workout-proposals');
      return await loadWoP(userId);
    } catch { return []; }
  })();

  const fullName = profile?.identity.full_name ?? glance?.greetingName ?? null;
  const user = {
    name: fullName ? fullName.split(' ')[0] : 'You',
    city: profile?.identity.city ?? '',
    initial: (fullName?.[0] ?? 'F').toUpperCase(),
    pro: true,
    experienceLevel: profile?.identity.experience_level ?? null,
    biologicalSex,
    // Honest beta label until a billing system is wired (single-user beta
    // per CLAUDE.md). Switch to a real renewal date when subscriptions ship.
    subscriptionLabel: 'Faff Pro · Beta',
  };
  // 2026-06-03 · drop "Week N of M" prefix per David's week-labels-out
  // directive. The "of M" framing implies the runner is at the start of
  // their training when they're often mid-block (10y of running). Phase
  // name + race horizon carries the load message without the count.
  // Example: was "Week 1 of 11 · QUALITY phase" · now "QUALITY phase · 74d to Americas Fin"
  const horizonNote = goalRace?.daysAway != null && goalRace.daysAway > 0 && goalRace.name
    ? ` · ${goalRace.daysAway}d to ${goalRace.name.split(' ').slice(0, 2).join(' ')}`
    : '';
  const weekOf = `${glance?.phaseLabel ?? 'Active block'}${horizonNote}`;

  // 2026-06-01 · honest baseline fix. adaptReadiness was setting
  // `readiness.baseline = health.hrv.baseline ?? 60` · the HRV
  // value in milliseconds mislabeled as a readiness baseline. UI
  // then rendered "Baseline 53 · today 42 · −11" mixing two
  // metrics into a meaningless delta.
  //
  // Override with the real readiness baseline (mean of past 14d
  // readiness scores) when available via composition. Falls back
  // to today's score (delta 0 · honest first-day state) when no
  // history yet.
  const honestReadiness = readinessBrief?.composition
    ? { ...readiness, baseline: readinessBrief.composition.baseline }
    : { ...readiness, baseline: readiness.score };
  // Apply to the embedded healthSnapshot too · single source of truth.
  healthSnapshot.readiness = honestReadiness;

  return {
    todayISO: new Date().toISOString(),
    topDate: todayLabel(),
    weekOf,
    user,
    week, todayIdx, results,
    readiness: honestReadiness,
    readinessBrief,
    planProposals,
    pendingWorkoutProposals,
    strengthRecommendation: glance?.strengthRecommendation ?? null,
    strengthWeekStatus: glance?.strengthWeekStatus ?? null,
    goalRace,
    volumeBars,
    thisWeekMiles,
    weeklyAvg,
    form,
    season,
    health: healthSnapshot,
    prs,
    races: racesList,
    unloggedRaceAlert: adaptUnloggedRaceAlert(races),
    projectionTrend,
    activity,
    shoes,
    todayShoeId,
    shoeRecByType,
    connections,
    pendingProposals,
    coachedExternally,
    coachCalendar,
    goalReady,
  };
}
