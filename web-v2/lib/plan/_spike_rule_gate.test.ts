/**
 * _spike_rule_gate.test.ts · SPIKEROLL-1 (2026-08-31) · the standing gate the
 * hand-back named as still owed: "The standing assertion across the whole
 * block, as a gate (Rule 18), with the 110% figure parsed out of
 * `Research/00a` at run time (Rule 7) rather than hardcoded."
 *
 * `enforceSpikeRule` in `lib/plan/generate.ts` is a non-exported closure
 * inside `finalizeComposedPlan`, so this gate does not call it directly — per
 * Rule 18 ("reading the source proves the code is WRITTEN; running it proves
 * the code ACTS"), it walks the REAL, FINAL output of the real pipeline
 * (`buildSimPlan`, the same corpus `_sweep_allusers.test.ts` and
 * `_dosing_sweep_gate.test.ts` already sweep) and asserts the invariant holds
 * on what actually shipped, not on what the source claims to do.
 *
 * Two things this gate proves, and states explicitly so a future reader does
 * not have to infer them (Rule 22 — say what a gate CANNOT fail on):
 *
 *  1. LIVE: at least one archetype in the corpus reaches an anchor at or
 *     above `SPIKE_MIN_COHERENT_ANCHOR_MI` and the guard actually binds
 *     there (a week whose long sits AT the ceiling, not comfortably under
 *     it) — so this gate cannot pass by the guard being silently inert.
 *  2. NO BREACH: across the whole corpus, no non-TAPER week's long exceeds
 *     110% of the rolling 30-day anchor, except where the anchor itself sits
 *     below the stated coherence floor (`SPIKE_MIN_COHERENT_ANCHOR_MI`) — the
 *     one population this pass is argued (not silently) exempt for.
 *
 * What this gate CANNOT catch: a TAPER-week breach. TAPER weeks are exempt
 * from the ceiling by design (see `enforceSpikeRule`'s own comment in
 * generate.ts for why — COH-4's restore-up pass cannot be undermined without
 * it), so this walk does not grade them against the 110% figure at all. That
 * is a scoped, argued exemption, not a gap this gate is pretending to cover.
 */
import { describe, it, expect } from 'vitest';
import { matrix, isUltra, arcStr, simInputsForArc, type Arc } from './sim-matrix';
import { buildSimPlan } from './sim-inputs';
import { SPIKE_MAX_SHARE, SPIKE_MIN_COHERENT_ANCHOR_MI, SPIKE_WINDOW_DAYS } from './generate';
import { resolveCitation, parseBand } from '@/lib/doctrine/resolve';

describe('SPIKEROLL-1 · the 110% single-session spike rule holds across the corpus', () => {
  it('the 110% figure is read out of Research/00a at run time, not hardcoded', () => {
    // Rule 7: parse the doctrine number from the doc itself rather than
    // asserting the engine agrees with a second hardcoded copy of itself.
    const cite = resolveCitation(
      'Research/00a-distance-running-training.md',
      '### Practical load rules',
    );
    const spec = cite.table().cell('Long-run cap rule', 'Specification');
    expect(spec, 'the long-run cap row no longer states a percentage').toMatch(/110%/);
    const [lo] = parseBand(spec);
    expect(lo, 'Research/00a no longer states the cap at 110%').toBe(110);
    // The doctrine sentence states the multiple ITSELF ("should not exceed
    // 110% of..."), not a growth delta on top of 100% (unlike, e.g., a "5-15%
    // per cycle" row elsewhere, where the ceiling is `1 + pct/100`) — so the
    // share is the parsed number divided by 100 directly, with no added 1.
    expect(SPIKE_MAX_SHARE, 'SPIKE_MAX_SHARE has drifted from the cited 110%').toBeCloseTo(lo / 100, 9);
  });

  it('every archetype: no non-taper long exceeds 110% of its rolling 30-day anchor, except below the coherence floor', () => {
    const weeksInWindow = Math.floor(SPIKE_WINDOW_DAYS / 7);
    let archetypesChecked = 0;
    let weeksAtOrAboveFloor = 0;
    let weeksBound = 0; // the ceiling was the reason the value is what it is
    const breaches: string[] = [];

    for (const a of matrix()) {
      if (isUltra(a.distance) && a.goalMode !== 'justRun') continue;
      const built = buildSimPlan(simInputsForArc(a) as any);
      if (!built.ok) continue;
      archetypesChecked++;

      const longestByWeek: number[] = [];
      for (const week of built.composed.weeks as any[]) {
        const day = week.days.find((d: any) => d.isLong && d.type !== 'race' && d.distanceMi > 0);
        const anchor = Math.max(0, ...longestByWeek.slice(-weeksInWindow));
        if (day && week.phase !== 'TAPER' && anchor > 0) {
          if (anchor >= SPIKE_MIN_COHERENT_ANCHOR_MI) {
            weeksAtOrAboveFloor++;
            const ceil = Math.floor(anchor * SPIKE_MAX_SHARE * 2) / 2;
            if (day.distanceMi > ceil + 1e-6) {
              breaches.push(
                `${arcStr(a)} · ${week.startISO} · long ${day.distanceMi}mi > ceil ${ceil}mi ` +
                `(anchor ${anchor}mi)`,
              );
            } else if (day.distanceMi > ceil - 0.5 + 1e-6) {
              // Within one grid step of the ceiling — the guard is doing
              // real work here, not merely never being tested against.
              weeksBound++;
            }
          }
        }
        longestByWeek.push(Math.max(0, ...week.days.map((d: any) => d.distanceMi)));
      }
    }

    console.log(
      `SPIKE gate · ${archetypesChecked} archetypes, ${weeksAtOrAboveFloor} non-taper weeks ` +
      `graded at or above the ${SPIKE_MIN_COHERENT_ANCHOR_MI}mi floor, ${weeksBound} bound at the ceiling`,
    );

    // Rule 20 / Rule 18 §2 · LIVENESS. If nothing in the corpus ever reaches
    // a graded anchor, this gate would pass vacuously and the "NO BREACH"
    // assertion below would mean nothing.
    expect(weeksAtOrAboveFloor, 'no archetype in the corpus ever reached a graded (>=floor) anchor — this gate cannot see the mechanism it exists to check').toBeGreaterThan(0);
    expect(weeksBound, 'the ceiling was never the binding constraint anywhere in the corpus — the guard may be inert (Rule 20)').toBeGreaterThan(0);

    expect(breaches, `${breaches.length} week(s) exceeded 110% of their rolling 30-day anchor:\n  ${breaches.join('\n  ')}`).toEqual([]);
  }, 30_000);

  it('falsifies the coherence-floor boundary (Rule 18 / Rule 9): 4.9mi anchor exempt, 5.1mi anchor bound', () => {
    // Direct arithmetic against the exported constants, not a corpus search —
    // the sim corpus does not let a caller dial an exact anchor, and the
    // boundary is a pure threshold comparison, so this tests it directly the
    // same way `CONVENTION.spike-rule-coherence-floor`'s own check does.
    const ceilFor = (anchor: number) =>
      anchor >= SPIKE_MIN_COHERENT_ANCHOR_MI ? Math.floor(anchor * SPIKE_MAX_SHARE * 2) / 2 : null;

    // Just under the floor: the ceiling does not apply at all (null, not a
    // very-loose number) — `enforceSpikeRule` leaves the week exactly as
    // every earlier pass left it.
    expect(ceilFor(4.9), 'a 4.9mi anchor is not exempt — the coherence floor moved').toBeNull();

    // Just over: the ceiling applies, at 110% rounded down to the half-mile
    // grid — a real, if modest, constraint (5.1 * 1.10 = 5.61 -> 5.5).
    expect(ceilFor(5.1), 'a 5.1mi anchor is exempt — the coherence floor moved').toBe(5.5);

    // Rule 9 · the cliff at the edge itself is bounded, not unbounded. Below
    // the floor the week is governed by whatever `layoutWeek`'s own
    // (authoring-time) `rampCeiling` already allowed — this pass simply adds
    // no further constraint there — so the discontinuity at 5.0mi is "this
    // guard's own ceiling activates", not "the runner goes from bounded to
    // unbounded". Documented here rather than smoothed: this is the discrete-
    // population case Rule 9 explicitly allows ("a behaviour may be discrete
    // ... but the DECISION must not hinge on a hair" — the decision here is
    // "does the FINISHING-PASS ceiling apply", a binary the exemption states
    // plainly, not a continuous quantity being chopped at an arbitrary point).
    const justBelow = ceilFor(SPIKE_MIN_COHERENT_ANCHOR_MI - 0.01);
    const justAbove = ceilFor(SPIKE_MIN_COHERENT_ANCHOR_MI + 0.01);
    expect(justBelow).toBeNull();
    expect(justAbove).not.toBeNull();
    // The jump in what the ceiling WOULD allow, right at the edge, is at most
    // one half-mile grid step — not an unbounded gap — because the floor is
    // defined (see the CONVENTION claim) as the smallest anchor whose own
    // 10% is already a full grid step.
    expect((justAbove as number) - SPIKE_MIN_COHERENT_ANCHOR_MI).toBeLessThanOrEqual(0.5);
  });
});
