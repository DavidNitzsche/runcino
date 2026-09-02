/**
 * lib/safety/load-safety.ts · the READ half of the canonical safety owner.
 *
 * `safety-verdict.ts` is pure and holds the decision. This file holds the
 * three point reads that feed it, and it is the ONLY place in the app that
 * reads `runner_injuries`, `sick_episodes` or `niggles` in order to decide
 * whether training may proceed. `lib/safety/_safety_ownership.test.ts` is the
 * ratchet that keeps that true.
 *
 * ── WHY THE READS LIVE HERE AND NOT IN `glance-state.ts` ────────────────────
 *
 * They used to live there, and `lib/watch/build-workout.ts` kept a second copy
 * whose own comment says why: "Read here rather than through loadGlanceState
 * because the watch payload needs three booleans, not a readiness
 * computation". That is a real constraint and it was answered by duplicating
 * the queries, which is how the wrist and the phone came to disagree about
 * what an open injury means. `resolveSafety` is the answer that keeps the
 * constraint and drops the duplication: three point reads, no readiness
 * computation, no plan load, callable from either surface.
 *
 * `loadGlanceState` now calls it and derives its own injury/illness/niggle
 * fields from the result, so the phone makes three reads where it used to make
 * three, and the watch can stop making its own.
 *
 * ── RULE 11 · WHAT EACH READ CAN RETURN ─────────────────────────────────────
 *
 * `attempt` from `lib/db/read.ts` tags every outcome, and this file keeps the
 * tag rather than flattening it. A failure is split once more:
 *
 *   · SQLSTATE 42P01 (undefined_table) -> `NOT_DEPLOYED`. The signal does not
 *     exist in this deployment at all.
 *   · anything else                    -> `READ_FAILED`.
 *
 * BOTH produce UNKNOWN when the signal could have changed the answer. A table
 * that is not there is not evidence the runner is uninjured, and this is the
 * clause the runner ruled on directly: "A failed safety read must never
 * silently become 'not injured.'"
 *
 * The distinction is kept anyway because the two need different fixes and an
 * operator reading a log should be able to tell a blip from a missing
 * migration. `runner_injuries` had NO migration file in `db/migrations` when
 * this module was written (the table exists in production and nowhere else),
 * which is exactly the condition `NOT_DEPLOYED` names; `162_runner_injuries.sql`
 * was added alongside this file to close it.
 *
 * ── COST ───────────────────────────────────────────────────────────────────
 *
 * Three LIMIT-1 indexed point reads, issued in parallel. This sits on the
 * wrist's critical path, so it does no more work than the code it replaces.
 */
import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import {
  classifySafety,
  type IllnessSignal,
  type InjurySignal,
  type NiggleSignal,
  type SafetyInputs,
  type SafetyResolution,
  type SignalFailure,
  type SignalRead,
} from './safety-verdict';

/** 42P01 = undefined_table. A missing relation is a deployment fact. */
function failureOf(e: unknown): SignalFailure {
  const code = (e as { code?: string } | null)?.code;
  return code === '42P01' ? 'NOT_DEPLOYED' : 'READ_FAILED';
}

type InjuryRow = {
  id: number; site: string; severity: string;
  start_date: string; expected_return_date: string | null;
  return_protocol: string | null; notes: string | null;
};
type IllnessRow = {
  id: string | number; symptoms: unknown; has_fever: boolean;
  started: string; logged_at: string | Date; days_active: string | number;
};
type NiggleRow = {
  id: string | number; body_part: string; severity: string | number;
  side: string | null; status: string;
  logged_at: string | Date; days_active: string | number;
};

async function readInjury(userUuid: string): Promise<SignalRead<InjurySignal>> {
  const r = await attempt('safety/open-injury', pool.query<InjuryRow>(
    `SELECT id, site, severity, start_date::text AS start_date,
            expected_return_date::text AS expected_return_date,
            return_protocol, notes
       FROM runner_injuries
      WHERE user_uuid = $1 AND resolved_date IS NULL
      ORDER BY start_date DESC
      LIMIT 1`,
    [userUuid],
  ));
  if (!r.ok) return { ok: false, failure: failureOf(r.error) };
  const row = r.value.rows[0];
  if (!row) return { ok: true, value: null };
  // `severity` is a free TEXT column with no CHECK constraint in production.
  // An unrecognised value is NOT quietly demoted to the mildest band — that
  // would be a swallowed failure wearing a default's clothes. It is read as
  // the most serious, which is the only direction a guess is allowed to run.
  const severity: InjurySignal['severity'] =
    row.severity === 'minor' ? 'minor'
      : row.severity === 'moderate' ? 'moderate'
        : 'major';
  return {
    ok: true,
    value: {
      id: Number(row.id),
      site: String(row.site),
      severity,
      startDateISO: String(row.start_date),
      expectedReturnDateISO: row.expected_return_date ?? null,
      returnProtocol: row.return_protocol ?? null,
      notes: row.notes ?? null,
    },
  };
}

async function readIllness(userUuid: string): Promise<SignalRead<IllnessSignal>> {
  const r = await attempt('safety/active-illness', pool.query<IllnessRow>(
    `SELECT id, symptoms, started, has_fever, logged_at,
            EXTRACT(EPOCH FROM (now() - logged_at)) / 86400.0 AS days_active
       FROM sick_episodes
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC
      LIMIT 1`,
    [userUuid],
  ));
  if (!r.ok) return { ok: false, failure: failureOf(r.error) };
  const row = r.value.rows[0];
  if (!row) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      id: Number(row.id),
      symptoms: Array.isArray(row.symptoms) ? (row.symptoms as string[]) : [],
      hasFever: Boolean(row.has_fever),
      started: String(row.started),
      loggedAtISO: new Date(row.logged_at).toISOString(),
      daysActive: Math.floor(Number(row.days_active) || 0),
    },
  };
}

async function readNiggle(userUuid: string): Promise<SignalRead<NiggleSignal>> {
  const r = await attempt('safety/active-niggle', pool.query<NiggleRow>(
    `SELECT id, body_part, severity, side, status, logged_at,
            EXTRACT(EPOCH FROM (now() - logged_at)) / 86400.0 AS days_active
       FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC
      LIMIT 1`,
    [userUuid],
  ));
  if (!r.ok) return { ok: false, failure: failureOf(r.error) };
  const row = r.value.rows[0];
  if (!row) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      id: Number(row.id),
      bodyPart: String(row.body_part),
      severity: Number(row.severity),
      side: (row.side as NiggleSignal['side']) ?? null,
      status: String(row.status),
      loggedAtISO: new Date(row.logged_at).toISOString(),
      daysActive: Math.floor(Number(row.days_active) || 0),
    },
  };
}

/** The three reads, tagged. Exposed so a caller that already has them can
 *  classify without re-reading, and so the behavioural suite can drive the
 *  classifier with hand-built inputs. */
export async function loadSafetyInputs(userUuid: string): Promise<SafetyInputs> {
  const [injury, illness, niggle] = await Promise.all([
    readInjury(userUuid),
    readIllness(userUuid),
    readNiggle(userUuid),
  ]);
  return { injury, illness, niggle };
}

/**
 * THE ENTRY POINT EVERY SURFACE CALLS.
 *
 *     const safety = await resolveSafety(userUuid);
 *     if (!mayEmitRunnableWorkout(safety)) { …no session… }
 *
 * Never throws: a database that is entirely unreachable resolves to the
 * UNKNOWN branch, which is the honest answer and the conservative one.
 */
export async function resolveSafety(userUuid: string): Promise<SafetyResolution> {
  return classifySafety(await loadSafetyInputs(userUuid));
}
