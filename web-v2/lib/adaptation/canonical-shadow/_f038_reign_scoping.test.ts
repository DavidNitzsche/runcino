/**
 * lib/adaptation/canonical-shadow/_f038_reign_scoping.test.ts · the
 * evidence-continuity clock no longer resets to zero on a plan rebuild —
 * CI-safe, no database.
 *
 * `programme-internal-working/00-master-programme/
 * F038-EVIDENCE-CLOCK-SCOPING-2026-09-14.md` traced the bug to one loader,
 * `live-input.ts`'s `buildLiveCanonicalInput`: every BACKWARD-looking read
 * (`weekObservations`, `qualitySessions`, `longRunObservations`, and their
 * `isCutback`/`authoredPlanMode` witnesses) was scoped to
 * `readPlanWorkouts(plan.id)` — the single currently-active plan's own rows,
 * nothing else. `plan_workouts` never deletes a superseded plan's rows
 * (CLAUDE.md Rule 14), so a week whose real prescription was authored by a
 * plan that has since been archived and rebuilt away read as `prescribedMi
 * === 0` — indistinguishable from a week that genuinely predates any plan.
 *
 * There is no Postgres in this suite (same convention as
 * `_owned_days_reign.test.ts` and `_never_mutates_plan.test.ts`): this pins
 * the SOURCE shape of the fix — which reads went backward-scoped to the
 * reign-stitched `ownedDaysSql()`, and which stayed current-plan-scoped
 * because they are genuinely forward-looking (F038 report §4) — rather than
 * executing it. `_f038_reign_scoping.audit.test.ts` is the live falsifier
 * that actually proves the fixed numbers, gated behind `DATABASE_URL_RO`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(__dirname, 'live-input.ts'), 'utf8');

/** Strip line/block comments the same crude way `_cannot_mutate.test.ts`
 *  does elsewhere in this codebase, so a mention of a symbol inside a doc
 *  comment cannot make an assertion pass for the wrong reason. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CODE = stripComments(SRC);

describe('1 · the fix reuses the reign-stitched query, does not re-derive it', () => {
  it('imports ownedDaysSql from lib/plan/owned-days — the same builder load.ts already trusts', () => {
    expect(SRC).toContain("import { ownedDaysSql } from '@/lib/plan/owned-days'");
  });

  it('never imports loadOwnedDays — that issues its query over the WRITABLE pool', () => {
    // `read-only-db.ts`'s own header says this directory must never carry a
    // dependency on `@/lib/db/pool`. `loadOwnedDays` (as opposed to the pure
    // SQL-string builder `ownedDaysSql`) calls `pool.query` directly, so
    // importing it here would reintroduce exactly that dependency.
    expect(SRC).not.toMatch(/import\s*\{[^}]*\bloadOwnedDays\b[^}]*\}/);
  });

  it('defines a reign-based reader that queries over roQuery, the fenced connection', () => {
    expect(CODE).toMatch(/async function readOwnedPlanWorkouts\(/);
    const fnStart = CODE.indexOf('async function readOwnedPlanWorkouts(');
    // F040 FOLLOW-UP (2026-09-14) widened this from 800: the function body
    // grew to ~1000 stripped chars once it also builds `version_rows` via a
    // `versions` CTE. 1300 keeps comfortable margin over the current ~1005
    // without being so loose it stops meaning "near the top of the function".
    const fnBody = CODE.slice(fnStart, fnStart + 1300);
    expect(fnBody).toContain('ownedDaysSql(');
    expect(fnBody).toContain('roQuery<OwnedPlanWorkoutRow>(');
    expect(fnBody).not.toContain('pool.query');
  });

  it('projects the owning plan\'s mode and its OWN plan_weeks.is_cutback, via includePlanWeeks', () => {
    const fnStart = CODE.indexOf('async function readOwnedPlanWorkouts(');
    // F040 FOLLOW-UP (2026-09-14) widened this from 800: the function body
    // grew to ~1000 stripped chars once it also builds `version_rows` via a
    // `versions` CTE. 1300 keeps comfortable margin over the current ~1005
    // without being so loose it stops meaning "near the top of the function".
    const fnBody = CODE.slice(fnStart, fnStart + 1300);
    expect(fnBody).toContain('includePlanWeeks: true');
    expect(fnBody).toMatch(/tp\.mode AS owning_plan_mode/);
    expect(fnBody).toMatch(/pwk\.is_cutback/);
  });
});

describe('2 · the backward-looking branch reads the owned/reign source, not the active-plan-only one', () => {
  it('weekObservations\' prescribedMi comes from ownedWorkoutsByDate, not workoutsByDate', () => {
    const start = CODE.indexOf('const weekObservations: WeekObservation[]');
    expect(start).toBeGreaterThan(-1);
    const block = CODE.slice(start, start + 1400);
    expect(block).toContain('ownedWorkoutsByDate.get(d)');
  });

  it('pastWeekStarts is built from ownedWorkouts, not the active plan\'s own workouts', () => {
    const start = CODE.indexOf('const pastWeekStarts');
    const block = CODE.slice(start, start + 300);
    expect(block).toContain('ownedWorkouts.map((w) => weekStartOf(w.date_iso))');
  });

  it('qualitySessions and longRunObservations are built by filtering ownedWorkouts', () => {
    const qStart = CODE.indexOf('const qualitySessions: GradedSession[] = [];');
    expect(CODE.slice(qStart, qStart + 200)).toContain('ownedWorkouts.filter((x) => x.is_quality');

    const lStart = CODE.indexOf('const longWorkouts =');
    expect(CODE.slice(lStart, lStart + 200)).toContain('ownedWorkouts.filter((x) => x.is_long');
  });

  it('prescription-to-run matching (SUPPLEMENTALGRADE-1) runs over ownedWorkouts', () => {
    expect(CODE).toContain('buildPrescriptionRunMatches(ownedWorkouts, runData)');
    expect(CODE).not.toContain('buildPrescriptionRunMatches(workouts, runData)');
  });

  it('a long run\'s following-session check reads ownedWorkoutsByDate, not the active plan\'s workoutsByDate', () => {
    const start = CODE.indexOf('const nextDayWorkout =');
    const block = CODE.slice(start, start + 200);
    expect(block).toContain('ownedWorkoutsByDate.get(');
  });

  it('isCutback is trusted to say YES across every owning plan for the week, never diluted to NO', () => {
    const start = CODE.indexOf('const isCutback =');
    expect(CODE.slice(start, start + 120)).toContain('pres.some((w) => w.is_cutback === true)');
  });

  it('authoredPlanMode is attributed per-week from the owning plan(s), and UNKNOWN when none owned the week', () => {
    const start = CODE.indexOf('const modesPresent =');
    const block = CODE.slice(start, start + 400);
    expect(block).toContain("modesPresent.size === 0");
    expect(block).toContain("'UNKNOWN'");
    expect(block).toContain("modesPresent.has('RECOVERY')");
    // The old code read `plan!.mode` (the CURRENT plan) uniformly for every
    // historical week — that literal read must be gone from this function.
    expect(CODE).not.toContain('(plan!.mode ?? \'\').toLowerCase() === \'recovery\'');
  });
});

describe('3 · the forward-looking branch is untouched — still current-plan-scoped, on purpose', () => {
  // F038 report §4: "what is the plan asking of me next week" is correctly a
  // CURRENT-plan question. These must keep reading `workouts`/`weeks` (from
  // `readPlanWorkouts(plan.id)` / `readPlanWeeks(plan.id)`), never the owned/
  // reign-stitched arrays this fix introduces for the backward half.
  it('thisWeekWorkouts / nextWeekWorkouts still filter the active plan\'s own workouts', () => {
    expect(CODE).toContain('const thisWeekWorkouts = workouts.filter((w) => weekStartOf(w.date_iso) === currentWeekStart)');
    expect(CODE).toContain('const nextWeekWorkouts = workouts.filter((w) => weekStartOf(w.date_iso) === nextWeekStart)');
  });

  it('futureThresholdSessionIds and the demand substrate still read the active plan\'s own workouts', () => {
    expect(CODE).toMatch(/futureThresholdSessionIds:\s*workouts/);
    expect(CODE).toMatch(/sessions:\s*workouts\.map/);
  });

  it('futureCutbackWeek / futureRaceWeek / nextWeekRow still read the active plan\'s own plan_weeks', () => {
    expect(CODE).toContain('weeks.find((w) => w.week_start_iso === nextWeekStart)');
    expect(CODE).toContain('weeks.find((w) => w.week_start_iso >= currentWeekStart && w.is_cutback)');
    expect(CODE).toContain('weeks.find((w) => w.week_start_iso >= currentWeekStart && w.is_race_week)');
  });

  it('readPlanWorkouts(plan.id) and readPlanWeeks(plan.id) are still called — the forward reads still need them', () => {
    expect(CODE).toContain('readPlanWeeks(plan.id)');
    expect(CODE).toContain('readPlanWorkouts(plan.id)');
  });
});

describe('4 · the lever files this loader feeds are untouched', () => {
  it('weekly-volume.ts and long-run.ts are not modified by this fix (the F038 report confirms both are pure and correct)', () => {
    // A structural guard against scope creep: this loader-only fix should
    // never need to touch either lever file. If a future change to this test
    // file starts asserting against those paths, that is the signal this
    // guard existed to give.
    expect(SRC).not.toMatch(/weekly-volume\.ts|long-run\.ts/);
  });
});

describe('5 · F040 follow-up (2026-09-14) — version_rows aliasing on top of the F038 fix', () => {
  // F038-F040-RECONCILIATION-2026-09-14.md: F038 alone gives every backward
  // date a row to match against (closes F040's defect #2), but a run can be
  // stamped against a DIFFERENT plan version's copy of a day's row than the
  // one `ownedDaysSql()` picks as that date's reign-owner (live-verified,
  // 2026-09-01), so Pass 1a's literal-id match still misses without
  // `version_rows` for Pass 1b (PLAN-VERSION-ALIAS-1) to fall back on.
  it('readOwnedPlanWorkouts also aggregates every plan version\'s row per date into version_rows', () => {
    const fnStart = CODE.indexOf('async function readOwnedPlanWorkouts(');
    const fnBody = CODE.slice(fnStart, fnStart + 1300);
    expect(fnBody).toContain('versions AS (');
    expect(fnBody).toContain("jsonb_agg(jsonb_build_object('id', pw.id, 'type', pw.type)) AS version_rows");
    expect(fnBody).toContain('LEFT JOIN versions ON versions.date_iso = owned.date_iso');
  });

  it('buildPrescriptionRunMatches carries version_rows through onto the DayResolverPrescribedRow it hands classifyDay', () => {
    const start = CODE.indexOf('const prescribedRows: DayResolverPrescribedRow[] = dayWorkouts.map((w) => ({');
    expect(start).toBeGreaterThan(-1);
    const block = CODE.slice(start, start + 500);
    expect(block).toContain('version_rows: w.version_rows ?? null');
  });

  it('a PlanWorkoutRow built from readPlanWorkouts (forward-looking, no aliases possible) still type-checks without version_rows', () => {
    // version_rows is OPTIONAL on PlanWorkoutRow specifically so the
    // forward-looking, current-plan-only `readPlanWorkouts` never needs to
    // supply it — `classifyDay`'s Pass 1b already treats it as absent.
    const start = CODE.indexOf('export interface PlanWorkoutRow {');
    const block = CODE.slice(start, start + 900);
    expect(block).toMatch(/version_rows\?\s*:/);
  });
});
