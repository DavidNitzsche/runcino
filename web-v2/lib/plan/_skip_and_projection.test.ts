/**
 * lib/plan/_skip_and_projection.test.ts · the gates PLANSNAPSHOT-SKIP-1 and
 * FINISHEST-RELIABILITY-1 shipped without.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `abea4ba4b` fixed two real defects and its commit message claimed "the fix's
 * own test suite fails against the pre-fix code (verified by temporarily
 * reverting and re-running)". No such suite existed. An independent reviewer
 * planted BOTH defects back — reverted `skipped: skippedDates.has(...)` to
 * `skipped: false`, and collapsed the tagged timeout branch back to
 * `{status:'ok', value: null}` — and `tsc`, every `check-*` script and the
 * entire vitest suite stayed green. `_plan_snapshot.test.ts` covers this
 * module's two PURE functions and deliberately says so in its own header; the
 * loader itself, where both defects lived, had nothing.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It drives the loaders against a SQL-dispatching fake pool, so it cannot
 * catch anything that lives in the shape of real rows: a predicate that reads
 * the wrong population (Rule 14), a `date_iso` cast that behaves differently
 * against a real TEXT column, a plan whose `owned` CTE resolves differently
 * across reigns. Those are the reasons `scripts/probe-snapshot-flicker.sh`
 * exists beside it and runs against a read-only copy of the owner's real
 * block; neither is a substitute for the other. It also cannot fail on
 * anything the PHONE does with these fields — `PlanSnapshotDay.skipped` and
 * the unreadable stat are rendered by Swift this file never loads.
 *
 * Every assertion here was falsified against the un-fixed code before landing:
 * the transcript is in the follow-up handback, and each test names the exact
 * one-line reversion it dies on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-09-07'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));
vi.mock('@/lib/execution/day-resolver', () => ({
  resolveDateRangeExecutions: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('@/lib/race/race-outlook', () => ({
  resolveRaceOutlookBySlug: vi.fn(),
}));
vi.mock('@/lib/training/race-projection', () => ({
  raceProjectionFromOutlook: vi.fn(),
}));
// ── loadTrainingState's own dependencies, for the three-way agreement test ──
vi.mock('@/lib/plan/lookup', () => ({
  // The literal, not the `PLAN_ID` const below: a `vi.mock` factory runs
  // during the import phase, before this module's own body executes, so a
  // reference to a module-scope binding here reads `undefined`.
  loadActivePlan: vi.fn().mockResolvedValue({ id: 'pln_test_0001', race_id: null, last_adapted_at: null }),
}));
vi.mock('@/lib/coach/settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({ long_run_day: 'sun' }),
}));
vi.mock('@/lib/runs/volume', () => ({
  getCanonicalRunIds: vi.fn().mockResolvedValue([]),
  mileageByDay: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('@/lib/coach/adaptation-info', () => ({
  loadAdaptationInfoByPlanIds: vi.fn().mockResolvedValue(new Map()),
}));

import { pool } from '@/lib/db/pool';
import { resolveRaceOutlookBySlug } from '@/lib/race/race-outlook';
import { raceProjectionFromOutlook } from '@/lib/training/race-projection';
import {
  RACE_PROJECTION_DEADLINE_MS,
  RACE_PROJECTION_MEASURED_WORST_MS,
  loadPlanSnapshot,
  withDeadline,
  __resetLastKnownGoodProjectionsForTest,
  type PlanSnapshotResult,
} from './plan-snapshot';
import { isDaySkipped, loadSkippedDates } from './week-loader';
import { loadTrainingState } from '@/lib/coach/training-state';
import { buildWeeks } from '@/lib/plan/v5-block';

const UUID = '00000000-0000-0000-0000-000000000042';
const TODAY = '2026-09-07';
const SKIPPED_DAY = '2026-09-09';
const NOT_SKIPPED_DAY = '2026-09-10';
const RACE_DAY = '2026-09-13';
const PLAN_ID = 'pln_test_0001';

/* ══════════════════════════════════════════════════════════════════════════
 * The fake pool · one fixture block, dispatched by SQL fingerprint
 * ═══════════════════════════════════════════════════════════════════════ */

interface Fixture {
  /** Dates in `day_actions` with action='skip'. */
  skips: string[];
  /** When true, ONLY the day_actions read rejects. Everything else succeeds,
   *  so a test can isolate "the skip read failed" from a general outage. */
  skipReadFails: boolean;
  /** Race rows (`races.meta->>'date'` → slug). */
  raceSlugs: Array<{ slug: string; date_iso: string }>;
}

let fx: Fixture;

const PLAN_DAYS: Array<Record<string, unknown>> = [
  { id: 'w1', date_iso: '2026-09-08', dow: 2, type: 'easy', distance_mi: '6', pace_target_s_per_mi: null, sub_label: null, notes: null, workout_spec: null, is_quality: false, is_long: false },
  { id: 'w2', date_iso: SKIPPED_DAY, dow: 3, type: 'threshold', distance_mi: '7', pace_target_s_per_mi: null, sub_label: 'Cruise intervals', notes: null, workout_spec: null, is_quality: true, is_long: false },
  { id: 'w3', date_iso: NOT_SKIPPED_DAY, dow: 4, type: 'easy', distance_mi: '5', pace_target_s_per_mi: null, sub_label: null, notes: null, workout_spec: null, is_quality: false, is_long: false },
  { id: 'w4', date_iso: RACE_DAY, dow: 0, type: 'race', distance_mi: '6.2', pace_target_s_per_mi: null, sub_label: '10K', notes: null, workout_spec: null, is_quality: true, is_long: false },
];

function installPool() {
  (pool.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (sql: string, _params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('FROM day_actions')) {
        if (fx.skipReadFails) throw new Error('simulated day_actions read failure');
        return { rows: fx.skips.map((d) => ({ date_iso: d })) };
      }
      if (s.includes('FROM training_plans') && s.includes('archived_iso IS NULL')) {
        return { rows: [{ id: PLAN_ID, last_adapted_at: null }] };
      }
      if (s.includes("authored_state->'horizon_raise'")) return { rows: [{}] };
      if (s.includes('MIN(date_iso)')) {
        return { rows: [{ start_iso: PLAN_DAYS[0].date_iso, end_iso: RACE_DAY }] };
      }
      if (s.includes('FROM profile')) return { rows: [{ lthr: 168 }] };
      if (s.includes('FROM plan_phases')) {
        return { rows: [{ label: 'BUILD', start_week_idx: 0, end_week_idx: 4 }] };
      }
      if (s.includes('FROM plan_weeks')) {
        return { rows: [{ id: 'wk1', week_idx: 0, week_start_iso: '2026-09-07', is_race_week: false, is_cutback: false }] };
      }
      if (s.includes('FROM plan_workouts') && s.includes('week_id')) {
        return { rows: PLAN_DAYS.map((d) => ({ ...d, week_id: 'wk1' })) };
      }
      if (s.includes('WITH owned AS')) return { rows: PLAN_DAYS };
      if (s.includes("workout_spec->>'pace_target_s_per_mi_lo'")) {
        return { rows: [{ lo: 480, hi: 520 }] };
      }
      if (s.includes('FROM races') && s.includes("meta->>'date'")) {
        return { rows: fx.raceSlugs };
      }
      if (s.includes('FROM races')) return { rows: [] };
      // Everything else a loader may reach for (strava rows, etc.) is empty
      // rather than a throw, so a test failure names the assertion it was
      // about rather than an unrelated missing fixture.
      return { rows: [] };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLastKnownGoodProjectionsForTest();
  fx = { skips: [], skipReadFails: false, raceSlugs: [] };
  installPool();
  (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: null });
  (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

function dayOf(snap: PlanSnapshotResult, date: string) {
  const d = snap.days.find((x) => x.date_iso === date);
  if (!d) throw new Error(`no snapshot day for ${date}`);
  return d;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · PLANSNAPSHOT-SKIP-1 · a recorded skip reaches the object the phone
 *     actually renders from
 *
 * FALSIFIER: change `skipped: skippedDates.has(row.date_iso)` back to
 * `skipped: false` in plan-snapshot.ts. Tests 1.1 and 1.4 go red.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('plan snapshot · day_actions skip', () => {
  it('1.1 · a skip row makes that day, and only that day, skipped', async () => {
    fx.skips = [SKIPPED_DAY];
    const snap = await loadPlanSnapshot(UUID, TODAY);

    expect(dayOf(snap, SKIPPED_DAY).skipped).toBe(true);
    expect(dayOf(snap, NOT_SKIPPED_DAY).skipped).toBe(false);
    expect(dayOf(snap, '2026-09-08').skipped).toBe(false);
    // The read succeeded, so the flag is ABSENT — not `false`. Rule 11's
    // contract is that the two are different facts on the wire too.
    expect(snap.skip_state_unknown).toBeUndefined();
    expect('skip_state_unknown' in snap).toBe(false);
  });

  it('1.2 · no skip rows means every day is unskipped and the read is not flagged', async () => {
    const snap = await loadPlanSnapshot(UUID, TODAY);
    expect(snap.days.every((d) => d.skipped === false)).toBe(true);
    expect(snap.skip_state_unknown).toBeUndefined();
  });

  it('1.3 · a FAILED skip read is not "nothing skipped" — skip_state_unknown says so', async () => {
    fx.skipReadFails = true;
    const snap = await loadPlanSnapshot(UUID, TODAY);

    // Best-effort false per day, exactly as documented…
    expect(snap.days.every((d) => d.skipped === false)).toBe(true);
    // …and the honest signal beside it, so a caller can tell the two apart.
    expect(snap.skip_state_unknown).toBe(true);
    // The rest of the block is unaffected: a skip read that failed may not
    // take the plan down with it.
    expect(snap.days).toHaveLength(PLAN_DAYS.length);
  });

  it('1.4 · the skip survives serialization — it is on the WIRE, not just the object', async () => {
    fx.skips = [SKIPPED_DAY];
    const snap = await loadPlanSnapshot(UUID, TODAY);
    const wire = JSON.parse(JSON.stringify(snap)) as PlanSnapshotResult;
    expect(wire.days.find((d) => d.date_iso === SKIPPED_DAY)?.skipped).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · FINISHEST-RELIABILITY-1 · the tagged deadline
 *
 * FALSIFIER: collapse `withDeadline`'s timeout branch to
 * `{ status: 'ok', value: null }`. Tests 2.1 and 2.3 go red.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('withDeadline · three outcomes, never two', () => {
  it('2.1 · a timeout is NOT an ok carrying null', async () => {
    const never = new Promise<string | null>(() => {});
    const r = await withDeadline(never, 10);
    expect(r.status).toBe('timeout');
    // The distinction the type exists for, asserted as a VALUE difference and
    // not only as a type: a timeout carries no `value` key at all, so it can
    // never be read as a resolution that produced null.
    expect('value' in r).toBe(false);
    expect(r).not.toEqual({ status: 'ok', value: null });
  });

  it('2.2 · a resolution that genuinely produced null is ok, and carries the null', async () => {
    const r = await withDeadline(Promise.resolve(null), 1_000);
    expect(r.status).toBe('ok');
    expect(r).toEqual({ status: 'ok', value: null });
    if (r.status === 'ok') expect(r.value).toBeNull();
  });

  it('2.3 · ok-with-null and timeout are distinguishable by the SAME test a consumer runs', async () => {
    const genuine = await withDeadline(Promise.resolve(null), 1_000);
    const timedOut = await withDeadline(new Promise<null>(() => {}), 10);
    // `attempt.status !== 'ok'` is the consumer's own branch in
    // plan-snapshot.ts. If the branches were collapsed, this asserts false.
    expect(genuine.status !== 'ok').toBe(false);
    expect(timedOut.status !== 'ok').toBe(true);
  });

  it('2.4 · a throw is tagged as error, carrying the cause, never swallowed', async () => {
    const boom = new Error('upstream exploded');
    const r = await withDeadline(Promise.reject(boom), 1_000);
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.error).toBe(boom);
  });

  it('2.5 · a value that beats the deadline resolves as ok, and the timer is cleared', async () => {
    const r = await withDeadline(Promise.resolve('42:57'), 1_000);
    expect(r).toEqual({ status: 'ok', value: '42:57' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · FINISHEST-DETERMINISM-1 · the stat must not blink
 *
 * FALSIFIERS, each named on its test:
 *   · delete the last-known-good serve → 3.3 goes red
 *   · render case 3 the same as case 2 (`return` instead of setting null)
 *     → 3.2 goes red
 *   · use `if (finish)` instead of `has()` in the stats block → 3.2 goes red
 * ═══════════════════════════════════════════════════════════════════════ */

const OUTLOOK = { slug: 'sm10k' } as unknown;

function finishStat(snap: PlanSnapshotResult) {
  return dayOf(snap, RACE_DAY).stats.find((s) => s.label === 'Projected finish') ?? null;
}

describe('projected finish · available / genuinely-absent / could-not-find-out', () => {
  beforeEach(() => {
    fx.raceSlugs = [{ slug: 'sm10k', date_iso: RACE_DAY }];
  });

  it('3.1 · CASE 1 · a real projection renders as a figure', async () => {
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });

    const stat = finishStat(await loadPlanSnapshot(UUID, TODAY));
    expect(stat).not.toBeNull();
    expect(stat!.value.text).toBe('42:57');
    expect(stat!.value.modelled).toBe(true);
    expect(stat!.tone).toBeNull();
  });

  it('3.2 · CASE 2 and CASE 3 do not look the same to the runner', async () => {
    // CASE 2 · the outlook resolved and has nothing to project. No stat.
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: null });
    const absent = finishStat(await loadPlanSnapshot(UUID, TODAY));
    expect(absent).toBeNull();

    // CASE 3 · the resolution failed, and nothing is known from before.
    __resetLastKnownGoodProjectionsForTest();
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('outlook resolution exploded'));
    const failed = finishStat(await loadPlanSnapshot(UUID, TODAY));
    expect(failed).not.toBeNull();
    // `text: null` is `FaffValue.unreadable` on the phone — a fault-red dash.
    // This is the assertion the original defect could not pass: before it,
    // both cases produced NO STAT and were indistinguishable on screen.
    expect(failed!.value.text).toBeNull();
    expect(failed!.tone).toBe('fault');
  });

  it('3.3 · THE ANTI-FLICKER GATE · a failed resolve serves the last known good, unchanged', async () => {
    // Load 1 · resolves. This is the value on the screen.
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });
    const first = finishStat(await loadPlanSnapshot(UUID, TODAY));
    expect(first!.value.text).toBe('42:57');
    expect((await loadPlanSnapshot(UUID, TODAY)).projection_served_stale).toBeUndefined();

    // Load 2 · the SAME runner, the SAME race, the SAME day — and the
    // resolution fails. Nothing about the runner changed; only latency did.
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('slow backend'));
    const snap = await loadPlanSnapshot(UUID, TODAY);
    const second = finishStat(snap);

    // The screen does not move. That is the entire fix.
    expect(second).toEqual(first);
    expect(second!.value.text).toBe('42:57');
    expect(second!.tone).toBeNull();
    // …and the honesty is paid where it is actionable, not on the pixel.
    expect(snap.projection_served_stale).toBe(true);
  });

  it('3.4 · the last-known-good is scoped to ONE runner, ONE race, ONE day', async () => {
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });
    await loadPlanSnapshot(UUID, TODAY);

    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('slow backend'));

    // A DIFFERENT runner must not read this runner's projection.
    const other = await loadPlanSnapshot('00000000-0000-0000-0000-0000000000ff', TODAY);
    expect(finishStat(other)!.value.text).toBeNull();

    // A DIFFERENT day must not read yesterday's projection, because the
    // quantity is a function of `today` (Rule 10 · the anchor is in the key).
    const tomorrow = await loadPlanSnapshot(UUID, '2026-09-08');
    expect(finishStat(tomorrow)!.value.text).toBeNull();
  });

  it('3.5 · a last-known-good older than its max age is not served', async () => {
    vi.useFakeTimers();
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });
    await loadPlanSnapshot(UUID, TODAY);

    // Past RACE_PROJECTION_LKG_MAX_AGE_MS (15 min). Rule 16: a value this old
    // could disagree with what Race Detail resolves fresh on its own screen.
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('slow backend'));
    const snap = await loadPlanSnapshot(UUID, TODAY);

    expect(finishStat(snap)!.value.text).toBeNull();
    expect(finishStat(snap)!.tone).toBe('fault');
    // Nothing stale was served, so nothing claims it was.
    expect(snap.projection_served_stale).toBeUndefined();
  });

  it('3.6 · a resolution that runs past the budget is a timeout, not an absence', async () => {
    vi.useFakeTimers();
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValue(new Promise(() => {}));

    const pending = loadPlanSnapshot(UUID, TODAY);
    // Past RACE_PROJECTION_DEADLINE_MS (8s). Advancing rather than waiting is
    // the only way to exercise the real constant without an 8-second test.
    await vi.advanceTimersByTimeAsync(8_500);
    const snap = await pending;

    const stat = finishStat(snap);
    expect(stat).not.toBeNull();
    expect(stat!.value.text).toBeNull();
    expect(stat!.tone).toBe('fault');
    // And the rest of the block came back regardless — BANNER-LATENCY-1's
    // fail-closed posture is unchanged by any of this.
    expect(snap.days).toHaveLength(PLAN_DAYS.length);
  });

  it('3.7 · THE BUDGET GATE · the deadline sits ABOVE the measured cost, not inside it', async () => {
    // WHY THIS EXISTS, AND WHAT 3.6 ABOVE CANNOT DO. 3.6 asserts a CEILING —
    // a resolution past 8.5s is a timeout — and a reverted 2500ms satisfies
    // that just as well as 8000ms does. An independent review planted 2500
    // back, the exact regressed value FINISHEST-DETERMINISM-1 corrects, and
    // all twenty tests here stayed green. A ceiling cannot tell the two apart;
    // only a floor can, so this is the floor.
    //
    // Rule 9 is the reason the floor is where it is. 2500ms sat INSIDE the
    // measured distribution (1974-5413ms), which is precisely what made half a
    // second of ordinary cold-start variance decide whether the runner's
    // goal-race day showed a finish time or nothing at all.

    // Half one · the number. Read against the measured worst case rather than
    // hardcoded on both sides (Rule 18) — move the measurement and this moves
    // with it, instead of only proving the test agrees with itself.
    expect(RACE_PROJECTION_MEASURED_WORST_MS).toBeGreaterThan(0);
    expect(
      RACE_PROJECTION_DEADLINE_MS,
      `the budget (${RACE_PROJECTION_DEADLINE_MS}ms) must clear the measured worst case ` +
      `(${RACE_PROJECTION_MEASURED_WORST_MS}ms), not sit inside the distribution`,
    ).toBeGreaterThan(RACE_PROJECTION_MEASURED_WORST_MS);

    // Half two · the BEHAVIOUR at that number, which is what the runner
    // actually experiences. A resolution costing exactly the measured worst
    // case must still RENDER A FIGURE. Under a 2500ms budget this same load is
    // a fault-red dash, so this half dies on the reversion on its own — the
    // constant could be deleted entirely and this would still hold the line.
    vi.useFakeTimers();
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(OUTLOOK), RACE_PROJECTION_MEASURED_WORST_MS)),
    );
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });

    const pending = loadPlanSnapshot(UUID, TODAY);
    await vi.advanceTimersByTimeAsync(RACE_PROJECTION_MEASURED_WORST_MS + 1);
    const stat = finishStat(await pending);

    expect(stat).not.toBeNull();
    expect(stat!.value.text, 'the slowest load ever measured must still show the figure').toBe('42:57');
    expect(stat!.tone).toBeNull();
  });

  it('3.8 · A WITHDRAWN PROJECTION IS NOT RESURRECTED · case 2 clears the last known good', async () => {
    // THE DEFECT THIS REPRODUCES (FINISHEST-RESURRECT-1). The last-known-good
    // exists so a resolution that FAILED does not blank a figure this process
    // already stood behind. It must never outlive the engine's own decision to
    // stop making the claim.
    //
    // The sequence, which is the reviewer's, step for step:
    //   (a) the projection resolves.                        → "42:57" cached
    //   (b) a LATER load re-resolves to CASE 2 — the race moved out of the
    //       projection horizon, the evidence changed, the goal went away — and
    //       the stat correctly disappears. But case 2's early `return` left the
    //       cache entry standing.
    //   (c) a THIRD load times out, reads that entry, and puts "42:57" back on
    //       the screen as a live value.
    //
    // Step (c) is the app serving a number the engine has already decided it
    // can no longer honestly make — the exact "silently serving a stale wrong
    // number" class this whole fix exists to prevent, and strictly worse than
    // the flicker it was built to cure, because a flicker is visible and this
    // is not. Rule 11: withdrawn and unknown are different facts, and the cache
    // was collapsing them into the last good one.

    // (a) · resolves. The runner sees 42:57 and the process remembers it.
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });
    expect(finishStat(await loadPlanSnapshot(UUID, TODAY))!.value.text).toBe('42:57');

    // (b) · CASE 2. Honestly withdrawn: no stat, and nothing claims staleness.
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: null });
    const withdrawn = await loadPlanSnapshot(UUID, TODAY);
    expect(finishStat(withdrawn)).toBeNull();
    expect(withdrawn.projection_served_stale).toBeUndefined();

    // (c) · the resolution now fails. There is nothing left to fall back on,
    // so the runner gets the honest third state — NOT the withdrawn figure.
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('slow backend'));
    const afterFailure = await loadPlanSnapshot(UUID, TODAY);
    const stat = finishStat(afterFailure);

    expect(stat, 'a failed resolve still renders the unreadable stat').not.toBeNull();
    expect(stat!.value.text, 'a withdrawn projection must not come back as a live value').toBeNull();
    expect(stat!.tone).toBe('fault');
    expect(
      afterFailure.projection_served_stale,
      'nothing stale was served, so nothing may claim it was',
    ).toBeUndefined();
  });

  it('3.9 · the SECOND case-2 exit clears it too · an unformattable projection', async () => {
    // `projectedSec == null` is not the only way case 2 is reached. A value
    // that survives that check and then fails to FORMAT — non-finite, zero or
    // negative, all of which `formatRaceTime` answers with null — takes the
    // `if (!text) return` exit one line below. Two exits, one contract: a
    // separate test because clearing one and not the other would leave the
    // resurrection live on a path the first test cannot see.
    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(OUTLOOK);
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 2577 });
    expect(finishStat(await loadPlanSnapshot(UUID, TODAY))!.value.text).toBe('42:57');

    // Past the null check, refused by the formatter.
    (raceProjectionFromOutlook as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ projectedSec: 0 });
    expect(finishStat(await loadPlanSnapshot(UUID, TODAY))).toBeNull();

    (resolveRaceOutlookBySlug as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('slow backend'));
    const afterFailure = await loadPlanSnapshot(UUID, TODAY);
    expect(finishStat(afterFailure)!.value.text).toBeNull();
    expect(afterFailure.projection_served_stale).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · SKIPOWNER-1 / SKIPAGREE-1 · Today, Block and Plan Snapshot agree
 *
 * The acceptance criterion this closes was a TWO-way check until now:
 * `PlanWeek.days` had no `skipped` field at all, so the Block screen could
 * not participate and a disagreement there was unrepresentable.
 *
 * FALSIFIER: point any ONE of the three back at its own inline predicate, or
 * drop `skipped` from `PlanWeek.days`. 4.1 goes red (or stops compiling,
 * which is the same answer sooner).
 * ═══════════════════════════════════════════════════════════════════════ */

describe('three surfaces, one skip resolver', () => {
  it('4.1 · Today, Block and Plan Snapshot report the same skipped value per date', async () => {
    fx.skips = [SKIPPED_DAY];

    const [todaySkipped, todayNotSkipped, block, snapshot] = await Promise.all([
      isDaySkipped(UUID, SKIPPED_DAY),          // Today · /api/v5/today, /api/today/skip, glance-state
      isDaySkipped(UUID, NOT_SKIPPED_DAY),
      loadTrainingState(UUID),                  // Block · /api/v5/block
      loadPlanSnapshot(UUID, TODAY),            // Plan Snapshot · /api/v5/plan-snapshot
    ]);

    const blockDays = block.weeks.flatMap((w) => w.days);
    const blockSkipped = blockDays.find((d) => d.date === SKIPPED_DAY);
    const blockNotSkipped = blockDays.find((d) => d.date === NOT_SKIPPED_DAY);

    expect(todaySkipped).toEqual({ skipped: true, failed: false });
    expect(blockSkipped?.skipped).toBe(true);
    expect(dayOf(snapshot, SKIPPED_DAY).skipped).toBe(true);

    expect(todayNotSkipped).toEqual({ skipped: false, failed: false });
    expect(blockNotSkipped?.skipped).toBe(false);
    expect(dayOf(snapshot, NOT_SKIPPED_DAY).skipped).toBe(false);

    // Stated as the agreement itself, so the failure message names the
    // disagreement rather than one surface's value.
    const answers = [todaySkipped.skipped, blockSkipped?.skipped, dayOf(snapshot, SKIPPED_DAY).skipped];
    expect(new Set(answers).size).toBe(1);
  });

  it('4.4 · SKIPWIRE-1 · the fact reaches the BLOCK SCREEN\'S PAYLOAD, not just TrainingState', async () => {
    // WHY 4.1 ABOVE IS NOT ENOUGH, and why this is a separate test rather than
    // two more lines on it. 4.1 proves the three surfaces AGREE, and it reads
    // Block's answer off `TrainingState` — the data layer. `buildWeeks` is the
    // mapping in between: it picks a named subset of each day
    // (`{id, miles, quality, race, isToday, isFuture, dateISO, type, isDone}`)
    // and that subset IS the Block screen's wire payload. It did not carry
    // `skipped`.
    //
    // So the agreement was true, tested, and invisible: a day the runner had
    // explicitly declined still rendered as an ordinary prescribed day on the
    // one screen that shows him his block. That is the original defect's
    // actual runner-facing manifestation, and a three-way test that stops at
    // the data layer cannot see it — Rule 15, the mechanism the corpus cannot
    // reach. This test reaches it.
    fx.skips = [SKIPPED_DAY];

    const state = await loadTrainingState(UUID);
    const wireDays = buildWeeks(state).flatMap((w) => w.days);

    const skipped = wireDays.find((d) => d.dateISO === SKIPPED_DAY);
    const notSkipped = wireDays.find((d) => d.dateISO === NOT_SKIPPED_DAY);
    expect(skipped, `no wire day for ${SKIPPED_DAY}`).toBeDefined();
    expect(notSkipped, `no wire day for ${NOT_SKIPPED_DAY}`).toBeDefined();

    // The key must be PRESENT, not merely falsy-by-absence. `undefined` and
    // `false` render identically on a lenient Swift decoder, so asserting the
    // truthy day alone would pass against a payload that dropped the field.
    expect(Object.prototype.hasOwnProperty.call(skipped!, 'skipped')).toBe(true);
    expect(skipped!.skipped).toBe(true);
    expect(notSkipped!.skipped).toBe(false);

    // And it is the SAME answer the other two give for that date — the wire
    // is now the third party to the agreement, not a fourth opinion.
    const snapshot = await loadPlanSnapshot(UUID, TODAY);
    const today = await isDaySkipped(UUID, SKIPPED_DAY);
    expect(new Set([today.skipped, skipped!.skipped, dayOf(snapshot, SKIPPED_DAY).skipped]).size).toBe(1);
  });

  it('4.5 · SKIPWIRE-1 · a failed read reaches the Block payload as unknown, not as "nothing skipped"', async () => {
    // Rule 11 on the wire. Under a failed read every `skipped` is a
    // best-effort `false`, which is indistinguishable from a runner who
    // declined nothing — unless the payload says so. 4.2 checks this on
    // `TrainingState`; this checks it on what the phone is actually handed.
    fx.skipReadFails = true;

    const state = await loadTrainingState(UUID);
    expect(state.skipStateUnknown).toBe(true);

    const wireDays = buildWeeks(state).flatMap((w) => w.days);
    expect(wireDays.length).toBeGreaterThan(0);
    // Every day reads not-skipped — which is exactly why the flag has to exist.
    expect(wireDays.every((d) => d.skipped === false)).toBe(true);
  });

  it('4.2 · a failed read is reported as unknown by all three, never as "not skipped"', async () => {
    fx.skipReadFails = true;

    const today = await isDaySkipped(UUID, SKIPPED_DAY);
    const block = await loadTrainingState(UUID);
    const snapshot = await loadPlanSnapshot(UUID, TODAY);

    expect(today.failed).toBe(true);
    expect(block.skipStateUnknown).toBe(true);
    expect(snapshot.skip_state_unknown).toBe(true);
  });

  it('4.3 · liveness · the fixture actually reaches the day_actions predicate', async () => {
    // Rule 18 guard 2. If the fake pool stopped matching the resolver's SQL,
    // every test above would report "not skipped" and pass vacuously on the
    // negative half. This asserts the dispatch fires and returns the row.
    fx.skips = [SKIPPED_DAY];
    const read = await loadSkippedDates(UUID, '2026-09-01', '2026-09-30');
    expect(read.failed).toBe(false);
    expect(read.skippedDates.has(SKIPPED_DAY)).toBe(true);

    const issued = (pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('FROM day_actions'));
    expect(issued.length).toBeGreaterThan(0);
    // ONE predicate, and it is the canonical one — not `COALESCE(user_uuid,
    // user_id)`, which is what the three folded call sites used to carry.
    for (const s of issued) {
      expect(s).toContain("user_uuid = $1 AND action = 'skip'");
      expect(s).not.toContain('COALESCE(user_uuid, user_id)');
    }
  });
});

const REPO = join(__dirname, '..', '..');

/**
 * Statements allowed to carry a `day_actions … action = 'skip'` SQL literal.
 *
 * `allows` is the KIND of statement each file is excused for, and it is the
 * load-bearing half. An earlier version of this allowlist was keyed on the FILE
 * alone — it computed `isRead` and then threw it away, exempting every literal
 * in an excused file rather than the one statement the excuse was written for.
 * An independent review planted a sixth inline READ inside
 * `app/api/today/skip/route.ts`, whose entry exists only for its DELETE, and
 * all twenty tests here stayed green. That was a real hole and this is what
 * closes it: a WRITE-excused file that starts READING is an offender, which is
 * exactly the shape SKIPOWNER-1 exists to catch.
 */
const SKIP_SQL_ALLOWED: Record<string, { allows: 'READ' | 'WRITE'; why: string }> = {
  'lib/plan/week-loader.ts': {
    allows: 'READ',
    why: 'THE resolver. The one owner of "which dates did this runner skip".',
  },
  'app/api/today/skip/route.ts': {
    allows: 'WRITE',
    why: 'DELETE — the unskip WRITE. A writer is not a second answer to the read.',
  },
  'app/api/notifications/ack/route.ts': {
    allows: 'WRITE',
    why: 'DELETE + INSERT — the notification-action WRITES, same reason.',
  },
};

/** A template literal that actually queries `day_actions`, as opposed to a
 *  doc comment's inline code span naming the table. */
const SQL_AGAINST_DAY_ACTIONS = /\b(FROM|INTO|UPDATE)\s+day_actions\b/i;

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('._')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · SKIPOWNER-1's own gate · no SIXTH copy of the predicate
 *
 * Rule 20: "when a rule IS violated, fix the gate, not just the instance."
 * `loadSkippedDates`' header said "do not add a second inline query for this
 * question" while FIVE were live — because a sentence in a header is
 * documentation, not enforcement. This is the enforcement.
 *
 * RATCHET · `SKIP_SQL_ALLOWED` may shrink, never grow. An entry whose file no
 * longer carries a literal of the KIND it was excused for fails until deleted.
 *
 * A HOLE THIS ONCE HAD, NOW CLOSED (Rule 22 · say what a gate cannot fail on,
 * and when the answer changes, say that too). The exemption used to be
 * FILE-level: the scan computed `isRead` and then discarded it, so any literal
 * at all in an excused file was waved through. An independent review planted a
 * sixth inline READ inside `app/api/today/skip/route.ts` — a file on the list
 * only for its unskip DELETE — and all twenty tests here stayed green. The
 * exemption is now STATEMENT-level: each entry names the kind it excuses, a
 * READ in a WRITE-excused file is an offender, and F9 below is the falsifier
 * that holds it. This is the one hole in this gate that was demonstrated
 * rather than theorised, which is why it is recorded here and not just fixed.
 *
 * WHAT IT STILL CANNOT FAIL ON (Rule 22): a copy written without the literal
 * `action = 'skip'` — a parameterised `action = $3`, a database view, a helper
 * that assembles the string from fragments. Those are invisible to it, and it
 * says so here rather than implying coverage it does not have. Nor can it see
 * a second READ added to `lib/plan/week-loader.ts` itself, which is READ-
 * excused as the resolver — 5.2 covers that by counting its literals.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('SKIPOWNER-1 · one owner for the skip predicate', () => {
  it('5.1 · every day_actions skip SQL outside the resolver is a WRITE, and named', () => {
    const roots = ['lib', 'app', 'components'].map((d) => join(REPO, d));
    const files = roots.flatMap((r) => walkTs(r));
    // Rule 18 guard 2 · a scanner that read nothing must fail, not report clean.
    expect(files.length).toBeGreaterThan(500);

    const offenders: string[] = [];
    const seen = new Set<string>();
    /** `<rel>::READ` / `<rel>::WRITE` — what each file was actually observed
     *  doing, so the ratchet below can check the EXCUSE and not just the file. */
    const seenKinds = new Set<string>();
    let literalsFound = 0;

    for (const file of files) {
      const rel = relative(REPO, file);
      if (rel.endsWith('_skip_and_projection.test.ts')) continue;
      const src = readFileSync(file, 'utf8');
      // Template literals that are actually SQL. A doc comment's inline code
      // span (`day_actions action='skip'`) is prose about the table, not a
      // query against it, and counting it would make this gate cry wolf on
      // every file that explains itself — which is most of them here.
      for (const [literal] of src.matchAll(/`[^`]*`/g)) {
        if (!/action\s*=\s*'skip'/.test(literal)) continue;
        if (!SQL_AGAINST_DAY_ACTIONS.test(literal)) continue;
        literalsFound++;
        seen.add(rel);
        const isRead = /\bSELECT\b/i.test(literal) && !/\b(INSERT|DELETE|UPDATE)\b/i.test(literal);
        const kind: 'READ' | 'WRITE' = isRead ? 'READ' : 'WRITE';
        seenKinds.add(`${rel}::${kind}`);
        // STATEMENT-level, not file-level. The excuse names a kind, and only
        // that kind is excused — a file allowed to WRITE that starts READING
        // is a second answer to the read, which is the whole finding.
        if (SKIP_SQL_ALLOWED[rel]?.allows === kind) continue;
        offenders.push(`${rel} · ${kind} · ${literal.slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }

    // Liveness · the predicate the scanner looks for must still exist.
    expect(literalsFound).toBeGreaterThan(0);
    expect(seen.has('lib/plan/week-loader.ts')).toBe(true);

    expect(offenders).toEqual([]);

    // Ratchet · an entry whose file no longer carries a literal OF THE KIND it
    // was excused for is stale and fails until deleted. Checking the kind and
    // not merely the file matters for the same reason the exemption does: an
    // entry excused for a DELETE that now only ever SELECTs has stopped
    // describing the code, and a stale excuse is how a gate quietly stops
    // meaning anything (Rule 18).
    for (const [allowed, { allows }] of Object.entries(SKIP_SQL_ALLOWED)) {
      expect(
        seenKinds.has(`${allowed}::${allows}`),
        `stale SKIP_SQL_ALLOWED entry: ${allowed} is excused for a ${allows} it no longer carries`,
      ).toBe(true);
    }
  });

  it('5.2 · the resolver carries exactly ONE such literal', () => {
    const src = readFileSync(join(REPO, 'lib/plan/week-loader.ts'), 'utf8');
    const hits = [...src.matchAll(/`[^`]*`/g)]
      .map(([l]) => l)
      .filter((l) => SQL_AGAINST_DAY_ACTIONS.test(l) && /action\s*=\s*'skip'/.test(l));
    expect(hits).toHaveLength(1);
  });
});
