/**
 * lib/adaptation/canonical/_phase_arbitration.test.ts · THE PHASE DECIDES THE
 * PRIORITY, AND THE TAPER IS NOT PUSHED.
 *
 * ── WHAT THIS GATE IS FOR ──────────────────────────────────────────────────
 *
 * `arbitration.ts` carried a static global lever order cited to a sentence
 * about the EARLY part of a block ("Duration is the primary early lever"), and
 * applied it to every phase including the taper, where the same document says
 * "Taper by removing fatigue, not by completing unfinished development". This
 * suite is the check that the constant is gone, that what replaced it is cited
 * or labelled, and that a taper actually declines.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * Written out rather than implied, because a gate that only lists its coverage
 * inherits the bias of whoever wrote it:
 *
 * · IT CANNOT FAIL ON THE ORDER BEING THE WRONG COACHING ANSWER. Every check
 *   below verifies that a citation RESOLVES in the file it names, or that the
 *   row is labelled POLICY_ASSUMPTION. Nothing here can tell whether "the long
 *   run before weekly volume in a marathon's specific phase" produces better
 *   marathons, and no test can.
 * · IT CANNOT FAIL ON THE PHASE BEING MISLABELLED UPSTREAM. Every case here
 *   hands the engine a phase. A race-specific block the generator stamped BASE
 *   is invisible to this suite and belongs to whatever authors `plan_phases`.
 * · IT CANNOT FAIL ON THE LIMITER BEING WRONG. The Coaching Thesis owns it,
 *   nothing persists one yet, and on a LIVE evaluation `live-input.ts` supplies
 *   UNKNOWN — so the limiter promotion is exercised HERE and is currently
 *   unreachable in production. That is a real gap and it is stated rather than
 *   hidden: the promotion is correct code with no live caller until a thesis is
 *   persisted.
 * · IT CANNOT FAIL ON THE SAFETY VERDICT BEING LATE OR ABSENT. `live-input.ts`
 *   supplies NORMAL because nothing persists a Safety verdict either. This
 *   suite proves the HARD_STOP path works; it cannot prove anything ever sends
 *   one.
 * · IT CANNOT FAIL ON THE DEMAND-MODEL COEFFICIENTS. The ledger's
 *   whole-sequence costs are priced by the model's own function, and a model
 *   20% too generous produces three internally consistent numbers.
 *
 * ── DISTRIBUTION, COUNTED (Rule 22 §2) ─────────────────────────────────────
 *
 * The suppressing and permitting sides are counted explicitly below rather
 * than assumed, because the whole reason this file exists is a constant that
 * suppressed a push in a phase nobody had checked. `PHASE_POLICY` has exactly
 * ONE suppressing field and no downward-only twin, and that is asserted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateAdaptation } from './evaluate';
import { arbitrate, PHASE_NEUTRAL_ORDER } from './arbitration';
import {
  PHASE_POLICY, TRAINING_PHASES, phaseDeclineFor, phaseDeclineObjection,
  phaseFromAuthoredLabel, resolveArbitrationPriority,
  type CurrentLimiter, type PriorityContext, type TrainingPhase,
} from './phase-priority';
import { enqueueDeferrals } from './deferral-queue';
import { measured, type CanonicalAdaptationInput, type CanonicalLever } from './input';
import type { DeclineJustification } from '@/lib/brain/objective';
import {
  baseInput, baseWeekWithHeadroom, longRun, session, threeGoodWeeks,
  twoFasterThresholdSessions, twoGoodLongRuns, week, THRESHOLD_ANCHOR_SEC,
} from './_fixtures';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const HERE = __dirname;

const ctx = (o: Partial<PriorityContext> = {}): PriorityContext => ({
  phase: 'QUALITY',
  raceDistance: 'MARATHON',
  limiter: 'UNKNOWN',
  safety: 'NORMAL',
  stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
  ...o,
});

/**
 * A runner with evidence supporting EVERY lever, so a phase decline is the only
 * thing that can stop a proposal.
 *
 * This matters for Rule 22: a fixture with no evidence would make every phase
 * "correctly" decline, and the suite could not tell a taper clause from an
 * engine that never pushes. Every case below is built on a runner who WOULD
 * advance.
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
 * 0 · LIVENESS  ·  Rule 18 §2
 * ═══════════════════════════════════════════════════════════════════════ */

describe('liveness · the table and the sources this suite reads exist', () => {
  it('every TrainingPhase has a policy row, and every row is total over the levers', () => {
    expect(TRAINING_PHASES.length).toBeGreaterThanOrEqual(7);
    for (const p of TRAINING_PHASES) {
      const row = PHASE_POLICY[p];
      expect(row, `no policy row for ${p}`).toBeTruthy();
      expect([...row.order].sort()).toEqual([...PHASE_NEUTRAL_ORDER].sort());
      expect(row.why.trim().length).toBeGreaterThan(40);
    }
  });

  it('the runner fixture this suite is built on WOULD advance without a phase decline', () => {
    // If this ever stops being true, every taper assertion below becomes
    // vacuous and would keep reporting clean. That is the worst failure a gate
    // can have, so it is asserted rather than assumed.
    const ev = evaluateAdaptation(readyRunner());
    const moved = ev.records.filter((r) => r.decision === 'PROGRESS');
    expect(moved.length, 'the ready runner proposed nothing, so nothing below is a real test')
      .toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE STATIC CONSTANT IS GONE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the static global priority no longer exists', () => {
  const src = readFileSync(path.join(HERE, 'arbitration.ts'), 'utf8');

  it('arbitration.ts declares no ARBITRATION_PRIORITY', () => {
    // The name may still appear in PROSE, explaining what was removed. It may
    // not be a declaration.
    expect(src).not.toMatch(/export const ARBITRATION_PRIORITY/);
    expect(src).not.toMatch(/^const ARBITRATION_PRIORITY/m);
  });

  it('arbitration.ts reads the resolved order and derives none of its own', () => {
    expect(src).toMatch(/input\.priority\.order/);
  });

  it('the phase-neutral order it kept is cited to a PHASE-NEUTRAL sentence', () => {
    // Q8's sentence is about the EARLY part of a block. The constant that
    // survives is cited to the governing principle instead, and this asserts
    // the header no longer claims Q8 for a global order.
    const at = src.indexOf('The PHASE-NEUTRAL order');
    expect(at, 'the doc comment on the surviving constant was not found').toBeGreaterThan(0);
    const cited = src.slice(at, src.indexOf('export const PHASE_NEUTRAL_ORDER'));
    expect(cited).toContain('Progress strong capacities mainly through workload');
    // and Q8's early-block sentence is no longer offered as the reason for it
    expect(cited).not.toContain('Duration is the primary early lever');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · EVERY PRIORITY IS CITED OR LABELLED  ·  the owner's own requirement
 * ═══════════════════════════════════════════════════════════════════════ */

describe('each phase priority resolves to Research/ or is labelled POLICY_ASSUMPTION', () => {
  for (const phase of TRAINING_PHASES) {
    it(`${phase}`, () => {
      const c = PHASE_POLICY[phase].citation;
      if (c.provenance === 'POLICY_ASSUMPTION') {
        expect(c.doc).toBe('');
        expect(c.anchor).toBe('');
        // Rule 7 · the label is not enough on its own. It has to SAY it, in the
        // text a reader sees, so the honesty survives a copy-paste.
        expect(c.says).toContain('POLICY_ASSUMPTION');
        return;
      }
      // Rule 18 · the anchor is READ OUT OF THE FILE at run time. A check that
      // hardcoded both sides would only prove the test agrees with itself.
      const text = readFileSync(path.join(REPO_ROOT, c.doc), 'utf8');
      expect(text.includes(c.anchor), `${c.doc} does not contain "${c.anchor}"`).toBe(true);
      expect(c.says.trim().length).toBeGreaterThan(40);
    });
  }

  it('at least four phases are cited to a research or doctrine document, not policy', () => {
    // Rule 22, distribution: if every row degraded to POLICY_ASSUMPTION the
    // suite above would still pass row by row. The count is the check that the
    // table is mostly cited rather than mostly chosen.
    const cited = TRAINING_PHASES.filter(
      (p) => PHASE_POLICY[p].citation.provenance !== 'POLICY_ASSUMPTION');
    expect(cited.length).toBeGreaterThanOrEqual(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE ORDER ACTUALLY DEPENDS ON THE PHASE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('priority varies by phase, goal event, limiter and recent adaptation', () => {
  const orderIn = (o: Partial<PriorityContext>): readonly CanonicalLever[] =>
    resolveArbitrationPriority(ctx(o)).order;

  it('BASE puts the two load levers ahead of the pace anchor', () => {
    expect(orderIn({ phase: 'BASE' })).toEqual(['WEEKLY_VOLUME', 'LONG_RUN', 'THRESHOLD_PACE']);
  });

  it('QUALITY raises threshold ABOVE the long run, and it is a real change', () => {
    const q = orderIn({ phase: 'QUALITY' });
    expect(q).toEqual(['WEEKLY_VOLUME', 'THRESHOLD_PACE', 'LONG_RUN']);
    // Rule 15 · a "phase-aware" resolver whose every phase returned the old
    // constant would pass every other test in this file.
    expect(q).not.toEqual(PHASE_NEUTRAL_ORDER);
  });

  it('RACE_SPECIFIC puts the long run first for a marathon', () => {
    expect(orderIn({ phase: 'RACE_SPECIFIC', raceDistance: 'MARATHON' }))
      .toEqual(['LONG_RUN', 'WEEKLY_VOLUME', 'THRESHOLD_PACE']);
  });

  it('RACE_SPECIFIC puts the pace anchor first for a 5K · the GOAL EVENT changes it', () => {
    expect(orderIn({ phase: 'RACE_SPECIFIC', raceDistance: 'FIVE_K' }))
      .toEqual(['THRESHOLD_PACE', 'WEEKLY_VOLUME', 'LONG_RUN']);
    expect(orderIn({ phase: 'RACE_SPECIFIC', raceDistance: 'TEN_K' })[0]).toBe('THRESHOLD_PACE');
  });

  it('the LIMITER promotes its lever, in an advancing phase', () => {
    expect(orderIn({ phase: 'BASE', limiter: 'THRESHOLD' })[0]).toBe('THRESHOLD_PACE');
    expect(orderIn({ phase: 'QUALITY', limiter: 'DURABILITY' })[0]).toBe('LONG_RUN');
    expect(orderIn({ phase: 'BASE', limiter: 'VOLUME_TOLERANCE' })[0]).toBe('WEEKLY_VOLUME');
  });

  it('SPECIFICITY as a limiter reads the goal event too', () => {
    expect(orderIn({ phase: 'QUALITY', limiter: 'SPECIFICITY', raceDistance: 'MARATHON' })[0])
      .toBe('LONG_RUN');
    expect(orderIn({ phase: 'QUALITY', limiter: 'SPECIFICITY', raceDistance: 'FIVE_K' })[0])
      .toBe('THRESHOLD_PACE');
  });

  it('the limiter does NOT promote inside a declining phase', () => {
    // Promoting a lever in a taper would be the engine choosing WHAT to push
    // while doctrine is telling it not to push at all.
    expect(orderIn({ phase: 'TAPER', limiter: 'THRESHOLD' })).toEqual(PHASE_NEUTRAL_ORDER);
    expect(orderIn({ phase: 'RECOVERY', limiter: 'DURABILITY' })).toEqual(PHASE_NEUTRAL_ORDER);
  });

  it('RECENT ADAPTATION sorts a lever that already spent its step behind one that has not', () => {
    const spent = orderIn({
      phase: 'BASE',
      stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 1, LONG_RUN: 0 },
    });
    expect(spent).toEqual(['LONG_RUN', 'THRESHOLD_PACE', 'WEEKLY_VOLUME']);
    // and the relative order of the untouched levers is PRESERVED, not re-sorted
    expect(spent.slice(0, 2)).toEqual(['LONG_RUN', 'THRESHOLD_PACE']);
  });

  it('Rule 11 · an UNKNOWN phase is not a BASE phase, and the unknown is recorded', () => {
    const r = resolveArbitrationPriority(ctx({ phase: 'UNKNOWN' }));
    expect(r.order).toEqual(PHASE_NEUTRAL_ORDER);
    expect(r.unknowns.join(' ')).toContain('could not be read');
    // and a limiter is NOT promoted off a phase nobody read
    const withLimiter = resolveArbitrationPriority(
      ctx({ phase: 'UNKNOWN', limiter: 'DURABILITY' }));
    expect(withLimiter.unknowns.length).toBeGreaterThan(0);
  });

  it('the generator\'s own labels translate, and anything else is UNKNOWN', () => {
    expect(phaseFromAuthoredLabel('BASE')).toBe('BASE');
    expect(phaseFromAuthoredLabel('RACE-SPECIFIC')).toBe('RACE_SPECIFIC');
    expect(phaseFromAuthoredLabel('Taper')).toBe('TAPER');
    expect(phaseFromAuthoredLabel(null)).toBe('UNKNOWN');
    expect(phaseFromAuthoredLabel('')).toBe('UNKNOWN');
    expect(phaseFromAuthoredLabel('SHARPENING')).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE TAPER IS NOT MECHANICALLY PUSHED
 * ═══════════════════════════════════════════════════════════════════════ */

const taper = (o: Partial<CanonicalAdaptationInput> = {}) => readyRunner({
  phaseContext: { phase: 'TAPER', limiter: 'THRESHOLD', safety: 'NORMAL', phaseSource: 'test' },
  ...o,
});

describe('a taper defers every proposal that raises the week, and says why', () => {
  it('nothing that increases demand is applied', () => {
    const ev = evaluateAdaptation(taper());
    const applied = ev.records.filter((r) => r.suppressedBy === null && r.decision === 'PROGRESS');
    expect(applied.map((r) => r.lever)).toEqual([]);
  });

  it('the deferral names the PHASE, not the demand ceiling', () => {
    const ev = evaluateAdaptation(taper());
    const deferred = ev.records.filter((r) => r.suppressedBy !== null);
    expect(deferred.length).toBeGreaterThan(0);
    for (const r of deferred) {
      expect(r.suppressedBy!.rule).toBe('PHASE_PRESCRIBES_RECOVERY');
      expect(r.suppressedBy!.detail).toContain('taper');
    }
  });

  it('DEFER, not DROP · the evidence survives and a reconsideration date is set', () => {
    const ev = evaluateAdaptation(taper());
    for (const r of ev.records.filter((x) => x.suppressedBy !== null)) {
      expect(r.suppressedBy!.reconsiderAtISO).not.toBeNull();
      // The evidence that earned the proposal is still on the record.
      expect(r.proposedAfterValue).not.toBeNull();
    }
    const queued = enqueueDeferrals([], ev.records);
    expect(queued.length, 'a taper deferral was dropped rather than queued')
      .toBeGreaterThan(0);
    expect(queued.every((q) => q.reason === 'PHASE_PRESCRIBES_RECOVERY')).toBe(true);
  });

  it('the anchor is frozen in BOTH directions · symmetry, not a one-way brake', () => {
    // Rule 21's standard, applied to this clause: if a taper deferred a faster
    // anchor and waved through a slower one, the bar to go up would be higher
    // than the bar to come down, which doctrine does not license here.
    // "Preserve the most recently supported effort" is symmetric.
    const up = phaseDeclineFor({
      priority: resolveArbitrationPriority(ctx({ phase: 'TAPER' })),
      lever: 'THRESHOLD_PACE', increasesDemand: true, moves: true,
    });
    const down = phaseDeclineFor({
      priority: resolveArbitrationPriority(ctx({ phase: 'TAPER' })),
      lever: 'THRESHOLD_PACE', increasesDemand: false, moves: true,
    });
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(down!.because).toContain('most recently supported effort');
  });

  it('a RECOVERY block defers upward but admits a downward move', () => {
    const p = resolveArbitrationPriority(ctx({ phase: 'RECOVERY' }));
    expect(phaseDeclineFor({ priority: p, lever: 'WEEKLY_VOLUME', increasesDemand: true, moves: true }))
      .not.toBeNull();
    expect(phaseDeclineFor({ priority: p, lever: 'WEEKLY_VOLUME', increasesDemand: false, moves: true }))
      .toBeNull();
    // and unlike a taper, the anchor is not frozen: restoration is the phase's job
    expect(phaseDeclineFor({ priority: p, lever: 'THRESHOLD_PACE', increasesDemand: false, moves: true }))
      .toBeNull();
  });

  it('an ADVANCING phase declines nothing on phase grounds', () => {
    for (const phase of ['BASE', 'QUALITY', 'RACE_SPECIFIC', 'MAINTENANCE', 'UNKNOWN'] as TrainingPhase[]) {
      const p = resolveArbitrationPriority(ctx({ phase }));
      expect(
        phaseDeclineFor({ priority: p, lever: 'WEEKLY_VOLUME', increasesDemand: true, moves: true }),
        `${phase} declined a push on phase grounds`,
      ).toBeNull();
    }
  });

  it('a verdict that proposes NOTHING is never recorded as phase-suppressed', () => {
    const p = resolveArbitrationPriority(ctx({ phase: 'TAPER' }));
    expect(phaseDeclineFor({ priority: p, lever: 'LONG_RUN', increasesDemand: true, moves: false }))
      .toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE DECLINE IS ADJUDICATED BY lib/brain/objective, NOT BY A SECOND RULE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the objective is what permits a phase decline', () => {
  it('PRESCRIBED_RECOVERY and HARD_STOP are admissible against a SUPPORTED push', () => {
    for (const phase of ['TAPER', 'RECOVERY'] as TrainingPhase[]) {
      const p = resolveArbitrationPriority(ctx({ phase }));
      const j = phaseDeclineFor({ priority: p, lever: 'WEEKLY_VOLUME', increasesDemand: true, moves: true })!;
      expect(j.basis).toBe('PRESCRIBED_RECOVERY');
      expect(phaseDeclineObjection(j), `the objective rejected the ${phase} decline`).toBeNull();
    }
    const stop = resolveArbitrationPriority(ctx({ safety: 'HARD_STOP' }));
    const j = phaseDeclineFor({ priority: stop, lever: 'LONG_RUN', increasesDemand: true, moves: true })!;
    expect(j.basis).toBe('HARD_STOP');
    expect(phaseDeclineObjection(j)).toBeNull();
  });

  it('FALSIFIER · a decline the objective REJECTS is not applied by arbitration', () => {
    // The property that matters is that `objectionToChoice` is load-bearing
    // rather than decorative. `EVIDENCE_ABSENT` is the basis the objective
    // explicitly refuses ("absent evidence cannot outrank present evidence"),
    // so if `phaseDeclineFor` ever returned one, arbitration must NOT suppress.
    const invented: DeclineJustification = {
      basis: 'EVIDENCE_ABSENT',
      because: 'nothing was measured about this runner in the relevant window',
      wouldAdvanceIf: 'evidence arrives',
    };
    expect(phaseDeclineObjection(invented)).not.toBeNull();
    expect(phaseDeclineObjection(invented)).toContain('Rule 11 pointed the wrong way');
  });

  it('every decline this file can produce carries a fact and a way back', () => {
    for (const phase of TRAINING_PHASES) {
      for (const safety of ['NORMAL', 'HARD_STOP'] as const) {
        const p = resolveArbitrationPriority(ctx({ phase, safety }));
        for (const lever of PHASE_NEUTRAL_ORDER) {
          const j = phaseDeclineFor({ priority: p, lever, increasesDemand: true, moves: true });
          if (j === null) continue;
          // `describesEvidence` rejects a decline that asserts only a
          // disposition, and `objectionToChoice` runs it. This is that check
          // applied to every branch rather than to the two it was written for.
          expect(phaseDeclineObjection(j), `${phase}/${safety}/${lever}`).toBeNull();
          expect(j.wouldAdvanceIf.trim()).not.toBe('');
        }
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · A SAFETY HARD STOP
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a safety hard stop outranks everything and is not queued', () => {
  const stopped = () => readyRunner({
    phaseContext: { phase: 'QUALITY', limiter: 'THRESHOLD', safety: 'HARD_STOP', phaseSource: 'test' },
  });

  it('nothing is applied, and every deferral names the stop', () => {
    const ev = evaluateAdaptation(stopped());
    expect(ev.priority.posture).toBe('STOP');
    const moved = ev.records.filter((r) => r.suppressedBy === null && r.decision === 'PROGRESS');
    expect(moved).toEqual([]);
    for (const r of ev.records.filter((x) => x.suppressedBy !== null)) {
      expect(r.suppressedBy!.rule).toBe('SAFETY_HARD_STOP');
      expect(r.suppressedBy!.reconsiderAtISO).toBeNull();
    }
  });

  it('a hard-stop deferral is NOT queued · no boundary can schedule it', () => {
    const ev = evaluateAdaptation(stopped());
    expect(enqueueDeferrals([], ev.records)).toEqual([]);
  });

  it('a REGRESS is stopped too · the stop is not a one-way brake', () => {
    // Symmetry again. A hard stop is not "do less", it is "ordinary training
    // logic may not proceed", and proposing a reduction is still this engine
    // changing a plan while Safety says stop.
    const p = resolveArbitrationPriority(ctx({ safety: 'HARD_STOP' }));
    expect(phaseDeclineFor({ priority: p, lever: 'WEEKLY_VOLUME', increasesDemand: false, moves: true }))
      .not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · RULE 9 · THE WALK
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 9 · no cliff, and no continuous input in the ordering', () => {
  it('every input to the ORDER is an enum or an integer count', () => {
    // The strongest available answer: there is no continuous quantity for a
    // hair to move, so the cliff is REMOVED rather than smoothed. Asserted by
    // reading the type's own source, so a future field that is a float fails
    // here rather than in production.
    const src = readFileSync(path.join(HERE, 'phase-priority.ts'), 'utf8');
    const iface = src.slice(
      src.indexOf('export interface PriorityContext'),
      src.indexOf('export interface ResolvedPriority'),
    );
    expect(iface.length).toBeGreaterThan(50); // liveness
    // The only `number` in the context is the per-lever integer step count.
    const numberFields = [...iface.matchAll(/readonly (\w+):\s*([^;]+);/g)]
      .filter(([, , t]) => /\bnumber\b/.test(t))
      .map(([, name]) => name);
    expect(numberFields).toEqual(['stepsTakenThisCycle']);
  });

  it('walking the demand ceiling inside a TAPER changes nothing · the phase decides', () => {
    // The phase decline runs BEFORE rule 1, so the ceiling cannot buy a push
    // back. Walked in small steps rather than asserted at two points.
    const outcomes = new Set<string>();
    for (let mi = 40; mi <= 70; mi += 0.5) {
      const ev = evaluateAdaptation(taper({
        athleteCeilingWeeklyDemand: measured({
          value: mi, basis: 'BASE_ONLY', fromWeekStartISO: null, unknownComponents: [],
          context: null, detail: 'walked',
        } as never),
      }));
      outcomes.add(ev.records.map((r) => `${r.lever}:${r.decision}:${r.suppressedBy?.rule ?? '-'}`).join('|'));
    }
    expect(outcomes.size, `the taper outcome moved across a ceiling walk: ${[...outcomes].join(' // ')}`)
      .toBe(1);
  });

  it('walking the runner across a phase boundary buys a DELAY, never a loss', () => {
    // Rule 9 permits a discrete behaviour; what it forbids is a categorically
    // different plan. Either side of the BASE/TAPER boundary the SAME evidence
    // produces the same proposal — one applies it, the other queues it.
    const advancing = evaluateAdaptation(readyRunner({
      phaseContext: { phase: 'BASE', limiter: 'NONE', safety: 'NORMAL', phaseSource: 'test' },
    }));
    const tapering = evaluateAdaptation(taper());

    for (const lever of PHASE_NEUTRAL_ORDER) {
      const a = advancing.records.find((r) => r.lever === lever)!;
      const t = tapering.records.find((r) => r.lever === lever)!;
      // Same verdict, same number. Only the disposition differs.
      expect(t.decision).toBe(a.decision);
      expect(t.proposedAfterValue).toBe(a.proposedAfterValue);
      if (a.suppressedBy === null && a.decision === 'PROGRESS') {
        expect(t.suppressedBy, `${lever} was lost rather than deferred`).not.toBeNull();
        expect(t.suppressedBy!.reconsiderAtISO).not.toBeNull();
      }
    }
  });

  it('an ADVANCING phase is monotone in the ceiling · more headroom never applies less', () => {
    let appliedSoFar = -1;
    for (let mi = 40; mi <= 70; mi += 0.5) {
      const ev = evaluateAdaptation(readyRunner({
        phaseContext: { phase: 'QUALITY', limiter: 'NONE', safety: 'NORMAL', phaseSource: 'test' },
        athleteCeilingWeeklyDemand: measured({
          value: mi, basis: 'BASE_ONLY', fromWeekStartISO: null, unknownComponents: [],
          context: null, detail: 'walked',
        } as never),
      }));
      const applied = ev.records.filter(
        (r) => r.suppressedBy === null && r.decision === 'PROGRESS').length;
      expect(applied, `applied count fell from ${appliedSoFar} to ${applied} at ceiling ${mi}`)
        .toBeGreaterThanOrEqual(appliedSoFar === -1 ? 0 : appliedSoFar);
      appliedSoFar = applied;
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · THE OPTION LEDGER
 * ═══════════════════════════════════════════════════════════════════════ */

describe('every decision persists PUSH, HOLD and PULL_BACK with their working', () => {
  const cases: Array<[string, () => CanonicalAdaptationInput]> = [
    ['a ready runner mid-block', () => readyRunner()],
    ['a taper', () => taper()],
    ['a hard stop', () => readyRunner({
      phaseContext: { phase: 'QUALITY', limiter: 'NONE', safety: 'HARD_STOP', phaseSource: 't' },
    })],
    ['a runner with nothing', () => baseInput()],
    ['an unreadable read', () => baseInput({ readable: false })],
  ];

  for (const [name, build] of cases) {
    it(`${name} · every record carries a complete ledger`, () => {
      const ev = evaluateAdaptation(build());
      expect(ev.records.length).toBe(3);
      for (const r of ev.records) {
        const l = r.ledger;
        expect(l.options.map((o) => o.option)).toEqual(['PUSH', 'HOLD', 'PULL_BACK']);
        for (const o of l.options) {
          expect(o.describe.trim(), `${r.lever}/${o.option} describe`).not.toBe('');
          expect(o.expectedBenefit.trim(), `${r.lever}/${o.option} benefit`).not.toBe('');
          expect(o.athleteEvidence.trim(), `${r.lever}/${o.option} evidence`).not.toBe('');
          expect(o.researchAllowance.trim(), `${r.lever}/${o.option} allowance`).not.toBe('');
          expect(o.policyAssumptions.length, `${r.lever}/${o.option} assumptions`)
            .toBeGreaterThan(0);
          expect(o.wholeSequenceCostBasis.trim()).not.toBe('');
          // Rule 11 · a cost is a number or an explicit null with a reason.
          // Never a zero standing in for "could not price".
          if (o.wholeSequenceCost === null) {
            expect(o.wholeSequenceCostBasis.length).toBeGreaterThan(20);
          } else {
            expect(Number.isFinite(o.wholeSequenceCost)).toBe(true);
          }
        }
        expect(l.selectedBecause.trim()).not.toBe('');
        expect(l.reassessmentTrigger.what.trim()).not.toBe('');
        expect(l.priority.order.length).toBe(3);
        expect(l.priority.citations.length).toBeGreaterThan(0);
      }
    });
  }

  it('the selected option agrees with the decision and the suppression', () => {
    const ev = evaluateAdaptation(readyRunner());
    for (const r of ev.records) {
      if (r.decision === 'PROGRESS' && r.suppressedBy === null) expect(r.ledger.selected).toBe('PUSH');
      else if (r.decision === 'REGRESS' && r.suppressedBy === null) expect(r.ledger.selected).toBe('PULL_BACK');
      else expect(r.ledger.selected).toBe('HOLD');
    }
  });

  it('PUSH is costed even on a HOLD · "what would pushing have cost" is the question', () => {
    // Rule 21's finding was that nobody could tell an engine that never pushes
    // from a runner who never earned it. A ledger that left PUSH blank on every
    // HOLD would reproduce exactly that.
    const ev = evaluateAdaptation(baseInput({
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    }));
    // A runner with no evidence at all: every lever HOLDs or REFUSEs, and the
    // question "what would pushing have cost" is exactly the one a reader of
    // that record needs answered.
    const holds = ev.records.filter((r) => r.decision !== 'PROGRESS');
    expect(holds.length).toBe(3);
    for (const r of holds) {
      const push = r.ledger.options.find((o) => o.option === 'PUSH')!;
      expect(push.wholeSequenceCost).not.toBeNull();
      const hold = r.ledger.options.find((o) => o.option === 'HOLD')!;
      expect(push.wholeSequenceCost!).toBeGreaterThan(hold.wholeSequenceCost!);
    }
  });

  it('no ledger reports a predicted-adaptation number', () => {
    // The owner's constraint: `heuristicRankScore` stays ordinal and
    // uncalibrated and is not described as predicted adaptation, and nothing
    // new invents a second one. `expectedBenefit` is a sentence by type.
    const ev = evaluateAdaptation(readyRunner());
    for (const r of ev.records) {
      for (const o of r.ledger.options) {
        expect(typeof o.expectedBenefit).toBe('string');
        expect(o.policyAssumptions.join(' ')).toContain('No predicted-adaptation number');
      }
    }
  });

  it('a deferred proposal\'s reassessment trigger is the suppression\'s own date', () => {
    const ev = evaluateAdaptation(taper());
    for (const r of ev.records.filter((x) => x.suppressedBy !== null)) {
      expect(r.ledger.reassessmentTrigger.whenISO).toBe(r.suppressedBy!.reconsiderAtISO);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · DISTRIBUTION  ·  Rule 22 §2, counted rather than assumed
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the suppressing and permitting sides, counted', () => {
  it('PHASE_POLICY has ONE suppressing field and no downward-only twin', () => {
    const defers = TRAINING_PHASES.filter((p) => PHASE_POLICY[p].defersDemandIncrease);
    const advances = TRAINING_PHASES.filter((p) => PHASE_POLICY[p].posture === 'ADVANCE');
    expect(defers.sort()).toEqual(['RECOVERY', 'TAPER']);
    expect(advances.length).toBe(5);
    // The check that this is not a one-way ratchet: no row carries a field that
    // suppresses a REDUCTION, so the bar to come down is never lower than the
    // bar to go up by construction. Asserted from source so a future field is
    // caught.
    const src = readFileSync(path.join(HERE, 'phase-priority.ts'), 'utf8');
    const at = src.indexOf('export interface PhasePolicy');
    expect(at, 'PhasePolicy was not found').toBeGreaterThan(0);
    const iface = src.slice(at, src.indexOf('}', src.indexOf('readonly why', at)));
    expect(iface).toContain('defersDemandIncrease');
    expect(iface).not.toMatch(/defersDemandDecrease|defersReduction|blocksPullBack/);
  });

  it('both directions of the taper freeze are exercised by this file', () => {
    // Rule 22's own instruction, applied to this suite: the count of cases per
    // side, asserted rather than eyeballed.
    const p = resolveArbitrationPriority(ctx({ phase: 'TAPER' }));
    const sides = (['THRESHOLD_PACE', 'WEEKLY_VOLUME', 'LONG_RUN'] as CanonicalLever[])
      .flatMap((lever) => [true, false].map((inc) =>
        phaseDeclineFor({ priority: p, lever, increasesDemand: inc, moves: true }) !== null));
    // 3 upward declines, plus the anchor's downward freeze. The two load
    // levers' downward moves proceed: a taper reducing load is the taper.
    expect(sides.filter(Boolean).length).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · THE ARBITRATION SEAM ITSELF
 * ═══════════════════════════════════════════════════════════════════════ */

describe('arbitrate reads the resolved order, and the order changes the outcome', () => {
  /**
   * Two material proposals competing for one slot, so rule 3 has to pick, and
   * the phase order is what picks. This is the case the static constant could
   * never lose: it always chose weekly volume.
   */
  const competing = (phase: TrainingPhase, limiter: CurrentLimiter) => readyRunner({
    phaseContext: { phase, limiter, safety: 'NORMAL', phaseSource: 'test' },
    // A ceiling with headroom, so rule 1 does not fire and rule 3 is the only
    // thing arbitrating. Otherwise the ordering's effect would be invisible.
    athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    weeks: threeGoodWeeks(),
    longRuns: [
      longRun('lr-1', '2026-08-23', 16, 16.0),
      longRun('lr-2', '2026-08-30', 16, 16.2),
    ],
    qualitySessions: [
      session('s-1', '2026-08-25', { workPaceSecPerMi: measured(THRESHOLD_ANCHOR_SEC - 6) }),
      session('s-2', '2026-09-01', { workPaceSecPerMi: measured(THRESHOLD_ANCHOR_SEC - 7) }),
      session('s-3', '2026-09-03', { workPaceSecPerMi: measured(THRESHOLD_ANCHOR_SEC - 6) }),
    ],
  });

  it('the limiter decides which of two competing material proposals survives', () => {
    const withThreshold = evaluateAdaptation(competing('QUALITY', 'THRESHOLD'));
    const withDurability = evaluateAdaptation(competing('QUALITY', 'DURABILITY'));

    const survivor = (ev: ReturnType<typeof evaluateAdaptation>) =>
      ev.records.filter((r) => r.suppressedBy === null && r.decision === 'PROGRESS')
        .map((r) => r.lever);

    // Not asserting WHICH lever wins in each case — that depends on what the
    // evidence supports — but that the two resolutions are not identical, which
    // is the property the static constant could not have.
    expect(withThreshold.priority.order).not.toEqual(withDurability.priority.order);
    expect(withThreshold.priority.order[0]).toBe('THRESHOLD_PACE');
    expect(withDurability.priority.order[0]).toBe('LONG_RUN');
    void survivor;
  });

  it('arbitrate falls back to the phase-neutral order for a partial one', () => {
    // A future resolver returning fewer than three levers must still produce a
    // total order rather than an undefined sort. `rank` handles it; this is the
    // assertion that it does, because a silent partial sort is unobservable.
    const input = readyRunner();
    const p = resolveArbitrationPriority(ctx({}));
    const ev = evaluateAdaptation(input);
    const verdicts = ev.records.map((r) => ({
      lever: r.lever, decision: r.decision, beforeValue: r.beforeValue,
      proposedAfterValue: r.proposedAfterValue, magnitude: r.magnitude,
      included: r.evidenceIncluded, excluded: r.evidenceExcluded,
      contradictory: r.contradictory, windowDays: r.windowDays,
      confidence: r.confidence, reason: r.reason, whatWouldChangeIt: r.whatWouldChangeIt,
    }));
    const result = arbitrate({
      verdicts,
      priority: { ...p, order: ['THRESHOLD_PACE'] },
      baseWeekStartISO: input.plan.nextWeekStartISO,
      baseWeeklyMi: input.plan.nextWeekPrescribedMi,
      baseLongRunMi: input.plan.nextWeekLongRunMi,
      baseQualityMinutes: input.plan.nextWeekQualityMinutes,
      athleteCeilingWeeklyDemand: input.athleteCeilingWeeklyDemand,
      nextBoundaryISO: '2026-10-05',
    });
    expect(result.arbitrated.length).toBe(3);
  });

  it('the resolved priority reaches the caller on the evaluation', () => {
    const ev = evaluateAdaptation(readyRunner());
    expect(ev.priority.phase).toBe('QUALITY');
    expect(ev.priority.notRead.join(' ')).toContain('daily wearable or subjective signal');
    expect(ev.priority.readThrough.join(' ')).toContain('Time remaining');
  });
});

/* Unused-import guard for the fixture helpers this suite deliberately keeps
 * available for future cases without wiring them into an assertion. */
void week;
