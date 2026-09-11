/**
 * EXECID-SCAN-1 · a surface that answers "did the runner complete this day"
 * calls the ONE resolver, and does not re-derive it from a calendar date.
 *
 * See `execution-identity-exemptions.ts` for the bug class and the four
 * separate defects it produced across 2026-09-03/04. In short: same-date was
 * read as identity in display, then in evidence, then in sealing, then in the
 * undo gate — four fixes, each believing it was the last, because nothing could
 * see a surface that simply did not call `lib/execution/day-resolver.ts`.
 *
 * NESTED-SUBQUERY-1 (2026-09-09) · a FIFTH instance, in three places at once,
 * that this scanner ALSO missed, for a different reason than "no scanner
 * existed yet": `recompute-paces.ts`, `reanchor-plan.ts`'s maintenance arm,
 * and `race-row-refresh.ts` each ran the pre-fix date-EXISTS join as a
 * subquery NESTED inside a larger SELECT that also read real quantity
 * columns (`pw.distance_mi`, …). The scanner's `projectsOnlyDates` ran on the
 * WHOLE literal, so those quantity columns made the whole query look
 * load-shaped even though the nested runs-subquery itself was a pure
 * date-coincidence check. See `lib/audit/execution-identity-scan.ts`'s header
 * for the full incident and the fix (`isRunCompletionBypass`), and
 * `lib/plan/seal.ts`'s `sealedWorkoutIdsForRange` for the three sites' fix.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *   · a file that asks the wrong question through a HELPER rather than inline
 *     SQL — the scanner reads string literals, so a date-only completion test
 *     hidden behind another module's function is invisible here. The behaviour
 *     tests in `lib/plan/_sealing_identity.test.ts` are the other half.
 *   · intent. It cannot tell a mileage query from a completion query; it can
 *     only insist that a runner-scoped day-key read of `runs` is either
 *     obviously load-shaped or argued for. That is why the allowlist exists,
 *     and why every entry has to say which question its file is asking.
 *   · a bypass subquery whose own projection ALSO happens to mention a
 *     quantity-shaped identifier (NESTED-SUBQUERY-1's own fix note) — narrower
 *     than a whole-string scan, on purpose, to avoid re-widening back into the
 *     20-file rubber stamp the fingerprint was built to avoid.
 *   · anything outside lib/ and app/.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  selectsRunDayKey, scopesToOneRunner, projectsOnlyDates,
  extractParenSubqueries, isRunCompletionBypass, scanExecutionIdentity,
} from './execution-identity-scan';
import { EXECUTION_IDENTITY_EXEMPTIONS } from './execution-identity-exemptions';

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['lib', 'app'];

describe('EXECID-SCAN-1 · completion is resolved, never inferred from a date', () => {
  const { findings, counts } = scanExecutionIdentity(ROOT, DIRS);
  const exemptFiles = new Set(EXECUTION_IDENTITY_EXEMPTIONS.map((e) => e.file));

  it('the scanner reads real SQL — a silent zero would prove nothing', () => {
    // Rule 18 · a scanner states how much it read and fails on zero.
    // `check-modelled-mark.sh` reported clean for months while scanning
    // nothing, and that is the worst available outcome because it also
    // reported confidence.
    expect(counts.files, 'the walk read no source files at all').toBeGreaterThan(500);
    expect(counts.literals, 'no string literals were extracted').toBeGreaterThan(500);
    expect(counts.runSql, 'no `FROM runs` SQL anywhere in lib/ or app/ — the extractor is broken')
      .toBeGreaterThan(10);

    // And the predicate itself, falsified in BOTH directions (Rule 18 §1).
    // A gate with two directions must fail on a new violation AND on a
    // fingerprint that has stopped recognising the defect it was written for.
    const sealdate = 'SELECT DISTINCT d::date AS d FROM runs r WHERE r.user_uuid = $1::uuid';
    expect(
      selectsRunDayKey(sealdate) && scopesToOneRunner(sealdate) && projectsOnlyDates(sealdate),
      'the fingerprint no longer matches SEALDATE-1\'s own query shape — this gate would now '
      + 'report clean on the defect it was written for',
    ).toBe(true);
    const loadRead = 'SELECT d::date AS d, SUM(r.distance_mi) FROM runs r WHERE r.user_uuid = $1';
    expect(
      projectsOnlyDates(loadRead),
      'the fingerprint now matches a plain load query — it has gone broad again and its '
      + 'allowlist will become a rubber stamp',
    ).toBe(false);
  });

  it('no surface re-derives completion from a calendar date', () => {
    const unexcused = findings.filter((f) => !exemptFiles.has(f.file));
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  EXECID  ${f.file}\n     ${f.sql}`);
    }
    expect(
      unexcused.length,
      'A query reads a day key out of `runs` for one runner in a file that talks about '
      + 'completion/sealing. Same calendar date is NOT identity — that is the defect '
      + 'WORKOUT-EXECUTION-ID-1, EXECUTION-IDENTITY-1, SEALING-IDENTITY-1, SEALDATE-1 and '
      + 'SEALEDBYPASS-1 each closed in a different place. Route the decision through '
      + '`lib/execution/day-resolver.ts` (or `isDaySealed`/`sealedWorkoutIdsForRange`), or add '
      + 'an argued entry to EXECUTION_IDENTITY_EXEMPTIONS saying which question this file is '
      + 'actually asking.',
    ).toBe(0);
  });

  it('the allowlist is a ratchet — an exemption whose file is now clean must be deleted', () => {
    const flagged = new Set(findings.map((f) => f.file));
    const stale = EXECUTION_IDENTITY_EXEMPTIONS.filter((e) => !flagged.has(e.file));
    expect(
      stale.map((e) => e.file),
      'These files no longer trip the scanner, so their exemptions are stale. '
      + 'Delete them — the list may shrink, never grow.',
    ).toEqual([]);
  });

  it('every exemption carries an argued reason, not a shrug', () => {
    for (const e of EXECUTION_IDENTITY_EXEMPTIONS) {
      expect(e.reason.length, `${e.file} has no argued reason`).toBeGreaterThan(60);
      expect(e.reason, `${e.file}'s reason is a shrug`).not.toMatch(/^(ok|fine|safe|n\/a)\b/i);
    }
  });
});

/**
 * NESTED-SUBQUERY-1 · falsified in both directions on synthetic fixtures that
 * mirror the three real sites' exact shape, per Rule 18: break the old
 * behaviour on purpose and watch it fail, then confirm the fix catches it.
 *
 * These fixtures are deliberately NOT the real files' live SQL (which is
 * fixed as of SEALEDBYPASS-1 and should no longer trip anything) — they are
 * frozen reproductions of the bypass shape, so this test keeps proving the
 * scanner catches the CLASS even after the three known instances are gone.
 */
describe('NESTED-SUBQUERY-1 · a bypass nested inside a quantity-bearing outer query', () => {
  // recompute-paces.ts's exact pre-fix shape: the outer SELECT reads
  // pw.distance_mi (a real quantity), and the nested EXISTS is a pure
  // date-coincidence completion check using the raw jsonb date derivation.
  const RECOMPUTE_SHAPE = `
    SELECT pw.id::text AS id, pw.week_id::text AS week_id, pw.type,
           pw.distance_mi::text AS distance_mi, pw.sub_label,
           pw.date_iso::text AS date_iso, pw.notes, pw.workout_spec,
           EXISTS (
             SELECT 1 FROM runs r
              WHERE r.user_uuid = $2::uuid
                AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
                AND NOT (r.data ? 'mergedIntoId')
           ) AS sealed
      FROM plan_workouts pw
     WHERE pw.plan_id = $1
       AND pw.date_iso::date >= $3::date
     ORDER BY pw.date_iso::date ASC
  `.replace(/\s+/g, ' ');

  // reanchor-plan.ts / race-row-refresh.ts's shape: the runs-subquery is
  // built from `${runDaySql('r')}`/`${runNotMergedSql('r')}` template
  // interpolations, present in extracted source as literal `${...}` text
  // (interpolations are never evaluated by extractStringLiterals) — and the
  // outer query reads pw.pace_target_s_per_mi and pw.distance_mi.
  const REANCHOR_SHAPE = `
    SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
           pw.pace_target_s_per_mi, pw.distance_mi, pw.workout_spec,
           pw.notes, pw.sub_label,
           EXISTS (
             SELECT 1 FROM runs r
              WHERE r.user_uuid = $2::uuid
                AND \${runDaySql('r')}::date = pw.date_iso::date
                AND \${runNotMergedSql('r')}
           ) AS sealed
      FROM plan_workouts pw
     WHERE pw.plan_id = $1 AND pw.type IN ('race', 'race_week_tuneup')
     ORDER BY pw.date_iso::date ASC
  `.replace(/\s+/g, ' ');

  // A negative control: a genuinely load-shaped nested subquery (reads a real
  // quantity in ITS OWN projection, not just the outer query's) must not be
  // flagged — the fix must not regress into the 20-file rubber stamp the
  // original fingerprint was built to avoid.
  const LOAD_SUBQUERY_SHAPE = `
    SELECT pw.id::text AS id, pw.distance_mi,
           (SELECT SUM(r.distance_mi) FROM runs r
             WHERE r.user_uuid = $2::uuid AND r.data->>'date' ::date = pw.date_iso::date) AS trailing_mi
      FROM plan_workouts pw
     WHERE pw.plan_id = $1
  `.replace(/\s+/g, ' ');

  it('FALSIFIED · the OLD whole-string-only predicate misses all three real shapes', () => {
    // This is the exact pre-fix predicate (selectsRunDayKey && scopesToOneRunner
    // && projectsOnlyDates, applied to the WHOLE literal only) — reconstructed
    // here, not imported, so this assertion keeps proving the historical blind
    // spot regardless of what the fixed module later does.
    const oldPredicate = (sql: string): boolean =>
      selectsRunDayKey(sql) && scopesToOneRunner(sql) && projectsOnlyDates(sql);

    expect(oldPredicate(RECOMPUTE_SHAPE),
      'recompute-paces.ts\'s shape should have evaded the pre-fix scanner — if this is now true, '
      + 'the blind spot this test documents no longer reproduces and the historical claim is stale')
      .toBe(false);
    expect(oldPredicate(REANCHOR_SHAPE),
      'reanchor-plan.ts/race-row-refresh.ts\'s shape should have evaded the pre-fix scanner')
      .toBe(false);
  });

  it('FIXED · isRunCompletionBypass catches all three real shapes', () => {
    expect(isRunCompletionBypass(RECOMPUTE_SHAPE)).toBe(true);
    expect(isRunCompletionBypass(REANCHOR_SHAPE)).toBe(true);
  });

  it('the extractor pulls the nested EXISTS content out intact', () => {
    const subs = extractParenSubqueries(RECOMPUTE_SHAPE);
    expect(subs.length).toBeGreaterThan(0);
    const runsSub = subs.find((s) => /from\s+runs/i.test(s));
    expect(runsSub).toBeDefined();
    expect(runsSub?.trim()).toMatch(/^select 1 from runs/i);
    expect(runsSub).not.toMatch(/pw\.distance_mi/);
  });

  it('does not regress into flagging a genuinely load-shaped nested subquery', () => {
    // A negative control on the boundary case adjacent to the real fix: a
    // subquery that projects a real quantity (SUM(r.distance_mi)) in its OWN
    // select list must stay unflagged, or the fix has re-widened the
    // fingerprint back toward the 20-file rubber stamp the original scanner
    // was built to avoid.
    expect(isRunCompletionBypass(LOAD_SUBQUERY_SHAPE)).toBe(false);
  });

  it('a genuinely flat, non-nested bypass is still caught (no regression on the original shape)', () => {
    const flat = 'SELECT DISTINCT d::date AS d FROM runs r WHERE r.user_uuid = $1::uuid';
    expect(isRunCompletionBypass(flat)).toBe(true);
  });
});
