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
 * ── WHAT THE FIX DID AND DID NOT CHANGE, STATED HONESTLY (Rule 13) ─────────
 *
 * Replayed over all 160 canonical runs in the account, grading each with its
 * own plan row's type and spec, the OLD selection and the NEW one emit the
 * SAME done-state on every single day — including 2026-09-02. On the four days
 * where the wrong row was picked, both payloads happen to grade the same way.
 *
 * So this fix corrects the MECHANISM without, so far, correcting a word the
 * runner has read. That is worth saying plainly rather than dressing up: the
 * defect is that the answer did not depend on the run, and it would have shown
 * the first time a stray payload graded differently. `B` below is that day,
 * built from two real production facts (see its own comment).
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *
 *   A · the graded phases are the MATCHED RUN'S, not the day's latest payload;
 *   B · when the decoy grades differently, the done-state follows the RUN;
 *   C · nothing matched → grades nothing and says so through the volume read,
 *       never by reaching for another payload (Rule 11);
 *   D · a failed read is NOT a confident 'nailed' — it propagates;
 *   E · the function still calls both owners, and carries no completion
 *       lookup of its own. A behavioural test cannot catch a surface that
 *       stops calling the resolver.
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
let INTENTS: IntentRow[] = [];
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
  DB_FAILS = false;
  vi.mocked(resolveDayExecutions).mockReset();
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockImplementation((async (sql: string, params: unknown[]) => {
    if (DB_FAILS) throw new Error('connection terminated unexpectedly');
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
    expect(await computeTodayExecution(USER, DATE, todayRow())).toBe('over');
    expect(await computeTodayExecution(USER, DATE, todayRow({ plannedMi: 8 }))).toBe('nailed');
    // The old lookup, on the same seed, would have graded the stranger and
    // said 'short' for both — a missed session reported on a day this runner
    // has no session on at all.
    expect(OLD_LOOKUP(DATE)?.field).toBe(DECOY_TRD_FIELD);
    expect(vi.mocked(pool.query)).not.toHaveBeenCalled();
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
    expect(SRC).toMatch(/await resolveStoredPhases\(userId, today, matchedRun\.data/);
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
