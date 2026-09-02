/**
 * lib/safety/_safety_verdict.test.ts · THE VERDICT ITSELF.
 *
 * `_safety_ownership.test.ts` pins WHERE the verdict is authored. This file
 * checks WHAT it says, and above all that a failed read is never spent as a
 * clearance.
 *
 * ── IT SUPERSEDES `lib/coach/_injury_read_rule11.test.ts` ──────────────────
 *
 * That gate was a source-text check on ONE query in ONE file, and it said so:
 * "It does NOT assert that any consumer behaves correctly when the read fails
 * — deliberately, because that behaviour is an open product decision." The
 * decision was taken on 2026-09-02 and the behaviour is asserted here. The
 * older file survives, rewritten, asserting the delegation it now guards.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ───────────────────────────────
 *
 *   · It cannot see the database. Every input is hand-built, so it says
 *     nothing about whether `load-safety.ts` maps a real row correctly, nor
 *     about SQLSTATE handling against a live Postgres.
 *   · It cannot see any surface. A route could stop calling the resolver and
 *     every assertion here still passes; the ownership gate covers location
 *     and the two `expect(route)` assertions there cover the two call sites
 *     that exist today.
 *   · It cannot see Swift, so it says nothing about what the wrist draws.
 *   · It cannot tell whether the doctrine mapping is RIGHT — that a minor
 *     injury deserves MODIFY rather than CAUTION is a judgement cited to
 *     brief 11, not a number parsed out of a research table. Change the
 *     mapping and these tests change with it.
 *
 * ── RULE 22 · THE DISTRIBUTION ─────────────────────────────────────────────
 *
 * The counted balance, because a gate written by whoever wrote the engine
 * inherits its instinct. Cases below by outcome:
 *
 *     NORMAL 4 · CAUTION 2 · MODIFY 3 · STOP 6 · UNKNOWN 7
 *
 * UNKNOWN is the largest bucket on purpose. It is the branch with no
 * production precedent, the one the runner ruled on, and the one where a
 * silent collapse into "clear" is invisible in every other check.
 */
import { describe, it, expect } from 'vitest';
import {
  classifySafety,
  isSafetyUnknown,
  mayEmitQualityWorkout,
  mayEmitRunnableWorkout,
  safetyTitle,
  safetyVerdictLine,
  SAFETY_NOT_RESOLVED,
  type IllnessSignal,
  type InjurySignal,
  type NiggleSignal,
  type SafetyInputs,
  type SignalRead,
} from './safety-verdict';

const none = <T>(): SignalRead<T> => ({ ok: true, value: null });
const failed = <T>(): SignalRead<T> => ({ ok: false, failure: 'READ_FAILED' });
const absentTable = <T>(): SignalRead<T> => ({ ok: false, failure: 'NOT_DEPLOYED' });

const injury = (severity: InjurySignal['severity']): SignalRead<InjurySignal> => ({
  ok: true,
  value: {
    id: 4, site: 'left calf', severity,
    startDateISO: '2026-08-21', expectedReturnDateISO: null,
    returnProtocol: null, notes: null,
  },
});
const illness = (hasFever: boolean): SignalRead<IllnessSignal> => ({
  ok: true,
  value: {
    id: 2, symptoms: ['fatigue'], hasFever, started: 'today',
    loggedAtISO: '2026-09-02T06:00:00.000Z', daysActive: 0,
  },
});
const niggle = (severity: number): SignalRead<NiggleSignal> => ({
  ok: true,
  value: {
    id: 9, bodyPart: 'right achilles', severity, side: 'right',
    status: 'few_days', loggedAtISO: '2026-09-01T06:00:00.000Z', daysActive: 1,
  },
});

const clear: SafetyInputs = { injury: none(), illness: none(), niggle: none() };

describe('the four known states', () => {
  it('NORMAL · nothing logged', () => {
    const r = classifySafety(clear);
    expect(r.known).toBe(true);
    if (!r.known) throw new Error('unreachable');
    expect(r.state).toBe('NORMAL');
    expect(r.posture).toBe('PRESCRIBE');
    expect(r.driver).toBeNull();
    expect(mayEmitRunnableWorkout(r)).toBe(true);
    expect(mayEmitQualityWorkout(r)).toBe(true);
  });

  it('NORMAL · a niggle below the caution threshold changes nothing', () => {
    const r = classifySafety({ ...clear, niggle: niggle(3) });
    expect(r.known && r.state).toBe('NORMAL');
  });

  it('CAUTION · a niggle at the threshold names itself but still prescribes', () => {
    const r = classifySafety({ ...clear, niggle: niggle(5) });
    if (!r.known) throw new Error('unreachable');
    expect(r.state).toBe('CAUTION');
    expect(r.driver).toBe('niggle');
    // CAUTION is the state that must NOT withhold. Doctrine brief 11: "Not
    // every complaint requires stopping."
    expect(mayEmitRunnableWorkout(r)).toBe(true);
    expect(mayEmitQualityWorkout(r)).toBe(true);
    expect(safetyVerdictLine(r)).toContain('right achilles');
  });

  it('CAUTION · a severe niggle is still CAUTION, not a stop', () => {
    const r = classifySafety({ ...clear, niggle: niggle(10) });
    expect(r.known && r.state).toBe('CAUTION');
  });

  it('MODIFY · a minor open injury takes the quality and keeps the running', () => {
    const r = classifySafety({ ...clear, injury: injury('minor') });
    if (!r.known) throw new Error('unreachable');
    expect(r.state).toBe('MODIFY');
    expect(r.posture).toBe('EASY_ONLY');
    expect(mayEmitRunnableWorkout(r)).toBe(true);
    // THE RUNNER'S OWN CLAUSE: no quality session is presented as cleared.
    expect(mayEmitQualityWorkout(r)).toBe(false);
    expect(safetyVerdictLine(r)).toBe(
      'Easy running only. The left calf gets a few easy days before anything harder comes back.',
    );
  });

  it('MODIFY · the sentence is the iPhone\'s own, byte for byte', () => {
    // Consolidating ownership is not licence to reword copy the runner has
    // already been reading. These are the strings the deleted
    // `verdictBySeverity` literal held.
    const mod = classifySafety({ ...clear, injury: injury('moderate') });
    const maj = classifySafety({ ...clear, injury: injury('major') });
    expect(safetyVerdictLine(mod)).toBe(
      'Rest, not run. The left calf gets time to settle before anything reintroduces load.',
    );
    expect(safetyVerdictLine(maj)).toBe(
      'Rest, not run. The left calf needs a real break. This is not a session to run through.',
    );
  });

  it('RULE 17 · the 56pt word follows the posture, not the table it came from', () => {
    // The phone printed "Not today" over EVERY injury severity, including a
    // MINOR one whose own verdict line under it read "Easy running only."
    // Verified against the live production row on 2026-09-02. The headline and
    // the sentence now have one author and cannot disagree.
    const minor = classifySafety({ ...clear, injury: injury('minor') });
    expect(safetyTitle(minor)).toBe('Easy only');
    expect(mayEmitRunnableWorkout(minor)).toBe(true);

    const major = classifySafety({ ...clear, injury: injury('major') });
    expect(safetyTitle(major)).toBe('Not today');
    expect(mayEmitRunnableWorkout(major)).toBe(false);

    // "Not today" is reserved for the states that really emit no session.
    for (const c of [minor, major, classifySafety({ ...clear, illness: illness(false) })]) {
      expect(safetyTitle(c) === 'Not today').toBe(!mayEmitRunnableWorkout(c));
    }
  });

  it('STOP · moderate and major injuries emit no runnable workout (Constitution §31)', () => {
    for (const sev of ['moderate', 'major'] as const) {
      const r = classifySafety({ ...clear, injury: injury(sev) });
      if (!r.known) throw new Error('unreachable');
      expect(r.state).toBe('STOP');
      expect(r.posture).toBe('NO_TRAINING');
      expect(mayEmitRunnableWorkout(r)).toBe(false);
      expect(mayEmitQualityWorkout(r)).toBe(false);
    }
  });

  it('STOP · an uncleared illness, with and without a fever', () => {
    const fever = classifySafety({ ...clear, illness: illness(true) });
    const plain = classifySafety({ ...clear, illness: illness(false) });
    expect(fever.known && fever.state).toBe('STOP');
    expect(plain.known && plain.state).toBe('STOP');
    expect(mayEmitRunnableWorkout(fever)).toBe(false);
    expect(safetyVerdictLine(fever)).toContain('A fever means the body is fighting something');
    expect(safetyVerdictLine(plain)).toContain('gets a real day off');
  });

  it('PRECEDENCE · an open injury outranks a concurrent illness', () => {
    // The iPhone\'s own ordering, kept verbatim: the injury\'s load
    // restriction is the more specific fact.
    const r = classifySafety({ injury: injury('minor'), illness: illness(true), niggle: niggle(9) });
    if (!r.known) throw new Error('unreachable');
    expect(r.driver).toBe('injury');
    expect(r.state).toBe('MODIFY');
  });
});

describe('UNKNOWN · a failed read is never a clearance', () => {
  it('an unreadable injury with nothing else firing refuses', () => {
    const r = classifySafety({ ...clear, injury: failed() });
    expect(r.known).toBe(false);
    expect(isSafetyUnknown(r)).toBe(true);
    if (r.known) throw new Error('unreachable');
    expect(r.posture).toBe('WITHHOLD_PENDING_CHECK');
    expect(r.unreadable).toEqual([{ signal: 'injury', failure: 'READ_FAILED' }]);
    expect(r.floor).toBe('NORMAL');
  });

  it('an unreadable illness with nothing else firing refuses', () => {
    const r = classifySafety({ ...clear, illness: absentTable() });
    if (r.known) throw new Error('unreachable');
    expect(r.unreadable).toEqual([{ signal: 'illness', failure: 'NOT_DEPLOYED' }]);
  });

  it('a missing TABLE is a failure, not an absence of injury', () => {
    // The runner\'s ruling, applied to the case that reads most like "nothing
    // to see": the relation does not exist, so nobody in this deployment can
    // have logged an injury. That is not evidence this runner is uninjured.
    const r = classifySafety({ ...clear, injury: absentTable() });
    expect(r.known).toBe(false);
  });

  it('UNKNOWN emits NO workout at all, runnable or quality', () => {
    const r = classifySafety({ ...clear, injury: failed() });
    expect(mayEmitRunnableWorkout(r)).toBe(false);
    expect(mayEmitQualityWorkout(r)).toBe(false);
  });

  it('UNKNOWN does not fabricate an injury or an illness', () => {
    const r = classifySafety({ ...clear, injury: failed(), illness: failed() });
    if (r.known) throw new Error('unreachable');
    // No `state`, no `reason`, no injury row. A surface reading this cannot
    // draw the flare screen, which would blank a healthy runner\'s day.
    expect('state' in r).toBe(false);
    expect('reason' in r).toBe(false);
    expect('injury' in r).toBe(false);
    expect(safetyTitle(r)).toBe('Not cleared');
    expect(safetyVerdictLine(r)).toContain('did not run');
    expect(safetyVerdictLine(r)).not.toMatch(/injur(y|ed)\b(?!.*check)/i);
  });

  it('the resolver never having run is UNKNOWN, not NORMAL', () => {
    expect(SAFETY_NOT_RESOLVED.known).toBe(false);
    expect(mayEmitRunnableWorkout(SAFETY_NOT_RESOLVED)).toBe(false);
  });

  it('every posture value that is not PRESCRIBE refuses quality', () => {
    // The clause stated as a property rather than as three examples.
    const cases = [
      classifySafety(clear),                                     // PRESCRIBE
      classifySafety({ ...clear, niggle: niggle(7) }),            // PRESCRIBE
      classifySafety({ ...clear, injury: injury('minor') }),      // EASY_ONLY
      classifySafety({ ...clear, injury: injury('major') }),      // NO_TRAINING
      classifySafety({ ...clear, injury: failed() }),             // WITHHOLD
      SAFETY_NOT_RESOLVED,
    ];
    for (const c of cases) {
      expect(mayEmitQualityWorkout(c)).toBe(c.posture === 'PRESCRIBE');
    }
  });
});

describe('a failed read that could not have changed the answer does not refuse', () => {
  it('injury unreadable but an illness already STOPs · verdict stands', () => {
    // Refusing here would be false humility: the missing read could only have
    // agreed. `degradedSignals` records that we could not see everything.
    const r = classifySafety({ injury: failed(), illness: illness(false), niggle: none() });
    expect(r.known).toBe(true);
    if (!r.known) throw new Error('unreachable');
    expect(r.state).toBe('STOP');
    expect(r.degradedSignals).toEqual(['injury']);
  });

  it('niggle unreadable · NORMAL stands, because its worst case is CAUTION', () => {
    // A niggle changes a sentence, not a prescription. Blanking the whole day
    // over one would be the over-reaction, and the runner asked for a
    // conservative fallback, not a fragile one.
    const r = classifySafety({ ...clear, niggle: failed() });
    expect(r.known).toBe(true);
    if (!r.known) throw new Error('unreachable');
    expect(r.state).toBe('NORMAL');
    expect(r.degradedSignals).toEqual(['niggle']);
    expect(mayEmitQualityWorkout(r)).toBe(true);
  });

  it('niggle unreadable AND injury unreadable · still UNKNOWN', () => {
    const r = classifySafety({ ...clear, injury: failed(), niggle: failed() });
    if (r.known) throw new Error('unreachable');
    // ONLY the blocking signal is listed. The niggle could not have changed
    // the answer and saying it could would overstate the refusal.
    expect(r.unreadable.map((u) => u.signal)).toEqual(['injury']);
  });

  it('a degraded KNOWN verdict is never silently clean', () => {
    const r = classifySafety({ ...clear, niggle: failed() });
    if (!r.known) throw new Error('unreachable');
    expect(r.degradedSignals.length).toBeGreaterThan(0);
    expect(r.explain).toContain('degraded=niggle');
  });
});

describe('the type is the enforcement (Rule 11)', () => {
  it('`state` is unreachable on the UNKNOWN branch without narrowing', () => {
    // This is a COMPILE-time guarantee; the runtime shape is what can be
    // asserted here. `tsc --noEmit` is the other half and runs in prebuild.
    const r = classifySafety({ ...clear, injury: failed() });
    expect(Object.prototype.hasOwnProperty.call(r, 'state')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r, 'posture')).toBe(true);
  });

  it('NORMAL says nothing · a coach does not announce the absence of a problem', () => {
    // Rule 17. `safetyVerdictLine` is total so callers need no branch, and it
    // returns the empty string rather than a sentence no surface should draw.
    expect(safetyVerdictLine(classifySafety(clear))).toBe('');
    expect(safetyTitle(classifySafety(clear))).toBe('');
  });
});
