/**
 * lib/runs/_overtime_phase.test.ts · OVERTIME-PHASE-1.
 *
 * ── THE DEFECT THIS GATE EXISTS FOR ─────────────────────────────────────────
 *
 * `runs.data.phases` has carried a fifth phase type — `overtime`, the running
 * that happens after the last prescribed piece — for as long as the watch has
 * written completions. `run-shape.ts`'s `PhaseType` union named only four, so
 * `runPhases` returned `null` for it, `verdict.ts` folded a null type into
 * `'unknown'`, and `app/api/v5/today/route.ts` sent `type: null` on the wire.
 *
 * The phone then read that null as WORK — `TodayAfterV5.sectionPieces` did
 * `p.type.map { $0 == "work" } ?? true` — so the owner's 2026-09-08 tempo drew
 * its 118-second jog home in signal orange, at the same ink weight and the
 * same row height as the 25-minute tempo block it was cooling down from.
 * Rule 11 exactly: an absent value became the most confident claim available.
 *
 * The fixture below is the owner's REAL stored row (`runs.id
 * '-75144899844434'`, user `0645f40c-951d-4ccc-b86e-9979cd26c795`,
 * 2026-09-08), read out of production through `faff_readonly` and pasted
 * verbatim minus the per-second `hrSamples` arrays. It is not invented to fit
 * the code.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT SEE THE PHONE. It asserts the wire says `overtime`; nothing
 *     here proves any Swift view draws it quietly. That half is
 *     `TodayAfterV5`'s own construction and a rendered screenshot.
 *   · IT IS ONE RUN. A different era that spells the type differently — an
 *     older `after`, a future `extra` — would pass every assertion here while
 *     collapsing to `unknown` exactly as `overtime` used to.
 *   · IT SAYS NOTHING ABOUT WHETHER THE SEGMENTATION IS RIGHT. If the watch
 *     mislabels twenty minutes of tempo as overtime, every check below is
 *     confidently green.
 *
 * ── FALSIFIED (Rule 18) ─────────────────────────────────────────────────────
 *
 * Run against the pre-fix tree (`PhaseType` without `'overtime'`,
 * `PHASE_TYPES` without it) every assertion in the first two `it` blocks
 * fails: `runPhases` returns `null`, `gradeStoredPhases` returns `'unknown'`,
 * and the wire expression yields `null`.
 */
import { describe, it, expect } from 'vitest';
import { runPhases, type RunData } from './run-shape';
import { gradeStoredPhases } from '@/lib/execution/verdict';
import { paceShapeFor } from '@/lib/training/execution-semantics';

/** The owner's REAL 2026-09-08 tempo, `runs.data.phases`, verbatim. */
const REAL_0908_PHASES = [
  {
    type: 'warmup', index: 0, label: 'Warm-up', avgHr: 128, maxHr: 147,
    verdict: 'hit', completed: true, paceShape: 'ceiling', avgCadence: 155,
    actualDistanceMi: 1.51, actualPaceSPerMi: 510, targetPaceSPerMi: 502,
    actualDurationSec: 769, timeInToleranceSec: 520, timeOutOfToleranceSec: 205,
  },
  {
    type: 'work', index: 1, label: '3.5 mi tempo', avgHr: 159, maxHr: 166,
    verdict: 'hit', completed: true, paceShape: 'window', avgCadence: 171,
    actualDistanceMi: 3.5, actualPaceSPerMi: 431, targetPaceSPerMi: 430,
    actualDurationSec: 1509, timeInToleranceSec: 740, timeOutOfToleranceSec: 725,
  },
  {
    type: 'cooldown', index: 2, label: 'Cool-down', avgHr: 151, maxHr: 164,
    verdict: 'hit', completed: true, paceShape: 'ceiling', avgCadence: 158,
    actualDistanceMi: 1.2, actualPaceSPerMi: 497, targetPaceSPerMi: 502,
    actualDurationSec: 598, timeInToleranceSec: 425, timeOutOfToleranceSec: 155,
  },
  {
    type: 'overtime', index: 3, label: 'After the session', completed: true,
    actualDistanceMi: 0.24, actualPaceSPerMi: 482, actualDurationSec: 118,
  },
];

describe('OVERTIME-PHASE-1 · a stored overtime phase keeps its own name', () => {
  it('run-shape normalises it as `overtime`, not as an unknown type', () => {
    const out = runPhases({ phases: REAL_0908_PHASES } as unknown as RunData);
    expect(out.map((p) => p.type)).toEqual(['warmup', 'work', 'cooldown', 'overtime']);
    // The three facts the surfaces actually draw off it survive intact.
    expect(out[3].actualDistanceMi).toBe(0.24);
    expect(out[3].actualDurationSec).toBe(118);
    expect(out[3].avgHr).toBeNull();
  });

  it('the grader keeps the name and refuses to grade it', () => {
    const v = gradeStoredPhases(REAL_0908_PHASES, 'threshold');
    const overtime = v.phases[3];
    expect(overtime.type).toBe('overtime');
    // NOT pace-graded, and the absence is the answer (Rule 11) — there was no
    // prescription here to be inside or outside of.
    expect(overtime.shape).toBe('none');
    expect(overtime.verdict).toBe('not_graded');
    expect(overtime.toleranceSec).toBeNull();
    // `paceShapeFor` is the owner of that decision, asserted directly so a
    // future edit to the switch cannot pass by accident.
    expect(paceShapeFor('overtime', 'threshold', { hasTarget: true })).toBe('none');
  });

  it('the today wire sends the word, never a null the phone reads as work', () => {
    const v = gradeStoredPhases(REAL_0908_PHASES, 'threshold');
    // `app/api/v5/today/route.ts`'s own `routePhases` expression, verbatim.
    const wireTypes = v.phases.map((gp) => (gp.type === 'unknown' ? null : gp.type));
    expect(wireTypes).toEqual(['warmup', 'work', 'cooldown', 'overtime']);
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT: no null reaches the phone,
    // because the phone's fallback for a null type is what drew the jog home
    // as work. `null` still means "this era did not record a type" and stays
    // legal on the wire — it is simply not what this run produces.
    expect(wireTypes).not.toContain(null);
  });

  it('naming it does not put it into the work set or move the session grade', () => {
    const v = gradeStoredPhases(REAL_0908_PHASES, 'threshold');
    // One work phase, one verdict. The overtime tail is not a fifth rep, and
    // it is not a second one — it never was, and it still is not.
    expect(v.session.workVerdicts).toEqual(['hit']);
    expect(v.session.verdict).toBe('executed');
    // And it does not dilute the work-scoped averages either — one work
    // phase in, one work phase counted, its own numbers unchanged.
    expect(v.work.count).toBe(1);
    expect(v.work.hrAvg).toBe(159);
    expect(v.work.paceSPerMi).toBe(431);
  });
});
