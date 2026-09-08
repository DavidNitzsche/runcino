/**
 * lib/coach/_glance_done_state_row_identity.test.ts
 *
 * TODAY'S DONE-STATE GRADES THE RUN THAT SATISFIED TODAY'S PRESCRIPTION.
 *
 * ── THE DEFECT (SIMROW-1 · GLANCE, found 2026-09-08) ────────────────────────
 *
 * `computeTodayExecution` resolved the phases it grades with its own query —
 * this runner, reason `watch_completion`, this DATE, `ORDER BY ts DESC LIMIT
 * 1`, over `.catch(() => ({ rows: [] }))`. It named no run at all. So on a day
 * carrying more than one completion payload, the done-state on Today — the
 * word the runner reads about the session he just finished — was decided by
 * whichever payload was written LAST, and a failed read became a confident
 * "nailed".
 *
 * Confirmed against the owner's production rows through `faff_readonly`.
 * 2026-09-02 carries three `watch_completion` intents:
 *
 *     0645f40c-…-2026-09-02#0919   @10:38   13 phases   ← his run
 *     sim-recovery-live#1101       @11:25    3 phases
 *     sim-recovery-live#1038       @11:25    3 phases   ← graded
 *
 * so the done-state for his 6.41 mi easy-plus-strides session was computed
 * from a SIMULATOR payload whose single work phase is 31 s / 0.09 mi. Four
 * days in his history select a payload that is not his run's.
 *
 * ── THE SECOND DEFECT (GLANCE-FALLBACK-1, found 2026-09-08) ────────────────
 *
 * THIS FILE'S HEADER USED TO CLAIM the fix above changed no word the runner
 * had read — "the OLD selection and the NEW one emit the SAME done-state on
 * every single day". That claim was FALSE, and the truth was worse than an
 * overclaim, so it is corrected here rather than quietly deleted.
 *
 * The first cut required `primaryPrescription(...)?.matchedRun` to be non-null
 * before it would grade anything. When it is null the function does not
 * refuse — it falls through to `overreach ? 'over' : 'nailed'`. So a FAILED
 * run-identity match rendered as the single MOST FLATTERING word available.
 *
 * Replayed over every day in this account carrying both a prescription and a
 * real run (`_replay_glance_done_state.script.ts`, against a local copy of the
 * owner's rows): `matchedRun` is null on 31 of 77 such days, and on FOUR the
 * done-state moved, all of them in the same direction —
 *
 *     2026-05-31   short -> nailed    long        12.36 mi run, 12 mi planned
 *     2026-06-02   short -> nailed    intervals    7.41 mi run, 7.5 planned
 *     2026-06-04   short -> nailed    tempo        7.76 mi run, 8 planned
 *     2026-07-14   short -> nailed    tempo        8.02 mi run, 8 planned
 *
 * On all four, the runner's OWN canonical run names its OWN completion through
 * `watchCompletionRef` — rung 1 of `resolveStoredPhases`, no date match
 * anywhere — and the execution resolver still (correctly) declines it: they
 * are `apple_watch` passive syncs with no `planWorkoutId`, and the two that
 * carry `workoutTypeSource = 'plan'` are refused by
 * PASSIVE-SYNC-TYPE-CONFIRM-1 because their own `type` is the generic 'Run'.
 * The phases were his, they were reachable by identity, and the stricter
 * selection walked past them to say "nailed" over four sessions he cut short.
 *
 * The fix is the fallback `lib/postrun/load.ts#loadRun` has always had, read
 * through the same function (`dayBiggestCanonicalRun`) rather than copied: ask
 * the execution resolver first, and when it names nothing, take the day's
 * biggest run OF THIS RUNNER'S OWN. Never a date-matched stranger — the query
 * cannot reach another runner, another date, or a merged twin.
 *
 * After the fix the same replay reports FOUR HEAD-vs-LIVE moves, all four of
 * them the rows above returning to `short`, and ZERO other days changed.
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *
 *   A · the graded phases are the MATCHED RUN'S, not the day's latest payload;
 *   B · when the decoy grades differently, the done-state follows the RUN;
 *   C · nothing matched and no run row → grades nothing and says so through
 *       the volume read, never by reaching for another payload (Rule 11);
 *   D · a failed read is NOT a confident 'nailed' — it propagates;
 *   E · the function still calls both owners, and carries no completion
 *       lookup of its own. A behavioural test cannot catch a surface that
 *       stops calling the resolver.
 *   F · GLANCE-FALLBACK-1 · nothing matched but the runner DID run → his own
 *       run's phases are graded, not the flattering default;
 *   G · the fallback reaches only HIS runs, and the source still calls the
 *       one owner rather than re-typing its query.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot fail on `resolveWorkoutVerdict` grading a session wrongly — it
 * asserts which ARRAY reached the grader, and `lib/execution/_verdict*` owns
 * the grade. It cannot fail on `resolveDayExecutions` matching the wrong run
 * to a prescription: that resolver is stubbed at its boundary here, because
 * "which run executed this prescription" is its documented job and
 * `_execution_identity_scan` is its gate. It cannot fail on the 'over'
 * threshold being wrong, and it cannot fail on the glance ADAPTER rendering
 * the resulting word badly.
 *
 * ── FALSIFIED ───────────────────────────────────────────────────────────────
 *
 * The removed lookup was put back in place of the two resolver calls and this
 * file goes red on A, B and D, reporting the simulator's phase count and the
 * decoy's 'short'. Reverting the source scan's target reddens E.
 *
 * GLANCE-FALLBACK-1: deleting the `dayBiggestCanonicalRun` call — restoring
 * `matchedRun ? … : []` — reddens F1 and F2 with the flattering 'nailed' the
 * runner actually saw on 2026-06-04, and reddens G's scan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn(async () => '2026-09-02'),
  runnerTimezone: vi.fn(async () => 'America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn(async () => 'America/Los_Angeles'),
}));
/* The execution-identity owner, stubbed AT ITS BOUNDARY. This file is about
 * which PHASES get graded, not about which run satisfied the prescription —
 * that question has its own owner and its own gate (EXECID-SCAN-1), and
 * re-deriving it here would be the second answer Rule 16 forbids. */
vi.mock('@/lib/execution/day-resolver', () => ({
  resolveDayExecutions: vi.fn(),
  primaryPrescription: vi.fn((d: unknown) => (d as { prescriptions: unknown[] }).prescriptions[0] ?? null),
}));

import { pool } from '@/lib/db/pool';
import { resolveDayExecutions } from '@/lib/execution/day-resolver';
import { computeTodayExecution, type GlanceWeekDay } from '@/lib/coach/glance-state';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATE = '2026-09-02';
const REAL_REF = `${USER}-${DATE}#0919`;

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIXTURES · the owner's own rows, read out of production through
 * `faff_readonly`, with only the per-second `hrSamples` / `paceSamples`
 * arrays stripped. Field names, phase types and every number are verbatim.
 * ═══════════════════════════════════════════════════════════════════════ */

/** `coach_intents.id = 919` — his real 2026-09-02 easy-plus-6-strides run. */
const REAL_PHASES = [
  { type: 'work', index: 0, label: '5.0 mi easy', avgHr: 137, maxHr: 149, verdict: 'hit', completed: true, avgCadence: 165, actualDistanceMi: 5, actualPaceSPerMi: 515, targetPaceSPerMi: 522, actualDurationSec: 2577 },
  { type: 'work', index: 1, label: 'Stride 1 of 6', avgHr: 147, maxHr: 148, completed: true, avgCadence: 171, actualDistanceMi: 0.05, actualPaceSPerMi: 401, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 2, label: 'Walk back', avgHr: 151, maxHr: 155, completed: true, avgCadence: 166, actualDistanceMi: 0.11, actualPaceSPerMi: 546, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 3, label: 'Stride 2 of 6', avgHr: 147, maxHr: 148, completed: true, avgCadence: 177, actualDistanceMi: 0.06, actualPaceSPerMi: 347, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 4, label: 'Walk back', avgHr: 153, maxHr: 159, completed: true, avgCadence: 162, actualDistanceMi: 0.12, actualPaceSPerMi: 519, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 5, label: 'Stride 3 of 6', avgHr: 149, maxHr: 153, completed: true, avgCadence: 174, actualDistanceMi: 0.06, actualPaceSPerMi: 349, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 6, label: 'Walk back', avgHr: 154, maxHr: 159, completed: true, avgCadence: 163, actualDistanceMi: 0.11, actualPaceSPerMi: 547, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 7, label: 'Stride 4 of 6', avgHr: 152, maxHr: 154, completed: true, avgCadence: 157, actualDistanceMi: 0.05, actualPaceSPerMi: 365, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 8, label: 'Walk back', avgHr: 154, maxHr: 160, completed: true, avgCadence: 147, actualDistanceMi: 0.09, actualPaceSPerMi: 677, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 9, label: 'Stride 5 of 6', avgHr: 142, maxHr: 146, completed: true, avgCadence: 176, actualDistanceMi: 0.06, actualPaceSPerMi: 350, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 10, label: 'Walk back', avgHr: 157, maxHr: 163, completed: false, avgCadence: 148, actualDistanceMi: 0.1, actualPaceSPerMi: 563, targetPaceSPerMi: 522, actualDurationSec: 59 },
  { type: 'work', index: 11, label: 'Stride 6 of 6', avgHr: 152, maxHr: 157, completed: true, avgCadence: 161, actualDistanceMi: 0.05, actualPaceSPerMi: 431, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 12, label: 'Walk back', avgHr: 157, maxHr: 160, completed: true, avgCadence: 146, actualDistanceMi: 0.12, actualPaceSPerMi: 526, targetPaceSPerMi: 522, actualDurationSec: 61 },
];

/** `sim-recovery-live#1038`, posted 47 minutes after his run. THE ROW THE OLD
 *  QUERY TOOK in production on 2026-09-02. */
const DECOY_SIM_PHASES = [
  { type: 'warmup', index: 0, label: 'Warm-up', avgHr: 166, maxHr: 166, completed: true, avgCadence: 183, actualDistanceMi: 0.18, actualPaceSPerMi: 178, actualDurationSec: 32 },
  { type: 'work', index: 1, label: 'Work', avgHr: 167, maxHr: 167, verdict: 'missed', completed: true, avgCadence: 184, actualDistanceMi: 0.09, actualPaceSPerMi: 344, targetPaceSPerMi: 391, actualDurationSec: 31 },
  { type: 'recovery', index: 2, label: 'Recovery', completed: false, actualDurationSec: 378 },
];

/** HIS OWN 2026-08-28 payload, verbatim: a 7-mile easy day he cut at 6.32,
 *  `completed: false`, stored verdict `incomplete`. It grades SHORT under any
 *  easy spec.
 *
 *  Used in `B` as the decoy, and that is a COMPOSITION of two real production
 *  facts rather than a day that exists: (1) 2026-09-02 really does resolve to
 *  the last-written payload rather than to his run, and (2) 2026-08-28 really
 *  does carry a second payload — `trd_8D81609C-…` — beside his own, filed
 *  under a field with no date suffix, so it lands on whatever day its
 *  timestamp falls in. Put a payload of THIS shape on a day where it wins the
 *  `ts DESC` race and the done-state flips. Nothing here invents a shape the
 *  account has not written. */
const DECOY_INCOMPLETE_PHASES = [
  { type: 'work', avgHr: 154, index: 0, label: '7.0 mi easy', maxHr: 172, verdict: 'incomplete', completed: false, avgCadence: 158, actualDistanceMi: 6.32, actualPaceSPerMi: 508, targetPaceSPerMi: 562, actualDurationSec: 3209, timeInToleranceSec: 140, timeOutOfToleranceSec: 2975 },
];
const DECOY_TRD_FIELD = 'trd_8D81609C-4D40-48E3-9F07-C3CF4BCE42FC';

/** The active plan's own row for 2026-09-02, verbatim. */
const PLAN_0902 = {
  type: 'easy',
  spec: {
    kind: 'easy', fuel_mi: [], hr_cap_bpm: 151, strides_reps: 6,
    strides_duration_s: 20, strides_recovery_s: 60, strides_pace_s_per_mi: 401,
    pace_target_s_per_mi_hi: 542, pace_target_s_per_mi_lo: 502,
  },
  mi: 5,
};

function todayRow(overrides: Partial<GlanceWeekDay> = {}): GlanceWeekDay {
  return {
    date: DATE, dow: 3,
    plannedId: 'pw-0902',
    plannedMi: PLAN_0902.mi,
    plannedType: PLAN_0902.type,
    plannedLabel: 'EASY · 6×20s strides',
    plannedSpec: PLAN_0902.spec as never,
    // His real numbers that day: the plan asked for 5 easy miles and the run
    // came to 6.41 with the strides, so `overreach` is TRUE on the real row.
    // That is not a problem for this file, it is what makes it discriminating:
    // 'short' is returned BEFORE the overreach read, so a run graded clean
    // reads 'over' and a payload graded incomplete reads 'short'. Two
    // different words off the same volume, decided entirely by which phases
    // reached the grader.
    doneMi: 6.41,
    activityId: 'run-0902',
    isToday: true, isPast: false, adaptation: null,
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE MOCK DATABASE · rows, not canned answers, so the OLD lookup and the NEW
 * resolver read ONE seeded table.
 * ═══════════════════════════════════════════════════════════════════════ */

interface IntentRow { field: string; ts: string; phases: unknown[] }
/** GLANCE-FALLBACK-1 · the `runs` side of the same seeded table. Rows here are
 *  CANONICAL rows of THIS runner on THIS date, which is exactly the population
 *  `dayBiggestCanonicalRun` reads; the mock returns the largest, as its
 *  `ORDER BY` does. */
interface RunRowSeed { id: string; distanceMi: number; data: Record<string, unknown> }
let INTENTS: IntentRow[] = [];
let RUNS: RunRowSeed[] = [];
let DB_FAILS = false;

/** The removed query, reproduced: no ref branch, no `sim-%` bound. */
function OLD_LOOKUP(dateISO: string): IntentRow | null {
  const dated = /-\d{4}-\d{2}-\d{2}(#\d+)?$/;
  const matches = INTENTS.filter((r) =>
    dated.test(r.field)
      ? new RegExp(`-${dateISO}(#\\d+)?$`).test(r.field)
      : r.ts.slice(0, 10) === dateISO,
  );
  matches.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return matches[0] ?? null;
}

/** The run the execution resolver says satisfied today's prescription. */
function matchToday(data: Record<string, unknown> | null) {
  vi.mocked(resolveDayExecutions).mockResolvedValue({
    dateISO: DATE,
    prescriptions: [{
      id: 'pw-0902', type: 'easy', distanceMi: 5, subLabel: null,
      isQuality: false, isLong: false,
      matchedRun: data
        ? { runId: 'run-0902', data: data as never, shoeId: null, distanceMi: 6.4, match: 'exact' as const, matchedWorkoutId: 'pw-0902' }
        : null,
    }],
    supplementalRuns: [],
  } as never);
}

beforeEach(() => {
  INTENTS = [];
  RUNS = [];
  DB_FAILS = false;
  vi.mocked(resolveDayExecutions).mockReset();
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockImplementation((async (sql: string, params: unknown[]) => {
    if (DB_FAILS) throw new Error('connection terminated unexpectedly');
    if (/FROM runs/.test(sql)) {
      // `dayBiggestCanonicalRun`. The seed is already scoped to this runner and
      // this day, so the only thing left to reproduce is the ordering.
      const best = [...RUNS].sort((a, b) => b.distanceMi - a.distanceMi)[0];
      return { rows: best ? [{ id: best.id, data: best.data }] : [] };
    }
    if (!/coach_intents/.test(sql)) return { rows: [] };
    if (/field = \$2/.test(sql)) {
      const want = String(params[1]);
      const hit = INTENTS.filter((r) => r.field === want).sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
      return { rows: hit ? [{ value: { phases: hit.phases } }] : [] };
    }
    const bounded = /field NOT LIKE 'sim-%'/.test(sql);
    const row = OLD_LOOKUP(String(params[1]));
    const ok = row && (!bounded || !row.field.startsWith('sim-'));
    return { rows: ok ? [{ value: { phases: row!.phases } }] : [] };
  }) as never);
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('SIMROW-1 · GLANCE — the done-state grades the run, not the day', () => {
  it('A · grades the MATCHED RUN\'S phases, not the later simulator payload', async () => {
    INTENTS = [
      { field: REAL_REF, ts: '2026-09-02T10:38:54', phases: REAL_PHASES },
      { field: 'sim-recovery-live#1101', ts: '2026-09-02T11:25:53', phases: DECOY_SIM_PHASES },
      { field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    // The fixtures reproduce the production selection (Rule 18).
    expect(OLD_LOOKUP(DATE)?.field).toBe('sim-recovery-live#1038');

    matchToday({ date: DATE, watchCompletionRef: REAL_REF });
    expect(await computeTodayExecution(USER, DATE, todayRow())).toBe('over');

    // …and the phases that reached the grader were HIS, thirteen of them, not
    // the simulator's three. Asserted on the call the resolver actually made,
    // because on this day both arrays happen to grade the same and a verdict
    // assertion alone would pass for the wrong reason.
    const refCalls = vi.mocked(pool.query).mock.calls
      .filter((c) => /field = \$2/.test(String(c[0])));
    expect(refCalls.map((c) => (c[1] as unknown[])[1])).toEqual([REAL_REF]);
  });

  it('B · when the decoy grades differently, the done-state follows the RUN', async () => {
    // The decoy is HIS OWN 2026-08-28 cut-short easy day (`completed: false`,
    // stored verdict `incomplete`), filed under the real `trd_` field that
    // carries no date suffix — so no `sim-%` bound sees it and only matching
    // the run saves this. See DECOY_INCOMPLETE_PHASES' comment for why this
    // composition is honest.
    INTENTS = [
      { field: REAL_REF, ts: '2026-09-02T10:38:54', phases: REAL_PHASES },
      { field: DECOY_TRD_FIELD, ts: '2026-09-02T14:01:00', phases: DECOY_INCOMPLETE_PHASES },
    ];
    expect(OLD_LOOKUP(DATE)?.field).toBe(DECOY_TRD_FIELD);

    matchToday({ date: DATE, watchCompletionRef: REAL_REF });
    // He completed his easy day plus six strides — nothing graded short, so
    // the volume read stands.
    expect(await computeTodayExecution(USER, DATE, todayRow())).toBe('over');

    // And the decoy really does say otherwise — so this test can tell the two
    // implementations apart rather than passing because everything is 'nailed'.
    matchToday({ date: DATE, watchCompletionRef: DECOY_TRD_FIELD });
    expect(await computeTodayExecution(USER, DATE, todayRow())).toBe('short');
  });

  it('C · NO run satisfied the prescription → grades nothing, never borrows', async () => {
    // The decoy is the only payload on the date and it grades SHORT. Nothing
    // satisfied today's prescription, so there are no phases that belong to
    // this day's session. The honest answer is the volume read — the same
    // answer a genuine non-watch run has always produced — not the stranger's
    // grade (Rule 11).
    INTENTS = [
      { field: DECOY_TRD_FIELD, ts: '2026-09-02T14:01:00', phases: DECOY_INCOMPLETE_PHASES },
    ];
    matchToday(null);
    // …and NO canonical run row for the day either, so there is genuinely
    // nothing of his to read. `RUNS` is left empty.
    expect(await computeTodayExecution(USER, DATE, todayRow())).toBe('over');
    expect(await computeTodayExecution(USER, DATE, todayRow({ plannedMi: 8 }))).toBe('nailed');
    // The old lookup, on the same seed, would have graded the stranger and
    // said 'short' for both — a missed session reported on a day this runner
    // has no session on at all.
    expect(OLD_LOOKUP(DATE)?.field).toBe(DECOY_TRD_FIELD);
    // GLANCE-FALLBACK-1 · the ONLY query this path may make is the one that
    // asks for HIS run. It found none, and nothing then reached for the
    // stranger's payload: no `coach_intents` read happened at all.
    const sqls = vi.mocked(pool.query).mock.calls.map((c) => String(c[0]));
    expect(sqls.every((q) => /FROM runs/.test(q))).toBe(true);
    expect(sqls.some((q) => /coach_intents/.test(q))).toBe(false);
  });

  it('C1 · a matched run whose named completion is gone refuses (sim decoys)', async () => {
    INTENTS = [
      { field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    matchToday({ date: DATE, watchCompletionRef: `${USER}-${DATE}#9999` });
    // Rung 1 misses, rung 2 is empty, rung 3 is bounded against `sim-%`. No
    // phases, so the volume read stands rather than the simulator's grade.
    expect(await computeTodayExecution(USER, DATE, todayRow({ plannedMi: 8 }))).toBe('nailed');
  });

  it('C2 · no run today at all is still null, not a grade', async () => {
    matchToday(null);
    expect(await computeTodayExecution(USER, DATE, todayRow({ doneMi: 0 }))).toBeNull();
    expect(await computeTodayExecution(USER, DATE, undefined)).toBeNull();
    // Nothing was even looked up — the volume gate short-circuits first.
    expect(vi.mocked(resolveDayExecutions)).not.toHaveBeenCalled();
  });

  it('D · a FAILED read is not a confident "nailed" (Rule 11)', async () => {
    // The removed `.catch(() => ({ rows: [] }))` turned a database outage into
    // "no phases", which the fall-through reports as a clean session. The
    // failure now reaches `loadGlanceState`'s callers, which is what turns it
    // into the honest data-outage screen instead.
    matchToday({ date: DATE, watchCompletionRef: REAL_REF });
    DB_FAILS = true;
    await expect(computeTodayExecution(USER, DATE, todayRow())).rejects.toThrow(/connection terminated/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E · THE FUNCTION STILL CALLS BOTH OWNERS
 *
 * Rule 16: a behavioural test cannot catch a surface that stops calling the
 * shared resolver — the surface's own copy passes every behavioural assertion
 * right up until the day two payloads land on one date.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('SIMROW-1 · GLANCE — no second answer inside glance-state', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'lib/coach/glance-state.ts'), 'utf8');

  it('the scanner read a real file (Rule 18 · liveness)', () => {
    expect(SRC.length).toBeGreaterThan(20_000);
    expect(SRC).toContain('export async function computeTodayExecution');
  });

  it('asks the execution resolver which run, and the phase owner which phases', () => {
    expect(SRC).toMatch(/const resolvedToday = await resolveDayExecutions\(userId, today\)/);
    expect(SRC).toMatch(/primaryPrescription\(resolvedToday\)\?\.matchedRun/);
    // GLANCE-FALLBACK-1 · the argument is now `runOfTheDay` — the matched run
    // when one exists, and this runner's own biggest canonical run when none
    // does. The phase owner is still the only thing asked for phases.
    expect(SRC).toMatch(/await resolveStoredPhases\(userId, today, runOfTheDay\)/);
    expect(SRC).toMatch(/matchedRun\s*\n?\s*\? \(matchedRun\.data as Record<string, unknown>\)/);
  });

  it('carries NO watch-completion lookup of its own', () => {
    expect(SRC).not.toMatch(/reason = 'watch_completion'/);
    expect(SRC).not.toMatch(/FROM coach_intents/);
  });

  it('does not swallow the read (Rule 11)', () => {
    // Scoped to this function's body, because the file still carries other
    // legacy swallows on `EMPTIED_KNOWN`'s list and this gate is about the one
    // that was removed, not about the file's whole history.
    const start = SRC.indexOf('export async function computeTodayExecution');
    const end = SRC.indexOf('export async function loadGlanceState');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);
    expect(body).not.toMatch(/\.catch\(/);
    expect(body).not.toMatch(/rows:\s*\[\]/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F · GLANCE-FALLBACK-1 · A FAILED IDENTITY MATCH IS NOT A CLEAN SESSION
 *
 * The fixtures below are 2026-06-04, verbatim out of the owner's rows: a
 * 2 mi WU / 4 mi @ T / 2 mi CD tempo, run as 7.76 mi, whose single work phase
 * carries the stored verdict `missed` (437 s/mi against a 419 target). The
 * execution resolver declines this run and is right to — `apple_watch`, no
 * `planWorkoutId`, own `type` the generic 'Run'. Its phases are still
 * reachable by IDENTITY, because the run names its own completion.
 *
 * Planned 8 mi against 7.8 done, so `overreach` is FALSE and the flattering
 * fall-through says 'nailed'. That is the word Today printed.
 * ═══════════════════════════════════════════════════════════════════════ */

const DATE_0604 = '2026-06-04';
const REF_0604 = `${USER}-${DATE_0604}`;

/** `coach_intents.field = '<uuid>-2026-06-04'`, per-second arrays stripped. */
const PHASES_0604 = [
  { type: 'warmup', avgHr: 138, index: 0, label: 'Warm-up', maxHr: 151, verdict: 'hit', completed: true, avgCadence: 163, actualDistanceMi: 1.51, actualPaceSPerMi: 505, targetPaceSPerMi: 502, actualDurationSec: 760, timeInToleranceSec: 615, timeOutOfToleranceSec: 135 },
  { type: 'work', avgHr: 162, index: 1, label: '5.0 mi tempo', maxHr: 171, verdict: 'missed', completed: true, avgCadence: 170, actualDistanceMi: 5, actualPaceSPerMi: 437, targetPaceSPerMi: 419, actualDurationSec: 2184, timeInToleranceSec: 1580, timeOutOfToleranceSec: 605 },
  { type: 'cooldown', avgHr: 159, index: 2, label: 'Cool-down', maxHr: 165, verdict: 'incomplete', completed: false, avgCadence: 159, actualDistanceMi: 1.25, actualPaceSPerMi: 503, targetPaceSPerMi: 502, actualDurationSec: 630, timeInToleranceSec: 490, timeOutOfToleranceSec: 145 },
];

/** The run row, verbatim in every field this path reads. */
const RUN_0604: RunRowSeed = {
  id: '-1483290537416636',
  distanceMi: 7.76,
  data: {
    date: DATE_0604, source: 'apple_watch', type: 'Run', distanceMi: 7.76,
    workoutType: 'tempo', workoutTypeSource: 'plan',
    watchCompletionRef: REF_0604,
    client_workout_id: '9BA0F0D3-554B-4AEE-8493-6D0750DA61CE',
  },
};

/** The plan row that owned 2026-06-04, verbatim. */
const PLAN_0604 = {
  type: 'tempo',
  spec: { kind: 'tempo', warmup_mi: 2, cooldown_mi: 2, hr_target_bpm: 149, tempo_distance_mi: 4, tempo_pace_s_per_mi: 442 },
  mi: 8,
};

function todayRow0604(overrides: Partial<GlanceWeekDay> = {}): GlanceWeekDay {
  return {
    date: DATE_0604, dow: 4,
    plannedId: 'pw-0604',
    plannedMi: PLAN_0604.mi,
    plannedType: PLAN_0604.type,
    plannedLabel: '2 mi WU / 4 mi @ T / 2 mi CD',
    plannedSpec: PLAN_0604.spec as never,
    doneMi: 7.8,
    activityId: 'run-0604',
    isToday: true, isPast: false, adaptation: null,
    ...overrides,
  };
}

/** The resolver declines this run, correctly. That is the premise of every
 *  case below, so it is stated once. */
function matchedNothing0604() {
  vi.mocked(resolveDayExecutions).mockResolvedValue({
    dateISO: DATE_0604,
    prescriptions: [{
      id: 'pw-0604', type: 'tempo', distanceMi: 8, subLabel: null,
      isQuality: true, isLong: false, matchedRun: null,
    }],
    supplementalRuns: [],
  } as never);
}

describe('GLANCE-FALLBACK-1 - a failed identity match is not a clean session', () => {
  it('F1 - grades HIS OWN run when nothing satisfied the prescription', async () => {
    matchedNothing0604();
    INTENTS = [{ field: REF_0604, ts: '2026-06-04T10:04:00', phases: PHASES_0604 }];
    RUNS = [RUN_0604];

    // The word the runner should read. 7.8 of 8 mi is not overreach, so the
    // flattering fall-through says 'nailed' - the grade is decided entirely
    // by whether his own phases reached the grader.
    expect(await computeTodayExecution(USER, DATE_0604, todayRow0604())).toBe('short');

    // ...and they reached it BY IDENTITY: rung 1 of `resolveStoredPhases`,
    // asked for the ref this run itself names. Asserted on the call, because
    // a verdict assertion alone cannot tell rung 1 from a date match.
    const refCalls = vi.mocked(pool.query).mock.calls
      .filter((c) => /field = \$2/.test(String(c[0])));
    expect(refCalls.map((c) => (c[1] as unknown[])[1])).toEqual([REF_0604]);
  });

  it('F2 - the fallback is the day BIGGEST canonical run, as `loadRun` picks it', async () => {
    matchedNothing0604();
    // Two canonical runs of his own that day. The seeded ordering is the
    // query's: largest first. The smaller one carries a clean payload, so
    // picking the wrong one is visible as a different word.
    const smaller: RunRowSeed = {
      id: 'run-shakeout', distanceMi: 2.1,
      data: { date: DATE_0604, source: 'watch', watchCompletionRef: `${REF_0604}#shake` },
    };
    INTENTS = [
      { field: REF_0604, ts: '2026-06-04T10:04:00', phases: PHASES_0604 },
      { field: `${REF_0604}#shake`, ts: '2026-06-04T18:00:00', phases: [
        { type: 'work', index: 0, label: 'Shakeout', verdict: 'hit', completed: true,
          actualDistanceMi: 2.1, actualPaceSPerMi: 505, targetPaceSPerMi: 520 },
      ] },
    ];
    RUNS = [smaller, RUN_0604];
    expect(await computeTodayExecution(USER, DATE_0604, todayRow0604())).toBe('short');
    const refCalls = vi.mocked(pool.query).mock.calls
      .filter((c) => /field = \$2/.test(String(c[0])));
    expect(refCalls.map((c) => (c[1] as unknown[])[1])).toEqual([REF_0604]);
  });

  it('F3 - a run with nothing stored on it still reads as the volume says', async () => {
    matchedNothing0604();
    // Rule 11 - the three facts stay apart. His run exists and is found, but
    // it names no completion and carries no phases, and the only payload on
    // the date is `sim-` prefixed (rung 3 refuses it). Nothing to grade is a
    // different fact from a session graded short, and the volume read is the
    // same answer a genuine non-watch run has always produced.
    INTENTS = [{ field: 'sim-recovery-live#1038', ts: '2026-06-04T18:00:00', phases: DECOY_SIM_PHASES }];
    RUNS = [{ id: 'run-plain', distanceMi: 7.76, data: { date: DATE_0604, source: 'strava' } }];
    expect(await computeTodayExecution(USER, DATE_0604, todayRow0604())).toBe('nailed');
  });

  it('F4 - a FAILED read still propagates through the fallback (Rule 11)', async () => {
    matchedNothing0604();
    RUNS = [RUN_0604];
    DB_FAILS = true;
    await expect(computeTodayExecution(USER, DATE_0604, todayRow0604()))
      .rejects.toThrow(/connection terminated/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G · THE FALLBACK IS THE OWNER'S, AND IT READS ONLY HIS RUNS
 *
 * Rule 16 one level down: `loadRun` already had this rung, and a second copy
 * of the query inside `glance-state.ts` would be a second answer to "which of
 * this runner's runs is the day's run".
 * ═══════════════════════════════════════════════════════════════════════ */
describe('GLANCE-FALLBACK-1 - the fallback is the shared owner', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'lib/coach/glance-state.ts'), 'utf8');
  const LOAD = fs.readFileSync(path.join(process.cwd(), 'lib/postrun/load.ts'), 'utf8');

  it('the scanner read real files (Rule 18 - liveness)', () => {
    expect(SRC.length).toBeGreaterThan(20_000);
    expect(LOAD.length).toBeGreaterThan(10_000);
  });

  it('glance-state calls the owner rather than writing its own runs query', () => {
    expect(SRC).toMatch(/await dayBiggestCanonicalRun\(userId, today\)/);
    // Scoped to THIS function's body. The file legitimately reads `runs`
    // elsewhere (the week strip's activity-id lookup); this gate is about the
    // done-state path not growing a second copy of the owner's query.
    const start = SRC.indexOf('export async function computeTodayExecution');
    const end = SRC.indexOf('export async function loadGlanceState');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(SRC.slice(start, end)).not.toMatch(/FROM runs/);
  });

  it('`loadRun` reads the same function, so the two cannot drift', () => {
    expect(LOAD).toMatch(/export async function dayBiggestCanonicalRun/);
    expect(LOAD).toMatch(/const fallback = await dayBiggestCanonicalRun\(userId, ref\.dateISO\)/);
  });

  it('the owner names its population: this user, canonical rows, this day', () => {
    const start = LOAD.indexOf('export async function dayBiggestCanonicalRun');
    expect(start).toBeGreaterThan(0);
    const body = LOAD.slice(start, start + 900);
    expect(body).toMatch(/user_uuid = \$1/);
    expect(body).toContain('${CANONICAL_ROW_SQL}');
    expect(body).toContain('${runDaySql()} = $2');
    expect(body).toContain('${runDistanceMiSql()} DESC NULLS LAST');
    // It can never widen to a `coach_intents` payload no run of his names.
    expect(body).not.toMatch(/coach_intents/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ONE CASE THE OWNER DOES NOT YET REFUSE — pinned, not blessed.
 *
 * `resolveStoredPhases`' rung 3 is a LEGACY date match for rows written before
 * `watchCompletionRef` existed, bounded only against `sim-%`. So a MATCHED run
 * that names a completion which does not resolve, and carries no phases of its
 * own, still falls through to the day and can still inherit a stranger's
 * payload when that stranger's field is not `sim-`-prefixed.
 *
 * Production evidence: the 2026-09-03 apple_watch run (4.48 mi at 12:25,
 * `client_workout_id` FB9BDB32-…, no intent under that key, no phases of its
 * own) inherits the 21-phase hill session recorded on the treadmill at 17:25
 * the same evening. Exactly one of the account's 160 canonical runs is
 * affected. See `_recap_phase_row_identity.test.ts`'s twin of this block for
 * the fix and why it belongs to the resolver's owner rather than to this
 * branch.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('SIMROW-1 · GLANCE — known gap: rung 3 still answers by date', () => {
  it('a matched run naming an unresolvable ref still inherits a non-`sim-` payload', async () => {
    INTENTS = [
      { field: DECOY_TRD_FIELD, ts: '2026-09-02T14:01:00', phases: DECOY_INCOMPLETE_PHASES },
    ];
    matchToday({ date: DATE, client_workout_id: 'FB9BDB32-558C-4E3C-B1D3-C62F31748035' });
    // TODAY'S BEHAVIOUR, stated plainly rather than asserted to be right.
    expect(await computeTodayExecution(USER, DATE, todayRow())).toBe('short');
    // WHEN THIS FAILS, the owner has been tightened: delete this test and
    // assert the volume read ('over') instead.
  });
});
