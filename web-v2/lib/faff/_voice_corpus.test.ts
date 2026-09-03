/**
 * lib/faff/_voice_corpus.test.ts · the golden voice corpus.
 *
 * Brief §7. One fixture per coaching state, each an explanation the coach
 * would actually produce, run through the contract's own audit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A CORPUS LIKE THIS IS FOR, AND WHAT IT IS NOT
 *
 * It is the WORKED EXAMPLE of the voice. When somebody asks what a modified
 * run is supposed to sound like, this file answers, and the answer is
 * mechanically checked rather than asserted in a doc. The state matrix in the
 * brief's §5 is the source; every row of it is below.
 *
 * It is NOT evidence that the app says these things. Only ONE of these states
 * is wired to the contract today — TODAY_BEFORE, through `why-voice.ts`. The
 * other fifteen are fixtures for composers that have not been migrated. That
 * is stated here rather than left to be discovered, because this repo's
 * signature failure is "wired, tested and inert" (Rule 21) and a green corpus
 * over unwired states is exactly how that looks from the inside.
 *
 * `_voice_live.audit.test.ts` is the half that checks production.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · IT CANNOT CATCH A WRONG VERDICT. The fixtures assert the SHAPE of a
 *     coaching sentence, not whether the coaching decision behind it is
 *     correct. "Stop running for now" over a healthy runner passes here.
 *   · IT IS FIXTURES. Rule 13 clause 2: a fixture skips the exact code paths
 *     that break. Nothing below runs a resolver, a query or a route.
 *   · ITS BALANCE IS DECLARED, NOT MEASURED. Rule 22 asks for the
 *     distribution across opposing verdicts, and this corpus is deliberately
 *     built with BOTH directions present — six fixtures where nothing
 *     changes or the coach holds back, and five where the coach supports,
 *     confirms or moves forward. `the corpus is not one-sided` asserts it,
 *     because a voice suite written by someone worrying only about false
 *     praise would contain nothing but refusals.
 */
import { describe, it, expect } from 'vitest';
import {
  auditExplanation, layerOne, layerTwo, certaintyHedge,
  EXPLANATION_MODEL_VERSION,
  type CoachingExplanation, type Certainty, type MessageIntent,
} from './explanation';

let n = 0;
function ex(over: Partial<CoachingExplanation>): CoachingExplanation {
  n += 1;
  return {
    id: `fx-${n}`,
    modelVersion: EXPLANATION_MODEL_VERSION,
    decisionVersion: 'plan:pln_test@2026-09-02',
    surfaceEvent: 'TODAY_AFTER',
    intent: 'INTERPRET',
    verdict: 'Good easy miles.',
    certainty: 'SUPPORTED',
    facts: [],
    spoken: { short: 'Good easy miles.' },
    accessibilitySummary: 'Good easy miles. The plan stays the same.',
    detail: { headline: 'Easy run', paragraphs: [], evidenceLabels: [] },
    ...over,
  };
}

/**
 * THE CORPUS. Brief §5's state matrix, one row at a time, plus the four
 * data-quality states §7 asks for that the matrix does not name.
 */
const CORPUS: Array<{ state: string; e: CoachingExplanation }> = [
  {
    state: 'easy run, controlled',
    e: ex({
      verdict: 'Good easy miles.',
      reason: 'Effort stayed easy and heart rate was stable.',
      consequence: 'The plan stays the same.',
      certainty: 'ESTABLISHED',
      facts: [{ kind: 'OBSERVED', code: 'HR_STABLE', display: 'Average heart rate 138, inside the easy range.' }],
      spoken: { short: 'Good easy miles. Nothing changes.' },
      accessibilitySummary: 'Good easy miles. Effort stayed easy. The plan stays the same.',
    }),
  },
  {
    state: 'easy run, hot, high HR',
    e: ex({
      verdict: 'Effort stayed appropriate for the conditions.',
      reason: 'Heart rate ran higher in the heat, but pace and perceived effort stayed controlled.',
      consequence: 'Nothing changes. Keep using effort in heat like this.',
      certainty: 'SUPPORTED',
      facts: [
        { kind: 'OBSERVED', code: 'DEWPOINT', display: 'Dewpoint 68F at the start.' },
        { kind: 'OBSERVED', code: 'HR_AVG', display: 'Average heart rate 151 against a 145 ceiling.' },
      ],
      spoken: { short: 'Effort was right for the heat.' },
      accessibilitySummary: 'Effort stayed appropriate for the conditions. Nothing changes.',
    }),
  },
  {
    state: 'quality, executed',
    e: ex({
      verdict: 'Good threshold work.',
      reason: 'All four reps stayed inside the intended effort and the last rep was strongest.',
      consequence: 'This supports the current target. No change yet.',
      certainty: 'SUPPORTED',
      facts: [{ kind: 'OBSERVED', code: 'REP_SPREAD', display: 'Reps ran 7:08, 7:10, 7:09, 7:04.' }],
      spoken: { short: 'Good threshold work. Target holds.' },
      accessibilitySummary: 'Good threshold work. The target holds.',
    }),
  },
  {
    state: 'quality, too hard early',
    e: ex({
      verdict: 'The opening reps were too aggressive.',
      reason: 'Pace faded after the first half of the set.',
      consequence: 'Start at the slower edge next time. The target itself does not change.',
      certainty: 'SUPPORTED',
      facts: [{ kind: 'OBSERVED', code: 'FADE', display: 'Reps ran 6:52, 6:55, 7:14, 7:22.' }],
      spoken: { short: 'Opened too fast. Start slower next time.' },
      accessibilitySummary: 'The opening reps were too aggressive. The target does not change.',
    }),
  },
  {
    state: 'long run, durable',
    e: ex({
      verdict: 'Strong long run.',
      reason: 'Pace and heart rate stayed stable late, including the final quality block.',
      consequence: 'This strengthens the read on how you hold pace over distance.',
      certainty: 'SUPPORTED',
      facts: [{ kind: 'OBSERVED', code: 'LATE_STABILITY', display: 'Last four miles held within 6 seconds of the first four.' }],
      spoken: { short: 'Strong long run. It held late.' },
      accessibilitySummary: 'Strong long run. Pace held late.',
    }),
  },
  {
    state: 'race',
    e: ex({
      surfaceEvent: 'RACE_OUTLOOK',
      verdict: 'The result supports a faster current estimate.',
      reason: 'The race was complete, representative, and consistent with recent training.',
      consequence: 'The race outlook moved. Training changes only if the prescription inputs moved with it.',
      certainty: 'ESTABLISHED',
      facts: [
        { kind: 'OBSERVED', code: 'FINISH', display: '1:36:04 at Clarksburg Half.' },
        { kind: 'MODELLED', code: 'OUTLOOK', display: '~3:22 to ~3:27 for the marathon.' },
      ],
      spoken: { short: 'The race supports a faster estimate.' },
      accessibilitySummary: 'The race supports a faster current estimate. Estimated marathon 3:22 to 3:27.',
    }),
  },
  {
    state: 'missed run',
    e: ex({
      surfaceEvent: 'MISSED_RUN',
      intent: 'REQUEST_DECISION',
      verdict: 'You missed today’s run.',
      reason: 'One missed day does not erase fitness.',
      consequence: 'The week still works if the long run lands.',
      action: { label: 'Move it to Friday', semanticAction: 'MOVE_SESSION' },
      certainty: 'ESTABLISHED',
      spoken: { short: 'Today’s run is still open.' },
      accessibilitySummary: 'You missed today’s run. Choose move, skip, or tell us something is wrong.',
    }),
  },
  {
    state: 'modified run',
    e: ex({
      surfaceEvent: 'MODIFIED_RUN',
      verdict: 'The session changed, and useful work still landed.',
      reason: 'You completed three controlled reps before stopping.',
      consequence: 'We will treat it as partial evidence rather than a four-rep session.',
      certainty: 'TENTATIVE',
      facts: [{ kind: 'OBSERVED', code: 'REPS_DONE', display: 'Three of four reps completed.' }],
      spoken: { short: 'Three reps landed. That still counts.' },
      accessibilitySummary: 'The session changed and useful work still landed.',
    }),
  },
  {
    state: 'illness',
    e: ex({
      surfaceEvent: 'ILLNESS',
      intent: 'WARN',
      verdict: 'Do not train today.',
      reason: 'The symptoms you reported make normal training inappropriate.',
      consequence: 'Check in tomorrow. Seek medical care for urgent or worsening symptoms.',
      certainty: 'ESTABLISHED',
      spoken: { short: 'No training today.', urgent: 'Stop and seek care if symptoms worsen.' },
      accessibilitySummary: 'Do not train today. Check in tomorrow and seek medical care if symptoms worsen.',
    }),
  },
  {
    state: 'injury flare',
    e: ex({
      surfaceEvent: 'INJURY',
      intent: 'WARN',
      verdict: 'Stop running for now.',
      reason: 'Pain worsened during impact and the return criteria are not met.',
      consequence: 'Follow the return-to-running steps, or seek clinical guidance.',
      certainty: 'ESTABLISHED',
      spoken: { short: 'Stop running for now.', urgent: 'Stop the session.' },
      accessibilitySummary: 'Stop running for now. Follow the return-to-running steps or seek clinical guidance.',
    }),
  },
  {
    state: 'insufficient evidence',
    e: ex({
      intent: 'REFUSE',
      verdict: 'Not enough evidence to change the target.',
      reason: 'The latest session was useful, but it does not yet corroborate a new level.',
      consequence: 'Hold the plan and reassess after the next representative session.',
      certainty: 'UNKNOWN',
      whyNot: [{ code: 'INSIDE_RECOVERY_WEEK', display: 'Saturday was strong, but it sat inside a recovery week.' }],
      spoken: { short: 'Not enough to move the target yet.' },
      accessibilitySummary: 'Not enough evidence to change the target. Hold the plan.',
    }),
  },
  {
    state: 'plan held',
    e: ex({
      intent: 'EXPLAIN_HOLD',
      surfaceEvent: 'PLAN_REVIEW',
      verdict: 'The week stays as written.',
      reason: 'Recent signals do not agree strongly enough to justify a change.',
      certainty: 'SUPPORTED',
      whyNot: [{ code: 'SIGNALS_DISAGREE', display: 'Sleep is down, but resting heart rate and training load are both normal.' }],
      spoken: { short: 'The week stays as written.' },
      accessibilitySummary: 'The week stays as written. No action needed.',
    }),
  },
  {
    state: 'plan changed',
    e: ex({
      intent: 'EXPLAIN_CHANGE',
      surfaceEvent: 'PLAN_REVIEW',
      verdict: 'Tomorrow is now easy.',
      reason: 'Fatigue, sleep and resting heart rate all moved in the same direction.',
      consequence: 'The quality session moved to Friday.',
      certainty: 'SUPPORTED',
      spoken: { short: 'Tomorrow is easy. Quality moved to Friday.' },
      accessibilitySummary: 'Tomorrow is now easy. The quality session moved to Friday.',
    }),
  },
  {
    state: 'goal aggressive',
    e: ex({
      surfaceEvent: 'RACE_OUTLOOK',
      verdict: 'Your goal is still possible, and it is currently aggressive.',
      reason: 'The current estimate is slower, and holding pace late is the main gap.',
      consequence: 'Keep the goal or edit it. The plan continues from current fitness either way.',
      certainty: 'SUPPORTED',
      facts: [
        { kind: 'STATED', code: 'GOAL', display: 'Your goal is 3:00:00.' },
        { kind: 'MODELLED', code: 'CURRENT', display: 'Current estimate ~3:22 to ~3:27.' },
      ],
      spoken: { short: 'The goal is possible and currently aggressive.' },
      accessibilitySummary: 'Your goal is still possible and currently aggressive. Estimated 3:22 to 3:27.',
    }),
  },
  {
    state: 'missing data',
    e: ex({
      intent: 'REFUSE',
      verdict: 'We cannot judge this run reliably.',
      reason: 'The activity is incomplete and the heart-rate and phase data are missing.',
      consequence: 'It still counts toward volume. It will not move the fitness read.',
      certainty: 'UNKNOWN',
      whyNot: [{ code: 'NO_HR', display: 'No heart-rate stream on this activity.' }],
      spoken: { short: 'Not enough data to judge this one.' },
      accessibilitySummary: 'We cannot judge this run reliably. It still counts toward volume.',
    }),
  },
  {
    state: 'outage · the read failed, which is not a refusal',
    e: ex({
      intent: 'REFUSE',
      verdict: 'Today is not available right now.',
      reason: 'We could not reach your training data.',
      consequence: 'Nothing about your plan has changed.',
      certainty: 'UNKNOWN',
      spoken: { short: 'Today is not available right now.' },
      accessibilitySummary: 'Today is not available right now. Nothing about your plan has changed.',
    }),
  },
  {
    state: 'treadmill · pace is not evidence',
    e: ex({
      verdict: 'Treadmill miles are in.',
      reason: 'Belt pace is not measured the way outdoor pace is, so this one counts for volume and not for pace.',
      certainty: 'TENTATIVE',
      facts: [{ kind: 'OBSERVED', code: 'INDOOR', display: 'Recorded indoors.' }],
      spoken: { short: 'Treadmill miles are in.' },
      accessibilitySummary: 'Treadmill miles are in. They count toward volume, not pace.',
    }),
  },
  {
    state: 'taper week',
    e: ex({
      surfaceEvent: 'TODAY_BEFORE',
      intent: 'PRESCRIBE',
      verdict: 'The work is done, so this week is about arriving fresh.',
      reason: 'Short touches of race pace with full recovery.',
      certainty: 'ESTABLISHED',
      spoken: { short: 'Short and sharp. Nothing to prove.' },
      accessibilitySummary: 'This week is about arriving fresh. Short touches of race pace.',
    }),
  },
];

describe('the golden voice corpus', () => {
  for (const { state, e } of CORPUS) {
    it(`${state} · passes the explanation audit`, () => {
      const defects = auditExplanation(e);
      expect(defects, `${state}: ${JSON.stringify(defects, null, 2)}`).toEqual([]);
    });
  }

  it('every fixture reads as at most two sentences in Layer 1', () => {
    for (const { state, e } of CORPUS) {
      const l1 = layerOne(e);
      const sentences = l1.split(/(?<=[.?])\s+/).filter((s) => s.trim());
      expect(sentences.length, `${state}: ${l1}`).toBeLessThanOrEqual(2);
      expect(l1.startsWith(e.verdict), `${state} does not lead with its verdict`).toBe(true);
    }
  });

  it('a refusal never renders a retry action; a decision request does render one', () => {
    for (const { state, e } of CORPUS) {
      if (e.intent === 'REFUSE') expect(e.action, state).toBeUndefined();
    }
    const decision = CORPUS.find((c) => c.e.intent === 'REQUEST_DECISION');
    expect(decision?.e.action?.semanticAction).toBeTruthy();
    // Brief §8: buttons name the consequence, not the mechanism.
    expect(decision!.e.action!.label, decision!.e.action!.label).not.toMatch(/^(OK|Done|Continue|Submit)$/i);
  });

  it('UNKNOWN certainty carries a hedge and ESTABLISHED does not', () => {
    expect(certaintyHedge('UNKNOWN')).toBeTruthy();
    expect(certaintyHedge('TENTATIVE')).toBeTruthy();
    expect(certaintyHedge('ESTABLISHED')).toBeNull();
    expect(certaintyHedge('SUPPORTED')).toBeNull();
    for (const { state, e } of CORPUS) {
      if (e.certainty !== 'UNKNOWN') continue;
      expect(layerTwo(e).join(' '), state).toContain('not enough evidence');
    }
  });

  it('every modelled fact is marked as modelled where the runner reads it', () => {
    // Rule 16 and the design contract's `~` mark. `auditExplanation` enforces
    // it; this asserts the corpus actually EXERCISES the rule rather than
    // containing no modelled facts at all (Rule 15).
    const modelled = CORPUS.flatMap((c) => c.e.facts).filter((f) => f.kind === 'MODELLED');
    expect(modelled.length, 'the corpus contains no modelled fact to check').toBeGreaterThanOrEqual(2);
    for (const f of modelled) expect(f.display, f.code).toMatch(/~|estimate/i);
  });

  it('goal, model and fact stay grammatically distinct', () => {
    // Brief §2: "your goal" is only ever the runner's stated aspiration.
    const goalCase = CORPUS.find((c) => c.state === 'goal aggressive')!.e;
    const stated = goalCase.facts.filter((f) => f.kind === 'STATED');
    const model = goalCase.facts.filter((f) => f.kind === 'MODELLED');
    expect(stated[0].display).toMatch(/your goal/i);
    expect(model[0].display).not.toMatch(/your goal/i);
    expect(model[0].display).toMatch(/estimate/i);
    // And nothing anywhere turns a model estimate into a new goal.
    for (const { state, e } of CORPUS) {
      const all = [e.verdict, e.reason, e.consequence, e.accessibilitySummary].join(' ');
      expect(all, state).not.toMatch(/your new goal|goal updated|new target set/i);
    }
  });

  it('the corpus is not one-sided', () => {
    // Rule 22. A voice suite written only by someone afraid of false praise
    // contains nothing but refusals, and would pass an app that can only
    // refuse. Both directions have to be present for this file to mean
    // anything about the coach's range.
    const holding = CORPUS.filter((c) =>
      c.e.intent === 'REFUSE' || c.e.intent === 'EXPLAIN_HOLD' || c.e.intent === 'WARN');
    const moving = CORPUS.filter((c) =>
      c.e.intent === 'INTERPRET' || c.e.intent === 'EXPLAIN_CHANGE'
      || c.e.intent === 'PRESCRIBE' || c.e.intent === 'ACKNOWLEDGE');
    expect(holding.length, 'no held/refused states').toBeGreaterThanOrEqual(4);
    expect(moving.length, 'no supported/changed states').toBeGreaterThanOrEqual(4);
    // Neither side may be more than twice the other.
    expect(Math.max(holding.length, moving.length))
      .toBeLessThanOrEqual(2 * Math.min(holding.length, moving.length));
  });

  it('the corpus covers the brief state matrix and every certainty', () => {
    const seenCertainty = new Set<Certainty>(CORPUS.map((c) => c.e.certainty));
    for (const c of ['ESTABLISHED', 'SUPPORTED', 'TENTATIVE', 'UNKNOWN'] as Certainty[]) {
      expect(seenCertainty.has(c), `no fixture with certainty ${c}`).toBe(true);
    }
    const seenIntent = new Set<MessageIntent>(CORPUS.map((c) => c.e.intent));
    for (const i of ['PRESCRIBE', 'INTERPRET', 'EXPLAIN_CHANGE', 'EXPLAIN_HOLD',
      'REQUEST_DECISION', 'REFUSE', 'WARN'] as MessageIntent[]) {
      expect(seenIntent.has(i), `no fixture with intent ${i}`).toBe(true);
    }
    expect(CORPUS.length).toBeGreaterThanOrEqual(16);
  });
});

describe('the audit itself can fail (Rule 18 · falsified in-file)', () => {
  // Every assertion above is worth exactly what the auditor is worth, and an
  // auditor that returns [] for everything would make this whole file green.
  it('names hype', () => {
    expect(auditExplanation(ex({ verdict: 'Great job, you crushed it.' })).map((d) => d.problem).join(' '))
      .toMatch(/hype/);
  });
  it('names the macho register', () => {
    expect(auditExplanation(ex({ reason: 'Drift early and you cook the back half.' })).map((d) => d.problem).join(' '))
      .toMatch(/macho/);
  });
  it('names Layer-3 jargon in a Layer-1 field', () => {
    expect(auditExplanation(ex({ verdict: 'Durability is the limiter right now.' })).map((d) => d.problem).join(' '))
      .toMatch(/jargon.*limiter/);
  });
  it('names an exclamation mark', () => {
    expect(auditExplanation(ex({ verdict: 'Good run!' })).map((d) => d.problem)).toContain('exclamation mark');
  });
  it('names an unmarked modelled value', () => {
    expect(auditExplanation(ex({
      facts: [{ kind: 'MODELLED', code: 'X', display: 'Marathon 3:22.' }],
    })).map((d) => d.problem).join(' ')).toMatch(/no modelled mark/);
  });
  it('names a refusal that carries a retry', () => {
    expect(auditExplanation(ex({
      intent: 'REFUSE', certainty: 'UNKNOWN',
      action: { label: 'Try again', semanticAction: 'RETRY' },
    })).map((d) => d.problem).join(' ')).toMatch(/refusal is an answer/);
  });
  it('names UNKNOWN dressed up as a conclusion', () => {
    expect(auditExplanation(ex({ intent: 'INTERPRET', certainty: 'UNKNOWN' }))
      .map((d) => d.problem).join(' ')).toMatch(/UNKNOWN but the intent/);
  });
  it('names a sentence printed twice (Rule 17)', () => {
    expect(auditExplanation(ex({
      verdict: 'Good easy miles.', reason: 'good easy miles',
    })).map((d) => d.problem).join(' ')).toMatch(/repeats a sentence/);
  });
  it('names a spoken cue that is a paragraph', () => {
    expect(auditExplanation(ex({
      spoken: { short: 'x'.repeat(120) },
    })).map((d) => d.problem).join(' ')).toMatch(/spoken cues stay under 90/);
  });
  it('names a missing decision version', () => {
    expect(auditExplanation(ex({ decisionVersion: '' })).map((d) => d.problem).join(' '))
      .toMatch(/decisionVersion|same decision/);
  });
});
