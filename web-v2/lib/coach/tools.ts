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
      "Read the runner's profile — name, experience_level, lthr (lactate threshold HR), " +
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
      "Read the runner's actual logged runs in the window. Returns array of " +
      '{date, mi, pace, hr, cadence, type, name, source}. Use this to know what ' +
      "actually happened, not what was planned. TRUTH CONTRACT: only narrate runs " +
      'this tool returns — never invent a run that\'s not in the result.',
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
      "Read today's composite readiness score (0-100) with input breakdown — " +
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
      'Returns {ts, rating}[]. Empty if they have not tapped recently — in ' +
      "which case do NOT claim they rated anything; just don't mention it.",
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
      "Read the runner's recent health-sample series — sleep hours by night, " +
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
      "Read the most recent workout completion payload sent by the watch — " +
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
    name: 'getDoctrine',
    description:
      "Read the research-backed doctrine on a topic, drawn from /Research/. " +
      'Topics: "threshold", "intervals", "tempo", "easy", "long", "cardiac-drift", ' +
      '"taper", "base-volume", "vdot", "hr-zones", "fueling". Returns short prose. ' +
      "Use this when you'd otherwise rely on general knowledge — anchor to the " +
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
  switch (name) {
    case 'getProfile':       return getProfile(userId);
    case 'getZones':         return getZones(userId);
    case 'getPlanWindow':    return getPlanWindow(userId, input);
    case 'getRuns':          return getRuns(userId, input);
    case 'getReadiness':     return getReadiness(userId);
    case 'getRaces':         return getRaces(userId, input);
    case 'getCheckIns':      return getCheckIns(userId, input);
    case 'getHealthSeries':  return getHealthSeries(userId, input);
    case 'getWorkoutCompletion': return getWorkoutCompletion(userId, input);
    case 'getDoctrine':      return getDoctrine(input);
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
  return {
    today,
    runs: r.map((row: any) => ({
      id: row.data?.id ?? null,
      date: row.data?.date,
      mi: Number(row.data?.distance_mi) || 0,
      pace: row.data?.pace ?? null,
      hr: row.data?.hr ?? null,
      cadence: row.data?.cadence ?? null,
      type: row.data?.type ?? null,
      name: row.data?.name ?? null,
      source: row.data?.source ?? 'strava',
    })),
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
  return { check_ins: r.map((x: any) => ({ ts: x.ts, rating: x.rating })) };
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
  const r = (await pool.query(
    input.workoutId
      ? `SELECT value, ts FROM coach_intents
          WHERE user_id = $1 AND reason = 'watch_completion' AND field = $2
          ORDER BY ts DESC LIMIT 1`
      : `SELECT value, ts FROM coach_intents
          WHERE user_id = $1 AND reason = 'watch_completion'
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
