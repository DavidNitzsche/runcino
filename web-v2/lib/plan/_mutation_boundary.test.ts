/**
 * THE PLAN MUTATION BOUNDARY · lib/plan/mutate.ts
 *
 * Two kinds of test, both of which run with no database:
 *
 *   1. BEHAVIOURAL, over the boundary's pure core. `rehydratePlan`,
 *      `violationsOf`, `structuralFingerprint` and `diffViolations` are the
 *      whole verdict — `mutatePlan` is a transaction wrapper around them. So a
 *      mutation is simulated by mutating the ROW ARRAY the way the SQL would,
 *      then asking the same functions the boundary asks. Every assertion below
 *      is the exact comparison `mutatePlan` performs before it decides between
 *      COMMIT and ROLLBACK.
 *
 *      This is the same posture as `_adapt_invariants.test.ts`: the SQL shell
 *      feeds these functions, and the logic they encode is what the SQL must
 *      respect.
 *
 *   2. STRUCTURAL, a source scan. Same shape as `_no_strength_rows.test.ts`.
 *      It fails the build if a `plan_workouts` writer appears in a file that
 *      does not route through the door. That is what stops the problem this
 *      module was built to fix from growing back.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_mutation_boundary.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  rehydratePlan,
  structuralFingerprint,
  violationsOf,
  diffViolations,
  type PlanSnapshot,
  type PlanWorkoutRow,
  type PlanMutationContext,
} from './mutate';

// ── fixture ───────────────────────────────────────────────────────────────────
//
// A marathon build far enough out that no week is "past" relative to TODAY, so
// nothing is skipped by the validator's sealed-week guards. Twelve weeks:
// eight BASE, two QUALITY, two TAPER, the last of which is the race week.

const TODAY = '2026-09-01';

/** Monday of week i, counting from 2026-09-07. */
function weekStart(i: number): string {
  const d = new Date('2026-09-07T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + i * 7);
  return d.toISOString().slice(0, 10);
}
function dayOf(weekIdx: number, offset: number): string {
  const d = new Date(weekStart(weekIdx) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function wko(
  weekIdx: number,
  offset: number,
  type: string,
  distanceMi: number,
  flags: { isQuality?: boolean; isLong?: boolean } = {},
): PlanWorkoutRow {
  // dow: the fixture's weeks start on a Monday (offset 0 → dow 1).
  const dow = (1 + offset) % 7;
  return {
    id: `wko_${String(++seq).padStart(4, '0')}`,
    week_id: `wk_${weekIdx}`,
    date_iso: dayOf(weekIdx, offset),
    dow,
    type,
    distance_mi: distanceMi,
    is_quality: flags.isQuality === true,
    is_long: flags.isLong === true,
    sub_label: null,
    notes: '',
  };
}

/**
 * THIRTEEN-WEEK MARATHON PLAN, authored to be doctrine-clean so that every
 * rejection below is caused by the mutation under test and nothing else.
 *
 *   weeks 0-7    BASE
 *   weeks 8-9    QUALITY
 *   weeks 10-12  TAPER · week 12 is the race week
 *
 * The shape is not arbitrary — it is what `validate.ts` requires of a marathon,
 * and each number is pinned to the check that constrains it:
 *
 *   · TWO non-race taper weeks. §4b's `minNonRaceTaperWks` is 2 at ≥20mi and
 *     the race week does not count toward it.
 *   · Peak (non-taper, non-race) volume is 52mi, at weeks 8-9.
 *   · The taper bottoms at 32mi = 38.5% below peak, inside §4b's marathon band
 *     of 36-60%, and descends 52 → 42 → 32.
 *   · Each taper week sits under its own `taperFactor('m', wksLeft)` target
 *     (0.82 × peak at three out, 0.60 × peak at two out) plus that check's 15%
 *     tolerance.
 *   · Peak long is 20mi, under the 25mi elite-band cap, and the long climbs at
 *     most a mile a week — far inside §4's 30% WoW ceiling.
 *
 * Day layout in a training week (weeks start Monday):
 *   Mon rest · Tue quality · Wed easy · Thu easy · Fri rest · Sat easy · Sun long
 * The quality-to-long gap is Tue→Sun, well clear of §9's stimulus spacing,
 * which leaves SATURDAY as the day a mutation can break it — which is exactly
 * where the adapt.ts field-test case below lands.
 *
 * Race week puts the race on SATURDAY so there is a calendar position after it
 * inside the week. §8 is otherwise unfalsifiable on a Sunday race: nothing can
 * be dated after the last day of the week.
 */
function buildSnapshot(): PlanSnapshot {
  seq = 0;
  const workouts: PlanWorkoutRow[] = [];

  //               wk  0   1   2   3   4   5   6   7   8   9 | 10  11
  const longs   = [12, 13, 14, 15, 16, 17, 18, 19, 20, 20,   14, 12];
  const easies  = [ 6,  6,  7,  7,  7,  8,  8,  8,  8,  8,    7,  5];
  const quality = [ 6,  6,  7,  7,  7,  8,  8,  8,  8,  8,    7,  5];
  // weeklyMi = quality + 3×easy + long
  //          =  36  37  42  43  44  49  50  51  52  52 | 42  32

  for (let w = 0; w < 12; w++) {
    workouts.push(wko(w, 0, 'rest', 0));
    workouts.push(wko(w, 1, 'threshold', quality[w], { isQuality: true }));
    workouts.push(wko(w, 2, 'easy', easies[w]));
    workouts.push(wko(w, 3, 'easy', easies[w]));
    workouts.push(wko(w, 4, 'rest', 0));
    workouts.push(wko(w, 5, 'easy', easies[w]));
    workouts.push(wko(w, 6, 'long', longs[w], { isLong: true }));
  }

  // Race week (12) · race on Saturday, Sunday left as rest.
  workouts.push(wko(12, 0, 'rest', 0));
  workouts.push(wko(12, 1, 'easy', 4));
  workouts.push(wko(12, 2, 'easy', 3));
  workouts.push(wko(12, 3, 'rest', 0));
  workouts.push(wko(12, 4, 'shakeout', 2));
  workouts.push(wko(12, 5, 'race', 26.2));
  workouts.push(wko(12, 6, 'rest', 0));

  const phaseFor = (w: number) => (w >= 10 ? 'phs_taper' : w >= 8 ? 'phs_quality' : 'phs_base');

  return {
    planId: 'pln_test',
    phases: [
      { id: 'phs_base', label: 'BASE', start_week_idx: 0, end_week_idx: 7, rationale: '', citation: '' },
      { id: 'phs_quality', label: 'QUALITY', start_week_idx: 8, end_week_idx: 9, rationale: '', citation: '' },
      { id: 'phs_taper', label: 'TAPER', start_week_idx: 10, end_week_idx: 12, rationale: '', citation: '' },
    ],
    weeks: Array.from({ length: 13 }, (_, w) => ({
      id: `wk_${w}`,
      week_idx: w,
      week_start_iso: weekStart(w),
      phase_id: phaseFor(w),
      is_race_week: w === 12,
      is_cutback: false,
    })),
    workouts,
  };
}

const CTX: PlanMutationContext = {
  raceDistanceMi: 26.2,
  mode: 'race-prep',
  level: 'intermediate',
  isSteppingStoneToMarathon: false,
  todayISO: TODAY,
  trainingDaysPerWeek: 5,
  recentWeeklyMi: 40,
  contextIncomplete: false,
};

/** Deep-copy a snapshot so a simulated mutation cannot leak between tests. */
function clone(s: PlanSnapshot): PlanSnapshot {
  return JSON.parse(JSON.stringify(s)) as PlanSnapshot;
}

/** The exact verdict `mutatePlan` computes for a 'structural' mutation. */
function verdict(before: PlanSnapshot, after: PlanSnapshot) {
  return diffViolations(violationsOf(before, CTX), violationsOf(after, CTX));
}

// ── 1 · rehydration is faithful ───────────────────────────────────────────────

describe('rehydration · persisted rows → the shape validateComposedPlan consumes', () => {
  it('reconstructs weeks, phases, days and the phase label off plan_phases', () => {
    const plan = rehydratePlan(buildSnapshot());
    expect(plan.weeks).toHaveLength(13);
    expect(plan.totalWeeks).toBe(13);
    expect(plan.blocks.phases.map((p) => p.label)).toEqual(['BASE', 'QUALITY', 'TAPER']);
    expect(plan.blocks.phases.map((p) => p.weeks)).toEqual([8, 2, 3]);
    expect(plan.weeks[0].phase).toBe('BASE');
    expect(plan.weeks[8].phase).toBe('QUALITY');
    expect(plan.weeks[10].phase).toBe('TAPER');
    expect(plan.weeks[12].isRaceWeek).toBe(true);
    // Days carry the flags the invariants read.
    const w0 = plan.weeks[0];
    expect(w0.days.filter((d) => d.isLong)).toHaveLength(1);
    expect(w0.days.filter((d) => d.isQuality)).toHaveLength(1);
  });

  it('derives weeklyMi by the generator VOL-1 rule · race excluded on the race week', () => {
    const plan = rehydratePlan(buildSnapshot());
    // week 0: 6 (T) + 6 + 6 + 6 (easies) + 12 (long) = 36
    expect(plan.weeks[0].weeklyMi).toBe(36);
    // the peak, and the two taper weeks the §4b depth checks read
    expect(plan.weeks[8].weeklyMi).toBe(52);
    expect(plan.weeks[10].weeklyMi).toBe(42);
    expect(plan.weeks[11].weeklyMi).toBe(32);
    // race week: 4 + 3 + 2 = 9, and the 26.2 race itself is NOT counted.
    expect(plan.weeks[12].weeklyMi).toBe(9);
  });

  it('keeps vols equal to weeklyMi · §0 is vacuous post-persistence, by design', () => {
    const plan = rehydratePlan(buildSnapshot());
    expect(plan.vols).toEqual(plan.weeks.map((w) => w.weeklyMi));
  });

  it('carries a widened persisted type through rather than coercing it', () => {
    // The adapter can write 'recovery', which is not in the composer's union.
    const snap = clone(buildSnapshot());
    const easy = snap.workouts.find((w) => w.week_id === 'wk_0' && w.type === 'easy')!;
    easy.type = 'recovery';
    const plan = rehydratePlan(snap);
    expect(plan.weeks[0].days.some((d) => (d.type as string) === 'recovery')).toBe(true);
  });
});

// ── 2 · the fixture itself is clean ───────────────────────────────────────────

describe('the fixture plan is doctrine-clean', () => {
  it('produces no violations, so every rejection below is caused by its mutation', () => {
    expect(violationsOf(buildSnapshot(), CTX)).toEqual([]);
  });
});

// ── 3 · THE adapt.ts CASE ─────────────────────────────────────────────────────

describe("adapt.ts field_test · SET type='tempo', is_quality=true", () => {
  it('is REJECTED when it lands the day before the long run (Research/00b:55-60)', () => {
    const before = buildSnapshot();
    const after = clone(before);
    // The nightly cron converting Saturday's easy run into the 30-minute
    // threshold field test. This is the literal statement adapt.ts issues:
    //   UPDATE plan_workouts SET type='tempo', is_quality=true, ... WHERE id=$1
    const sat = after.workouts.find(
      (w) => w.week_id === 'wk_2' && w.type === 'easy' && w.dow === 6,
    )!;
    sat.type = 'tempo';
    sat.is_quality = true;

    const v = verdict(before, after);
    expect(v.introduced.length).toBeGreaterThan(0);
    expect(v.introduced.join('\n')).toMatch(/only 0 easy day\(s\), needs 1/);
    expect(v.introduced.join('\n')).toMatch(/Research\/00b:55-60/);
    // And it is a NEW violation, not one the plan already carried.
    expect(v.preExisting).toEqual([]);
  });

  it('is REJECTED when it also pushes the week past the volume ramp', () => {
    const before = buildSnapshot();
    const after = clone(before);
    // A field test authored at full tempo length onto a rest day, doubling the
    // week. Two independent invariants should name it.
    const rest = after.workouts.find(
      (w) => w.week_id === 'wk_3' && w.type === 'rest' && w.dow === 5,
    )!;
    rest.type = 'tempo';
    rest.is_quality = true;
    rest.distance_mi = 30;

    const v = verdict(before, after);
    expect(v.introduced.length).toBeGreaterThan(0);
    // long-primacy: a 30mi tempo in a week whose long is 15.
    expect(v.introduced.join('\n')).toMatch(/exceeds the long/);
  });

  it('is ACCEPTED when it lands on the existing quality slot · the gap still holds', () => {
    const before = buildSnapshot();
    const after = clone(before);
    // Tuesday's threshold becomes the field test. Same day, same distance,
    // same spacing — this is the shape the adapter is supposed to produce.
    const tue = after.workouts.find(
      (w) => w.week_id === 'wk_2' && w.type === 'threshold',
    )!;
    tue.type = 'tempo';
    tue.is_quality = true;

    expect(verdict(before, after).introduced).toEqual([]);
  });
});

// ── 4 · adapt.ts downgrade ────────────────────────────────────────────────────

describe('adapt.ts downgrade · quality → easy', () => {
  it('is REJECTED when it empties a QUALITY-phase week of quality', () => {
    const before = buildSnapshot();
    const after = clone(before);
    // Week 8 is the first QUALITY-phase week and carries exactly one quality
    // session. The RHR-spike limb downgrades it to easy.
    const q = after.workouts.find((w) => w.week_id === 'wk_8' && w.is_quality)!;
    q.type = 'easy';
    q.is_quality = false;

    const v = verdict(before, after);
    expect(v.introduced.join('\n')).toMatch(/no quality sessions prescribed/);
  });

  it('is ACCEPTED in a BASE-phase week · §5 only guards quality phases', () => {
    const before = buildSnapshot();
    const after = clone(before);
    const q = after.workouts.find((w) => w.week_id === 'wk_1' && w.is_quality)!;
    q.type = 'easy';
    q.is_quality = false;
    expect(verdict(before, after).introduced).toEqual([]);
  });
});

// ── 5 · the other write shapes ────────────────────────────────────────────────

describe('the remaining mutation shapes each invariant catches', () => {
  it('mark_upgrade is REJECTED when a bumped easy day passes the long (§7)', () => {
    const before = buildSnapshot();
    const after = clone(before);
    const easy = after.workouts.find((w) => w.week_id === 'wk_0' && w.type === 'easy')!;
    easy.distance_mi = 20; // long is 12
    const v = verdict(before, after);
    expect(v.introduced.join('\n')).toMatch(/exceeds the long/);
  });

  it('reschedule is REJECTED when it dates a run AFTER race day (§8)', () => {
    const before = buildSnapshot();
    const after = clone(before);
    // The race is on Saturday; Sunday is a rest row. A move that lands a run
    // on that Sunday puts a prescription after race day — the shape a naive
    // `SET date_iso = …` poke produces.
    const sunday = after.workouts.find(
      (w) => w.week_id === 'wk_12' && w.dow === 0,
    )!;
    sunday.type = 'easy';
    sunday.distance_mi = 5;
    const v = verdict(before, after);
    expect(v.introduced.join('\n')).toMatch(/dated AFTER the race/);
  });

  it('a taper week flattened back to peak volume is REJECTED (§4b)', () => {
    const before = buildSnapshot();
    const after = clone(before);
    for (const w of after.workouts) {
      if (w.week_id === 'wk_10' && w.distance_mi != null && w.distance_mi > 0) {
        w.distance_mi = w.distance_mi * 3;
      }
    }
    const v = verdict(before, after);
    expect(v.introduced.length).toBeGreaterThan(0);
    expect(v.introduced.join('\n')).toMatch(/taper/i);
  });

  it('a week-over-week volume explosion is REJECTED (§6)', () => {
    const before = buildSnapshot();
    const after = clone(before);
    for (const w of after.workouts) {
      if (w.week_id === 'wk_5' && w.distance_mi != null && w.distance_mi > 0) {
        w.distance_mi = w.distance_mi * 2.2;
      }
    }
    const v = verdict(before, after);
    expect(v.introduced.length).toBeGreaterThan(0);
  });

  it('deleting every row of a week does not silently pass', () => {
    const before = buildSnapshot();
    const after = clone(before);
    after.workouts = after.workouts.filter((w) => w.week_id !== 'wk_9');
    const v = verdict(before, after);
    // Week 9 is a QUALITY week; emptying it loses its quality session.
    expect(v.introduced.join('\n')).toMatch(/no quality sessions prescribed/);
  });
});

// ── 6 · the plan is unchanged after a rejection ───────────────────────────────

describe('a rejected mutation leaves the plan untouched', () => {
  it('the before-snapshot the boundary rolls back to is byte-identical', () => {
    const before = buildSnapshot();
    const beforeFingerprint = structuralFingerprint(before);
    const beforeViolations = violationsOf(before, CTX);

    // Simulate the rejected field test, then the rollback.
    const after = clone(before);
    const sat = after.workouts.find(
      (w) => w.week_id === 'wk_2' && w.type === 'easy' && w.dow === 6,
    )!;
    sat.type = 'tempo';
    sat.is_quality = true;
    expect(verdict(before, after).introduced.length).toBeGreaterThan(0);

    // ROLLBACK: the boundary re-reads the plan, which is the before state.
    expect(structuralFingerprint(before)).toBe(beforeFingerprint);
    expect(violationsOf(before, CTX)).toEqual(beforeViolations);
  });
});

// ── 7 · differential semantics ────────────────────────────────────────────────

describe('differential verdict · inherited violations never block', () => {
  it('a plan that ALREADY violates an invariant still accepts an unrelated edit', () => {
    // Author a plan that is already out of doctrine: week 4's easy run is
    // longer than its long run.
    const before = clone(buildSnapshot());
    const badEasy = before.workouts.find((w) => w.week_id === 'wk_4' && w.type === 'easy')!;
    badEasy.distance_mi = 25;
    expect(violationsOf(before, CTX).length).toBeGreaterThan(0);

    // Now shave an unrelated day in a different week — the adapter's most
    // common write.
    const after = clone(before);
    const shave = after.workouts.find((w) => w.week_id === 'wk_1' && w.type === 'easy')!;
    shave.distance_mi = 5;

    const v = verdict(before, after);
    expect(v.introduced).toEqual([]);        // nothing new → the edit lands
    expect(v.preExisting.length).toBeGreaterThan(0);  // and the debt is reported
  });

  it('a mutation that makes an EXISTING violation worse still reads as introduced', () => {
    const before = clone(buildSnapshot());
    const badEasy = before.workouts.find((w) => w.week_id === 'wk_4' && w.type === 'easy')!;
    badEasy.distance_mi = 25;

    const after = clone(before);
    const worse = after.workouts.find((w) => w.week_id === 'wk_4' && w.type === 'easy')!;
    worse.distance_mi = 40;

    const v = verdict(before, after);
    // The message embeds the numbers, so a worse version is a different string.
    expect(v.introduced.length).toBeGreaterThan(0);
  });

  it('reports a repair as resolved rather than pretending nothing happened', () => {
    const before = clone(buildSnapshot());
    const badEasy = before.workouts.find((w) => w.week_id === 'wk_4' && w.type === 'easy')!;
    badEasy.distance_mi = 25;
    const after = buildSnapshot();  // clean

    const v = verdict(before, after);
    expect(v.introduced).toEqual([]);
    expect(v.resolved.length).toBeGreaterThan(0);
  });
});

// ── 8 · the 'derivations' declaration is proven, not trusted ──────────────────

describe("'derivations' mutations · the fingerprint proves the claim", () => {
  it('a paces-and-spec rewrite leaves the structural fingerprint identical', () => {
    const before = buildSnapshot();
    const after = clone(before);
    // Exactly what recompute-paces / reanchor write: label only (spec and
    // pace_target are not even in the snapshot, which is the point).
    for (const w of after.workouts) w.sub_label = 'CRUISE INTERVALS';
    for (const w of after.workouts) w.notes = 'rebuilt';
    expect(structuralFingerprint(after)).toBe(structuralFingerprint(before));
  });

  it('a distance change breaks the fingerprint · the declaration would be refused', () => {
    const before = buildSnapshot();
    const after = clone(before);
    after.workouts[1].distance_mi = (after.workouts[1].distance_mi ?? 0) + 0.5;
    expect(structuralFingerprint(after)).not.toBe(structuralFingerprint(before));
  });

  it('a type flip breaks the fingerprint', () => {
    const before = buildSnapshot();
    const after = clone(before);
    after.workouts[1].type = 'tempo';
    expect(structuralFingerprint(after)).not.toBe(structuralFingerprint(before));
  });

  it('an is_quality flip breaks the fingerprint', () => {
    const before = buildSnapshot();
    const after = clone(before);
    after.workouts[1].is_quality = !after.workouts[1].is_quality;
    expect(structuralFingerprint(after)).not.toBe(structuralFingerprint(before));
  });

  it('adding or removing a row breaks the fingerprint', () => {
    const before = buildSnapshot();
    const after = clone(before);
    after.workouts.pop();
    expect(structuralFingerprint(after)).not.toBe(structuralFingerprint(before));
  });
});

// ── 9 · degenerate inputs never crash the boundary ────────────────────────────

describe('degenerate inputs', () => {
  it('an empty plan validates to no violations rather than throwing', () => {
    const empty: PlanSnapshot = { planId: 'pln_x', phases: [], weeks: [], workouts: [] };
    expect(violationsOf(empty, CTX)).toEqual([]);
    expect(() => structuralFingerprint(empty)).not.toThrow();
  });

  it('a week whose phase_id does not resolve falls back rather than throwing', () => {
    const snap = clone(buildSnapshot());
    snap.weeks[0].phase_id = 'phs_missing';
    expect(() => rehydratePlan(snap)).not.toThrow();
    expect(rehydratePlan(snap).weeks[0].phase).toBe('BASE');
  });

  it('null distances read as zero', () => {
    const snap = clone(buildSnapshot());
    snap.workouts[1].distance_mi = null;
    const plan = rehydratePlan(snap);
    expect(plan.weeks[0].days.some((d) => d.distanceMi === 0)).toBe(true);
  });
});

// ── 10 · SOURCE SCAN · no writer outside the door ─────────────────────────────
//
// Behavioural coverage of `mutatePlan` itself needs a database and would not
// run in CI, so the guarantee that every writer is INSIDE the door is enforced
// by reading the source, the same way `_no_strength_rows.test.ts` enforces its
// rule.

/** web-v2 root (this file lives at web-v2/lib/plan/). */
const ROOT = join(__dirname, '..', '..');

/**
 * Files that write `plan_workouts` and are NOT expected to call `mutatePlan`
 * themselves, each with the reason.
 *
 * These are not exemptions from the boundary — every one of them runs INSIDE a
 * transaction the boundary already owns, and validating them separately would
 * judge an intermediate state of someone else's batch. An entry here is an
 * admission with a name on it, and the staleness check below makes a file that
 * stops writing plan_workouts get deleted from the list.
 */
const RUNS_INSIDE_ANOTHERS_BOUNDARY: Record<string, string> = {
  'lib/plan/progression-pass.ts':
    'applyProgressionReshape is one statement inside applyAdaptations\' batch; ' +
    'writes workout_spec / sub_label / pace_target only',
  'lib/plan/recompute-paces.ts':
    'enters the boundary itself when called standalone; runs on the caller\'s ' +
    'transaction when applyAdaptations or reanchorPlan already own one',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Source with comments stripped, so prose about the rule never trips it. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const WRITE_RE = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+plan_workouts\b/i;

describe('source scan · every plan_workouts writer routes through the boundary', () => {
  const files = [
    ...walk(join(ROOT, 'lib')),
    ...walk(join(ROOT, 'app')),
  ];

  const writers = files.filter((f) => WRITE_RE.test(code(f)));

  it('finds the writers at all (the scan is not silently matching nothing)', () => {
    expect(writers.length).toBeGreaterThan(5);
  });

  it('every writer either calls mutatePlan or is a named inside-another-batch file', () => {
    const unrouted: string[] = [];
    for (const f of writers) {
      const rel = f.slice(ROOT.length + 1);
      if (rel === 'lib/plan/mutate.ts') continue;               // the door itself
      if (RUNS_INSIDE_ANOTHERS_BOUNDARY[rel] != null) continue; // named, with a reason
      if (/\bmutatePlan\s*[<(]/.test(code(f))) continue;        // routed
      unrouted.push(rel);
    }
    expect(unrouted).toEqual([]);
  });

  it('the inside-another-batch list has no stale entries', () => {
    const stale = Object.keys(RUNS_INSIDE_ANOTHERS_BOUNDARY).filter((rel) => {
      const full = join(ROOT, rel);
      try { return !WRITE_RE.test(code(full)); }
      catch { return true; }  // file gone
    });
    expect(stale).toEqual([]);
  });
});

// ── 11 · the module's own contract ────────────────────────────────────────────

describe('mutate.ts declares its limits in the file itself', () => {
  const src = readFileSync(join(__dirname, 'mutate.ts'), 'utf8');

  it('names §0 and §2 as the invariants it cannot enforce', () => {
    expect(src).toMatch(/§0 vols\/weeklyMi coherence — NOT ENFORCEABLE/);
    expect(src).toMatch(/§2 prior-plan corruption check — NOT APPLICABLE/);
  });

  it('states the performance trade-off it took', () => {
    expect(src).toMatch(/PERFORMANCE/);
    expect(src).toMatch(/The trade-off taken/);
  });

  it('documents the escape hatch as the only way past validation', () => {
    expect(src).toMatch(/THE ESCAPE HATCH, and the only one/);
  });
});
