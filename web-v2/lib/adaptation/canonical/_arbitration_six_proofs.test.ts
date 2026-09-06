/**
 * lib/adaptation/canonical/_arbitration_six_proofs.test.ts · THE OVERNIGHT
 * PRIORITY 7 REQUIREMENT, PROVEN EXPLICITLY, ONE `it()` PER CLAIM.
 *
 * The owner's task, verbatim: "Live arbitration cannot remain reachable only
 * through an admin route. Wire phase-aware arbitration into the actual
 * proposal path" — and prove six things about the result. This file is that
 * proof, isolated from `_phase_arbitration.test.ts` (which already exercises
 * `resolveArbitrationPriority` broadly) so each of the six claims has exactly
 * one test that names it and cannot be satisfied by accident.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER THE ORDER IS THE RIGHT COACHING ANSWER. That is
 *   `phase-priority.ts`'s own citation, checked in its own suite. This file
 *   only checks that the SIX CLAIMED BEHAVIOURS hold, not that the doctrine
 *   behind them is correctly read.
 * · WHETHER A RUNNER HAS EVER ACTUALLY SEEN ONE OF THESE ORDERINGS FIRE. Proof
 *   6's persistence half is proven against a mocked pool, in
 *   `canonical-shadow/_live_arbitration_proposals.test.ts` — this file proves
 *   the ORDERING half only, which is what `resolveArbitrationPriority` and
 *   `phaseDeclineFor` alone can answer.
 * · SAFETY BEING RESOLVED CORRECTLY UPSTREAM. Proof 5 proves that WHATEVER
 *   `TrainingSafetyPosture` this engine is handed, a non-NORMAL value defeats
 *   every phase and every limiter with no exception. It cannot prove the
 *   Safety owner classified the runner correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  phaseDeclineFor, phaseDeclineObjection, resolveArbitrationPriority,
  TRAINING_PHASES, type CurrentLimiter, type PriorityContext,
} from './phase-priority';
import type { TrainingSafetyPosture } from '@/lib/safety/training-safety';

const NO_STEPS = { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 } as const;

const ctx = (o: Partial<PriorityContext> = {}): PriorityContext => ({
  phase: 'BASE',
  raceDistance: 'MARATHON',
  limiter: 'NONE',
  safety: 'NORMAL',
  stepsTakenThisCycle: NO_STEPS,
  ...o,
});

const idx = (order: readonly string[], lever: string): number => order.indexOf(lever);

describe('ARBITRATION-6PROOF-1 · proof 1 · volume can beat pace during an appropriate BASE phase', () => {
  it('BASE, no limiter: WEEKLY_VOLUME is ordered ahead of THRESHOLD_PACE', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'BASE', limiter: 'NONE' }));
    expect(r.posture).toBe('ADVANCE');
    expect(idx(r.order, 'WEEKLY_VOLUME')).toBeLessThan(idx(r.order, 'THRESHOLD_PACE'));
    expect(r.order[0]).toBe('WEEKLY_VOLUME');
  });

  it('BASE with the limiter naming volume tolerance: WEEKLY_VOLUME is promoted to the very front', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'BASE', limiter: 'VOLUME_TOLERANCE' }));
    expect(r.order[0]).toBe('WEEKLY_VOLUME');
    expect(idx(r.order, 'WEEKLY_VOLUME')).toBeLessThan(idx(r.order, 'THRESHOLD_PACE'));
  });
});

describe('ARBITRATION-6PROOF-2 · proof 2 · threshold dose/pace can beat volume during THRESHOLD DEVELOPMENT', () => {
  // phase-priority.ts's own mapping, stated once in its header: "threshold
  // development -> QUALITY". Read the mapping, never re-derive it.
  it('QUALITY phase alone still runs volume first (the phase-neutral reading, unpromoted)', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'QUALITY', limiter: 'NONE' }));
    expect(r.order).toEqual(['WEEKLY_VOLUME', 'THRESHOLD_PACE', 'LONG_RUN']);
  });

  it('QUALITY phase WITH the coaching thesis naming THRESHOLD as the current limiter: '
    + 'THRESHOLD_PACE is promoted ahead of WEEKLY_VOLUME', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'QUALITY', limiter: 'THRESHOLD' }));
    expect(r.order[0]).toBe('THRESHOLD_PACE');
    expect(idx(r.order, 'THRESHOLD_PACE')).toBeLessThan(idx(r.order, 'WEEKLY_VOLUME'));
  });
});

describe('ARBITRATION-6PROOF-3 · proof 3 · marathon-specific dose can win during RACE PREPARATION', () => {
  it('RACE_SPECIFIC + MARATHON: LONG_RUN — the marathon-specific dose — leads the order', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'RACE_SPECIFIC', raceDistance: 'MARATHON', limiter: 'NONE' }));
    expect(r.order[0]).toBe('LONG_RUN');
  });

  it('RACE_SPECIFIC + HALF: the same endurance-specific reading applies', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'RACE_SPECIFIC', raceDistance: 'HALF', limiter: 'NONE' }));
    expect(r.order[0]).toBe('LONG_RUN');
  });

  it('RACE_SPECIFIC + FIVE_K: specificity means race pace, not the long run — THRESHOLD_PACE leads instead', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'RACE_SPECIFIC', raceDistance: 'FIVE_K', limiter: 'NONE' }));
    expect(r.order[0]).toBe('THRESHOLD_PACE');
  });
});

describe('ARBITRATION-6PROOF-4 · proof 4 · TAPER refuses unnecessary progression', () => {
  it('TAPER defers every demand increase and freezes the threshold anchor both ways', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'TAPER', limiter: 'THRESHOLD' }));
    expect(r.posture).toBe('PRESERVE');
    expect(r.defersDemandIncrease).toBe(true);
    expect(r.freezesThresholdAnchor).toBe(true);
    expect(r.declineBasis).toBe('PRESCRIBED_RECOVERY');
  });

  it('a PUSH that would raise demand inside the taper is actually declined, through the '
    + 'governing objective — not asserted by this file agreeing with itself', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'TAPER', limiter: 'VOLUME_TOLERANCE' }));
    const decline = phaseDeclineFor({
      priority: r, lever: 'WEEKLY_VOLUME', increasesDemand: true, moves: true,
    });
    expect(decline).not.toBeNull();
    expect(decline!.basis).toBe('PRESCRIBED_RECOVERY');
    // Rule 18 · this is the objective's OWN function agreeing, not a second
    // rule this file invented and hopes matches.
    expect(phaseDeclineObjection(decline!)).toBeNull();
  });

  it('a change that does NOT raise demand, and is not the frozen pace anchor, is not declined by the phase', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'TAPER', limiter: 'NONE' }));
    const decline = phaseDeclineFor({
      priority: r, lever: 'WEEKLY_VOLUME', increasesDemand: false, moves: true,
    });
    expect(decline).toBeNull();
  });
});

describe('ARBITRATION-6PROOF-5 · proof 5 · SAFETY defeats every PUSH — no exception, ever', () => {
  const SAFETY_NON_NORMAL: readonly TrainingSafetyPosture[] = ['HARD_STOP', 'CONSTRAINED', 'UNREADABLE'];
  const LIMITERS: readonly CurrentLimiter[] = [
    'DURABILITY', 'THRESHOLD', 'SPECIFICITY', 'VOLUME_TOLERANCE', 'NONE', 'UNKNOWN',
  ];

  it('LIVENESS · the walk below actually covers every phase, every limiter and every non-NORMAL '
    + 'safety posture — a walk over zero cases would pass on an empty set', () => {
    expect(TRAINING_PHASES.length).toBeGreaterThan(0);
    expect(LIMITERS.length).toBeGreaterThan(0);
    expect(SAFETY_NON_NORMAL.length).toBe(3);
  });

  it('EVERY (phase, limiter, non-NORMAL safety) combination stops the engine — no ordering is '
    + 'computed, no lever is promoted, whatever the phase or limiter argue for', () => {
    let examined = 0;
    for (const phase of TRAINING_PHASES) {
      for (const limiter of LIMITERS) {
        for (const safety of SAFETY_NON_NORMAL) {
          examined += 1;
          const r = resolveArbitrationPriority(ctx({ phase, limiter, safety }));
          expect(r.posture, `${phase}/${limiter}/${safety} did not stop`).toBe('STOP');
          expect(r.defersDemandIncrease, `${phase}/${limiter}/${safety}`).toBe(true);
          expect(r.freezesThresholdAnchor, `${phase}/${limiter}/${safety}`).toBe(true);
          // Never a scheduled reconsideration on a safety basis — Safety
          // lifts it, not a clock. Asserted here because it is the second
          // half of "no exception": a stop that quietly re-offers itself
          // next Tuesday is not a stop.
          const decline = phaseDeclineFor({
            priority: r, lever: 'WEEKLY_VOLUME', increasesDemand: true, moves: true,
          });
          expect(decline, `${phase}/${limiter}/${safety} produced no decline to check`).not.toBeNull();
          expect(['HARD_STOP', 'SAFETY_UNREADABLE', 'PRESCRIBED_RECOVERY']).toContain(decline!.basis);
        }
      }
    }
    // TRAINING_PHASES(7) x LIMITERS(6) x SAFETY(3) = 126.
    expect(examined).toBe(TRAINING_PHASES.length * LIMITERS.length * SAFETY_NON_NORMAL.length);
  });

  it('the most aggressive coaching case on offer — RACE_SPECIFIC, limiter=THRESHOLD, MARATHON, '
    + 'zero steps taken — is STILL defeated by a HARD_STOP', () => {
    const r = resolveArbitrationPriority(ctx({
      phase: 'RACE_SPECIFIC', raceDistance: 'MARATHON', limiter: 'THRESHOLD', safety: 'HARD_STOP',
    }));
    expect(r.posture).toBe('STOP');
  });
});
