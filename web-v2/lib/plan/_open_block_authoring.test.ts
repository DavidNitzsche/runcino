/**
 * _open_block_authoring.test.ts · the runner who finishes a race with nothing
 * booked now gets a PLAN.
 *
 * ─── the state under test ────────────────────────────────────────────────────
 *
 * `runPostResultChain` archives the finished plan the moment a finish time
 * lands. It then looks for the next A/B race. When there is none it used to
 * stop, so at that instant the runner had ZERO active plans — on the morning
 * after their goal race — and no entry into the plan engine could give them
 * one: `loadGeneratorInputs` returned `'race not found'` without a `raceSlug`
 * or a `goalTarget`. `lib/plan/open-block.ts` did everything except the
 * authoring, and recorded a PENDING proposal saying so.
 *
 * `GenerateInput.openTarget` (OPEN-TARGET-1) is the missing entry. These tests
 * assert the runner now receives an authored, validated plan.
 *
 * ─── how it is proved ────────────────────────────────────────────────────────
 *
 * Through `composeForUser` — the export that exists precisely so the author-time
 * pipeline can be driven END TO END against real rows without persisting: real
 * `loadGeneratorInputs`, real mode selection, real composer, real
 * `finalizeComposedPlan`, real `validateComposedPlan`. Every failure mode this
 * work could have introduced (the runway gates firing, the validator refusing
 * an unknown distance, a composer dereferencing a null `nextRace`) surfaces
 * there. Nothing is written: no plan row, no proposal row, no mutation.
 *
 * The one step `composeForUser` does not cover is persistence, which is
 * `mutatePlan` — already covered by `_mutation_boundary.test.ts` — so the last
 * link (composed → `ok: true` → `reason: 'authored'` → an `auto_applied` audit
 * row rather than a `pending` one) is asserted as a source scan, the same tool
 * and for the same reason as `_lifecycle_open_block.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  composeForUser,
  composeMaintenancePlan,
  composeRecoveryPlan,
  openBlockShapeAnchorMi,
  OPEN_BLOCK_SHAPE_ANCHOR_MI,
  type ComposeNonRaceInput,
} from './generate';
import { validateComposedPlan } from './validate';
import { openBlockMode } from './race-lifecycle';
import { classifyGoalTier, postRaceRecoveryWeeks } from './goal-tiers';
import { predictRaceTime } from '@/lib/training/vdot';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { pool } from '@/lib/db/pool';
import { HAS_DATABASE } from '@/lib/db/_test-db';

const ROOT = join(__dirname, '..', '..');
/** Source with comments stripped, so prose about a rule never satisfies it. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/** A runner with real training history, so the composers have something to
 *  size a block from. Read-only: the test never writes for this user. */
async function aRunnerWithHistory(): Promise<string> {
  const r = await pool.query<{ uid: string }>(
    `SELECT user_uuid::text AS uid, COUNT(*) AS n
       FROM runs
      WHERE user_uuid IS NOT NULL
        AND NOT (data ? 'mergedIntoId')
      GROUP BY user_uuid
      ORDER BY COUNT(*) DESC
      LIMIT 1`,
  );
  const uid = r.rows[0]?.uid;
  expect(uid, 'no runner with run history in this database').toBeTruthy();
  return uid;
}

// ── 1 · the bug, and its absence ─────────────────────────────────────────────

describe.skipIf(!HAS_DATABASE)('the plan engine can be entered with no target at all', () => {
  it('WITHOUT openTarget the engine still refuses — the exact bug', async () => {
    const userId = await aRunnerWithHistory();
    // No raceSlug, no goalTarget, no openTarget. This is what every path into
    // the engine looked like for a runner with nothing booked, and it is why
    // they got no plan. Unchanged: the fix adds an entry, it does not loosen
    // the existing one.
    const r = await composeForUser({ userId });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('race not found');
  }, 120_000);

  it('a runner who finished a race YESTERDAY gets an authored recovery block', async () => {
    const userId = await aRunnerWithHistory();
    const todayISO = await runnerToday(userId);
    const raceISO = addDaysISO(todayISO, -1);

    // Deliberately relative to the runner's own date rather than a literal, so
    // the case stays inside Research/00b's window for as long as this test
    // exists. Determinism is preserved — `runnerToday` is the runner's date,
    // the only clock the engine is allowed to read.
    const r = await composeForUser({
      userId,
      openTarget: {
        after: { slug: 'test-marathon', dateISO: raceISO, distanceMi: 26.2, priority: 'A' },
      },
      startAnchor: 'today',
    });

    expect(r.ok, r.ok === false ? r.reason : '').toBe(true);
    if (!r.ok) return;

    // A marathon finished yesterday is squarely inside the recovery window.
    expect(postRaceRecoveryWeeks('m', 'A')).toBeGreaterThan(0);
    expect(r.result.mode).toBe('recovery');

    // An actual plan: weeks, days, and real running in them.
    expect(r.result.composed.weeks.length).toBeGreaterThan(0);
    const days = r.result.composed.weeks.flatMap((w) => w.days);
    expect(days.length).toBeGreaterThan(0);
    expect(days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length).toBeGreaterThan(0);

    // Recovery is easy running only — no quality, per Research/00b.
    expect(days.filter((d) => d.isQuality)).toHaveLength(0);
  }, 120_000);

  it('a runner whose last race is long past gets an authored maintenance block', async () => {
    const userId = await aRunnerWithHistory();
    const todayISO = await runnerToday(userId);
    // 400 days is outside every row of the recovery table at every priority.
    const raceISO = addDaysISO(todayISO, -400);

    const r = await composeForUser({
      userId,
      openTarget: {
        after: { slug: 'test-marathon', dateISO: raceISO, distanceMi: 26.2, priority: 'A' },
      },
      startAnchor: 'today',
    });

    expect(r.ok, r.ok === false ? r.reason : '').toBe(true);
    if (!r.ok) return;
    expect(r.result.mode).toBe('maintenance');
    // composeMaintenancePlan's rolling default, reached because nextRace is
    // null — the block's length comes from the composer, not from a date.
    expect(r.result.composed.totalWeeks).toBe(4);
    const days = r.result.composed.weeks.flatMap((w) => w.days);
    expect(days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length).toBeGreaterThan(0);
  }, 120_000);

  it('a caller that names no finished race still gets a block', async () => {
    // `after: null` is what the nightly cron passes when it finds somebody
    // planless and can see no A/B race behind them — the "just run" population.
    // The mode is NOT asserted to be maintenance here: with no race named, the
    // engine falls back to `loadLastRaceFinished`, which asks the database the
    // same question the cron asked, so a runner who did race recently
    // correctly still gets recovery. What is asserted is that a plan comes out.
    const userId = await aRunnerWithHistory();
    const r = await composeForUser({ userId, openTarget: { after: null }, startAnchor: 'today' });
    expect(r.ok, r.ok === false ? r.reason : '').toBe(true);
    if (!r.ok) return;
    expect(['recovery', 'maintenance']).toContain(r.result.mode);
    const days = r.result.composed.weeks.flatMap((w) => w.days);
    expect(days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length).toBeGreaterThan(0);
  }, 120_000);

  it('the mode the engine picks is the mode openBlockMode already reported', async () => {
    // `authorOpenBlock` answers recovery-vs-maintenance itself, and records
    // that answer on the audit row. If `pickPlanMode` reached a different one
    // the runner's proposal row would describe a block they did not get. Both
    // read `postRaceRecoveryWeeks`; this asserts they agree through the whole
    // real pipeline, including the two cases the DB reader behind pickPlanMode
    // cannot see on its own — a race dated TODAY, and a C-priority race.
    const userId = await aRunnerWithHistory();
    const todayISO = await runnerToday(userId);
    for (const [distanceMi, priority, daysAgo] of [
      [26.2, 'A', 0],   // race day itself
      [13.1, 'C', 0],   // C priority, invisible to loadLastRaceFinished
      [13.1, 'A', 3],
      [6.2, 'B', 30],
      [26.2, 'A', 400],
    ] as const) {
      const dateISO = addDaysISO(todayISO, -daysAgo);
      const expected = openBlockMode({
        lastRaceDateISO: dateISO, lastRaceDistanceMi: distanceMi,
        lastRacePriority: priority, todayISO,
      });
      const r = await composeForUser({
        userId,
        openTarget: { after: { slug: 'test-race', dateISO, distanceMi, priority } },
        startAnchor: 'today',
      });
      const label = `${distanceMi}/${priority}/${daysAgo}d`;
      expect(`${label}:${r.ok}`).toBe(`${label}:true`);
      if (!r.ok) continue;
      expect(`${label}:${r.result.mode}`).toBe(`${label}:${expected}`);
    }
  }, 300_000);
});

// ── 2 · the shape anchor is a convention, and it is inert ────────────────────

describe('OPEN_BLOCK_SHAPE_ANCHOR_MI', () => {
  it('prefers the distance the runner last raced', () => {
    expect(openBlockShapeAnchorMi(26.2)).toBe(26.2);
    expect(openBlockShapeAnchorMi(3.1)).toBe(3.1);
    // Never a guessed number in place of an unresolvable one: null, zero and
    // non-finite all fall to the stated convention rather than to `0`, which
    // `distanceCategoryOrThrow` would reject and which no runner ever raced.
    expect(openBlockShapeAnchorMi(null)).toBe(OPEN_BLOCK_SHAPE_ANCHOR_MI);
    expect(openBlockShapeAnchorMi(undefined)).toBe(OPEN_BLOCK_SHAPE_ANCHOR_MI);
    expect(openBlockShapeAnchorMi(0)).toBe(OPEN_BLOCK_SHAPE_ANCHOR_MI);
    expect(openBlockShapeAnchorMi(NaN)).toBe(OPEN_BLOCK_SHAPE_ANCHOR_MI);
  });

  it('WOULD change the tier if evidence were graded against it', () => {
    // The finding that shaped the design, kept as a test so it cannot quietly
    // stop being true. Grading a runner's demonstrated pace at the anchor
    // distance is NOT distance-invariant: it holds to about VDOT 48 and
    // diverges above, where the same runner reads a tier higher at 13.1 than at
    // 26.2 — a different MAINTENANCE_BY_TIER row, a different number of running
    // days a week, decided by a number nobody chose. This is why the lift is
    // withheld when the anchor is the convention.
    const anchors = [3.1, 6.2, 13.1, 26.2];
    const tiersAt = (vdot: number) => new Set(
      anchors.map((mi) => {
        const t = predictRaceTime(vdot, mi);
        const demonstrated = t != null ? Math.round(t / mi) : null;
        // TIEREVIDENCE-2 · there is no level argument any more; the
        // demonstrated pace is the whole of the reading.
        return classifyGoalTier(null, mi, demonstrated);
      }),
    );
    expect(tiersAt(60).size).toBeGreaterThan(1);
  });

  it('is inert once the demonstrated lift is withheld', () => {
    // With no goal AND no demonstrated pace, `classifyGoalTier` is a CONSTANT —
    // the anchor distance cannot reach it, and since TIEREVIDENCE-2 neither can
    // an experience level, because there is no longer a parameter for one. That
    // is the whole mechanism by which the convention stops mattering, so it is
    // asserted directly rather than argued.
    const tiers = new Set([3.1, 6.2, 13.1, 26.2, 31.07].map((mi) => classifyGoalTier(null, mi, null)));
    expect([...tiers].join('|')).toBe([...tiers][0]);
    // LIVENESS · and the constant is `UNMEASURED_ROW_TIER`, not some other
    // constant that would satisfy the sameness assertion for free.
    expect([...tiers][0]).toBe('intermediate');
  });

  it('the validator reaches the same verdict whichever row the anchor selects', () => {
    // The second consumer. `validateComposedPlan` selects a CONSTRAINTS row by
    // category; outside race-prep the only field of that row which binds is
    // `longRunWoWMaxPct`, which is 30 in all five. Asserted by validating ONE
    // composed maintenance block against every distance and requiring the same
    // outcome each time — if a future edit makes a row's non-race-prep
    // behaviour differ, this fails.
    const composed = composeMaintenancePlan({ ...BASE });
    const ctx = {
      level: 'intermediate' as const,
      isSteppingStoneToMarathon: false,
      priorPlanPeakLongMi: null,
      todayISO: '2026-03-02',
      trainingDaysPerWeek: null,
      trailingAvgWeeklyMi: 40,
      recentWeeklyMi: 40,
    };
    const verdicts = [3.1, 6.2, 13.1, 26.2, 31.07].map((mi) => {
      try {
        validateComposedPlan(composed, mi, 'maintenance', ctx);
        return 'ok';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(new Set(verdicts).size, verdicts.join(' | ')).toBe(1);
    expect(verdicts[0]).toBe('ok');
  });
});

// ── 3 · the composers, driven directly with no next race ─────────────────────

const BASE: ComposeNonRaceInput = {
  startMondayISO: '2026-03-02',
  level: 'intermediate',
  recentWeeklyMi: 40,
  recentLongMi: 14,
  recentPeakWeeklyMi: 55,
  easyDayMedianMi: 6,
  longRunDow: 0,
  restDow: 6,
  qualityDows: [2, 4],
  availableDows: null,
  trainingDaysPerWeek: null,
  crossModes: [],
  tier: 'intermediate',
  nextRace: null,
  lastRaceFinished: null,
  rxQuality: { quality: null, threshold: null, intervals: null, tempo: null, long: null } as never,
  tPaceSec: 400,
  lthr: 170,
  bestRecentVdot: 48,
};

describe('the non-race composers accept a null nextRace', () => {
  it('maintenance falls back to its rolling four weeks', () => {
    const r = composeMaintenancePlan({ ...BASE });
    expect(r.totalWeeks).toBe(4);
    expect(r.weeks).toHaveLength(4);
    const days = r.weeks.flatMap((w) => w.days);
    expect(days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length).toBeGreaterThan(0);
    // The claim that made the shape anchor inert: neither type is ever emitted,
    // so `goalIPaceEligible` — the only remaining distance-keyed consumer on
    // this path — has nothing to act on.
    expect(days.filter((d) => d.type === 'intervals' || d.type === 'race_week_tuneup')).toHaveLength(0);
  });

  it('recovery reads the FINISHED race, never the next one', () => {
    const r = composeRecoveryPlan({
      ...BASE,
      lastRaceFinished: { slug: 'r', name: 'R', date: '2026-03-01', distanceMi: 26.2, priority: 'A' },
    });
    expect(r.weeks.length).toBeGreaterThan(0);
    const days = r.weeks.flatMap((w) => w.days);
    expect(days.filter((d) => d.isQuality)).toHaveLength(0);
    expect(days.filter((d) => d.type === 'intervals' || d.type === 'race_week_tuneup')).toHaveLength(0);
    expect(days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length).toBeGreaterThan(0);
  });
});

// ── 4 · the seam is wired, and it authors rather than proposes ───────────────

describe('open-block authorship reaches the generator', () => {
  it('authorNoTargetBlock calls generatePlan with openTarget', () => {
    const src = code('lib/plan/open-block.ts');
    expect(src).toMatch(/openTarget: \{ after: input\.lastRace \}/);
    // The placeholder is gone — not renamed, gone.
    expect(src).not.toMatch(/no_target_entry_missing/);
    expect(src).toMatch(/reason: 'authored'/);
  });

  it('a successful authoring records auto_applied, not pending', () => {
    const src = code('lib/plan/open-block.ts');
    // `recordOpenBlock` is called with `authored.ok`, and maps it to the status.
    expect(src).toMatch(/ok \? 'auto_applied' : 'pending'/);
    expect(src).toMatch(/recordOpenBlock\(userUuid, mode, input\.source, authored\.ok/);
  });

  it('the runway gates are skipped on the open path and nowhere else', () => {
    const src = code('lib/plan/generate.ts');
    expect(src).toMatch(/if \(!openTarget && totalDays < 14\)/);
    expect(src).toMatch(/if \(!openTarget && totalDays > 365\)/);
    expect(src).toMatch(/if \(!openTarget && totalWeeks < 3\)/);
    // And a real target still cannot slip past them.
    expect(src).not.toMatch(/if \(totalDays < 14\)/);
  });

  it('a real target always beats an open block', () => {
    const src = code('lib/plan/generate.ts');
    expect(src).toMatch(/const openTarget = \(!raceSlug && !goalTarget\) \? input\.openTarget : undefined;/);
  });

  it('the open block never claims today as its goal date', () => {
    const src = code('lib/plan/generate.ts');
    expect(src).toMatch(/raceDateISO: openTarget \? openBlockEndISO : inputs\.compose\.raceDateISO/);
  });

  it('the demonstrated lift is withheld when the anchor is the convention', () => {
    const src = code('lib/plan/generate.ts');
    expect(src).toMatch(/bestRecentVdot != null && !openAnchorIsConvention/);
    // And the flag is derived from the same input the loader anchored on, so
    // the two cannot drift into disagreeing about which case this is.
    expect(src).toMatch(/openAnchorIsConvention = !!openTarget && !openBlockAnchorIsMeasured\(openAfter\?\.distanceMi \?\? null\)/);
  });

  it('the row records whether its anchor was raced or assumed', () => {
    const src = code('lib/plan/generate.ts');
    expect(src).toMatch(/open_block_shape_anchor_source/);
    expect(src).toMatch(/'last_raced' : 'convention'/);
  });
});

// ── 5 · the coached gate, at the chokepoint ─────────────────────────────────

describe('coached_externally is checked in generatePlan itself', () => {
  it('the gate is the first thing generatePlan does', () => {
    const src = code('lib/plan/generate.ts');
    const fn = src.indexOf('export async function generatePlan');
    expect(fn).toBeGreaterThan(-1);
    const body = src.slice(fn, fn + 700);
    expect(body).toMatch(/isCoachedExternally\(input\.userId\)/);
    // Before composition, so a coached runner's plan is never even built.
    expect(body.indexOf('isCoachedExternally')).toBeLessThan(body.indexOf('composeForUserInternal'));
  });

  it('the automatic paths carry no override', () => {
    // silent-rebuild is the one that mattered: automatic, and invisible by
    // design (no proposal, no banner). It must not opt out.
    for (const rel of [
      'app/api/cron/silent-rebuild/route.ts',
      'lib/plan/open-block.ts',
      'lib/plan/auto-rebuild.ts',
      'lib/race/result-chain.ts',
      'app/api/onboarding/complete/route.ts',
    ]) {
      expect(code(rel), rel).not.toMatch(/allowCoached/);
    }
  });

  it('exactly the three explicit runner actions override it', () => {
    for (const rel of [
      'app/api/plan/generate/route.ts',
      'app/api/plan/replan/route.ts',
      'app/api/plan/proposal/route.ts',
    ]) {
      expect(code(rel), rel).toMatch(/allowCoached: true/);
    }
  });

  it('the override is opt-IN, so a forgotten call site is gated', () => {
    const src = code('lib/plan/generate.ts');
    // `!input.allowCoached && …` — absent means gated. The inverse spelling
    // (a `skipCoachedGate` defaulting to true, say) would make every future
    // call site unsafe by omission.
    expect(src).toMatch(/if \(!input\.allowCoached && await isCoachedExternally/);
  });
});
