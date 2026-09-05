/**
 * lib/adaptation/canonical/_safety_stops_the_engine.test.ts · THE OTHER HALF OF
 * `lib/brain/_hard_stop_is_real.test.ts`.
 *
 * That file proves the objective's predicates behave. THIS one proves the
 * canonical engine actually obeys them: that a Safety posture other than NORMAL
 * stops every lever, that the three non-NORMAL postures leave three
 * DISTINGUISHABLE records rather than one, and that none of them is queued for
 * re-offer at a boundary.
 *
 * It lives in this directory rather than beside its twin because
 * `_cannot_mutate.test.ts`'s guard 4 is a ratcheted allowlist on who may import
 * this engine at all, and "a test wanted to" is not a good reason to widen a
 * boundary that exists to keep a proposal engine away from a plan row.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT CANNOT SEE WHETHER SAFETY IS RIGHT. Every case hands the engine a
 *     posture directly. If `resolveSafety` returns NORMAL for an injured
 *     runner, this suite is green. `lib/safety/_safety_precedence.test.ts`
 *     covers the resolution and `lib/safety/_safety_wired_live.test.ts` covers
 *     the wiring; nothing in CI runs those statements against a database.
 *   · IT CANNOT PROVE THE ENGINE EVER PUSHES. Every assertion here is a
 *     refusal, and an engine that refused everything unconditionally would pass
 *     all of them. That is exactly Rule 22's warning, which is why the FIRST
 *     test in the engine section is a liveness probe asserting the same fixture
 *     DOES advance under NORMAL. Without it the rest is vacuous.
 *   · IT CANNOT SEE A FUTURE MUTATING PATH that skips arbitration entirely.
 *     `_zero_mutation_scan.test.ts` and `AUTOMATIC_ADAPTATION_AUTHORITY` are
 *     what stand between such a path and a plan row today.
 *
 * ── FALSIFICATION (Rule 18 §1) ─────────────────────────────────────────────
 *
 * Run against a deliberately broken engine before this file was trusted; the
 * verbatim failures are in the commit message. The break used was narrowing
 * `resolvePriority`'s safety branch back to `ctx.safety === 'HARD_STOP'`, so
 * that a CONSTRAINED or UNREADABLE posture falls through to ordinary
 * arbitration and a PUSH survives an unread safety check.
 */
import { describe, it, expect } from 'vitest';
import type { TrainingSafetyPosture } from '@/lib/safety/training-safety';
import { phaseDeclineFor, resolveArbitrationPriority } from './phase-priority';
import { PHASE_NEUTRAL_ORDER } from './arbitration';
import { evaluateAdaptation } from './evaluate';
import type { CanonicalAdaptationInput } from './input';
import { enqueueDeferrals } from './deferral-queue';
import {
  baseInput,
  baseWeekWithHeadroom,
  threeGoodWeeks,
  twoFasterThresholdSessions,
  twoGoodLongRuns,
} from './_fixtures';

/**
 * A runner whose own evidence WOULD advance every lever, so that a "nothing was
 * applied" assertion means Safety stopped it rather than that the fixture had
 * nothing to propose. Same construction as `_phase_arbitration.test.ts`'s, for
 * the same Rule 22 reason its header gives.
 */
const readyRunner = (o: Partial<CanonicalAdaptationInput> = {}): CanonicalAdaptationInput =>
  baseInput({
    weeks: threeGoodWeeks(),
    longRuns: twoGoodLongRuns(),
    qualitySessions: twoFasterThresholdSessions(),
    athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    ...o,
  });

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE ENGINE OBEYS IT · NOT A PREDICATE NOBODY CALLS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the canonical engine cannot advance under a non-NORMAL posture', () => {
  const stoppedRunner = (safety: TrainingSafetyPosture) => readyRunner({
    phaseContext: { phase: 'QUALITY', limiter: 'THRESHOLD', safety, phaseSource: 'test' },
  });

  it('LIVENESS · the same fixture DOES advance under NORMAL', () => {
    // The probe, and the most important assertion in this file. If the ready
    // runner stopped advancing for an unrelated reason, every "nothing was
    // applied" case below would pass while proving nothing at all. That is
    // Rule 22's warning and Rule 18 §2's liveness requirement in one.
    const ev = evaluateAdaptation(stoppedRunner('NORMAL'));
    const applied = ev.records.filter(
      (r) => r.suppressedBy === null && r.decision === 'PROGRESS');
    expect(
      applied.length,
      'the ready-runner fixture no longer advances anything under NORMAL, so the '
      + 'hard-stop assertions below prove nothing',
    ).toBeGreaterThan(0);
  });

  for (const safety of ['HARD_STOP', 'CONSTRAINED', 'UNREADABLE'] as const) {
    it(`${safety} · nothing is applied and every record names the reason`, () => {
      const ev = evaluateAdaptation(stoppedRunner(safety));
      expect(ev.priority.posture).toBe('STOP');
      expect(ev.records.filter(
        (r) => r.suppressedBy === null && r.decision === 'PROGRESS')).toEqual([]);

      const expected = safety === 'HARD_STOP' ? 'SAFETY_HARD_STOP'
        : safety === 'CONSTRAINED' ? 'SAFETY_CONSTRAINED' : 'SAFETY_UNREADABLE';
      const suppressed = ev.records.filter((r) => r.suppressedBy !== null);
      expect(suppressed.length).toBeGreaterThan(0);
      for (const r of suppressed) {
        expect(r.suppressedBy!.rule).toBe(expected);
        // Rule 11: no invented reconsideration date. Safety lifts when Safety
        // says so, and a failed read is not fixed by a clock advancing.
        expect(r.suppressedBy!.reconsiderAtISO).toBeNull();
      }
    });

    it(`${safety} · the deferral is NOT queued`, () => {
      const ev = evaluateAdaptation(stoppedRunner(safety));
      expect(enqueueDeferrals([], ev.records)).toEqual([]);
    });

    it(`${safety} · a REGRESS is stopped too · this is not a one-way brake`, () => {
      // Symmetry. A non-NORMAL posture is not "do less"; it is "ordinary
      // training logic may not proceed", and proposing a reduction is still
      // this engine changing a plan while Safety has not cleared it.
      const p = resolveArbitrationPriority({
        phase: 'QUALITY', raceDistance: 'MARATHON', limiter: 'NONE', safety,
        stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
      });
      for (const lever of PHASE_NEUTRAL_ORDER) {
        expect(
          phaseDeclineFor({ priority: p, lever, increasesDemand: false, moves: true }),
          `${safety} let a non-demand-increasing ${lever} through`,
        ).not.toBeNull();
      }
    });
  }

  it('the three postures produce three DIFFERENT records · Rule 11', () => {
    const rules = (['HARD_STOP', 'CONSTRAINED', 'UNREADABLE'] as const).map((s) => {
      const ev = evaluateAdaptation(stoppedRunner(s));
      return ev.records.find((r) => r.suppressedBy !== null)!.suppressedBy!.rule;
    });
    expect(new Set(rules).size, `three safety facts collapsed into ${rules.join('/')}`).toBe(3);
  });

  it('and the decline the engine raises is one the OBJECTIVE permits', () => {
    // `arbitration.ts` only applies a decline `phaseDeclineObjection` allows.
    // If SAFETY_UNREADABLE were mis-classified as EVIDENCE_ABSENT, the
    // objective would reject the decline and the push would go through, which
    // is the failure the separate basis exists to prevent. Asserted end to end
    // rather than on the mapping alone.
    const MOVING = new Set(['PROGRESS', 'REGRESS', 'RESTRUCTURE']);
    for (const safety of ['HARD_STOP', 'CONSTRAINED', 'UNREADABLE'] as const) {
      const ev = evaluateAdaptation(stoppedRunner(safety));
      // A record that proposes nothing is not suppressed, and recording it as
      // suppressed would be a lie (arbitration.ts says so in as many words).
      // The property that matters is that nothing which MOVES got through.
      const movedFreely = ev.records.filter(
        (r) => r.suppressedBy === null && MOVING.has(r.decision));
      expect(movedFreely.map((r) => `${r.lever}:${r.decision}`),
        `${safety} let a moving decision through`).toEqual([]);
      // and at least one decline was actually raised, so this is not passing
      // because the fixture proposed nothing at all.
      expect(ev.records.some((r) => r.suppressedBy !== null),
        `${safety} raised no decline · is the fixture still advancing?`).toBe(true);
    }
  });
});
