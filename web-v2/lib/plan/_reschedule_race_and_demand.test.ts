/**
 * lib/plan/_reschedule_race_and_demand.test.ts · MOVE-A-RUN, the parts the
 * first cut of the rescheduler could not see.  (RS-9)
 *
 * ─── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
 *
 * `_reschedule_contract.test.ts` already proves the contract: nothing writes
 * until he approves, identity survives, undo is exact, no option carries a
 * separation deficit unless it is labelled a compromise. This suite covers the
 * question that one could not ask, and the family of moves the required-move
 * matrix names.
 *
 * RS-9 · RACE PROXIMITY AT DAY GRAIN. The rescheduler read races at WEEK grain
 * only: a race day refuses, a taper week refuses, an A-race week refuses. So a
 * threshold session could be moved onto the Monday two days after a B-priority
 * 10k and be offered as a CLEAN option, because the destination week was
 * neither a taper nor an A-race week and the race sat in the previous week.
 * `Research/00b` §"Recovery by Effort" owes that runner five days without
 * quality. Nothing anywhere checked.
 *
 * ─── WHAT THIS SUITE CANNOT FAIL ON  (Rule 22) ──────────────────────────────
 *
 * Written down deliberately, because a gate that does not state its blind
 * spots invites being trusted past them.
 *
 * · IT CANNOT FAIL ON THE DOCTRINE NUMBERS BEING WRONG. It asserts that the
 *   rescheduler SPENDS `postRaceNoQualityDays` and `longRunFactorAfterRace`,
 *   and it computes the expected windows by CALLING those functions rather
 *   than by hardcoding 5 and 4.9 (Rule 18: a check that hardcodes both sides
 *   only proves the test agrees with itself). Whether those functions match
 *   `Research/00b` is `lib/doctrine/`'s job, not this file's.
 * · IT CANNOT FAIL ON THE COST WEIGHTS BEING MISCALIBRATED. It asserts the
 *   ORDER (a race-recovery shortfall costs something, and less than a missing
 *   recovery day) and never that 150 is the right number. No test can settle a
 *   weight; the header where it is declared argues it.
 * · IT CANNOT SEE A DEFECT IN THE WRITE PATH. Every case here drives
 *   `recommendReschedule`, which is a pure read. `_reschedule_contract.test.ts`
 *   owns apply, undo and the table assertions.
 * · IT CANNOT SEE ARBITRATION. The "defer another progression" case is
 *   reinterpreted rather than skipped, and the reinterpretation is argued at
 *   that test. A reschedule is architecturally forbidden from reaching the
 *   adaptation seam (`_reschedule_not_adaptation.test.ts` walks the import
 *   graph and fails if it ever does), so a reschedule that DEFERRED a
 *   progression would itself be the defect.
 * · IT CANNOT PROVE THE PHONE RENDERS ANY OF THIS. Rule 13 is not satisfied by
 *   a server test. Nothing here is evidence about a screen.
 *
 * ─── LIVENESS  (Rule 18) ────────────────────────────────────────────────────
 *
 * Every describe block below either asserts a positive finding or asserts a
 * count it also proves is reachable. `race proximity is REACHED at all` is the
 * explicit liveness probe: if the fixture ever stops producing a race-window
 * case, it fails loudly rather than reporting clean on zero findings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recommendReschedule,
  raceProximityFindings,
  bindingRaceProximity,
  raceRecoveryShortfall,
  inheritedNoQualityRaceSlugs,
  dateVerdict,
  timelineOf,
  weekRolesOf,
  isDemanding,
  type RaceEntry,
  type RescheduleRecommendation,
  type AvailabilityConstraint,
} from './reschedule';
import {
  postRaceNoQualityDays,
  returnToLongDays,
  longRunFactorAfterRace,
} from './combined-stress';
import { classifyDay } from '@/lib/execution/day-resolver';
import {
  USER_UUID, TODAY, DAYS, WEEKS, RACES, makeReadClient,
  type FixtureDay, type FixtureRace, type QueryRecord,
} from './_reschedule_fixture';
import { loadPlanShape } from './replan-scenarios';

/* ══════════════════════════════════════════════════════════════════════════
 * HARNESS · the production fixture, read-only
 * ═══════════════════════════════════════════════════════════════════════ */

// A day is sealed only when the test says so. The real `isDaySealed` reads the
// database; the fixture has none. Seals ON FAILURE in production (Rule 11), and
// that posture is asserted by `_reschedule_contract.test.ts`, not re-asserted
// here.
const sealedDates = new Set<string>();
vi.mock('@/lib/plan/seal', () => ({
  isDaySealed: async (_u: string, iso: string) => sealedDates.has(iso),
}));

/**
 * The fixture client is a minimal stand-in and does not implement `pg`'s full
 * overloaded `query` signature. Cast once, here, rather than at five call
 * sites. `_reschedule_contract.test.ts` sidesteps this by mocking the whole
 * pool module; this suite injects instead, because several cases need two
 * different row sets in one file.
 */
type ReadClient = NonNullable<Parameters<typeof loadPlanShape>[1]>;
const readClient = (o: Parameters<typeof makeReadClient>[0]): ReadClient =>
  makeReadClient(o) as unknown as ReadClient;

let log: QueryRecord[] = [];
let days: FixtureDay[] = [];
let races: FixtureRace[] = [];

beforeEach(() => {
  log = [];
  days = DAYS.map((d) => ({ ...d }));
  races = RACES.map((r) => ({ ...r }));
  sealedDates.clear();
});

async function recommend(opts: {
  dateISO?: string;
  planWorkoutId?: string;
  constraint?: AvailabilityConstraint;
  adjacentWeek?: boolean;
} = {}): Promise<RescheduleRecommendation> {
  const out = await recommendReschedule({
    userUuid: USER_UUID,
    todayISO: TODAY,
    dateISO: opts.dateISO,
    planWorkoutId: opts.planWorkoutId,
    constraint: opts.constraint ?? { kind: 'UNKNOWN' },
    allowAdjacentWeek: opts.adjacentWeek ?? true,
    client: readClient({ log, days, weeks: WEEKS, races }),
  });
  if (!out.ok) throw new Error(`recommend refused: ${out.code} · ${out.reason}`);
  return out.recommendation;
}

/**
 * A FIFTH WEEK, added to the production fixture, and why.
 *
 * The production block ends on 2026-09-27, so every date after the Dodgers
 * race on 09-26 is `OUTSIDE_PLAN` and the long run's return-to-long ramp is
 * structurally unreachable. Rule 15 says a mechanism the corpus cannot reach
 * is untested however many cases pass, and that adding rows is the remedy when
 * the corpus cannot express the question at all.
 *
 * So these seven days are SYNTHETIC and are labelled as such. They carry no
 * quality and no long run: they exist only to give the calendar somewhere for
 * a long run to land in the days after a race, which is the one thing the real
 * fixture's tail cannot offer. Every other test in this file runs against the
 * production rows untouched.
 */
const WK5 = {
  id: 'wk5', week_idx: 5, week_start_iso: '2026-09-28',
  phase: 'QUALITY', is_race_week: false, is_cutback: false,
};
const synthDay = (
  id: string, date: string, dow: number, type: string, mi: number,
): FixtureDay => ({
  id, week_id: 'wk5', date_iso: date, dow, type, distance_mi: String(mi),
  is_quality: false, is_long: false, sub_label: type.toUpperCase(),
  pace_target_s_per_mi: null, workout_spec: { kind: 'easy' },
});
const WEEK5_DAYS: FixtureDay[] = [
  synthDay('pw0928', '2026-09-28', 1, 'rest', 0),
  synthDay('pw0929', '2026-09-29', 2, 'easy', 5),
  synthDay('pw0930', '2026-09-30', 3, 'rest', 0),
  synthDay('pw1001', '2026-10-01', 4, 'easy', 5),
  synthDay('pw1002', '2026-10-02', 5, 'rest', 0),
  synthDay('pw1003', '2026-10-03', 6, 'rest', 0),
  synthDay('pw1004', '2026-10-04', 0, 'easy', 6),
];

async function recommendExtended(planWorkoutId: string): Promise<RescheduleRecommendation> {
  const out = await recommendReschedule({
    userUuid: USER_UUID, todayISO: TODAY, planWorkoutId,
    constraint: { kind: 'UNKNOWN' }, allowAdjacentWeek: true,
    client: readClient({
      log, days: [...days, ...WEEK5_DAYS], weeks: [...WEEKS, WK5], races,
    }),
  });
  if (!out.ok) throw new Error(`recommend refused: ${out.code} · ${out.reason}`);
  return out.recommendation;
}

/** The race calendar in the shape the module reads it, for the pure helpers. */
const RACE_ENTRIES: RaceEntry[] = RACES.map((r) => ({
  slug: r.slug,
  name: r.name ?? r.slug,
  dateISO: r.date_iso!,
  priority: (r.priority as 'A' | 'B' | 'C' | null) ?? null,
  distanceMi: r.distance_mi == null ? null : Number(r.distance_mi),
}));

const SANTA_MONICA = RACE_ENTRIES.find((r) => r.slug.startsWith('santa-monica'))!;

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · RS-9 · THE READING ITSELF
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RS-9 · race proximity is read at DAY grain', () => {
  it('spends the doctrine window rather than a number of its own', () => {
    // Read out of the owning module at run time. Hardcoding 5 here would only
    // prove this test agrees with itself (Rule 18).
    const window = postRaceNoQualityDays(SANTA_MONICA.distanceMi!, 'B');
    const f = raceProximityFindings({
      dateISO: '2026-09-15',                       // two days after the 10k
      carriesQuality: true, isLongRun: false, races: RACE_ENTRIES,
    });
    const q = f.find((x) => x.kind === 'QUALITY_IN_NO_QUALITY_WINDOW');
    expect(q, 'no quality-window finding two days after a B 10k').toBeDefined();
    expect(q!.raceSlug).toBe(SANTA_MONICA.slug);
    expect(q!.daysAfterRace).toBe(2);
    expect(q!.windowDays).toBe(window);
  });

  it('stops at the far edge of the window and not before it', () => {
    const window = postRaceNoQualityDays(SANTA_MONICA.distanceMi!, 'B');
    const inside = raceProximityFindings({
      dateISO: addDays(SANTA_MONICA.dateISO, window - 1),
      carriesQuality: true, isLongRun: false, races: RACE_ENTRIES,
    }).filter((x) => x.kind === 'QUALITY_IN_NO_QUALITY_WINDOW');
    const atEdge = raceProximityFindings({
      dateISO: addDays(SANTA_MONICA.dateISO, window),
      carriesQuality: true, isLongRun: false, races: RACE_ENTRIES,
    }).filter((x) => x.kind === 'QUALITY_IN_NO_QUALITY_WINDOW');
    expect(inside.length, 'the last day inside the window produced no finding').toBe(1);
    expect(atEdge.length, 'the window did not end where doctrine says it ends').toBe(0);
  });

  it('the long run is a RAMP, and its factor is the owner\'s own curve', () => {
    const returnDays = returnToLongDays(SANTA_MONICA.distanceMi!, 'B');
    for (const k of [1, 2, 3]) {
      const f = raceProximityFindings({
        dateISO: addDays(SANTA_MONICA.dateISO, k),
        carriesQuality: false, isLongRun: true, races: RACE_ENTRIES,
      }).find((x) => x.kind === 'LONG_INSIDE_RETURN_WINDOW');
      expect(f, `no long-run finding ${k} days after the race`).toBeDefined();
      expect(f!.longRunFactor).toBeCloseTo(longRunFactorAfterRace(k, returnDays), 3);
    }
  });

  it('a race it cannot price is NAMED, never assumed in either direction (Rule 11)', () => {
    const noPriority: RaceEntry[] = [
      { ...SANTA_MONICA, priority: null },
    ];
    const noDistance: RaceEntry[] = [
      { ...SANTA_MONICA, distanceMi: null },
    ];
    for (const [label, cal] of [['no priority', noPriority], ['no distance', noDistance]] as const) {
      const f = raceProximityFindings({
        dateISO: '2026-09-15', carriesQuality: true, isLongRun: false, races: cal,
      });
      expect(f.length, `${label} produced no finding at all, which is silence`).toBe(1);
      expect(f[0].kind).toBe('UNPRICEABLE_RACE');
      expect(f[0].windowDays, 'an unpriceable race must not report a window').toBeNull();
      // It does not BIND. Unknown is not a verdict.
      expect(bindingRaceProximity(f)).toBeNull();
    }
  });

  it('does not throw on a distance no category covers', () => {
    // `postRaceNoQualityDays` throws on an unknown distance by design. The
    // reader must guard it, not discover it in production.
    expect(() => raceProximityFindings({
      dateISO: '2026-09-15', carriesQuality: true, isLongRun: true,
      races: [{ ...SANTA_MONICA, distanceMi: 0 }],
    })).not.toThrow();
  });

  it('reads a race that is only in the CALENDAR, not in the plan rows', () => {
    // The week-grain guards resolve roles from plan weeks. This one does not:
    // it walks the calendar directly, so a race with no plan row still counts.
    const orphan: RaceEntry[] = [{
      slug: 'orphan-half', name: 'Orphan Half', dateISO: '2026-09-14',
      priority: 'B', distanceMi: 13.1,
    }];
    const f = raceProximityFindings({
      dateISO: '2026-09-20', carriesQuality: true, isLongRun: false, races: orphan,
    });
    expect(f.map((x) => x.kind)).toContain('QUALITY_IN_NO_QUALITY_WINDOW');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · RS-9 · DIFFERENTIAL · A BOUNDARY, NOT A BOOBY TRAP
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RS-9 · only an INTRODUCED window refuses', () => {
  it('a session already inside the window keeps its options', () => {
    // The fixture's 09-17 intervals sit 4 days after the B 10k, inside a
    // 5-day window, IN PRODUCTION. Moving it to 09-16 is still inside, and
    // refusing that would leave a runner mid-recovery unable to move anything.
    const window = postRaceNoQualityDays(SANTA_MONICA.distanceMi!, 'B');
    const intervals = DAYS.find((d) => d.id === 'pw0917')!;
    const daysAfter = dayGap(SANTA_MONICA.dateISO, intervals.date_iso);
    expect(daysAfter, 'the fixture no longer places a quality day inside the window')
      .toBeLessThan(window);

    const inherited = inheritedNoQualityRaceSlugs(
      { dateISO: intervals.date_iso, isQuality: true, isLong: false },
      RACE_ENTRIES,
    );
    expect(inherited.has(SANTA_MONICA.slug)).toBe(true);

    const tl = timelineOf(loadShapeSync());
    const v = dateVerdict({
      dateISO: '2026-09-16', todayISO: TODAY, tl,
      roles: weekRolesOf(loadShapeSync(), RACE_ENTRIES),
      constraint: { kind: 'UNKNOWN' }, sealed: new Set(),
      movingIsDemanding: true, races: RACE_ENTRIES,
      movingCarriesQuality: true, inheritedNoQualitySlugs: inherited,
    });
    expect(v?.cause, 'an inherited window was treated as this move\'s fault')
      .not.toBe('RACE_RECOVERY');
  });

  it('a session from OUTSIDE the window is refused for landing inside it', () => {
    // The 09-22 tempo is 9 days after the 10k, outside the window, so nothing
    // is inherited. Moving it to 09-15 would be a NEW breach.
    const tempo = DAYS.find((d) => d.id === 'pw0922')!;
    const inherited = inheritedNoQualityRaceSlugs(
      { dateISO: tempo.date_iso, isQuality: true, isLong: false }, RACE_ENTRIES,
    );
    expect(inherited.size, 'the tempo already sits inside a window; pick another day').toBe(0);

    const v = dateVerdict({
      dateISO: '2026-09-15', todayISO: TODAY, tl: timelineOf(loadShapeSync()),
      roles: weekRolesOf(loadShapeSync(), RACE_ENTRIES),
      constraint: { kind: 'UNKNOWN' }, sealed: new Set(),
      movingIsDemanding: true, races: RACE_ENTRIES,
      movingCarriesQuality: true, inheritedNoQualitySlugs: inherited,
    });
    expect(v, 'quality was allowed two days after a race with no comment').not.toBeNull();
    expect(v!.cause).toBe('RACE_RECOVERY');
    expect(v!.reason).toContain('Santa Monica 10k');
  });

  it('an EASY run is never refused for race proximity', () => {
    // The no-quality window is about quality. Easy running after a race is the
    // recovery, not a breach of it.
    const v = dateVerdict({
      dateISO: '2026-09-15', todayISO: TODAY, tl: timelineOf(loadShapeSync()),
      roles: weekRolesOf(loadShapeSync(), RACE_ENTRIES),
      constraint: { kind: 'UNKNOWN' }, sealed: new Set(),
      movingIsDemanding: false, races: RACE_ENTRIES,
      movingCarriesQuality: false, inheritedNoQualitySlugs: new Set(),
    });
    expect(v?.cause).not.toBe('RACE_RECOVERY');
  });

  it('the shortfall is floored at zero · moving AWAY from a race never pays for anything else', () => {
    const near = raceProximityFindings({
      dateISO: '2026-09-15', carriesQuality: false, isLongRun: true, races: RACE_ENTRIES,
    });
    const far = raceProximityFindings({
      dateISO: '2026-10-05', carriesQuality: false, isLongRun: true, races: RACE_ENTRIES,
    });
    expect(raceRecoveryShortfall(near, far), 'improving one term bought a credit')
      .toBe(0);
    expect(raceRecoveryShortfall(far, near)).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · RS-9 · REACHED IN THE REAL RECOMMENDATION  (Rule 15 liveness)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RS-9 · race proximity is REACHED at all', () => {
  it('the recommendation for the 09-22 tempo refuses at least one day for RACE_RECOVERY', async () => {
    const r = await recommend({ planWorkoutId: 'pw0922' });
    const hits = r.refusals.filter((x) => x.cause === 'RACE_RECOVERY');
    // Liveness · if the fixture ever stops reaching this, fail loudly rather
    // than reporting a clean run over zero findings (Rule 18).
    expect(hits.length, 'RS-9 is unreachable from the corpus, so it is untested (Rule 15)')
      .toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.reason).toMatch(/without quality/);
      expect(h.reason).not.toMatch(/[—!]/);            // coach voice
    }
  });

  it('no OFFERED option lands quality inside a window it did not start in', async () => {
    const r = await recommend({ planWorkoutId: 'pw0922' });
    const inherited = inheritedNoQualityRaceSlugs(
      { dateISO: '2026-09-22', isQuality: true, isLong: false }, RACE_ENTRIES,
    );
    for (const o of r.options) {
      const breach = o.raceProximity.filter(
        (x) => x.kind === 'QUALITY_IN_NO_QUALITY_WINDOW' && !inherited.has(x.raceSlug),
      );
      expect(breach, `option ${o.newDateISO} carries an introduced no-quality breach`).toEqual([]);
    }
  });

  it('a long-run option inside a return window is OFFERED, priced and explained', async () => {
    // The ramp is a COST, never a refusal. That is the half of RS-9 that keeps
    // the feature usable rather than turning it into a second wall. The 09-27
    // long sits one day after the Dodgers race, so the days just after it are
    // exactly the return-to-long window.
    const r = await recommendExtended('pw0927');
    const withFinding = r.options.filter((o) =>
      o.raceProximity.some((x) => x.kind === 'LONG_INSIDE_RETURN_WINDOW'));
    expect(withFinding.length, 'no long-run option reached the return-to-long ramp')
      .toBeGreaterThan(0);
    for (const o of withFinding) {
      const f = o.raceProximity.find((x) => x.kind === 'LONG_INSIDE_RETURN_WINDOW')!;
      // OFFERED, not refused. The whole point of the continuous half.
      expect(r.refusals.some((x) => x.dateISO === o.newDateISO)).toBe(false);
      expect(f.longRunFactor).toBeLessThan(1);
      expect(o.tradeoffs.join(' '), 'the runner is never told about the race window')
        .toContain(f.raceName);
      expect(o.tradeoffs.join(' ')).not.toMatch(/[—!]/);          // coach voice
    }
  });

  it('moving AWAY from the race is priced at zero even while still inside the window', async () => {
    // Every option here IMPROVES on the authored day, which sits one day after
    // the race. The finding is still reported, because the fact is real; the
    // COST is zero, because this move did not cause it.
    //
    // NOT REACHABLE FROM THIS FIXTURE (Rule 15, stated rather than hidden): a
    // NON-ZERO `cost.raceRecovery` through `recommendReschedule`. It needs a
    // long run that starts outside a return window and lands inside one, and
    // in this block every such destination ranks below the top five that are
    // returned. The shortfall arithmetic itself is covered directly, above, by
    // the `raceRecoveryShortfall` cases.
    const r = await recommendExtended('pw0927');
    for (const o of r.options) {
      expect(o.cost.raceRecovery, `${o.newDateISO} was charged for a race it moved away from`)
        .toBe(0);
    }
  });

  it('every cost component still sums to the total, with the new term in it', async () => {
    const r = await recommendExtended('pw0927');
    for (const o of r.options) {
      const parts = o.cost.stimulus + o.cost.separation + o.cost.raceRecovery
        + o.cost.displacedQuality + o.cost.continuity + o.cost.rollingLoad
        + o.cost.blockDisturbance;
      expect(Math.abs(parts - o.cost.total), `cost does not add up on ${o.newDateISO}`)
        .toBeLessThan(0.01);
    }
  });

  it('Rule 9 · the race-recovery term is continuous in days-after', () => {
    const returnDays = returnToLongDays(SANTA_MONICA.distanceMi!, 'B');
    const seen: number[] = [];
    for (let k = 1; k <= Math.ceil(returnDays) + 2; k++) {
      const f = raceProximityFindings({
        dateISO: addDays(SANTA_MONICA.dateISO, k),
        carriesQuality: false, isLongRun: true, races: RACE_ENTRIES,
      }).find((x) => x.kind === 'LONG_INSIDE_RETURN_WINDOW');
      seen.push(f?.longRunFactor ?? 1);
    }
    expect(seen.length).toBeGreaterThan(3);                    // liveness
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], 'the return-to-long factor went backwards')
        .toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[i] - seen[i - 1], 'the factor jumped in kind rather than degree')
        .toBeLessThan(0.75);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE REQUIRED MOVE MATRIX
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the moves a runner actually makes', () => {
  it('moves an EASY run', async () => {
    const r = await recommend({ planWorkoutId: 'pw0916' });   // 09-16 easy
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.target.family).toBe('easy');
    for (const o of r.options) expect(o.edits.length).toBeGreaterThan(0);
  });

  it('moves a LONG run, and never calls a shortened one preserved', async () => {
    const r = await recommend({ planWorkoutId: 'pw0920' });
    expect(r.target.family).toBe('long');
    for (const o of r.options) {
      if (o.session.distanceMi < o.session.originalDistanceMi) {
        expect(o.stimulusPreservation, 'a cut long run was called FULL').not.toBe('FULL');
        expect(o.identity.kind).toBe('REVISED_VERSION');
      } else {
        expect(o.identity.kind).toBe('SAME_INSTANCE');
      }
    }
  });

  it('moves a QUALITY session', async () => {
    const r = await recommend({ planWorkoutId: 'pw0917' });   // 09-17 intervals
    expect(r.target.family).toBe('quality');
    expect(r.options.length).toBeGreaterThan(0);
  });

  it('moves ACROSS a week boundary when the adjacent week is opened', async () => {
    const withAdjacent = await recommend({ planWorkoutId: 'pw0920', adjacentWeek: true });
    const crossed = withAdjacent.options.filter((o) => {
      const wkOf = (iso: string) => WEEKS.filter((w) => w.week_start_iso <= iso).pop()?.id;
      return wkOf(o.newDateISO) !== wkOf('2026-09-20');
    });
    expect(crossed.length, 'no option crossed a week boundary with the window open')
      .toBeGreaterThan(0);
    // And the week totals move on BOTH sides, which is the thing a cross-week
    // move changes and an in-week move does not.
    for (const o of crossed) {
      const moved = o.load.weeks.filter((w) => w.afterMi !== w.beforeMi);
      expect(moved.length, `${o.newDateISO} crossed a week and no week total moved`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('moving into an OCCUPIED day rearranges rather than overwrites', async () => {
    const r = await recommend({ planWorkoutId: 'pw0920' });
    for (const o of r.options) {
      const dest = DAYS.find((d) => d.date_iso === o.newDateISO);
      if (!dest || dest.type === 'rest') continue;
      // The occupant is not deleted. It appears in the edit set with a new
      // date, or the option was not offered at all.
      const occupantEdit = o.edits.find((e) => e.planWorkoutId === dest.id);
      expect(occupantEdit, `${dest.id} was displaced with no edit recording it`).toBeDefined();
      expect(occupantEdit!.after.dateISO,
        'the occupant was written onto the same day as the arriving session')
        .not.toBe(o.newDateISO);
    }
  });

  it('never duplicates or loses a workout · every edit set is a permutation', async () => {
    for (const id of ['pw0916', 'pw0917', 'pw0920', 'pw0922']) {
      const r = await recommend({ planWorkoutId: id });
      for (const o of r.options) {
        const ids = o.edits.map((e) => e.planWorkoutId);
        expect(new Set(ids).size, `${id} · a row is edited twice in one option`)
          .toBe(ids.length);
        const before = o.edits.map((e) => e.before.dateISO).sort();
        const after = o.edits.map((e) => e.after.dateISO).sort();
        expect(after, `${id} · the edit set is not a permutation of dates`).toEqual(before);
      }
    }
  });

  it('refuses a COMPLETED day outright', async () => {
    sealedDates.add('2026-09-20');
    const out = await recommendReschedule({
      userUuid: USER_UUID, todayISO: TODAY, planWorkoutId: 'pw0920',
      constraint: { kind: 'UNKNOWN' },
      client: readClient({ log, days, weeks: WEEKS, races }),
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('sealed');
  });

  it('refuses a day already in the PAST, which is the already-started case', async () => {
    const out = await recommendReschedule({
      userUuid: USER_UUID, todayISO: TODAY, planWorkoutId: 'pw0901',   // 09-01
      constraint: { kind: 'UNKNOWN' },
      client: readClient({ log, days, weeks: WEEKS, races }),
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('sealed');
  });

  it('never offers a SEALED day as a destination', async () => {
    sealedDates.add('2026-09-19');
    const r = await recommend({ planWorkoutId: 'pw0920' });
    expect(r.options.map((o) => o.newDateISO)).not.toContain('2026-09-19');
    expect(r.refusals.some((x) => x.dateISO === '2026-09-19' && x.cause === 'DAY_SEALED'))
      .toBe(true);
  });

  it('a move that changes the weekly volume distribution reports BOTH weeks', async () => {
    const r = await recommend({ planWorkoutId: 'pw0920', adjacentWeek: true });
    const crossWeek = r.options.find((o) => o.load.weeks.length >= 2);
    expect(crossWeek, 'no option touched two weeks').toBeDefined();
    // Volume is conserved across the pair unless the option shortened the run.
    const beforeTotal = crossWeek!.load.weeks.reduce((s, w) => s + w.beforeMi, 0);
    const afterTotal = crossWeek!.load.weeks.reduce((s, w) => s + w.afterMi, 0);
    const dropped = crossWeek!.session.originalDistanceMi - crossWeek!.session.distanceMi;
    expect(Math.abs((beforeTotal - afterTotal) - dropped),
      'miles appeared or vanished across the two weeks').toBeLessThan(0.6);
  });

  /**
   * "A move that causes arbitration to defer another progression."
   *
   * REINTERPRETED, and the reinterpretation is the finding rather than a way
   * around the case. A reschedule cannot reach arbitration: it is a placement
   * change, not a training change, and `_reschedule_not_adaptation.test.ts`
   * walks the transitive import graph and fails if `lib/plan/reschedule.ts`
   * ever reaches `lib/adaptation/**` or `progression-pass.ts`. A reschedule
   * that deferred a progression would be the defect, not the feature.
   *
   * What the rescheduler DOES have is the same shape one layer down: a move
   * that forces another session to give way. That is `displacedQualityLoss`,
   * and this asserts it is decided INSIDE the reschedule decision, stated to
   * the runner, and never expressed as an adaptation.
   */
  it('a move that displaces another session says so, and defers nothing to the adaptation engine', async () => {
    const r = await recommend({ planWorkoutId: 'pw0920', adjacentWeek: true });
    const displacing = r.options.filter((o) => o.edits.length > 1);
    expect(displacing.length, 'no option displaced anything, so this case is unreachable')
      .toBeGreaterThan(0);
    for (const o of displacing) {
      const others = o.edits.filter((e) => e.planWorkoutId !== 'pw0920');
      for (const e of others) {
        expect(e.why, 'a row moved with no reason given to the runner').toBeTruthy();
      }
      expect(o.whyRankedHere).toBeTruthy();
    }
    expect(r.evidenceEffect, 'a reschedule claimed an effect on evidence').toBe('NONE');
    expect(r.kind).toBe('RESCHEDULE');
    expect(r.origin).toBe('RUNNER_CONSTRAINT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · EXECUTION MATCHING SURVIVES THE MOVE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a moved workout is still the workout the run completes', () => {
  it('a run stamped with the plan_workout_id resolves EXACT on the NEW date', async () => {
    const r = await recommend({ planWorkoutId: 'pw0920' });
    const option = r.options[0];
    const edit = option.edits.find((e) => e.planWorkoutId === 'pw0920')!;

    // Identity is the whole point: a pure date move keeps the row id.
    expect(option.identity.kind === 'SAME_INSTANCE' || option.identity.kind === 'REVISED_VERSION')
      .toBe(true);
    expect(edit.planWorkoutId).toBe('pw0920');
    expect(edit.after.dateISO).not.toBe(edit.before.dateISO);

    // Now drive the REAL resolver over the post-move rows. This is the claim
    // that actually matters, and asserting the row id alone stops one step short.
    const resolved = classifyDay(
      edit.after.dateISO,
      [{
        id: 'pw0920', date_iso: edit.after.dateISO, type: edit.after.type,
        distance_mi: String(edit.after.distanceMi), sub_label: edit.after.subLabel,
        is_quality: edit.after.isQuality, is_long: edit.after.isLong,
      }],
      [{
        id: 'run_1', day: edit.after.dateISO, shoe_id: null,
        data: { planWorkoutId: 'pw0920', distanceMi: edit.after.distanceMi },
      }],
    );
    expect(resolved.prescriptions).toHaveLength(1);
    expect(resolved.prescriptions[0].matchedRun, 'the moved workout lost its run').not.toBeNull();
    expect(resolved.prescriptions[0].matchedRun!.match).toBe('exact');
    expect(resolved.supplementalRuns, 'the run was orphaned by the move').toHaveLength(0);
  });

  it('falsifier · a move that MINTED a new row id would break the match', () => {
    // The failure this guards against, made explicit: had the mover written the
    // session onto the destination as a new row, the stamped run would resolve
    // SUPPLEMENTAL and the runner's completed session would read as unrun.
    const resolved = classifyDay(
      '2026-09-19',
      [{
        id: 'pw_NEWLY_MINTED', date_iso: '2026-09-19', type: 'long',
        distance_mi: '12', sub_label: 'LONG', is_quality: false, is_long: true,
      }],
      [{
        id: 'run_1', day: '2026-09-19', shoe_id: null,
        data: { planWorkoutId: 'pw0920', distanceMi: 12 },
      }],
    );
    expect(resolved.prescriptions[0].matchedRun).toBeNull();
    expect(resolved.supplementalRuns).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * helpers
 * ═══════════════════════════════════════════════════════════════════════ */

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/** The fixture's plan shape, loaded once per call through the real loader. */
let shapeCache: Awaited<ReturnType<typeof loadPlanShape>> | null = null;
function loadShapeSync() {
  if (!shapeCache) throw new Error('shape not loaded');
  return shapeCache;
}

beforeEach(async () => {
  shapeCache = await loadPlanShape(
    USER_UUID, readClient({ log: [], days: DAYS, weeks: WEEKS, races: RACES }),
  );
});

describe('harness liveness', () => {
  it('the fixture loads and carries the race that makes RS-9 reachable', () => {
    expect(loadShapeSync()).not.toBeNull();
    expect(RACE_ENTRIES.length).toBeGreaterThan(2);
    expect(SANTA_MONICA.priority).toBe('B');
    expect(isDemanding).toBeTypeOf('function');
  });
});
