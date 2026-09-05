/**
 * lib/safety/load-safety.ts · the READ half of the canonical safety owner.
 *
 * `safety-verdict.ts` is pure and holds the decision. This file holds the
 * FIVE reads that feed it, and it is the ONLY place in the app that reads
 * `runner_injuries`, `sick_episodes` or `niggles` in order to decide whether
 * training may proceed. `lib/safety/_safety_ownership.test.ts` is the ratchet
 * that keeps that true.
 *
 * Two of the five landed 2026-09-05, closing two states Constitution §2.E
 * names and nothing in this app supplied: RETURN-TO-RUNNING (the window after
 * an injury is resolved) and RECENT TRAINING DISRUPTION (a break long enough
 * that `Research/22` §14 restarts the runner below their previous volume).
 * Before that, the Adaptation Engine's live loader wrote `safety: 'NORMAL'` as
 * a literal, which is the defect `lib/safety/training-safety.ts` exists to
 * close and `_safety_wired_live.test.ts` is the ratchet for.
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
 * ── COST · RESTATED HONESTLY 2026-09-05, BECAUSE THE OLD SENTENCE IS NOW FALSE
 *
 * This header used to read: "Three LIMIT-1 indexed point reads, issued in
 * parallel. This sits on the wrist's critical path, so it does no more work
 * than the code it replaces." That was true of three signals and is not true of
 * five. Rule 20's corollary: gate the claim or delete the sentence, and a
 * sentence nothing verifies is worse than silence. So here is what it actually
 * costs now.
 *
 *   · injury, illness, niggle · three point reads. The niggle one is LIMIT 12
 *     rather than LIMIT 1, because escalation is a comparison and one row
 *     cannot make one. A row cap, not a widened scan.
 *   · returnToRunning · one point read, plus a `coach_intents` count that is
 *     issued ONLY when an injury was resolved inside the window. Fifteen of the
 *     sixteen production accounts have no `runner_injuries` row at all, so for
 *     them the second query never runs.
 *   · disruption · the genuinely new work. One `runs` read over a 180-day
 *     window, plus `loadPrescribedWindows`'s `races` read for the Rule 8
 *     filter. Neither predicate is index-backed (the run day is computed out of
 *     the `data` jsonb), so both are scans over one user's own rows: 159 runs
 *     and a handful of races for the owner today.
 *
 * All five are issued through one `Promise.all`, so the added LATENCY is the
 * slowest of them rather than their sum. Measured against production on
 * 2026-09-05, a full five-signal resolution for the owner returned in well
 * under a second including connection setup.
 *
 * IT IS STILL MORE WORK THAN BEFORE, and this sits on the wrist's critical
 * path. If that ever shows up as a real latency complaint, the fix is NOT to
 * give the watch a cheaper subset: two subsets is how the wrist and the phone
 * came to disagree about an open injury in the first place. It is to make the
 * disruption read cheaper, or to cache it, since a gap in running does not
 * change between one request and the next.
 */
import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';
import { isPrescribedNonNormal, loadPrescribedWindows } from '@/lib/training/normal-window';
import {
  classifySafety,
  DISRUPTION_LONG_CONSTRAINT_DAYS,
  DISRUPTION_LONG_GAP_DAYS,
  DISRUPTION_MIN_GAP_DAYS,
  DISRUPTION_SHORT_CONSTRAINT_DAYS,
  type DisruptionSignal,
  type IllnessSignal,
  type InjurySignal,
  type NiggleSignal,
  type ReturnToRunningSignal,
  type SafetyInputs,
  type SafetyResolution,
  type SignalFailure,
  type SignalRead,
} from './safety-verdict';

/**
 * How this module reaches the database.
 *
 * Defaults to the app's shared writable pool, which is what every existing
 * caller wants. It is a PARAMETER so the canonical shadow evaluation can pass
 * `roQuery` from `lib/adaptation/canonical-shadow/read-only-db.ts` and get the
 * SAME SQL over its fenced read-only connection.
 *
 * Rule 16 is the reason this is a seam rather than a second copy of the
 * queries. A shadow-only duplicate of the safety reads is precisely how the
 * wrist and the phone came to disagree about what an open injury means, and
 * that duplication is what `lib/safety` was created to end. One set of
 * statements, two connections.
 */
export type SafetyQuery = <R>(
  sql: string,
  params: readonly unknown[],
) => Promise<{ rows: R[] }>;

const defaultQuery: SafetyQuery = <R>(sql: string, params: readonly unknown[]) =>
  pool.query<R extends Record<string, unknown> ? R : never>(sql, params as unknown[]) as
    unknown as Promise<{ rows: R[] }>;

/** 42P01 = undefined_table. A missing relation is a deployment fact. */
function failureOf(e: unknown): SignalFailure {
  const code = (e as { code?: string } | null)?.code;
  return code === '42P01' ? 'NOT_DEPLOYED' : 'READ_FAILED';
}

const DAY_MS = 86_400_000;
const dayOf = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const isoShift = (iso: string, days: number): string =>
  new Date(dayOf(iso) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number =>
  Math.round((dayOf(b) - dayOf(a)) / DAY_MS);

/**
 * How long after an injury is RESOLVED the runner is still building back.
 *
 * 30 days, and it is not a new number: `lib/plan/return-checkin-store.ts`
 * (`resolved_date >= CURRENT_DATE - INTERVAL '30 days'`) and
 * `app/api/v5/races/route.ts`'s `detectReturningFromInjury` both already use
 * exactly this window for exactly this question, and their own comment calls it
 * "recently healed still informs return-to-run framing". Rule 16 says one
 * quantity gets one name; this is the name, and the two existing sites are
 * named here so a future reconciliation knows where to look.
 *
 * DOCTRINE POSTURE, stated rather than implied (Rule 20): 30 days is a POLICY
 * ASSUMPTION inherited from those sites, not a research figure.
 * `Research/22-plan-templates.md` §14's moderate-layoff table runs six weeks
 * and its long-layoff table runs longer, so 30 days is the CONSERVATIVE side of
 * doctrine for a moderate case and the permissive side for a severe one. It can
 * only add a sentence and refuse an upward proposal, which is the
 * lowest-consequence place to be wrong.
 */
export const RETURN_TO_RUNNING_WINDOW_DAYS = 30;

/** How far back the gap search looks. Wide enough to contain the longest
 *  constraint window plus the longest gap that could open it. */
const DISRUPTION_LOOKBACK_DAYS = 180;

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
  logged_at: string | Date; cleared_at: string | Date | null;
  days_active: string | number;
};

async function readInjury(userUuid: string, q: SafetyQuery): Promise<SignalRead<InjurySignal>> {
  const r = await attempt('safety/open-injury', q<InjuryRow>(
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

async function readIllness(userUuid: string, q: SafetyQuery): Promise<SignalRead<IllnessSignal>> {
  const r = await attempt('safety/active-illness', q<IllnessRow>(
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

/**
 * The current niggle, and whether it is ESCALATING.
 *
 * ONE query, widened from LIMIT 1 to the recent history of the SAME body part,
 * because escalation is a comparison and a single row cannot make one.
 * `Research/05-injury-return-protocols.md` §1.6 lists "Symptoms worsening
 * rather than improving" among the universal red flags, and that is what this
 * detects: the newest uncleared reading against the most recent earlier
 * reading of the same site, cleared or not.
 *
 * Cost: still one indexed point read, LIMIT 12 instead of LIMIT 1. This sits on
 * the wrist's critical path and the widening is a row cap, not a scan.
 *
 * RULE 11 · `previousSeverity` is null when there is exactly one reading, and
 * that is a THIRD fact next to "the previous reading was milder" and "the
 * previous reading was worse". A single reading is not evidence of stability.
 */
async function readNiggle(userUuid: string, q: SafetyQuery): Promise<SignalRead<NiggleSignal>> {
  const r = await attempt('safety/active-niggle', q<NiggleRow>(
    `SELECT id, body_part, severity, side, status, logged_at, cleared_at,
            EXTRACT(EPOCH FROM (now() - logged_at)) / 86400.0 AS days_active
       FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1
      ORDER BY logged_at DESC
      LIMIT 12`,
    [userUuid],
  ));
  if (!r.ok) return { ok: false, failure: failureOf(r.error) };
  const rows = r.value.rows;
  // The verdict is about what is CURRENTLY open. A cleared history informs the
  // trend and never becomes the driver on its own.
  const current = rows.find((x) => x.cleared_at == null);
  if (!current) return { ok: true, value: null };

  const site = String(current.body_part);
  const currentAt = new Date(current.logged_at).getTime();
  // STRICTLY EARLIER, not merely "a different row". `current` is the first
  // UNCLEARED row, and a cleared row for the same site could have been logged
  // after it; comparing against that would make `previousSeverity` a later
  // reading than the one it is the previous of. Rare, and the kind of thing
  // that produces a confident wrong "escalating" rather than a visible error.
  const earlier = rows.filter(
    (x) => String(x.body_part) === site
      && String(x.id) !== String(current.id)
      && new Date(x.logged_at).getTime() < currentAt,
  );
  // `rows` arrives newest-first, so the first earlier row for this site IS the
  // most recent earlier reading.
  const prev = earlier[0];
  const previousSeverity = prev ? Number(prev.severity) : null;
  const severity = Number(current.severity);

  return {
    ok: true,
    value: {
      id: Number(current.id),
      bodyPart: site,
      severity,
      side: (current.side as NiggleSignal['side']) ?? null,
      status: String(current.status),
      loggedAtISO: new Date(current.logged_at).toISOString(),
      daysActive: Math.floor(Number(current.days_active) || 0),
      previousSeverity,
      escalating: previousSeverity != null && severity > previousSeverity,
    },
  };
}

/**
 * IS THIS RUNNER INSIDE THE WINDOW AFTER A RESOLVED INJURY?
 *
 * Constitution §2.E gives Safety "return-to-running restrictions" by name, and
 * nothing in this app supplied one until now.
 *
 * TWO reads, and the second is CONDITIONAL on the first, which is the whole
 * reason this signal is cheap and the reason a failure of it is rare enough to
 * matter honestly. A runner with no injury row resolved inside the window
 * cannot be on a ladder, so the check-in count is never asked for. Fifteen of
 * the sixteen production accounts have no `runner_injuries` row at all, so for
 * them this signal costs exactly one indexed point read and can only return
 * `{ ok: true, value: null }`.
 *
 * An OPEN injury deliberately does not produce this signal. That runner is rank
 * 1, already stopped, and reporting them at rank 4 as well would be one fact
 * under two names.
 */
async function readReturnToRunning(
  userUuid: string,
  q: SafetyQuery,
): Promise<SignalRead<ReturnToRunningSignal>> {
  const r = await attempt('safety/return-to-running', q<{
    id: number; site: string; resolved_date: string;
    return_protocol: string | null; days_since: string | number;
  }>(
    `SELECT id, site, resolved_date::text AS resolved_date, return_protocol,
            (CURRENT_DATE - resolved_date) AS days_since
       FROM runner_injuries
      WHERE user_uuid = $1
        AND resolved_date IS NOT NULL
        AND resolved_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      ORDER BY resolved_date DESC
      LIMIT 1`,
    [userUuid, RETURN_TO_RUNNING_WINDOW_DAYS],
  ));
  if (!r.ok) return { ok: false, failure: failureOf(r.error) };
  const row = r.value.rows[0];
  if (!row) return { ok: true, value: null };

  /* The ladder check-ins, if any. `lib/plan/return-checkin-store.ts` writes
   * them as `coach_intents` rows (`reason = 'v5_return_checkin'`, `field` =
   * the injury id) because `runner_injuries` has no jsonb column; that is its
   * storage decision and this only counts them. Rule 11 and Constitution §5:
   * a failed count is NOT zero check-ins, so it fails the whole signal rather
   * than reporting a ladder that has not started. `lib/plan/return-ladder.ts`
   * owns what STAGE the runner is on and nothing here re-derives one. */
  const c = await attempt('safety/return-checkin-count', q<{ n: string | number }>(
    `SELECT count(*) AS n FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'v5_return_checkin'
        AND field = $2`,
    [userUuid, String(row.id)],
  ));
  if (!c.ok) return { ok: false, failure: failureOf(c.error) };

  return {
    ok: true,
    value: {
      injuryId: Number(row.id),
      site: String(row.site),
      resolvedDateISO: String(row.resolved_date),
      daysSinceResolved: Math.max(0, Math.floor(Number(row.days_since) || 0)),
      checkinCount: Number(c.value.rows[0]?.n ?? 0),
      returnProtocol: row.return_protocol ?? null,
    },
  };
}

/**
 * WAS THERE AN UNPLANNED BREAK IN RUNNING, AND IS THE RESTART STILL RUNNING?
 *
 * ── RULE 8 · THE FILTER, AND WHY THIS READER NEEDS IT ──────────────────────
 *
 * A taper is a stretch of reduced running the engine ITSELF prescribed, and a
 * post-race recovery block can be four weeks of it. Reading either as an
 * unplanned break would report the app's own instruction back to it as a
 * safety finding, which is Rule 8's exact bug shape pointed at a new reader.
 * Every prescribed day is excluded through `lib/training/normal-window.ts`,
 * which is the ONE filter, and the windows come from `loadPrescribedWindows`
 * rather than from a second derivation here.
 *
 * `loadPrescribedWindows` refuses rather than answering `[]` on a failed read,
 * and this reader lets that refusal through as `READ_FAILED` instead of
 * catching it. An empty window list and an unreadable one are different facts
 * (Rule 11), and treating the second as the first would put this reader
 * straight back on the contaminated window.
 *
 * ── WHICH SIDE OF RULE 8's COROLLARY THIS FALLS ON ─────────────────────────
 *
 * HABIT. It asks what this runner's training normally looks like and whether
 * something interrupted it, which is a capability question, not an
 * absorbed-load question. The corollary's unfiltered lane is for injury guards
 * reading literal recent tissue load; this is not one of those.
 */
async function readDisruption(
  userUuid: string,
  todayISO: string,
  q: SafetyQuery,
): Promise<SignalRead<DisruptionSignal>> {
  const sinceISO = isoShift(todayISO, -DISRUPTION_LOOKBACK_DAYS);

  const r = await attempt('safety/training-disruption', q<{ day: string }>(
    `SELECT DISTINCT ${runDaySql()} AS day
       FROM runs
      WHERE user_uuid = $1::uuid
        AND ${runDaySql()} >= $2
        AND ${runDaySql()} <= $3
        AND ${runNotMergedSql()}
      ORDER BY day ASC`,
    [userUuid, sinceISO, todayISO],
  ));
  if (!r.ok) return { ok: false, failure: failureOf(r.error) };

  let windows;
  try {
    windows = await loadPrescribedWindows(userUuid, todayISO, q);
  } catch (e) {
    // Rule 8's own instruction: if excluding leaves nothing honest to say, say
    // so and refuse. Falling back to the unfiltered window is how every row in
    // Rule 8's table happened.
    return { ok: false, failure: failureOf(e) };
  }

  const days = r.value.rows.map((x) => String(x.day).slice(0, 10)).filter(Boolean);
  // Rule 11 · no runs in the window at all is a real fact and the wrong one to
  // spend. A runner with no run history is not "recently disrupted", they are
  // a runner this reader has nothing to say about, and the plan generator's
  // cold start owns that case.
  if (days.length === 0) return { ok: true, value: null };

  /* Walk the day list and find the most recent gap that doctrine calls a
   * break. Days inside a prescribed window do not count toward a gap: a taper
   * that contains three non-running days has not disrupted anything. */
  let best: DisruptionSignal | null = null;
  for (let i = 1; i < days.length; i += 1) {
    const prevRun = days[i - 1];
    const nextRun = days[i];
    let gap = 0;
    for (let d = 1; d < daysBetween(prevRun, nextRun); d += 1) {
      const iso = isoShift(prevRun, d);
      if (!isPrescribedNonNormal(iso, windows)) gap += 1;
    }
    if (gap < DISRUPTION_MIN_GAP_DAYS) continue;
    const windowDays = gap >= DISRUPTION_LONG_GAP_DAYS
      ? DISRUPTION_LONG_CONSTRAINT_DAYS
      : DISRUPTION_SHORT_CONSTRAINT_DAYS;
    const sinceReturn = daysBetween(nextRun, todayISO);
    if (sinceReturn > windowDays) continue;      // the restart has completed
    best = {
      gapDays: gap,
      gapEndedISO: isoShift(nextRun, -1),
      returnedOnISO: nextRun,
      daysSinceReturn: sinceReturn,
      constraintWindowDays: windowDays,
    };
  }

  /* And the open-ended case: the runner has not come back yet. Counted from
   * the last run to today with the same prescribed-day exclusion, so a runner
   * three weeks into a marathon recovery block is not reported as disrupted. */
  const last = days[days.length - 1];
  let openGap = 0;
  for (let d = 1; d <= daysBetween(last, todayISO); d += 1) {
    const iso = isoShift(last, d);
    if (!isPrescribedNonNormal(iso, windows)) openGap += 1;
  }
  if (openGap >= DISRUPTION_MIN_GAP_DAYS) {
    best = {
      gapDays: openGap,
      gapEndedISO: todayISO,
      returnedOnISO: null,
      daysSinceReturn: 0,
      constraintWindowDays: openGap >= DISRUPTION_LONG_GAP_DAYS
        ? DISRUPTION_LONG_CONSTRAINT_DAYS
        : DISRUPTION_SHORT_CONSTRAINT_DAYS,
    };
  }

  return { ok: true, value: best };
}

/** The five reads, tagged. Exposed so a caller that already has them can
 *  classify without re-reading, and so the behavioural suite can drive the
 *  classifier with hand-built inputs. */
export async function loadSafetyInputs(
  userUuid: string,
  opts: { readonly todayISO?: string; readonly query?: SafetyQuery } = {},
): Promise<SafetyInputs> {
  const q = opts.query ?? defaultQuery;
  const todayISO = opts.todayISO ?? new Date().toISOString().slice(0, 10);
  const [injury, illness, niggle, returnToRunning, disruption] = await Promise.all([
    readInjury(userUuid, q),
    readIllness(userUuid, q),
    readNiggle(userUuid, q),
    readReturnToRunning(userUuid, q),
    readDisruption(userUuid, todayISO, q),
  ]);
  return { injury, illness, niggle, returnToRunning, disruption };
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
export async function resolveSafety(
  userUuid: string,
  opts: { readonly todayISO?: string; readonly query?: SafetyQuery } = {},
): Promise<SafetyResolution> {
  return classifySafety(await loadSafetyInputs(userUuid, opts));
}
