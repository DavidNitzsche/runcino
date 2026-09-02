/**
 * _layout_contract.test.ts · LAYOUTWEEK-CONTRACT-1 / LAYOUTWEEK-RACEWEEK-1.
 *
 * Brief Phase 2's own instruction: "Preserve behavior first, then fix defects
 * under gates." This is that gate.
 *
 * A behaviour-preserving refactor has exactly one property worth asserting and
 * it is not a property of any one week: the WHOLE corpus must compose the same
 * bytes it composed before. So this walks the archetype matrix, serialises
 * every composed week, and pins the result — a snapshot over thousands of
 * plans rather than a hand-written expectation, because a hand-written one
 * would have been the refactorer's own reading of what the code did, which is
 * the thing under test.
 *
 * ── HOW IT WAS FALSIFIED ────────────────────────────────────────────────────
 *
 * Before landing, `layoutRaceWeek` was given a deliberately wrong body (the
 * shakeout moved a day) and the digest changed, naming the archetype count and
 * the first differing plan. The output is in the handback. A refactor gate
 * that has never been made to move is a hypothesis (Rule 18).
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · A CHANGE THE CORPUS CANNOT REACH. `sim-matrix` archetypes carry no
 *     history (Rule 15's standing gap in this repo), no travel windows, no
 *     mid-block races and no Coaching Thesis, so a refactor that broke only
 *     those paths would pass here. `coaching-structural`, `_combined_stress`
 *     and `_brain_acceptance` reach three of the four.
 *   · WHETHER THE BEHAVIOUR IS RIGHT. It asserts SAMENESS. Every coaching
 *     question about these plans belongs to `_sweep_allusers`,
 *     `_maint_invariants` and the doctrine gate, all of which stay green
 *     across this change and are the reason a digest is enough here.
 *   · A LATER, INTENDED change. The digest is a snapshot: when the composer is
 *     deliberately changed it moves, and the argument for moving it goes in
 *     the commit exactly as it does for `_audit_periodization`'s.
 *
 * ── DIGEST MOVES ────────────────────────────────────────────────────────────
 *
 *   · 2026-09-02 · LADDER-LENGTH-1. `restoreSteps` no longer emits a rung worth
 *     a tenth of a mile, so a returning runner's block spends one fewer week
 *     restoring and one more week climbing. Reaches only the 89 archetypes in
 *     this corpus that carry a history at all — `composed` (8781), `days`
 *     (699860) and `raceWeeks` (3969) are all unchanged, so no plan gained or
 *     lost a day; the contents of some weeks moved.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildSimPlan } from './sim-inputs';
import { matrix, arcStr, simInputsForArc, type Arc } from './sim-matrix';

describe('LAYOUTWEEK-CONTRACT-1 · the decomposition changed nothing', () => {
  it('the whole archetype matrix composes byte-identically', () => {
    const h = createHash('sha256');
    let composed = 0;
    let raceWeeks = 0;
    let days = 0;
    for (const a of matrix()) {
      const built = buildSimPlan(simInputsForArc(a) as never);
      if (!built.ok) continue;
      composed++;
      h.update(arcStr(a as Arc));
      for (const w of built.composed.weeks as unknown as Array<{
        startISO: string; phase: string; weeklyMi: number; isRaceWeek: boolean;
        days: Array<{ dow: number; type: string; distanceMi: number; isQuality?: boolean; isLong?: boolean; subLabel: string | null; notes?: string | null }>;
      }>) {
        if (w.isRaceWeek) raceWeeks++;
        h.update(`|${w.startISO}:${w.phase}:${w.weeklyMi}:${w.isRaceWeek ? 'R' : '-'}`);
        for (const d of w.days) {
          days++;
          h.update(`|${d.dow}:${d.type}:${d.distanceMi}:${d.isQuality ? 'Q' : ''}${d.isLong ? 'L' : ''}:${d.subLabel ?? ''}:${d.notes ?? ''}`);
        }
      }
    }

    // Rule 18 liveness, three ways. A digest over nothing is a clean report
    // about nothing, and the RACE-WEEK count specifically must be non-zero or
    // the branch this commit extracted was never executed.
    expect(composed, 'the corpus composed no plans').toBeGreaterThan(1000);
    expect(days, 'the corpus produced no days').toBeGreaterThan(100_000);
    expect(raceWeeks, 'no race week was composed — layoutRaceWeek was never reached').toBeGreaterThan(1000);

    // eslint-disable-next-line no-console
    console.log(`\n=== LAYOUTWEEK-CONTRACT-1 · ${composed} plans · ${days} days · ${raceWeeks} race weeks ===`);
    expect({ composed, days, raceWeeks, digest: h.digest('hex') })
      .toMatchSnapshot('layout-corpus-digest');
  }, 300_000);
});
