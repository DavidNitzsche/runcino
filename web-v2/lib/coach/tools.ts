/**
 * Coach tool registry — Anthropic tool-use definitions + handlers.
 *
 * The coach DOES NOT receive pre-extracted facts in its prompt. It receives
 * a list of TOOLS it can call to read from the runner's data sources, and
 * decides which to call based on the surface + mode + its own reasoning.
 *
 * Each tool is a pure read. Tools never mutate state. The coach composes
 * voice from tool results; the server populates numeric topic-card fields
 * from the same data sources after the LLM is done.
 *
 * Add a new tool when:
 *   1. You'd otherwise be tempted to stuff a new fact into the prompt
 *   2. The data has a clear source-of-truth shape worth exposing
 *
 * NEVER add a tool whose handler hardcodes a value the coach is supposed
 * to reason about. Handlers query DB or compute from doctrine, nothing else.
 */
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '@/lib/db/pool';
import { computeZones, zonesAsPromptText } from '@/lib/training/zones';
import { computeReadiness } from './readiness';
import { loadCoachState } from './state-loader';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Tool definitions (the surface the coach sees) ──────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'getProfile',
    description:
      "Read the runner's profile, name, experience_level, lthr (lactate threshold HR), " +
      'hrmax, rhr (resting HR baseline), height_cm, birthday. Call this when you need ' +
      "any biographical or physiological anchor to reason about today's session.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getZones',
    description:
      "Read the runner's HR zone table (LTHR-anchored Friel zones when LTHR is known, " +
      '%MHR fallback otherwise). Returns Z1-Z5 boundaries + the doctrine citation. ' +
      "Call this any time you're about to reference a heart-rate effort level.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getPlanWindow',
    description:
      "Read the runner's planned workouts as an array of {date, dow, type, mi, " +
      'sub_label} rows. The window is relative to today: daysBack=0 means start ' +
      'from today, daysBack=1 means include yesterday, etc. daysForward is days ' +
      "past today to include. To inspect today's session: daysBack=0, daysForward=0. " +
      'To inspect this week: daysBack=days_since_monday, daysForward=days_until_sunday. ' +
      'To look ahead 2 weeks: daysBack=0, daysForward=13.',
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'integer', minimum: 0, maximum: 30 },
        daysForward: { type: 'integer', minimum: 0, maximum: 60 },
      },
      required: ['daysBack', 'daysForward'],
    },
  },
  {
    name: 'getRuns',
    description:
      "Read the runner's actual logged runs in the window. Returns " +
      '{runs: [...], baselines: {...}}. Each run has {date, mi, pace, avgHr, ' +
      'maxHr, avgCadence, avgPowerW, avgVertOscCm, elevGainFt, type, name, ' +
      'splits[], phases[], hrZonePcts, weather}. The baselines block has the ' +
      "runner's distance-weighted averages across the window: avgCadence, " +
      'avgHrEasy, avgHrQuality, avgCadenceEasy, avgCadenceQuality. Use baselines ' +
      "to compare today's numbers without doing arithmetic in your head, they " +
      'are the source of truth for "your recent average". TRUTH CONTRACT: only ' +
      "narrate runs this tool returns; never invent a run that's not in the result.",
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'integer', minimum: 1, maximum: 90 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['daysBack'],
    },
  },
  {
    name: 'getReadiness',
    description:
      "Read today's composite readiness score (0-100) with input breakdown, " +
      'sleep, sleep deficit, RHR delta, HRV, recent training load. Returns ' +
      '{score, band, label, inputs[]}. Call this when you want to read the ' +
      'runner before recommending intensity.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getRaces',
    description:
      "Read the runner's race calendar. Optionally filter by priority (A, B, C). " +
      'Returns {slug, name, date, daysAway, distanceMi, distanceLabel, ' +
      "priority, goalDisplay}. Use this to anchor today's session to the season frame.",
    input_schema: {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['A', 'B', 'C', 'any'] },
        upcomingOnly: { type: 'boolean' },
      },
    },
  },
  {
    name: 'getCheckIns',
    description:
      "Read the runner's SOLID/TIRED/WRECKED self-ratings in the window. " +
      "Returns {ts, rating}[] plus a summary count. Empty if the runner has not " +
      "checked in recently, in which case do NOT claim they rated anything. " +
      "WHEN REFERENCING: say 'three SOLID check-ins' or 'three SOLID days running', " +
      "NEVER 'tapped SOLID three times' (the runner isn't aware of the tap mechanic).",
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'integer', minimum: 1, maximum: 30 },
      },
      required: ['daysBack'],
    },
  },
  {
    name: 'getHealthSeries',
    description:
      "Read the runner's recent health-sample series, sleep hours by night, " +
      'RHR by day, HRV by day, cadence baseline. Returns {sleep[], rhr[], hrv[], ' +
      'cadenceBaseline}. Call this when you want trend, not a single number.',
    input_schema: {
      type: 'object',
      properties: { daysBack: { type: 'integer', minimum: 1, maximum: 30 } },
      required: ['daysBack'],
    },
  },
  {
    name: 'getWorkoutCompletion',
    description:
      "Read the most recent workout completion payload sent by the watch, " +
      'per-phase actuals (pace, distance, HR, cadence per warmup/rep/recovery/cooldown), ' +
      'totals (totalDistanceMi, totalDurationSec, avgHr, maxHr), and the completed flag ' +
      "per phase. Use this on POST-RUN briefs to analyze pace consistency across reps, " +
      'HR drift across same-pace reps, plan-vs-actual distance per phase, and form drift ' +
      '(cadence at start vs end). If workoutId is omitted, returns the latest completion ' +
      "the runner has logged. If no completion has been logged, returns { completion: null }.",
    input_schema: {
      type: 'object',
      properties: {
        workoutId: { type: 'string', description: 'specific workoutId to fetch; omit for latest' },
      },
    },
  },
  {
    name: 'getShoes',
    description:
      'List the runner\'s shoes with current mileage and any retirement target. ' +
      'Each shoe shows current cumulative miles, retirement target, and remaining ' +
      'life. Use this when planning a race-day shoe pick or warning about ' +
      'overdue rotations.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getDoctrine',
    description:
      "Read the research-backed doctrine on a topic, drawn from /Research/. " +
      'Topics: "threshold", "intervals", "tempo", "easy", "long", "cardiac-drift", ' +
      '"taper", "base-volume", "vdot", "hr-zones", "fueling". Returns short prose. ' +
      "Use this when you'd otherwise rely on general knowledge, anchor to the " +
      "runner's research instead.",
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['threshold', 'intervals', 'tempo', 'easy', 'long',
                 'cardiac-drift', 'taper', 'base-volume', 'vdot', 'hr-zones', 'fueling'],
        },
      },
      required: ['topic'],
    },
  },
];

// ── Dispatcher (the wiring the coach never sees) ───────────────────────

export async function dispatchTool(
  name: string,
  userId: string,
  input: Record<string, any>,
): Promise<unknown> {
  // Anthropic tool input arrives as untyped Record. Each handler has its
  // own schema but we cast through `any` at the boundary — validation
  // happens in the schema the SDK enforces against `input_schema`.
  const i = input as any;
  switch (name) {
    case 'getProfile':       return getProfile(userId);
    case 'getZones':         return getZones(userId);
    case 'getPlanWindow':    return getPlanWindow(userId, i);
    case 'getRuns':          return getRuns(userId, i);
    case 'getReadiness':     return getReadiness(userId);
    case 'getRaces':         return getRaces(userId, i);
    case 'getCheckIns':      return getCheckIns(userId, i);
    case 'getHealthSeries':  return getHealthSeries(userId, i);
    case 'getWorkoutCompletion': return getWorkoutCompletion(userId, i);
    case 'getDoctrine':      return getDoctrine(i);
    case 'getShoes':         return getShoes(userId);  // P32 / P15.3
    default:                 return { error: `unknown tool: ${name}` };
  }
}

// ── Handlers (each is a pure read from a source of truth) ──────────────

function todayPT(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

async function getProfile(userId: string) {
  const r = (await pool.query(
    `SELECT full_name, sex, age, city, hrmax, hrmax_observed, lthr,
            rhr, height_cm, experience_level, birthday
       FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!r) return { profile: null };
  return {
    full_name: r.full_name,
    sex: r.sex,
    age: r.age,
    city: r.city,
    hrmax: r.hrmax_observed ?? r.hrmax,   // prefer observed
    lthr: r.lthr,
    rhr: r.rhr,
    height_cm: r.height_cm,
    experience_level: r.experience_level,
    birthday: r.birthday,
  };
}

async function getZones(userId: string) {
  const prof = await getProfile(userId) as any;
  const z = computeZones({ lthr: prof?.lthr ?? null, maxHr: prof?.hrmax ?? null });
  if (!z) return { method: null, zones: [], note: 'no LTHR or MaxHR set' };
  return {
    method: z.method,
    anchor: z.anchor,
    citation: z.citation,
    zones: z.zones,
    prompt_text: zonesAsPromptText(z),
  };
}

async function getPlanWindow(userId: string, input: { daysBack: number; daysForward: number }) {
  const today = todayPT();
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!plan) return { plan_id: null, days: [] };

  const rows = (await pool.query(
    `SELECT date_iso, dow, type, distance_mi::float AS mi, sub_label
       FROM plan_workouts
      WHERE plan_id = $1
        AND date_iso::date BETWEEN ($2::date - $3::int) AND ($2::date + $4::int)
      ORDER BY date_iso ASC`,
    [plan.id, today, input.daysBack, input.daysForward]
  )).rows;
  return {
    plan_id: plan.id,
    today,
    days: rows.map((r: any) => ({
      date: r.date_iso, dow: r.dow, type: r.type,
      mi: Number(r.mi) || 0, sub_label: r.sub_label,
    })),
  };
}

async function getRuns(userId: string, input: { daysBack: number; limit?: number }) {
  const today = todayPT();
  const limit = Math.min(input.limit ?? 25, 50);
  const r = (await pool.query(
    `SELECT data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date >= ($2::date - $3::int)
        AND (data->>'date')::date <= $2::date
      ORDER BY (data->>'date') DESC
      LIMIT $4`,
    [userId, today, input.daysBack, limit]
  )).rows;
  // Pre-compute baselines across the window so coach can reference them
  // by name without doing mental arithmetic. The "Voice: ARITHMETIC" rule
  // forbids the coach from subtracting two numbers in its head — these
  // baselines let it say "your recent avg cadence is 172" without inferring.
  const completedRuns = r
    .map((row: any) => row.data ?? {})
    .filter((d: any) => Number(d.distanceMi ?? d.distance_mi) > 0);
  const weightedAvg = (
    pickValue: (d: any) => number | null,
    pickWeight: (d: any) => number | null,
  ): number | null => {
    let sum = 0;
    let w = 0;
    for (const d of completedRuns) {
      const v = pickValue(d);
      const wt = pickWeight(d) ?? 0;
      if (v == null || !isFinite(v) || wt <= 0) continue;
      sum += v * wt;
      w += wt;
    }
    return w > 0 ? Math.round(sum / w) : null;
  };
  const byType = (t: string) => completedRuns.filter((d: any) => d.type === t);
  const weightedAvgIn = (
    arr: any[],
    pickValue: (d: any) => number | null,
    pickWeight: (d: any) => number | null,
  ): number | null => {
    let sum = 0;
    let w = 0;
    for (const d of arr) {
      const v = pickValue(d);
      const wt = pickWeight(d) ?? 0;
      if (v == null || !isFinite(v) || wt <= 0) continue;
      sum += v * wt;
      w += wt;
    }
    return w > 0 ? Math.round(sum / w) : null;
  };
  const easyRuns = byType('easy').concat(byType('long')).concat(byType('recovery'));
  const qualityRuns = byType('threshold').concat(byType('intervals')).concat(byType('tempo'));
  const baselines = {
    windowDays: input.daysBack,
    runsCounted: completedRuns.length,
    // Overall averages across the window (distance-weighted).
    avgCadence: weightedAvg(
      (d) => d.avgCadence ?? d.cadence ?? null,
      (d) => d.distanceMi ?? d.distance_mi ?? null,
    ),
    avgHrEasy: weightedAvgIn(
      easyRuns,
      (d) => d.avgHr ?? d.hr ?? null,
      (d) => d.distanceMi ?? d.distance_mi ?? null,
    ),
    avgHrQuality: weightedAvgIn(
      qualityRuns,
      (d) => d.avgHr ?? d.hr ?? null,
      (d) => d.distanceMi ?? d.distance_mi ?? null,
    ),
    avgCadenceEasy: weightedAvgIn(
      easyRuns,
      (d) => d.avgCadence ?? d.cadence ?? null,
      (d) => d.distanceMi ?? d.distance_mi ?? null,
    ),
    avgCadenceQuality: weightedAvgIn(
      qualityRuns,
      (d) => d.avgCadence ?? d.cadence ?? null,
      (d) => d.distanceMi ?? d.distance_mi ?? null,
    ),
  };
  return {
    today,
    baselines,
    runs: r.map((row: any) => {
      const d = row.data ?? {};
      const w = d.weather;
      // Field names: jsonb canonically uses camelCase (distanceMi,
      // avgPaceMinPerMi, avgHr, avgCadence). Earlier version read
      // snake_case which always returned nulls — that's why the coach
      // kept saying "no detailed splits to parse" even when splits
      // existed in the row.
      const splits = Array.isArray(d.splits) ? d.splits : [];
      const phases = Array.isArray(d.phases) ? d.phases : [];
      return {
        id: d.id ?? d.activityId ?? null,
        date: d.date,
        mi: Number(d.distanceMi ?? d.distance_mi) || 0,
        pace: d.avgPaceMinPerMi ?? d.pace ?? null,
        avgHr: d.avgHr ?? d.hr ?? null,
        maxHr: d.maxHr ?? null,
        avgCadence: d.avgCadence ?? d.cadence ?? null,
        avgPowerW: d.avgPowerW ?? null,           // running power (HK)
        avgVertOscCm: d.avgVertOscCm ?? null,     // vertical oscillation (HK)
        avgStrideLengthM: d.avgStrideLengthM ?? null,  // stride length (HK)
        avgGctMs: d.avgGctMs ?? null,             // ground contact time (HK)
        elevGainFt: d.elevGainFt ?? null,
        movingTime: d.timeMoving ?? d.movingTime ?? null,
        type: d.type ?? null,
        name: d.name ?? null,
        source: d.source ?? 'strava',
        // Per-mile splits when present — pace + HR + cadence per mile.
        // Coach can reference rep consistency, cardiac drift, fade in late miles.
        splits: splits.length > 0 ? splits.map((s: any) => ({
          mile: s.mile ?? s.index ?? null,
          pace: s.pace ?? s.pace_min_per_mi ?? null,
          hr: s.hr ?? s.avgHr ?? null,
          cadence: s.cadence ?? s.avgCadence ?? null,
        })) : null,
        // Per-phase breakdown (warmup / work / recovery / cooldown) — when
        // the Faff watch app shipped structured-workout phases.
        phases: phases.length > 0 ? phases.map((p: any) => ({
          type: p.type,
          label: p.label ?? null,
          targetPaceSPerMi: p.targetPaceSPerMi ?? null,
          actualPaceSPerMi: p.actualPaceSPerMi ?? null,
          actualDistanceMi: p.actualDistanceMi ?? null,
          actualDurationSec: p.actualDurationSec ?? null,
          avgHr: p.avgHr ?? null,
          avgCadence: p.avgCadence ?? null,
          avgPowerW: p.avgPowerW ?? null,
          avgVertOscCm: p.avgVertOscCm ?? null,
        })) : null,
        // HR-zone distribution when stored — Z1/Z2/Z3/Z4/Z5 percentages.
        hrZonePcts: d.hrZonePcts ?? null,
        weather: w ? {
          temp_f: w.temp_f ?? null,
          humidity_pct: w.humidity_pct ?? null,
          wind_mph: w.wind_mph ?? null,
          conditions: w.conditions ?? null,
        } : null,
      };
    }),
  };
}

async function getShoes(userId: string) {
  // P32 — shoe inventory + current mileage for the coach. Auto-bumped
  // by the recompute-on-PATCH path on /api/runs/[id].
  const rows = (await pool.query(
    `SELECT id, brand, model, color, run_types,
            mileage::numeric AS mileage_mi,
            mileage_cap::numeric AS retirement_mi,
            COALESCE(retired, false) AS retired,
            COALESCE(preferred, false) AS preferred,
            notes
       FROM shoes
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
      ORDER BY retired ASC, preferred DESC, mileage DESC NULLS LAST`,
    [userId]
  )).rows;
  return {
    shoes: rows.map((s: any) => {
      const cur = Number(s.mileage_mi) || 0;
      const target = Number(s.retirement_mi) || 0;
      return {
        id: s.id,
        name: [s.brand, s.model].filter(Boolean).join(' '),
        brand: s.brand,
        model: s.model,
        color: s.color,
        run_types: s.run_types ?? [],
        preferred: Boolean(s.preferred),
        retired: Boolean(s.retired),
        mileage_mi: Math.round(cur * 10) / 10,
        retirement_mi: target || null,
        remaining_mi: target > 0 ? Math.max(0, Math.round((target - cur) * 10) / 10) : null,
        overdue: target > 0 && cur >= target,
        notes: s.notes ?? null,
      };
    }),
  };
}

async function getReadiness(userId: string) {
  const state = await loadCoachState(userId);
  const r = computeReadiness(state);
  return {
    score: r.score,
    band: r.band,
    label: r.label,
    inputs: r.inputs.map((i) => ({
      key: i.key, label: i.label, observedV: i.observedV,
      observedSub: i.observedSub, weight: i.weight, meaning: i.meaning,
    })),
  };
}

async function getRaces(userId: string, input: { priority?: string; upcomingOnly?: boolean }) {
  const today = todayPT();
  const where: string[] = ['(user_uuid = $1 OR user_uuid IS NULL)'];
  const params: any[] = [userId];
  if (input.priority && input.priority !== 'any') {
    where.push(`meta->>'priority' = $${params.length + 1}`);
    params.push(input.priority);
  }
  if (input.upcomingOnly !== false) {
    where.push(`(meta->>'date')::date >= $${params.length + 1}::date`);
    params.push(today);
  }
  const sql = `SELECT slug, meta FROM races WHERE ${where.join(' AND ')}
               ORDER BY (meta->>'date') ASC`;
  const r = (await pool.query(sql, params)).rows;
  return {
    today,
    races: r.map((row: any) => {
      const m = row.meta ?? {};
      const date = m.date;
      const daysAway = date
        ? Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
        : null;
      return {
        slug: row.slug,
        name: m.name,
        date,
        daysAway,
        distanceMi: m.distanceMi != null ? Number(m.distanceMi) : null,
        distanceLabel: m.distanceLabel ?? null,
        priority: m.priority ?? null,
        goalDisplay: m.goalDisplay ?? null,
      };
    }),
  };
}

async function getCheckIns(userId: string, input: { daysBack: number }) {
  const r = (await pool.query(
    `SELECT ts, rating FROM check_ins
      WHERE user_id = $1 AND ts >= (now() - ($2::int || ' days')::interval)
      ORDER BY ts DESC LIMIT 20`,
    [userId, input.daysBack]
  ).catch(() => ({ rows: [] }))).rows;
  const checkIns = r.map((x: any) => ({ ts: x.ts, rating: x.rating }));
  // Summary the coach can quote without inventing wording like "tapped
  // three times" or "three SOLID today." Includes the unique-day count
  // so the LLM has no excuse to conflate "3 check-ins" with "3 today."
  const counts = { solid: 0, tired: 0, wrecked: 0 };
  const uniqueDays = new Set<string>();
  for (const c of checkIns) {
    const k = String(c.rating).toLowerCase();
    if (k === 'solid' || k === 'tired' || k === 'wrecked') counts[k as keyof typeof counts]++;
    if (c.ts) uniqueDays.add(new Date(c.ts).toISOString().slice(0, 10));
  }
  const summary = `${counts.solid} SOLID · ${counts.tired} TIRED · ${counts.wrecked} WRECKED across ${uniqueDays.size} different days in the last ${input.daysBack} days`;
  return { check_ins: checkIns, summary, uniqueDaysCovered: uniqueDays.size };
}

async function getHealthSeries(userId: string, input: { daysBack: number }) {
  const state = await loadCoachState(userId);
  return {
    sleep7Avg: state.sleep7Avg,
    sleep7Deficit: state.sleep7Deficit,
    rhrCurrent: state.rhrCurrent,
    rhrBaseline: state.rhrBaseline,
    hrvCurrent: state.hrvCurrent,
    hrvBaseline: state.hrvBaseline,
    cadenceBaseline: state.cadenceBaseline,
    note: 'For full per-day series, future expansion. Aggregates from loadCoachState today.',
  };
}

async function getWorkoutCompletion(userId: string, input: { workoutId?: string }) {
  // Watch completions land in coach_intents as reason='watch_completion' rows.
  // value column carries the full WatchCompletion JSON the watch agent
  // documented (per-phase actuals + totals). If workoutId is specified we
  // match exactly; otherwise return the most recent.
  //
  // Hardening: if a recent intent has status='abandoned' BUT a richer
  // run exists in strava_activities for the same day (HK / Strava /
  // manual), the abandoned shell is stale data — the runner actually
  // finished the workout in a different app. Hide it. The Real Run is
  // what `getRuns` surfaces; this avoids the coach narrating a phantom
  // "abandoned" workout on top of a real completion.
  const r = (await pool.query(
    input.workoutId
      ? `SELECT value, ts FROM coach_intents
          WHERE user_id = $1 AND reason = 'watch_completion' AND field = $2
            AND acknowledged_at IS NULL
          ORDER BY ts DESC LIMIT 1`
      : `SELECT value, ts FROM coach_intents
          WHERE user_id = $1 AND reason = 'watch_completion'
            AND acknowledged_at IS NULL
          ORDER BY ts DESC LIMIT 1`,
    input.workoutId ? [userId, input.workoutId] : [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return { completion: null, note: 'no watch completion logged for this runner' };
  let payload: any = null;
  try {
    payload = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  } catch {
    return { completion: null, note: 'completion blob unparseable' };
  }

  // Abandoned-shell vs real-completion arbitration.
  if (payload?.status === 'abandoned' || payload?.status === 'aborted') {
    const startedAt: string | undefined = payload?.startedAt ?? payload?.startTime;
    const localDate = startedAt
      ? new Date(startedAt).toISOString().slice(0, 10)
      : new Date(r.ts).toISOString().slice(0, 10);
    const hasReal = (await pool.query(
      `SELECT 1 FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')
          AND data->>'date' = $2
          AND (data->>'distanceMi')::numeric > 0.5
        LIMIT 1`,
      [userId, localDate]
    ).catch(() => ({ rowCount: 0 }))).rowCount ?? 0;
    if (hasReal > 0) {
      return { completion: null, note: 'watch-app session abandoned, but the runner finished the workout elsewhere, see getRuns for the real completion.' };
    }
  }

  return { completion: payload, ingested_at: r.ts };
}

async function getDoctrine(input: { topic: string }) {
  // Doctrine lives in /Research/ as markdown. Map topic -> filename.
  // Files verified present in repo. When a topic spans multiple files,
  // pick the one with the workout vocabulary / training-principle anchor.
  const map: Record<string, string> = {
    'hr-zones':       '03-heart-rate-zones.md',
    'threshold':      '04-workout-vocabulary.md',   // §5 threshold family
    'intervals':      '04-workout-vocabulary.md',   // VO2max intervals
    'tempo':          '04-workout-vocabulary.md',   // continuous tempo
    'easy':           '04-workout-vocabulary.md',   // §2 easy/general aerobic
    'long':           '04-workout-vocabulary.md',   // long-run family
    'cardiac-drift':  '03-heart-rate-zones.md',
    'taper':          '08-pacing-and-race-week.md',
    'base-volume':    '00a-distance-running-training.md',
    'vdot':           '01-pace-zones-vdot.md',
    'fueling':        '18-fueling-products.md',
  };
  const filename = map[input.topic];
  if (!filename) return { topic: input.topic, doctrine: null, note: 'topic not found' };
  const path = join(process.cwd(), 'Research', filename);
  if (!existsSync(path)) {
    return { topic: input.topic, doctrine: null, note: `${filename} not found in /Research/` };
  }
  try {
    const md = readFileSync(path, 'utf8');
    // Cap doctrine length to keep token budget sane — first ~5KB. The
    // coach can re-call for a different topic rather than reading a 30KB
    // file in one go.
    return { topic: input.topic, source: `Research/${filename}`, doctrine: md.slice(0, 5000) };
  } catch {
    return { topic: input.topic, doctrine: null, note: 'read failed' };
  }
}
