/**
 * APPLY, BUT LET ME UNDO · the wiring, asserted where it can be asserted
 * without a database.
 *
 * Three separate claims, and it is worth being explicit about which is which
 * because two of them are source scans and a source scan proves less than a
 * unit test:
 *
 *   1 · PURE · the sentence a runner reads, composed from a stored delta. Real
 *       assertions on real functions.
 *   2 · SOURCE · the SQL and the statement ORDER inside the undo route.
 *       `training_plans_active_uq` makes the order load-bearing and there is no
 *       Postgres here to catch getting it wrong, so the order is read out of
 *       the file. A scan, and it says so.
 *   3 · SOURCE · that the completed-day gate exists at all and that the two
 *       surfaces agree about the button.
 *
 * The falsifier for the whole feature that this file CANNOT run is "restore a
 * block over a completed day and check nothing moved" — that needs a live
 * schema. What is checked instead is that the gate is in the path, that it
 * refuses rather than proceeding, and that the refusal carries a sentence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { selectCoachDecisions } from '@/lib/coach/decision-cards';
import { ownedDaysSql } from './owned-days';
import { runNotMergedSql } from '@/lib/runs/run-shape';

const WEB = resolve(__dirname, '../..');
const UNDO_SRC = readFileSync(join(WEB, 'app/api/plan/undo/route.ts'), 'utf8');
const GEN_SRC = readFileSync(join(WEB, 'lib/plan/generate.ts'), 'utf8');
const OWNED_SRC = readFileSync(join(WEB, 'lib/plan/owned-days.ts'), 'utf8');

describe('1 · the notice card carries the undo', () => {
  const applied = {
    id: 41,
    kind: 'long_drift',
    status: 'auto_applied',
    message: 'Drift raised this week from 23 to 38 miles, and the long run from 7 to 13.',
    createdAt: '2026-08-25T09:29:32.000Z',
    planId: 'pln_old',
    previousPlanId: 'pln_old',
    newPlanId: 'pln_new',
  };

  it('offers PUT THE OLD BLOCK BACK on an applied rebuild', () => {
    const [d] = selectCoachDecisions({
      planProposals: [applied], todayISO: '2026-08-25',
    });
    expect(d.kind).toBe('notice');
    const undo = d.actions.find((a) => a.role === 'undo');
    expect(undo, 'an applied rebuild with both plan ids must be undoable').toBeTruthy();
    expect(undo!.label).toBe('PUT THE OLD BLOCK BACK');
    expect(undo!.endpoint).toBe('/api/plan/undo');
    expect(undo!.body).toEqual({ id: 41 });
  });

  it('still offers SEE THE CHANGE alongside it', () => {
    const [d] = selectCoachDecisions({ planProposals: [applied], todayISO: '2026-08-25' });
    expect(d.actions.find((a) => a.role === 'link')?.href)
      .toBe('/training/plans/pln_new/diff?from=pln_old');
  });

  it('does NOT offer an undo when the row records no earlier block', () => {
    // No `new_plan_id` means the pairing was never written — the rebuild
    // committed and the audit row after it did not. There is nothing to hand
    // back, and a button that 409s every time is worse than no button.
    const [d] = selectCoachDecisions({
      planProposals: [{ ...applied, newPlanId: null }], todayISO: '2026-08-25',
    });
    expect(d.actions.some((a) => a.role === 'undo')).toBe(false);
  });

  it('never offers an undo on a PENDING proposal', () => {
    // Nothing has been applied, so there is nothing to reverse. The grammar
    // there is ACCEPT / KEEP.
    const [d] = selectCoachDecisions({
      planProposals: [{ ...applied, status: 'pending' }], todayISO: '2026-08-25',
    });
    expect(d.kind).toBe('decision');
    expect(d.actions.map((a) => a.role).sort()).toEqual(['accept', 'keep']);
  });

  it('never interrupts for a no-op rebuild or an already-undone one', () => {
    for (const status of ['no_change', 'undone', 'dismissed', 'expired', 'superseded']) {
      expect(
        selectCoachDecisions({ planProposals: [{ ...applied, status }], todayISO: '2026-08-25' }),
        `status ${status} must not raise a card`,
      ).toEqual([]);
    }
  });
});

describe('2 · the swap order, which a unique index makes load-bearing', () => {
  // migration 142 · training_plans_active_uq is UNIQUE on (user_uuid) WHERE
  // archived_iso IS NULL. Un-archiving the old block BEFORE archiving the new
  // one puts two rows in that index and Postgres refuses halfway through the
  // transaction. The order is not a style preference.
  it('archives the new block before it un-archives the old one', () => {
    const archiveAt = UNDO_SRC.indexOf("archive_reason = 'undone_by_runner'");
    const unarchiveAt = UNDO_SRC.indexOf('SET archived_iso = NULL');
    expect(archiveAt, 'the archive statement must exist').toBeGreaterThan(-1);
    expect(unarchiveAt, 'the un-archive statement must exist').toBeGreaterThan(-1);
    expect(archiveAt, 'archive must precede un-archive').toBeLessThan(unarchiveAt);
  });

  it('does both inside one transaction', () => {
    expect(UNDO_SRC).toMatch(/await client\.query\('BEGIN'\)/);
    expect(UNDO_SRC).toMatch(/await client\.query\('COMMIT'\)/);
    const begin = UNDO_SRC.indexOf("query('BEGIN')");
    const commit = UNDO_SRC.indexOf("query('COMMIT')");
    expect(begin).toBeLessThan(UNDO_SRC.indexOf("archive_reason = 'undone_by_runner'"));
    expect(UNDO_SRC.indexOf('SET archived_iso = NULL')).toBeLessThan(commit);
  });

  it('stamps an honest archive reason of its own', () => {
    // Not 'regenerated', which is what every archive said until today and is
    // the reason the incident could not be attributed to a job.
    expect(UNDO_SRC).toContain("archive_reason = 'undone_by_runner'");
  });

  it('deletes nothing', () => {
    expect(UNDO_SRC).not.toMatch(/DELETE\s+FROM/i);
    expect(UNDO_SRC).not.toMatch(/DROP\s+/i);
  });
});

describe('3 · the completed-day gate', () => {
  it('is in the path before the swap', () => {
    const gateAt = UNDO_SRC.indexOf('conflictingCompletedDays(');
    const swapAt = UNDO_SRC.indexOf("archive_reason = 'undone_by_runner'");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt, 'the gate must run before anything is written').toBeLessThan(swapAt);
  });

  it('refuses with a sentence, not an empty state', () => {
    expect(UNDO_SRC).toContain("error: 'completed_day_conflict'");
    // A refusal is a correct answer. It carries copy the card renders verbatim.
    expect(UNDO_SRC).toMatch(/completed_day_conflict[\s\S]{0,400}message:/);
    expect(UNDO_SRC).toContain('would change what you did');
  });

  it('uses the same "has run" definition Rule 15 seals against', () => {
    // One definition, two callers. If these drift, a day can be immutable to
    // the adapter and invisible to the undo, which is the shape of every
    // silent-loss bug in this codebase. The day key and the merge-loser filter
    // come from run-shape.ts rather than being re-spelled, so the assertion is
    // that the route CALLS them.
    expect(UNDO_SRC).toContain("runDaySql('r')");
    expect(UNDO_SRC).toContain("runNotMergedSql('r')");
    expect(runNotMergedSql('r')).toBe("NOT (r.data ? 'mergedIntoId')");
    // The watch-completion half has no shared helper; seal.ts spells it too.
    expect(UNDO_SRC).toContain("ci.reason = 'watch_completion'");
  });

  it('pins both sides of the shared parameter to their column types', () => {
    // A bare `$1` across a uuid column and a text one made isDaySealed throw
    // for every user and every date until 2026-08-24, and the catch under it
    // answered "not sealed". This query is the same shape.
    expect(UNDO_SRC).toContain('r.user_uuid = $1::uuid');
    expect(UNDO_SRC).toContain("COALESCE(ci.user_uuid::text, ci.user_id::text) = $1::text");
  });

  it('also refuses when the plan has moved on, or the old block has elapsed', () => {
    expect(UNDO_SRC).toContain("error: 'superseded'");
    expect(UNDO_SRC).toContain("error: 'restore_target_elapsed'");
  });
});

describe('4 · the commit gate in generatePlan', () => {
  it('reads the outgoing block BEFORE clearActivePlansFor archives it', () => {
    const snapAt = GEN_SRC.indexOf('priorPrescription = await snapshotActivePrescription');
    const archiveAt = GEN_SRC.indexOf('await clearActivePlansFor(client, userId');
    expect(snapAt).toBeGreaterThan(-1);
    expect(archiveAt).toBeGreaterThan(-1);
    // snapshotActivePrescription filters on archived_iso IS NULL, so one
    // statement later there is no active plan to read. Same reason
    // snapshotSealedDays runs where it does.
    expect(snapAt).toBeLessThan(archiveAt);
  });

  it('refuses a byte-identical rebuild and refuses to re-land an undone one', () => {
    expect(GEN_SRC).toContain("new RebuildRefused('no_change'");
    expect(GEN_SRC).toContain("new RebuildRefused('undone_by_runner'");
  });

  it('reports the refusal as ok with unchanged set, not as a failure', () => {
    // A failure writes a `pending` proposal for a human to retry. A refusal is
    // the engine working correctly and must not queue anything.
    expect(GEN_SRC).toMatch(/if \(boundary instanceof RebuildRefused\)[\s\S]{0,400}ok: true/);
    expect(GEN_SRC).toMatch(/if \(boundary instanceof RebuildRefused\)[\s\S]{0,400}unchanged: true/);
  });

  it('the undone-block check fails OPEN', () => {
    // The opposite posture from hasPendingProposal, deliberately. That guard
    // stands in front of REPLACING a block so it must assume the worst. This
    // one stands in front of REFUSING to, and a read error that silently froze
    // a runner's plan against every future rebuild would be far quieter and
    // far worse than one that lets a rebuild through.
    expect(GEN_SRC).toMatch(/undone-block check[\s\S]{0,200}rows: \[\{ n: '0' \}\]/);
  });
});

describe('5 · owned-days prefers the active plan, so an undo cannot split the brain', () => {
  it('an active plan (reign extends to now()) outranks a reverted, archived one for a shared date', () => {
    // Without this, un-archiving would leave the week strip (which filters
    // archived_iso IS NULL) showing the restored block while execution
    // scoring, the adapter and the goal projection — all of which read through
    // ownedDaysSql — kept grading the runner against the block he had just
    // rejected. Two surfaces, two answers, no error.
    //
    // 2026-09-01: the tiebreak is now reign-containment first (see
    // `_owned_days_reign.test.ts` for the full three-tier fixture), but the
    // active-plan-wins property this describes still has to hold, because it
    // falls out of the SAME clause: an active plan's reign runs to `now()`,
    // which sorts above any past `archived_iso` on the very archived plan it
    // was undone from. Assert the fallback clauses are still present as the
    // documented last resort, in the documented order.
    expect(OWNED_SRC).toContain("CASE WHEN ${REIGN_CONTAINS_DATE} THEN COALESCE(tp.archived_iso, now()) END DESC NULLS LAST");
    const emitted = ownedDaysSql();
    const orderByAt = emitted.indexOf('ORDER BY');
    expect(orderByAt).toBeGreaterThan(-1);
    const orderByClause = emitted.slice(orderByAt);
    // Within the ORDER BY (not the header prose above it), the
    // reign-containment/latest-archived_iso tiebreak precedes the
    // pre-2026-09-01 fallback clauses.
    expect(orderByClause.indexOf('COALESCE(tp.archived_iso, now()) END DESC'))
      .toBeLessThan(orderByClause.indexOf('(tp.archived_iso IS NULL) DESC,'));
  });

  it('still does not FILTER on archived_iso', () => {
    // The day after a goal race the live plan is a fresh recovery block with no
    // history in it. Scoping to the active plan would make four months of
    // training read as nothing, on the morning the runner most wants to see it.
    // Read off the emitted SQL rather than the file, so a comment that
    // discusses the filter cannot be mistaken for one.
    const emitted = ownedDaysSql();
    expect(emitted).toContain('archived_iso IS NULL) DESC');   // the fallback tiebreak
    // Scope to the WHERE clause itself, not everything after the WHERE
    // keyword — the reign predicate legitimately says `archived_iso IS NULL`
    // inside the ORDER BY (an open-ended reign, not a filter), so a regex
    // that just scans forward from WHERE would trip on that and false-flag.
    const whereAt = emitted.indexOf('WHERE');
    const orderByAt = emitted.indexOf('ORDER BY');
    const whereClause = emitted.slice(whereAt, orderByAt);
    expect(whereClause).not.toMatch(/archived_iso/);
    expect(emitted.indexOf('archived_iso')).toBeGreaterThan(emitted.indexOf('ORDER BY'));
  });
});
