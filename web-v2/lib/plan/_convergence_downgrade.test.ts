/**
 * The convergence downgrade at the WRITE BOUNDARY.
 *
 * `lib/coach/_convergence.test.ts` proves what the rule decides. This file
 * proves what the decision is allowed to do to the plan.
 *
 * ── On measuring "cannot breach" correctly ───────────────────────────────
 *
 * The first draft of this file asserted that a downgrade leaves
 * `dosingBreachIfWritten` returning `[]`, and that was the wrong question. The
 * guard reports the ABSOLUTE state of the resulting week, so on a week that
 * already sits over a cap it reports the pre-existing breach whatever you do —
 * including a change that removed load. Asserting `[]` would have made this
 * file pass only on weeks that had room to spare, which is exactly where a
 * downgrade could never have breached anyway.
 *
 * The property that actually matters is DIFFERENTIAL, and it is the same shape
 * `mutatePlan` uses to decide whether to roll a pass back: the breaches after
 * the change must be a SUBSET of the breaches before it. A downgrade may
 * inherit a breach it did not cause; it may never add one.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_convergence_downgrade.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dosingBreachIfWritten } from './dose-guard';
import { slotDosePace, weeklyDoseBudgetMi } from './dosing';

/** A fake pg client returning canned rows, so this needs no database. */
const clientFor = (rows: Array<Record<string, unknown>>, meta: Record<string, unknown>) => ({
  query: async (sql: string) => {
    if (/FROM plan_workouts pw/.test(sql)) return { rows: [meta] } as never;
    return { rows } as never;
  },
}) as never;

const META = {
  date_iso: '2026-09-09', plan_id: 'p1', long_run_day: 'sun',
  phase: 'QUALITY', is_race_week: false,
};

/**
 * A week sitting right AT the threshold cap: 34 mi of training gives Daniels
 * 3.4 mi at T, and the cruise session spends 4. This is the fixture the
 * existing dosing suite uses to prove the field-test guard refuses to add to a
 * tight week, and it is where a downgrade would show up if it could ever make
 * things worse.
 */
const TIGHT_WEEK = [
  { id: 'w-long', type: 'long', distance_mi: '14', sub_label: 'LONG', is_long: true },
  { id: 'w-t', type: 'threshold', distance_mi: '8', sub_label: '4×1mi @ T pace · 60s jog', is_long: false },
  { id: 'w-e1', type: 'easy', distance_mi: '6', sub_label: 'EASY', is_long: false },
  { id: 'w-e2', type: 'easy', distance_mi: '6', sub_label: 'EASY', is_long: false },
];

/** The same shape with room to spare · 50 mi of training, 5 mi of T budget. */
const ROOMY_WEEK = [
  { id: 'r-long', type: 'long', distance_mi: '18', sub_label: 'LONG', is_long: true },
  { id: 'r-t', type: 'threshold', distance_mi: '8', sub_label: '3×1mi @ T pace · 60s jog', is_long: false },
  { id: 'r-e1', type: 'easy', distance_mi: '12', sub_label: 'EASY', is_long: false },
  { id: 'r-e2', type: 'easy', distance_mi: '12', sub_label: 'EASY', is_long: false },
];

type Row = Record<string, unknown>;

/** Breaches for a week exactly as it stands · a no-op proposal. */
function breachesAsIs(week: Row[], row: Row, atPaceMi: number) {
  return dosingBreachIfWritten(clientFor(week, META), 'u1', {
    workoutId: String(row.id),
    type: String(row.type),
    distanceMi: Number(row.distance_mi),
    subLabel: String(row.sub_label),
    atPaceMi,
  } as never);
}

/** Breaches for the week with `row` downgraded to easy · what the limb emits. */
function breachesAfterDowngrade(week: Row[], row: Row) {
  return dosingBreachIfWritten(clientFor(week, META), 'u1', {
    workoutId: String(row.id),
    type: 'easy',
    distanceMi: Number(row.distance_mi),
    subLabel: 'EASY',
    atPaceMi: 0,
  } as never);
}

const key = (f: { pace: string; scope: string }) => `${f.pace}/${f.scope}`;

describe('a convergence downgrade cannot ADD a dosing breach', () => {
  it('the tight week is genuinely tight · the guard refuses to add to it', async () => {
    // Establishes the fixture is load-bearing. Without this, a downgrade
    // passing would prove nothing.
    const breach = await dosingBreachIfWritten(
      clientFor(TIGHT_WEEK, META), 'u1',
      { workoutId: 'w-e1', type: 'tempo', distanceMi: 6, subLabel: 'FIELD TEST', atPaceMi: 4 } as never,
    );
    expect(breach.length).toBeGreaterThan(0);
    expect(breach[0].pace).toBe('T');
    expect(breach.every((f) => f.enforced)).toBe(true);
  });

  it('the roomy week is clean, and stays clean through every downgrade', async () => {
    for (const row of ROOMY_WEEK) {
      const after = await breachesAfterDowngrade(ROOMY_WEEK, row);
      expect(after, `downgrading ${row.id}`).toEqual([]);
    }
  });

  it('on the tight week, downgrading is a subset of what was already there', async () => {
    // The differential property. Sweep every row: whichever one the runner's
    // convergent-red morning lands on, the resulting breach set never gains a
    // member it did not already have.
    for (const row of TIGHT_WEEK) {
      const atPace = row.id === 'w-t' ? 4 : 0;
      const before = new Set((await breachesAsIs(TIGHT_WEEK, row, atPace)).map(key));
      const after = await breachesAfterDowngrade(TIGHT_WEEK, row);
      for (const f of after) {
        expect(before.has(key(f)), `downgrading ${row.id} ADDED a ${key(f)} breach`).toBe(true);
      }
    }
  });

  it('downgrading the offending session CLEARS the breach outright', async () => {
    // The case the runner actually hits: red morning, quality day, session
    // becomes easy. The 4 mi of T leaves the week with it.
    const before = await breachesAsIs(TIGHT_WEEK, TIGHT_WEEK[1], 4);
    expect(before.length).toBeGreaterThan(0);
    expect(await breachesAfterDowngrade(TIGHT_WEEK, TIGHT_WEEK[1])).toEqual([]);
  });

  it('the reason it cannot add one · easy doses no capped pace family at all', () => {
    // The structural argument behind the sweep, so a future change to
    // `slotDosePace` cannot quietly invalidate it. A cap is breached by
    // SPENDING budget; an easy day spends none.
    expect(slotDosePace('easy' as never)).toBeNull();
    // And the capped families still have finite budgets, so the assertion
    // above is about the day, not about the caps having gone away.
    expect(weeklyDoseBudgetMi(40, 'T')).toBeGreaterThan(0);
    expect(Number.isFinite(weeklyDoseBudgetMi(40, 'T'))).toBe(true);
  });
});

describe('the change reaches the plan through one door', () => {
  const adaptSrc = readFileSync(path.join(process.cwd(), 'lib', 'plan', 'adapt.ts'), 'utf8');
  /**
   * Comments stripped. The first draft of this file scanned the raw source and
   * matched the OLD gate inside the new docblock that quotes it — the module
   * explains what it replaced, and that explanation is not the code.
   */
  const adaptCode = adaptSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const limbOf = (src: string) => {
    const start = src.indexOf("case 'readiness_pullback': {");
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("case 'heat_bail': {", start));
  };

  it('the readiness limb emits an action · it issues no write of its own', () => {
    const limb = limbOf(adaptCode);
    // It reads (to find today's quality row) and returns actions. It must not
    // UPDATE, INSERT or DELETE — those belong to applyAdaptations, inside
    // `mutatePlan`, which snapshots and rolls back on a doctrine violation.
    expect(limb).not.toMatch(/\bUPDATE\s+plan_workouts\b/i);
    expect(limb).not.toMatch(/\bINSERT\s+INTO\s+plan_workouts\b/i);
    expect(limb).not.toMatch(/\bDELETE\s+FROM\s+plan_workouts\b/i);
    expect(limb).toMatch(/kind: 'downgrade'/);
  });

  it('applyAdaptations still wraps the whole action loop in mutatePlan', () => {
    expect(adaptCode).toMatch(/const boundary = await mutatePlan</);
  });

  it('amber returns a record-only note and never reaches the downgrade', () => {
    const limb = limbOf(adaptCode);
    // The amber branch returns BEFORE anything looks for a quality row.
    const amberAt = limb.indexOf("if (grade !== 'red')");
    const downgradeAt = limb.indexOf("kind: 'downgrade'");
    expect(amberAt).toBeGreaterThan(-1);
    expect(downgradeAt).toBeGreaterThan(amberAt);
    expect(limb.slice(amberAt, downgradeAt)).toMatch(/kind: 'note'/);
  });

  it('every readiness action is settled overnight · none becomes a banner', () => {
    // Both halves carry forceApplyNow, for DIFFERENT reasons, and both reasons
    // are the owner's:
    //   · the red downgrade because the ruling says the change is settled the
    //     night before — the cron runs 03:00 UTC, which is 20:00 PT the
    //     previous evening;
    //   · the amber note because it is record-only. Proposing a note would ask
    //     the runner to approve a change that does not exist.
    const limb = limbOf(adaptCode);
    const notes = limb.match(/kind: 'note'/g)?.length ?? 0;
    const downgrades = limb.match(/kind: 'downgrade'/g)?.length ?? 0;
    const forced = limb.match(/forceApplyNow: true/g)?.length ?? 0;
    expect(notes + downgrades).toBe(forced);
  });

  it('the old single-signal gate is gone from the CODE', () => {
    // The four-way OR that let one pillar streak, or one bad post-run rating,
    // downgrade a session by itself. It survives in the docblock as history;
    // what must not survive is an executable copy.
    expect(adaptCode).not.toMatch(/!sustainedPullBack\s*&&\s*!hasTieredStreak/);
    expect(adaptCode).not.toMatch(/const hasTieredStreak\s*=/);
    expect(adaptCode).not.toMatch(/adapterRelevantPillars/);
    // And the replacement is wired.
    expect(adaptCode).toMatch(/gradeConvergence/);
  });

  it('readiness never re-anchors paces · the limb touches no pace or VDOT', () => {
    const limb = limbOf(adaptCode);
    expect(limb).not.toMatch(/recompute_paces|vdot|paceTarget|pace_target/i);
  });
});
