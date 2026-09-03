/**
 * lib/plan/_reschedule_contract.test.ts · the rescheduling contract, gated.
 *
 * Every assertion here is a clause of `docs/RESCHEDULING_CONTRACT.md` or of
 * `docs/MASTER_CORE_PRODUCT_PROGRAM.md`'s RS-1..RS-8, checked against the LIVE
 * CASE read off production on 2026-09-02 (`_reschedule_fixture.ts`), not
 * against a shape invented to suit the code.
 *
 * The whole suite runs against ONE in-memory row store behind a mocked pool.
 * `applyReschedule` and `undoReschedule` run FOR REAL against it — only
 * `mutatePlan`'s transaction machinery is replaced, and its `apply` callback is
 * invoked exactly as the real boundary invokes it. So the statements asserted
 * below are the statements `writeEdits` and `recordDecision` actually issue,
 * not a re-implementation of them.
 *
 * ─── WHAT THIS SUITE CANNOT FAIL ON  (Rule 22) ──────────────────────────────
 *
 * · Anything after a run is completed. Grading, evidence weighting and the
 *   post-run comparison belong to another owner. This proves a reschedule
 *   LEAVES them what they need (original prescription preserved,
 *   `stimulusPreservation` recorded apart from any execution grade). It never
 *   proves they use it correctly.
 * · The real validator. `mutatePlan` is mocked, so a doctrine violation the
 *   real boundary would catch is invisible here. The suite proves the edit set
 *   is coherent and reversible, not that `validateComposedPlan` accepts it.
 * · Real SQL execution. The fake transaction interprets the UPDATE by its
 *   parameters rather than parsing it, so a syntax error in `writeEdits` would
 *   pass. The statement text is verified separately against the live schema.
 * · The WORDING of an option beyond the specific sentences asserted. A badly
 *   phrased but structurally correct tradeoff passes.
 * · Which option a human would prefer. It asserts the ORDER follows the stated
 *   costs and that doctrine's refusals hold, not that the ranking is wise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  USER_UUID, PLAN_ID, TODAY, DAYS, WEEKS, RACES, LONG_0906_SPEC,
  type FixtureDay, type FixtureWeek, type FixtureRace,
} from './_reschedule_fixture';

// ─────────────────────────────────────────────────────────────────────────────
// the store · one mutable set of rows, one query log, shared by every mock
// ─────────────────────────────────────────────────────────────────────────────

interface Call { sql: string; params: unknown[] }

const state = {
  days: [] as FixtureDay[],
  weeks: [] as FixtureWeek[],
  races: [] as FixtureRace[],
  reschedules: [] as Array<{ id: string; decision: unknown; undone_at: string | null; plan_id: string }>,
  log: [] as Call[],
  sealed: new Set<string>(),
  tableMissing: false,
};

function reset(days: FixtureDay[] = DAYS, weeks: FixtureWeek[] = WEEKS) {
  state.days = days.map((d) => ({ ...d }));
  state.weeks = weeks.map((w) => ({ ...w }));
  state.races = RACES.map((r) => ({ ...r }));
  state.reschedules = [];
  state.log = [];
  state.sealed = new Set();
  state.tableMissing = false;
}

/** The single query router. Reads serve the fixture; writes mutate the store. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function route(sql: any, params: any = []): Promise<{ rows: any[]; rowCount: number }> {
  const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
  state.log.push({ sql: text, params: params ?? [] });

  if (/^\s*UPDATE\s+plan_workouts/i.test(text)) {
    const [id, , dateISO, dow, type, dist, isQ, isL, sub, pace, spec] = params;
    const row = state.days.find((d) => d.id === id);
    if (!row) return { rows: [], rowCount: 0 };
    if (row.original_date_iso === undefined) row.original_date_iso = row.date_iso;
    row.date_iso = dateISO;
    row.dow = Number(dow);
    row.type = type;
    row.distance_mi = String(dist);
    row.is_quality = Boolean(isQ);
    row.is_long = Boolean(isL);
    row.sub_label = sub;
    row.pace_target_s_per_mi = pace;
    row.workout_spec = spec == null ? null : JSON.parse(spec);
    // Re-home the week the way the real statement's subselect does.
    const w = state.weeks.find((x) =>
      dateISO >= x.week_start_iso && dateISO < isoPlus(x.week_start_iso, 7));
    if (w) row.week_id = w.id;
    return { rows: [], rowCount: 1 };
  }
  if (/^\s*INSERT INTO plan_reschedules/i.test(text)) {
    if (state.tableMissing) {
      throw new Error('relation "plan_reschedules" does not exist');
    }
    state.reschedules.push({
      id: params[0], plan_id: params[2], undone_at: null, decision: JSON.parse(params[9]),
    });
    return { rows: [], rowCount: 1 };
  }
  if (/^\s*UPDATE plan_reschedules/i.test(text)) {
    const r = state.reschedules.find((x) => x.id === params[0]);
    if (r) r.undone_at = '2026-09-02T00:00:00Z';
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/FROM plan_reschedules/i.test(text)) {
    const r = state.reschedules.find((x) => x.id === params[0]);
    return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
  }
  if (/FROM training_plans/i.test(text)) {
    return {
      rows: [{ id: PLAN_ID, mode: 'race-prep', race_id: 'cim', goal_iso: '2026-12-06' }],
      rowCount: 1,
    };
  }
  if (/FROM plan_weeks/i.test(text)) return { rows: state.weeks, rowCount: state.weeks.length };
  if (/FROM plan_workouts/i.test(text)) {
    const rows = state.days.slice().sort((a, b) => (a.date_iso < b.date_iso ? -1 : 1));
    return { rows, rowCount: rows.length };
  }
  if (/FROM races/i.test(text)) return { rows: state.races, rowCount: state.races.length };
  return { rows: [], rowCount: 0 };
}

const isoPlus = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

vi.mock('@/lib/db/pool', () => ({ pool: { query: (s: unknown, p: unknown) => route(s, p) } }));

vi.mock('@/lib/plan/seal', () => ({
  isDaySealed: vi.fn(async (_u: string, iso: string) => state.sealed.has(iso)),
  assertDayIsMutable: vi.fn(async (_u: string, iso: string) => !state.sealed.has(iso)),
}));

/**
 * `mutatePlan` replaced by its own contract: run the caller's `apply` against a
 * transaction, return `applied` on success, propagate an `apply` throw after
 * "rolling back" (which here means restoring the snapshot).
 */
vi.mock('@/lib/plan/mutate', () => ({
  mutatePlan: vi.fn(async (opts: {
    planId?: string | null;
    apply: (tx: { query: typeof route }, planId: string) => Promise<unknown>;
  }) => {
    const snapshot = state.days.map((d) => ({ ...d }));
    try {
      const value = await opts.apply({ query: route }, opts.planId ?? PLAN_ID);
      return {
        ok: true, outcome: 'applied', value, violations: [], preExisting: [],
        resolved: [], planId: opts.planId ?? PLAN_ID,
      };
    } catch (e) {
      state.days = snapshot;                    // rollback
      throw e;
    }
  }),
}));

import {
  recommendReschedule,
  applyReschedule,
  undoReschedule,
  splitEligibility,
  requiredRecoveryDaysAfter,
  separationFindings,
  timelineOf,
  applyEditsToTimeline,
  isDemanding,
  resolveConstraint,
  carriesFuellingLadder,
  carriesMarathonPaceWork,
  permutationFault,
  type RescheduleRecommendation,
} from './reschedule';
import { loadPlanShape } from './replan-scenarios';

// ─────────────────────────────────────────────────────────────────────────────
// harness
// ─────────────────────────────────────────────────────────────────────────────

/** He is away Saturday and Sunday. This is the live constraint. */
const AWAY_WEEKEND = { kind: 'UNAVAILABLE_DATES' as const, dates: ['2026-09-05', '2026-09-06'] };

beforeEach(() => reset());

async function recommend(
  over: Partial<Parameters<typeof recommendReschedule>[0]> = {},
): Promise<RescheduleRecommendation> {
  const out = await recommendReschedule({
    userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06',
    constraint: AWAY_WEEKEND, ...over,
  });
  if (!out.ok) throw new Error(`recommend failed: ${out.code} ${out.reason}`);
  return out.recommendation;
}

async function applyBest(over: Partial<Parameters<typeof recommendReschedule>[0]> = {}) {
  const r = await recommend(over);
  const option = r.options[0];
  const before = new Map<string, FixtureDay>(
    [...new Set(option.edits.flatMap((e) => [e.before.dateISO, e.after.dateISO]))]
      .map((iso) => [iso, { ...state.days.find((d) => d.date_iso === iso)! }]),
  );
  state.log = [];
  const out = await applyReschedule({
    userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06',
    constraint: (over.constraint ?? AWAY_WEEKEND) as never,
    optionId: option.id, token: r.token,
  });
  if (!out.ok) throw new Error(`apply failed: ${out.code} ${out.reason}`);
  return { r, option, before, out, writes: state.log.slice() };
}

const dayAt = (iso: string): FixtureDay | undefined => state.days.find((d) => d.date_iso === iso);

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · NOTHING WRITES DURING RECOMMENDATION  (RS-5, and the core constraint)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('recommendation writes nothing', () => {
  it('issues only SELECT statements', async () => {
    await recommend();
    expect(state.log.length).toBeGreaterThan(0);            // liveness · Rule 18
    for (const q of state.log) {
      expect(q.sql.trim().slice(0, 6).toUpperCase(), `non-SELECT issued:\n${q.sql}`).toBe('SELECT');
    }
  });

  it('leaves every row byte-identical', async () => {
    const before = JSON.stringify(state.days);
    await recommend();
    expect(JSON.stringify(state.days)).toBe(before);
    expect(state.reschedules).toHaveLength(0);
  });

  it('never reaches coach_intents, plan_mutations, day_actions, runs or profile', async () => {
    await recommend();
    const all = state.log.map((q) => q.sql).join('\n').toLowerCase();
    for (const t of ['coach_intents', 'plan_mutations', 'day_actions', ' runs', 'profile']) {
      expect(all, `recommendation reached ${t}`).not.toContain(t);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · RESCHEDULING IS NOT ADAPTATION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('rescheduling is not adaptation', () => {
  it('carries the reschedule discriminants and declares no evidence effect', async () => {
    const r = await recommend();
    expect(r.kind).toBe('RESCHEDULE');
    expect(r.origin).toBe('RUNNER_CONSTRAINT');
    expect(r.evidenceEffect).toBe('NONE');
  });

  it('states plainly that nothing about training changed', async () => {
    const r = await recommend();
    const said = r.options[0].unchanged.join(' ');
    expect(said).toContain('This is a calendar change, not a training change');
    expect(said).toMatch(/paces and your heart-rate ceilings are untouched/);
  });

  it('applying a decision writes plan_workouts and plan_reschedules and nothing else', async () => {
    const { writes } = await applyBest();
    const written = writes
      .filter((c) => /^\s*(UPDATE|INSERT|DELETE)/i.test(c.sql))
      .map((c) => c.sql.replace(/\s+/g, ' ').trim());
    expect(written.length).toBeGreaterThan(0);              // liveness
    for (const s of written) {
      expect(s, `unexpected write: ${s}`).toMatch(/plan_workouts|plan_reschedules/);
    }
    const all = written.join('\n').toLowerCase();
    for (const t of ['coach_intents', 'plan_mutations', 'adaptation_log', 'last_adapted_at', 'day_actions', 'vdot', 'lthr']) {
      expect(all, `apply reached ${t}`).not.toContain(t);
    }
  });

  it('the persisted decision declares evidenceEffect NONE', async () => {
    await applyBest();
    expect(state.reschedules).toHaveLength(1);
    const d = state.reschedules[0].decision as Record<string, unknown>;
    expect(d.kind).toBe('RESCHEDULE');
    expect(d.origin).toBe('RUNNER_CONSTRAINT');
    expect(d.evidenceEffect).toBe('NONE');
  });

  it('refuses to apply at all when the reschedule cannot be recorded', async () => {
    const r = await recommend();
    state.tableMissing = true;
    const before = JSON.stringify(state.days);
    const out = await applyReschedule({
      userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06',
      constraint: AWAY_WEEKEND, optionId: r.options[0].id, token: r.token,
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('no_record_table');
    // And nothing was left half-applied.
    expect(JSON.stringify(state.days)).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · A MANUALLY UNAVAILABLE DAY IS NOT FAILED TRAINING
 * ═══════════════════════════════════════════════════════════════════════ */

describe('an unavailable day is not a missed workout', () => {
  it('refuses the day for the runner-supplied reason, not a training one', async () => {
    const r = await recommend();
    const sat = r.refusals.find((x) => x.dateISO === '2026-09-05');
    expect(sat?.cause).toBe('RUNNER_UNAVAILABLE');
    expect(sat?.reason).toBe('You said you cannot run that day.');
    expect(sat?.reason.toLowerCase()).not.toMatch(/miss|skip|fail|behind|debt/);
  });

  it('leaves the vacated date carrying a PRESCRIBED rest row, never an unrun prescription', async () => {
    const { out } = await applyBest();
    const vacated = dayAt('2026-09-06');
    expect(vacated, 'the vacated date lost its row entirely').toBeDefined();
    expect(vacated!.type).toBe('rest');
    expect(Number(vacated!.distance_mi)).toBe(0);
    expect(vacated!.is_quality).toBe(false);
    expect(vacated!.is_long).toBe(false);
    // And the session itself is somewhere real, not deleted.
    const landed = dayAt(out.ok ? out.decision.newDateISO : '');
    expect(landed?.is_long).toBe(true);
    expect(Number(landed?.distance_mi)).toBe(15);
  });

  it('records no skip and no coach note', async () => {
    const { writes } = await applyBest();
    const all = writes.map((c) => c.sql).join('\n').toLowerCase();
    expect(all).not.toMatch(/insert into day_actions/);
    expect(all).not.toMatch(/insert into coach_intents/);
  });

  it('the same day count is prescribed before and after · nothing is lost or duplicated', async () => {
    const before = state.days.length;
    const beforeDates = state.days.map((d) => d.date_iso).sort().join(',');
    await applyBest();
    expect(state.days.length).toBe(before);
    expect(state.days.map((d) => d.date_iso).sort().join(',')).toBe(beforeDates);
    expect(new Set(state.days.map((d) => d.id)).size).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Q40 · THE TWO QUESTIONS DO NOT COLLAPSE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Q40 · identity and stimulus preservation', () => {
  it('a pure date change keeps the SAME workout instance, same row id', async () => {
    const r = await recommend();
    const pure = r.options.find((o) => o.identity.kind === 'SAME_INSTANCE');
    expect(pure, 'no pure-move option was produced').toBeDefined();
    expect(pure!.stimulusPreservation).toBe('FULL');
    expect(pure!.session.distanceMi).toBe(pure!.session.originalDistanceMi);
    const moved = pure!.edits.find((e) => e.planWorkoutId === 'pw0906')!;
    expect(moved.before.dateISO).toBe('2026-09-06');
    expect(moved.after.dateISO).toBe(pure!.newDateISO);
    expect(moved.after.distanceMi).toBe(15);
    expect(moved.after.spec).toEqual(LONG_0906_SPEC);
  });

  it('after applying, the SAME row id carries the session on its new date', async () => {
    const { out } = await applyBest();
    if (!out.ok) throw new Error('apply failed');
    const landed = dayAt(out.decision.newDateISO)!;
    expect(landed.id).toBe('pw0906');                       // the instance survived
    expect(landed.workout_spec).toEqual(LONG_0906_SPEC);
    expect(out.decision.identity.kind).toBe('SAME_INSTANCE');
    expect(out.decision.stimulusPreservation).toBe('FULL');
  });

  it('the decision preserves the ORIGINAL prescription verbatim', async () => {
    const { out } = await applyBest();
    if (!out.ok) throw new Error('apply failed');
    expect(out.decision.original.planWorkoutId).toBe('pw0906');
    expect(out.decision.original.dateISO).toBe('2026-09-06');
    expect(out.decision.original.distanceMi).toBe(15);
    expect(out.decision.original.spec).toEqual(LONG_0906_SPEC);
  });

  it('the shortened path is REACHABLE, and produces a revised version (Rule 15)', async () => {
    const r = await recommend();
    const cut = r.options.filter((o) => o.identity.kind === 'REVISED_VERSION');
    expect(cut.length, 'no option ever reaches the shortening path').toBeGreaterThan(0);
    for (const o of cut) {
      expect(o.stimulusPreservation).toBe('PARTIAL');
      expect(o.session.distanceMi).toBeLessThan(o.session.originalDistanceMi);
      // A shortened run cannot rehearse a gel past its own distance.
      const moved = o.edits.find((e) => e.planWorkoutId === 'pw0906')!;
      const fuel = (moved.after.spec as { fuel_mi?: number[] }).fuel_mi ?? [];
      for (const mi of fuel) expect(mi).toBeLessThanOrEqual(o.session.distanceMi);
      expect(fuel.length).toBeLessThan((LONG_0906_SPEC.fuel_mi as number[]).length);
    }
    // And it always ranks BELOW an arrangement that keeps the run whole.
    const whole = r.options.filter((o) => o.stimulusPreservation === 'FULL');
    expect(whole.length).toBeGreaterThan(0);
    expect(Math.min(...cut.map((o) => o.rank)))
      .toBeGreaterThan(Math.max(...whole.map((o) => o.rank)));
  });

  it('REVISED_VERSION and FULL are mutually exclusive, in both directions', async () => {
    for (const c of [
      AWAY_WEEKEND,
      { kind: 'AVAILABLE_DATES' as const, dates: ['2026-09-04'] },
      { kind: 'AVAILABLE_DATES' as const, dates: ['2026-09-08'] },
      { kind: 'UNKNOWN' as const },
    ]) {
      const r = await recommend({ constraint: c });
      for (const o of r.options) {
        if (o.identity.kind === 'REVISED_VERSION') {
          expect(o.stimulusPreservation).not.toBe('FULL');
          expect(o.identity.reductionReason.length).toBeGreaterThan(0);
          expect(o.session.distanceMi).toBeLessThan(o.session.originalDistanceMi);
        }
        if (o.stimulusPreservation === 'FULL') {
          expect(o.identity.kind).toBe('SAME_INSTANCE');
          expect(o.session.distanceMi).toBe(o.session.originalDistanceMi);
        }
      }
    }
  });

  it('refuses to touch a day that has already been run', async () => {
    state.sealed.add('2026-09-06');
    const out = await recommendReschedule({
      userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06', constraint: AWAY_WEEKEND,
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('sealed');
  });

  it('refuses to reschedule a past workout at all (Q36)', async () => {
    const out = await recommendReschedule({
      userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-01',
      constraint: { kind: 'UNKNOWN' },
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/A past session is not rescheduled/);
  });

  it('refuses to apply if a run lands on a touched day between reading and approving', async () => {
    const r = await recommend();
    state.sealed.add(r.options[0].newDateISO);
    const before = JSON.stringify(state.days);
    const out = await applyReschedule({
      userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06',
      constraint: AWAY_WEEKEND, optionId: r.options[0].id, token: r.token,
    });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(state.days)).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Q31 / Q32 · SEARCH WINDOW AND SEPARATION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Q31 · the search window is a boundary, not a permission', () => {
  it('a long run searches ±3 days and no further', async () => {
    const r = await recommend({ constraint: { kind: 'UNKNOWN' } });
    expect(r.considered[0]).toBe('2026-09-03');
    expect(r.considered[r.considered.length - 1]).toBe('2026-09-09');
  });

  it('the adjacent week is reachable only on an explicit request', async () => {
    const wide = await recommend({ constraint: { kind: 'UNKNOWN' }, allowAdjacentWeek: true });
    expect(wide.considered[0]).toBe('2026-08-27');
    expect(wide.considered[wide.considered.length - 1]).toBe('2026-09-16');
  });

  it('an empty declaration is UNKNOWN, never "no days are blocked" (RS-2, Rule 11)', () => {
    // The forbidden shortcut is returning an empty UNAVAILABLE_DATES, which
    // reads downstream as "every other day is fine" and is exactly the
    // assumption the contract forbids.
    expect(resolveConstraint([], [])).toEqual({ kind: 'UNKNOWN' });
    expect(resolveConstraint(['nonsense'], ['also-nonsense'])).toEqual({ kind: 'UNKNOWN' });
    expect(resolveConstraint(['2026-09-05'], [])).toEqual({
      kind: 'UNAVAILABLE_DATES', dates: ['2026-09-05'], note: undefined,
    });
    // Saying which days DO work is the stronger statement and wins.
    expect(resolveConstraint(['2026-09-05'], ['2026-09-07'])).toEqual({
      kind: 'AVAILABLE_DATES', dates: ['2026-09-07'], note: undefined,
    });
  });

  it('never assumes availability when he has not said (RS-2)', async () => {
    const r = await recommend({ constraint: { kind: 'UNKNOWN' } });
    expect(r.availabilityUnknown).toBe(true);
    expect(r.refusals.find((x) => x.cause === 'UNKNOWN_AVAILABILITY')?.reason)
      .toMatch(/Mark the days that work/);
  });
});

describe('Q32 · separation between demanding sessions', () => {
  it('mirrors validate.ts §9 SEP-1: intervals one day (same as threshold), marathon-specific long two', async () => {
    // SEP-1 (2026-09-03) resolved the divergence this test used to assert:
    // David's ruling is "at least ONE" for ordinary interval/threshold
    // sessions alike, so intervals no longer needs two.
    const shape = await loadPlanShape(USER_UUID);
    const tl = timelineOf(shape!);
    expect(requiredRecoveryDaysAfter(tl.byDate.get('2026-09-03')!)).toBe(1);
    expect(requiredRecoveryDaysAfter(tl.byDate.get('2026-09-01')!)).toBe(1);
    // 15 mi, fuelled, no race-effort block: Q32's "<~16 mi" row, one day.
    expect(requiredRecoveryDaysAfter(tl.byDate.get('2026-09-06')!)).toBe(1);
  });

  it('a long run with race-effort work inside it costs two days, a merely fuelled one does not', async () => {
    const shape = await loadPlanShape(USER_UUID);
    const tl = timelineOf(shape!);
    const fuelled = tl.byDate.get('2026-09-06')!;
    expect(requiredRecoveryDaysAfter(fuelled)).toBe(1);
    expect(requiredRecoveryDaysAfter({
      ...fuelled, spec: { ...LONG_0906_SPEC, finish_pace_s_per_mi: 420 },
    })).toBe(2);
    expect(requiredRecoveryDaysAfter({ ...fuelled, distanceMi: 18 })).toBe(2);
  });

  it('never offers an option with a separation deficit unless it is labelled a compromise', async () => {
    for (const c of [AWAY_WEEKEND, { kind: 'UNKNOWN' as const }]) {
      const r = await recommend({ constraint: c });
      for (const o of r.options) {
        const deficit = o.separation.reduce((s, x) => s + x.deficitDays, 0);
        if (deficit > 0) {
          expect(o.isCompromise, `${o.newDateISO} has a deficit and is not a compromise`).toBe(true);
          expect(r.impossibility).toBeTruthy();
        }
      }
    }
  });

  it('never stands a demanding session down just to make room on its own day', async () => {
    // "Do not sacrifice another key workout unless no viable arrangement
    // exists." The first version turned Thursday's hill session into rest to
    // land the long run on it, called the loss "6.5 mi of easy running", and
    // ranked the result first.
    const shape = await loadPlanShape(USER_UUID);
    const tl = timelineOf(shape!);
    const r = await recommend();
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      const after = applyEditsToTimeline(tl, o.edits);
      const count = (m: Map<string, ReturnType<typeof tl.byDate.get>>) => {
        let n = 0;
        for (let iso = '2026-09-01'; iso <= '2026-09-20';
             iso = new Date(Date.parse(`${iso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
          const d = m.get(iso);
          if (d && isDemanding(d)) n++;
        }
        return n;
      };
      const lost = count(tl.byDate) - count(after);
      if (lost > 0) {
        expect(o.cost.displacedQuality,
          `${o.newDateISO} loses ${lost} demanding session(s) and is charged nothing for it`)
          .toBeGreaterThan(0);
        expect(o.tradeoffs.join(' '),
          `${o.newDateISO} loses a session and does not say so`)
          .toMatch(/comes out|stands down|is not replaced|supplies that week/);
      }
    }
    // And the two days that already hold a hard session are refused by name.
    for (const iso of ['2026-09-03', '2026-09-08']) {
      const ref = r.refusals.find((x) => x.dateISO === iso);
      expect(ref, `${iso} was not refused`).toBeDefined();
      expect(ref!.reason).toMatch(/already holds your/);
    }
  });

  it('reports elapsed time as NOMINAL, never as a measurement', async () => {
    const r = await recommend();
    for (const f of r.options[0].separation) {
      expect(f.nominalHours).toBe(24 * (f.interveningDays + 1));
    }
  });

  it("Saturday 09-05 DOES clear Thursday's intervals gap, now that intervals needs only one day (SEP-1)", async () => {
    // Was "does not clear" against the old (2 for intervals) rule this test
    // used to assert — the contract's own Saturday proviso is "provided
    // Friday stays easy and Thursday's intervals leave adequate separation",
    // and under David's ruling (intervals needs "at least ONE", same as
    // threshold) they now genuinely do: Thu 09-03 intervals to Sat 09-05
    // leaves exactly the one intervening day (Friday) SEP-1 requires.
    const shape = await loadPlanShape(USER_UUID);
    const tl = timelineOf(shape!);
    const moved = new Map(tl.byDate);
    moved.set('2026-09-05', { ...tl.byDate.get('2026-09-06')!, dateISO: '2026-09-05', dow: 6 });
    moved.set('2026-09-06', { ...tl.byDate.get('2026-09-05')!, dateISO: '2026-09-06', dow: 0 });
    const clash = separationFindings(moved, '2026-09-01', '2026-09-13')
      .find((x) => x.earlierISO === '2026-09-03' && x.laterISO === '2026-09-05');
    expect(clash).toBeDefined();
    expect(clash!.requiredDays).toBe(1);
    expect(clash!.interveningDays).toBe(1);
    expect(clash!.deficitDays).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Q34 · PROTECT THE PURPOSE, NOT THE LABEL
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Q34 · protected weeks', () => {
  it('resolves the B-race week from the race calendar, not from is_race_week', async () => {
    // Production has is_race_week = false on the week that ENDS on the 10k.
    expect(WEEKS.find((w) => w.week_start_iso === '2026-09-07')!.is_race_week).toBe(false);
    const r = await recommend({ constraint: { kind: 'UNKNOWN' } });
    const intoWk2 = r.options.find((o) => o.newDateISO >= '2026-09-07');
    expect(intoWk2, 'no option reached the following week').toBeDefined();
    const wk2 = intoWk2!.load.weeks.find((w) => w.startISO === '2026-09-07');
    expect(wk2?.racePriority).toBe('B');
    expect(wk2?.isCutback).toBe(true);
  });

  it('names the cost of importing load into an authored cutback', async () => {
    const r = await recommend({ constraint: { kind: 'UNKNOWN' } });
    const intoWk2 = r.options.find((o) =>
      o.load.weeks.some((w) => w.startISO === '2026-09-07' && w.afterMi > w.beforeMi));
    expect(intoWk2).toBeDefined();
    const said = intoWk2!.tradeoffs.join(' ');
    expect(said).toMatch(/authored as a cutback/);
    expect(said).toMatch(/reduction is smaller than intended/);
    expect(said).toMatch(/week of your B race/);
  });

  it('never moves a long run into a taper week', async () => {
    reset(DAYS, WEEKS.map((w) => (w.week_start_iso === '2026-09-07' ? { ...w, phase: 'TAPER' } : w)));
    const out = await recommendReschedule({
      userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06', constraint: AWAY_WEEKEND,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const o of out.recommendation.options) {
      expect(o.newDateISO < '2026-09-07', `an option landed in the taper: ${o.newDateISO}`).toBe(true);
    }
    const blocked = out.recommendation.refusals.filter((x) => x.cause === 'PROTECTED_WEEK');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toMatch(/taper/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · Q35 · SPLITTING
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Q35 · a split is never called a preserved long run', () => {
  it('refuses to split the marathon-specific 15-miler, and says why', async () => {
    const r = await recommend();
    expect(r.splitVerdict).toBeTruthy();
    expect(r.splitVerdict!.eligible).toBe(false);
    expect(r.splitVerdict!.reason).toMatch(/continuous time on feet, fuelling practice or late-run mechanics/);
    expect(r.splitVerdict!.reason).toMatch(/would not preserve what it is for/);
  });

  it('reads the fuelling ladder off the row, not off the distance alone', () => {
    expect(carriesFuellingLadder({ spec: LONG_0906_SPEC })).toBe(true);
    expect(carriesFuellingLadder({ spec: { kind: 'long' } })).toBe(false);
  });

  it('keeps the fuelling ladder and marathon-pace work as SEPARATE questions (Rule 16)', () => {
    // The live 15-miler carries gels and no race-effort block. One predicate
    // answering both made it demand a 20-miler's recovery.
    expect(carriesFuellingLadder({ spec: LONG_0906_SPEC })).toBe(true);
    expect(carriesMarathonPaceWork({ spec: LONG_0906_SPEC, subLabel: 'LONG', type: 'long' })).toBe(false);
    const withMp = { spec: { kind: 'long', finish_pace_s_per_mi: 420 }, subLabel: 'LONG', type: 'long' };
    expect(carriesMarathonPaceWork(withMp)).toBe(true);
    expect(carriesFuellingLadder(withMp)).toBe(false);
  });

  it('never offers a SPLIT option for a durability long run', async () => {
    const r = await recommend();
    for (const o of r.options) expect(o.moveKind).not.toBe('SPLIT');
  });

  it('allows it only for a genuinely general-aerobic long run, with the loss stated', () => {
    const v = splitEligibility({
      id: 'x', weekId: 'w', dateISO: '2026-10-01', dow: 4, type: 'long',
      distanceMi: 10, isQuality: false, isLong: true, subLabel: 'LONG',
      paceTargetSPerMi: null, spec: { kind: 'long' },
    });
    expect(v.eligible).toBe(true);
    expect(v.reason).toMatch(/You lose the continuous-duration benefit/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · RS-4 · EVERY OPTION CARRIES EVERYTHING THE CONTRACT ASKS FOR
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RS-4 · per-option display', () => {
  it('every option states date, moved, unchanged, purpose, separation, load, downstream and rank reason', async () => {
    const r = await recommend();
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      expect(o.newDateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.moved.length).toBeGreaterThan(0);
      expect(o.unchanged.length).toBeGreaterThan(0);
      expect(o.session.purpose.length).toBeGreaterThan(0);
      expect(o.session.distanceMi).toBeGreaterThan(0);
      expect(o.separation.length).toBeGreaterThan(0);
      expect(o.load.weeks.length).toBeGreaterThan(0);
      expect(o.downstream).toBeTruthy();
      expect(o.whyRankedHere).toMatch(/^Ranked \d/);
      expect(o.trainingValuePreserved.length).toBeGreaterThan(0);
    }
  });

  it('states the effect on the next long run, next race, next cutback and taper', async () => {
    const o = (await recommend()).options[0];
    expect(o.downstream.nextLongRun?.dateISO).toBe('2026-09-20');
    expect(o.downstream.nextRace?.name).toBe('Santa Monica 10k');
    expect(o.downstream.nextRace?.priority).toBe('B');
    expect(o.downstream.taper).toBeTruthy();
  });

  it('says the split refusal ONCE, on the workout, not on every option (Rule 17)', async () => {
    const r = await recommend();
    expect(r.splitVerdict?.reason).toBeTruthy();
    for (const o of r.options) {
      expect(o.tradeoffs.join(' '), 'the split refusal is repeated per option')
        .not.toContain('Splitting it would not preserve');
    }
  });

  it('uses coach voice · no em dashes, no exclamation marks, no emoji', async () => {
    const r = await recommend();
    const prose = r.options.flatMap((o) => [
      o.whyRankedHere, o.trainingValuePreserved, ...o.moved, ...o.unchanged, ...o.tradeoffs,
    ]).concat(r.impossibility ?? '', r.splitVerdict?.reason ?? '', ...r.refusals.map((x) => x.reason));
    expect(prose.length).toBeGreaterThan(5);                // liveness
    for (const s of prose) {
      expect(s, `em dash in: ${s}`).not.toMatch(/—/);
      expect(s, `exclamation in: ${s}`).not.toMatch(/!/);
      expect(s, `emoji in: ${s}`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('ranks by cost, and the cost breakdown adds up to the total', async () => {
    const r = await recommend({ constraint: { kind: 'UNKNOWN' } });
    for (let i = 1; i < r.options.length; i++) {
      expect(r.options[i].cost.total).toBeGreaterThanOrEqual(r.options[i - 1].cost.total);
    }
    for (const o of r.options) {
      const parts = o.cost.stimulus + o.cost.separation + o.cost.displacedQuality
        + o.cost.continuity + o.cost.rollingLoad + o.cost.blockDisturbance;
      expect(Math.abs(parts - o.cost.total)).toBeLessThan(0.01);
    }
  });

  it('ranks by disruption, not calendar distance', async () => {
    // The nearest empty day is not automatically first. This asserts the
    // ranking is capable of preferring a further day, which is the whole of
    // "rank by physiological and plan disruption, not calendar distance".
    const r = await recommend({ constraint: { kind: 'UNKNOWN' } });
    const byDistance = r.options.slice().sort((a, b) =>
      Math.abs(new Date(a.newDateISO).getTime() - new Date('2026-09-06').getTime())
      - Math.abs(new Date(b.newDateISO).getTime() - new Date('2026-09-06').getTime()));
    expect(r.options.map((o) => o.newDateISO).join(),
      'the ranking is indistinguishable from sorting by calendar distance')
      .not.toBe(byDistance.map((o) => o.newDateISO).join());
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · RULE 9 · NO CLIFFS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 9 · a hair of input never changes the option set', () => {
  it('walking the long run 14.0 to 15.9 mi in 0.1 mi steps never adds or removes an option', async () => {
    const observed: Array<{ mi: number; ids: string; total: number }> = [];
    for (let mi = 14.0; mi <= 15.91; mi = Math.round((mi + 0.1) * 10) / 10) {
      reset(DAYS.map((d) => (d.id === 'pw0906' ? { ...d, distance_mi: String(mi) } : d)));
      const r = await recommend();
      observed.push({
        mi, ids: r.options.map((o) => o.newDateISO).join(','),
        total: r.options[0]?.cost.total ?? -1,
      });
    }
    expect(observed.length).toBeGreaterThan(15);            // liveness · Rule 18
    for (const x of observed) {
      expect(x.ids, `option set changed at ${x.mi} mi`).toBe(observed[0].ids);
    }
    for (let i = 1; i < observed.length; i++) {
      expect(
        Math.abs(observed[i].total - observed[i - 1].total),
        `cost jumped between ${observed[i - 1].mi} and ${observed[i].mi} mi`,
      ).toBeLessThan(25);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · RS-5 / RS-6 · APPLY IS GUARDED AND UNDO IS EXACT
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RS-5 · apply', () => {
  it('refuses without the token the runner read', async () => {
    const r = await recommend();
    const before = JSON.stringify(state.days);
    const out = await applyReschedule({
      userUuid: USER_UUID, todayISO: TODAY, dateISO: '2026-09-06',
      constraint: AWAY_WEEKEND, optionId: r.options[0].id, token: 'stale',
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('plan_moved');
    expect(JSON.stringify(state.days)).toBe(before);
  });

  it('every offered edit set is a permutation of dates', async () => {
    for (const c of [AWAY_WEEKEND, { kind: 'UNKNOWN' as const }]) {
      const r = await recommend({ constraint: c });
      for (const o of r.options) expect(permutationFault(o.edits)).toBeNull();
    }
  });

  it('writes an RS-8 summary saying what moved, what did not, why, and that undo exists', async () => {
    const { out } = await applyBest();
    if (!out.ok) throw new Error('apply failed');
    expect(out.summary.headline).toMatch(/moves from Sunday 2026-09-06 to/);
    expect(out.summary.whatMoved.length).toBeGreaterThan(0);
    expect(out.summary.whatIsUnchanged.length).toBeGreaterThan(0);
    expect(out.summary.why.length).toBeGreaterThan(0);
    expect(out.summary.undoAvailable).toBe(true);
    expect(out.summary.decisionId).toMatch(/^rsd_/);
  });
});

describe('RS-6 · undo', () => {
  it('restores every touched row to exactly the state it held before', async () => {
    const { before, out } = await applyBest();
    if (!out.ok) throw new Error('apply failed');
    expect(dayAt('2026-09-06')!.type).toBe('rest');         // it really changed

    const undone = await undoReschedule({
      userUuid: USER_UUID, todayISO: TODAY, decisionId: out.decision.decisionId,
    });
    expect(undone.ok, undone.ok === false ? undone.reason : '').toBe(true);

    for (const [date, was] of before) {
      const now = dayAt(date);
      expect(now, `row for ${date} vanished`).toBeDefined();
      expect(now!.id).toBe(was.id);
      expect(now!.type).toBe(was.type);
      expect(Number(now!.distance_mi)).toBe(Number(was.distance_mi));
      expect(now!.is_quality).toBe(was.is_quality);
      expect(now!.is_long).toBe(was.is_long);
      expect(now!.sub_label).toBe(was.sub_label);
      expect(now!.workout_spec).toEqual(was.workout_spec);
    }
    expect(state.reschedules[0].undone_at).toBeTruthy();
  });

  it('cannot be undone twice', async () => {
    const { out } = await applyBest();
    if (!out.ok) throw new Error('apply failed');
    await undoReschedule({ userUuid: USER_UUID, todayISO: TODAY, decisionId: out.decision.decisionId });
    const again = await undoReschedule({
      userUuid: USER_UUID, todayISO: TODAY, decisionId: out.decision.decisionId,
    });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.code).toBe('already_undone');
  });

  it('refuses to undo across a day he has since run', async () => {
    const { out } = await applyBest();
    if (!out.ok) throw new Error('apply failed');
    state.sealed.add(out.decision.newDateISO);
    const undone = await undoReschedule({
      userUuid: USER_UUID, todayISO: TODAY, decisionId: out.decision.decisionId,
    });
    expect(undone.ok).toBe(false);
    expect(undone.ok === false && undone.code).toBe('sealed');
  });

  it('refuses an unknown decision rather than doing nothing quietly', async () => {
    const out = await undoReschedule({ userUuid: USER_UUID, todayISO: TODAY, decisionId: 'rsd_nope' });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('not_found');
  });
});
