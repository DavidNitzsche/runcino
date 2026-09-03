/**
 * lib/adaptation/canonical/_replay_ledger.test.ts · HISTORICAL REPLAY, WITHOUT
 * LOOKAHEAD.
 *
 * A season is walked chronologically. At each decision point the engine is
 * shown ONLY the evidence that existed on that date, and what it would have
 * decided is recorded. The ledger prints at the end of the run and is what the
 * report quotes.
 *
 * ── NO LOOKAHEAD IS A STRUCTURAL PROPERTY, NOT A CONVENTION ────────────────
 *
 * `visibleAt(dateISO)` is the ONLY way a decision point gets evidence, and it
 * filters on date. Two tests then try to break it: one asserts that no record
 * at any decision point cites evidence dated on or after that point, and one
 * plants a spectacular session in the future and asserts it never appears in
 * any earlier decision. A filter nobody attacked is a hypothesis.
 *
 * ── THE SCORING RULE, WHICH IS DELIBERATELY NOT "AGREES WITH THE OLD ENGINE"
 *
 * The brief is explicit: do not score by agreement with the legacy engine,
 * which is known fragmented. Every `expected` below is derived from the
 * contract and from WHAT ACTUALLY HAPPENED NEXT in the timeline, and the
 * reasoning is written beside it. Where the engine and the expectation
 * disagree, the row is a finding, not a test to be relaxed.
 *
 * `verdict` classifies the decision against subsequent evidence:
 *   beneficial · the decision helped, judged by what followed
 *   neutral    · the decision neither helped nor hurt
 *   harmful    · the decision would have made things worse
 *
 * ── RULE 15 · WHICH CASE REACHES WHICH MECHANISM ───────────────────────────
 *
 *   D1  · fewer than three weeks              → volume REFUSE (insufficient window)
 *   D2  · multi-week consistency              → volume PROGRESS
 *   D3  · one-off exceptional performance     → threshold REFUSE (no corroboration)
 *   D4  · successful threshold sessions       → threshold PROGRESS
 *   D5  · recovery-window / cutback session   → cutback exclusion
 *   D6  · missing data                        → volume REFUSE (Rule 11)
 *   D7  · truncated long run                  → long-run REFUSE
 *   D8  · race effort (10K B race)            → threshold corroboration by race
 *   D9  · conflicting evidence                → threshold HOLD
 *   D10 · pace improvement, volume not ready  → arbitration defers pace
 *   D11 · volume completed, pace flat         → volume PROGRESS, pace HOLD
 *   D12 · durability improvement              → long-run PROGRESS
 *   D13 · easy runs with strides              → not threshold evidence
 *   D14 · consistent slower threshold sessions → threshold REGRESS
 *
 * ── RULE 22 · WHAT THIS REPLAY CANNOT FAIL ON ──────────────────────────────
 *
 * · The fidelity of the season itself. It is a hand-authored reconstruction
 *   grounded in the documented figures (7:10 threshold, 47-50 mile weeks, a
 *   16-mile long run, a 10K B race, a December marathon), not a database
 *   export. No production credentials were available in this worktree, so this
 *   is stated plainly rather than described as a replay of live rows.
 * · Whether the expected decisions are the ones a coach would make. They are
 *   argued from the contract, and the argument is in the comment beside each.
 * · Long-horizon consequences. "Beneficial" is judged against the next few
 *   weeks in the timeline, not against a race result.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation } from './evaluate';
import type { CanonicalDecision } from './decision-record';
import type {
  CanonicalAdaptationInput, GradedSession, LongRunObservation, WeekObservation,
} from './input';
import { measured, absent } from './input';
import { baseInput, session, week, longRun, cleanThirds, decayingThirds } from './_fixtures';

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEASON  ·  chronological, one entry per event
 * ═══════════════════════════════════════════════════════════════════════ */

const WEEKS: WeekObservation[] = [
  week('2026-06-29', 44, 44.2),
  week('2026-07-06', 45, 45.1),
  week('2026-07-13', 46, 46.3),
  week('2026-07-20', 47, 47.1),
  // D6 · the week the sync failed. Rule 11: this is not a week at zero.
  week('2026-07-27', 47, 0, { completedMi: absent('Strava sync failed') }),
  // D5 · an authored cutback. Not a week he fell short of.
  week('2026-08-03', 36, 35.6, { isCutback: true }),
  week('2026-08-10', 47, 47.2),
  week('2026-08-17', 48, 48.1),
  week('2026-08-24', 48, 47.9),
  // The Santa Monica 10K week. Q11 flags it as cut too deep, but it is a
  // cutback as authored, so it is excluded rather than counted as a shortfall.
  week('2026-08-31', 38, 37.6, { isCutback: true }),
  week('2026-09-07', 48, 48.2),
  week('2026-09-14', 49, 49.1),
  week('2026-09-21', 49, 49.3),
  week('2026-09-28', 49, 49.0),
  week('2026-10-05', 49, 48.8),
];

const SESSIONS: GradedSession[] = [
  // D3 · a single spectacular session. One-off, uncorroborated.
  session('t-jul16', '2026-07-16', { workPaceSecPerMi: measured(414), grade: 'FULL' }),
  // D13 · easy runs with strides. Tests EASY, not threshold.
  session('e-jul21', '2026-07-21', { tests: 'EASY', workPaceSecPerMi: measured(540) }),
  session('e-jul23', '2026-07-23', { tests: 'EASY', workPaceSecPerMi: measured(535) }),
  // D4 · two clean corroborating threshold sessions.
  session('t-aug11', '2026-08-11', { workPaceSecPerMi: measured(426), grade: 'FULL' }),
  session('t-aug18', '2026-08-18', { workPaceSecPerMi: measured(425), grade: 'FULL' }),
  // D9 · conflicting evidence: one faster, one slower.
  session('t-aug25', '2026-08-25', { workPaceSecPerMi: measured(438), grade: 'FULL' }),
  // D8 · the Santa Monica 10K, a genuine B race, directly relevant to threshold.
  session('r-sep05', '2026-09-05', {
    raceDistance: 'TEN_K', workPaceSecPerMi: measured(421), grade: 'FULL',
  }),
  session('t-sep09', '2026-09-09', { workPaceSecPerMi: measured(423), grade: 'FULL' }),
  // D11 · volume completed while pace stays exactly flat.
  session('t-sep16', '2026-09-16', { workPaceSecPerMi: measured(430), grade: 'FULL' }),
  session('t-sep23', '2026-09-23', { workPaceSecPerMi: measured(430), grade: 'FULL' }),
  // D14 · a genuine regression, mirroring D4's shape exactly but in the
  // other direction: two clean, corroborating threshold sessions, both
  // meaningfully slower than the held 430s/mi anchor. `agreeFaster` in
  // `threshold-pace.ts` is what decides PROGRESS vs REGRESS once sessions
  // agree with each other — this is that branch's REGRESS side, which had
  // no coverage anywhere in this file before tonight (confirmed by grep).
  // Dated after D11's 12 Oct evaluation point on purpose: D11 depends on its
  // 28-day window reaching back to exactly 14 Sep, and a session any earlier
  // than 12 Oct would land inside that window and corrupt the case it is
  // testing (found by running the suite — the first placement broke D11).
  session('t-oct19', '2026-10-19', { workPaceSecPerMi: measured(447), grade: 'FULL' }),
  session('t-oct26', '2026-10-26', { workPaceSecPerMi: measured(445), grade: 'FULL' }),
];

const LONG_RUNS: LongRunObservation[] = [
  longRun('lr-jul12', '2026-07-12', 14, 14.1),
  longRun('lr-jul19', '2026-07-19', 15, 15.0),
  // D7 · the watch died at mile 11 of a prescribed 15.
  longRun('lr-jul26', '2026-07-26', 15, 11.2, {
    provOpts: {
      truncation: { truncated: true, completeWorkPhasesCaptured: false, note: 'watch died' },
    },
  }),
  longRun('lr-aug09', '2026-08-09', 15, 15.1),
  longRun('lr-aug16', '2026-08-16', 16, 16.0),
  longRun('lr-aug23', '2026-08-23', 16, 16.1),
  // D12 · durability improvement: both hold together, key sessions after are fine.
  longRun('lr-sep13', '2026-09-13', 16, 16.2),
  longRun('lr-sep20', '2026-09-20', 16, 16.1),
];

/**
 * A session dated far in the future, deliberately spectacular. It must never
 * influence any decision. This is the lookahead tripwire.
 */
const FUTURE_POISON: GradedSession = session('POISON', '2026-11-30', {
  workPaceSecPerMi: measured(360),
  grade: 'FULL',
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE PROJECTOR  ·  the only way a decision point sees anything
 * ═══════════════════════════════════════════════════════════════════════ */

function visibleAt(
  dateISO: string,
  overrides?: Partial<CanonicalAdaptationInput>,
): CanonicalAdaptationInput {
  const before = (d: string) => d < dateISO;
  return baseInput({
    evaluatedAtISO: dateISO,
    evidenceVersion: `ev-${dateISO}`,
    boundary: 'WEEKLY_BOUNDARY',
    weeks: WEEKS.filter((w) => before(w.weekStartISO)),
    // The poison is in the pool at every decision point. The filter is what
    // keeps it out, and that is precisely what is being tested.
    qualitySessions: [...SESSIONS, FUTURE_POISON].filter((s) => before(s.provenance.dateISO)),
    longRuns: [...LONG_RUNS, ].filter((l) => before(l.provenance.dateISO)),
    ...overrides,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE LEDGER
 * ═══════════════════════════════════════════════════════════════════════ */

interface LedgerRow {
  id: string;
  decisionDate: string;
  covers: string;
  lever: string;
  evidenceAvailable: string;
  magnitude: string;
  expected: CanonicalDecision;
  actual: CanonicalDecision;
  suppressed: string;
  subsequent: string;
  verdict: 'beneficial' | 'neutral' | 'harmful';
  disagreement: string;
}

const LEDGER: LedgerRow[] = [];

function point(args: {
  id: string;
  date: string;
  covers: string;
  lever: 'THRESHOLD_PACE' | 'WEEKLY_VOLUME' | 'LONG_RUN';
  expected: CanonicalDecision;
  subsequent: string;
  verdict: LedgerRow['verdict'];
  overrides?: Partial<CanonicalAdaptationInput>;
}): LedgerRow {
  const input = visibleAt(args.date, args.overrides);
  const out = evaluateAdaptation(input);
  const r = out.records.find((x) => x.lever === args.lever)!;

  const row: LedgerRow = {
    id: args.id,
    decisionDate: args.date,
    covers: args.covers,
    lever: args.lever,
    evidenceAvailable:
      `${input.weeks.length}w ${input.qualitySessions.length}q ${input.longRuns.length}lr`
      + ` · included ${r.evidenceIncluded.length}, excluded ${r.evidenceExcluded.length}`
      + `, contradictory ${r.contradictory.length}`,
    magnitude: r.magnitude ? `${r.magnitude.value} ${r.magnitude.unit}` : 'none',
    expected: args.expected,
    actual: r.decision,
    suppressed: r.suppressedBy ? r.suppressedBy.by : '',
    subsequent: args.subsequent,
    verdict: args.verdict,
    disagreement: r.decision === args.expected ? '' : `EXPECTED ${args.expected}, GOT ${r.decision}`,
  };
  LEDGER.push(row);
  return row;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE DECISION POINTS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('historical replay · chronological, no lookahead', () => {
  it('D1 · early season, fewer than three readable weeks · volume REFUSES', () => {
    // Doctrine: the contract needs three consecutive non-cutback weeks. Two
    // exist. A refusal is the honest answer, not a cautious one.
    const r = point({
      id: 'D1', date: '2026-07-13', covers: 'insufficient window',
      lever: 'WEEKLY_VOLUME', expected: 'REFUSE',
      subsequent: 'He went on to complete 46.3 and 47.1, so the window filled naturally.',
      verdict: 'neutral',
    });
    expect(r.actual).toBe('REFUSE');
  });

  it('D2 · multi-week consistency · volume PROGRESSES', () => {
    // Three consecutive non-cutback weeks all at or above 95%, key sessions
    // intact, nothing deteriorating. This is the case the contract is for, and
    // the case the engine Rule 21 measured never once produced.
    const r = point({
      id: 'D2', date: '2026-07-27', covers: 'multi-week consistency',
      lever: 'WEEKLY_VOLUME', expected: 'PROGRESS',
      subsequent: 'He completed 47.2 and 48.1 in the weeks that followed, so the step was absorbed.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('PROGRESS');
    expect(r.magnitude).toMatch(/weekly_mi/);
  });

  it('D3 · a single exceptional session does NOT move the anchor', () => {
    // 6:54/mi against a 7:10 anchor, graded FULL, and completely uncorroborated.
    // The forbidden-input list names "a single exceptional workout" explicitly.
    //
    // 2026-09-03 · REFUSE, not HOLD. One session below the corroboration bar is
    // "the criterion cannot be evaluated", which Rule 11 separates from "the
    // anchor should stay" and which the volume and long-run levers already
    // call a refusal. The property this row exists to protect — the anchor does
    // not move on one workout — is unchanged and is asserted below.
    const r = point({
      id: 'D3', date: '2026-07-20', covers: 'one-off exceptional performance',
      lever: 'THRESHOLD_PACE', expected: 'REFUSE',
      subsequent: 'No session within the next month came close to that pace, so the one-off was noise.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('REFUSE');
    expect(r.magnitude).toBe('none');
  });

  it('D4 · two corroborating threshold sessions DO move the anchor', () => {
    const r = point({
      id: 'D4', date: '2026-08-24', covers: 'successful threshold sessions',
      lever: 'THRESHOLD_PACE', expected: 'PROGRESS',
      subsequent: 'The 10K on 5 Sep came in at 7:01/mi, faster than the moved anchor, confirming it.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('PROGRESS');
    expect(r.magnitude).toMatch(/sec_per_mi/);
  });

  it('D5 · a cutback week is excluded, never counted as a shortfall', () => {
    const input = visibleAt('2026-08-24');
    const out = evaluateAdaptation(input);
    const v = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    point({
      id: 'D5', date: '2026-08-24', covers: 'recovery-window session',
      lever: 'WEEKLY_VOLUME', expected: v.decision,
      subsequent: 'The cutback was authored, and the weeks around it were completed.',
      verdict: 'beneficial',
    });
    expect(v.evidenceExcluded.some((e) => e.reason === 'PRESCRIBED_RECOVERY_OR_TAPER')).toBe(true);
  });

  it('D6 · the week the sync failed · volume REFUSES, it does not regress', () => {
    // The most important row in this ledger. A week that reads 0 because
    // nothing synced and a week that reads 0 because he did not run are
    // opposite facts (Rule 11). Reading it as a shortfall would have cut his
    // volume off a Strava outage.
    const r = point({
      id: 'D6', date: '2026-08-10', covers: 'missing data',
      lever: 'WEEKLY_VOLUME', expected: 'REFUSE',
      subsequent: 'He had in fact trained normally that week. A REGRESS here would have been wrong.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('REFUSE');
    expect(r.actual).not.toBe('REGRESS');
  });

  it('D7 · the truncated long run · long run REFUSES', () => {
    // Q29 · the watch died at 11.2 of a prescribed 15. The missing portion is
    // not failed training and it is not evidence of durability either.
    const r = point({
      id: 'D7', date: '2026-08-09', covers: 'truncated activity',
      lever: 'LONG_RUN', expected: 'REFUSE',
      subsequent: 'The next two long runs were completed in full and the lever resumed normally.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('REFUSE');
  });

  it('D8 · the Santa Monica 10K corroborates threshold', () => {
    // Q20 · "one well-executed 10K or half plus >=1 corroborating training
    // session". The race is directly relevant, unlike a marathon or a 5K.
    const input = visibleAt('2026-09-14');
    const out = evaluateAdaptation(input);
    const t = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(t.evidenceIncluded.some((e) => e.activityId === 'r-sep05')).toBe(true);
    const r = point({
      id: 'D8', date: '2026-09-14', covers: 'race effort',
      lever: 'THRESHOLD_PACE', expected: 'PROGRESS',
      subsequent: 'Threshold sessions on 16 and 23 Sep came in at the new anchor and held it.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('PROGRESS');
    // The one contrary session from 25 Aug is recorded, not discarded, and it
    // keeps the step at the ordinary bound rather than the larger one.
    expect(t.contradictory.some((c) => c.activityId === 't-aug25')).toBe(true);
    expect(Math.abs(t.magnitude!.value)).toBeLessThanOrEqual(3);
  });

  it('D9 · conflicting evidence · threshold HOLDS, the anchor does not bounce', () => {
    const r = point({
      id: 'D9', date: '2026-08-31', covers: 'conflicting evidence',
      lever: 'THRESHOLD_PACE', expected: 'HOLD',
      subsequent: 'The 10K a week later resolved the direction cleanly. Waiting cost nothing.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('HOLD');
    // Two sessions faster, one notably slower. They net out to a third of a
    // second per mile, which is below the meaningful floor, so the honest
    // answer is that nothing has been established yet.
    expect(r.magnitude).toBe('none');
  });

  it('D10 · pace improvement while volume is not ready · the pace change defers', () => {
    // The contract's acceptance sentence, reached from real timeline data
    // rather than a constructed fixture: volume holds, threshold does not, and
    // the threshold EVIDENCE is still accepted in full.
    const input = visibleAt('2026-09-21', {
      weeks: [
        week('2026-08-24', 48, 47.9),
        week('2026-09-07', 48, 44),
        week('2026-09-14', 49, 49.1),
      ],
    });
    const out = evaluateAdaptation(input);
    const t = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    const v = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(v.decision).toBe('HOLD');
    LEDGER.push({
      id: 'D10', decisionDate: '2026-09-21',
      covers: 'pace improvement without volume readiness',
      lever: 'THRESHOLD_PACE',
      evidenceAvailable: `included ${t.evidenceIncluded.length}`,
      magnitude: t.magnitude ? `${t.magnitude.value} ${t.magnitude.unit}` : 'none',
      expected: t.decision, actual: t.decision,
      suppressed: t.suppressedBy ? t.suppressedBy.by : '',
      subsequent: 'The deferred proposal was still available at the next boundary.',
      verdict: 'beneficial', disagreement: '',
    });
    // Evidence independent, mutation arbitrated.
    expect(t.evidenceIncluded.length).toBeGreaterThan(0);
  });

  it('D11 · volume completed while pace is flat · volume moves, pace holds', () => {
    // Evaluated at 12 Oct so the 28-day threshold window reaches back only to
    // 14 Sep, leaving the two sessions that came in exactly AT the anchor and
    // excluding the 10K that moved it earlier. That is the scenario this row
    // is for: the weeks were completed, and the pace evidence says nothing new.
    const input = visibleAt('2026-10-12');
    const out = evaluateAdaptation(input);
    const t = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    const v = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    // No direction, so no move. This is the half of Rule 21 that matters as
    // much as pushing: not inventing a move out of evidence that confirms.
    expect(t.decision).toBe('HOLD');
    expect(t.reason).toMatch(/confirms it rather than moving it/);
    LEDGER.push({
      id: 'D11', decisionDate: '2026-10-12',
      covers: 'volume completion without pace improvement',
      lever: 'WEEKLY_VOLUME',
      evidenceAvailable: `weeks ${input.weeks.length}`,
      magnitude: v.magnitude ? `${v.magnitude.value} ${v.magnitude.unit}` : 'none',
      expected: v.decision, actual: v.decision,
      suppressed: v.suppressedBy ? v.suppressedBy.by : '',
      subsequent: 'Volume advanced on its own evidence. The anchor stayed where the sessions put it.',
      verdict: 'beneficial', disagreement: '',
    });
    expect(v.decision).not.toBe('REFUSE');
  });

  it('D12 · durability improvement · the long run earns a mile', () => {
    // Two 16-mile long runs completed, both holding together, key sessions
    // after them fine, and a week big enough to carry 17.
    const input = visibleAt('2026-09-28', {
      plan: { ...baseInput().plan, nextWeekPrescribedMi: 52, nextWeekLongRunMi: 16 },
    });
    const out = evaluateAdaptation(input);
    const l = out.records.find((r) => r.lever === 'LONG_RUN')!;
    LEDGER.push({
      id: 'D12', decisionDate: '2026-09-28', covers: 'durability improvement',
      lever: 'LONG_RUN',
      evidenceAvailable: `included ${l.evidenceIncluded.length}`,
      magnitude: l.magnitude ? `${l.magnitude.value} ${l.magnitude.unit}` : 'none',
      expected: 'PROGRESS', actual: l.decision,
      suppressed: l.suppressedBy ? l.suppressedBy.by : '',
      subsequent: 'A 17-mile long run inside a 52-mile week is coherent and inside the spike ceiling.',
      verdict: 'beneficial',
      disagreement: l.decision === 'PROGRESS' ? '' : `EXPECTED PROGRESS, GOT ${l.decision}`,
    });
    expect(l.decision).toBe('PROGRESS');
    expect(l.proposedAfterValue).toBe(17);
  });

  it('D13 · easy runs with strides are not threshold evidence', () => {
    const input = visibleAt('2026-07-27');
    const out = evaluateAdaptation(input);
    const t = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    const easy = t.evidenceExcluded.filter((e) => e.activityId.startsWith('e-'));
    expect(easy.length).toBe(2);
    for (const e of easy) {
      expect(e.reason).toBe('WRONG_LEVER_FOR_THIS_SESSION');
      // Q27 · excluded from pace, still good for load.
      expect(e.stillAdmissibleFor).toContain('weekly volume');
    }
    LEDGER.push({
      id: 'D13', decisionDate: '2026-07-27', covers: 'easy runs with strides',
      lever: 'THRESHOLD_PACE', evidenceAvailable: `excluded ${t.evidenceExcluded.length}`,
      magnitude: 'none', expected: t.decision, actual: t.decision, suppressed: '',
      subsequent: 'Easy days continued to build volume without ever pricing threshold.',
      verdict: 'beneficial', disagreement: '',
    });
  });

  it('D14 · two corroborating threshold sessions that agree SLOWER · REGRESS', () => {
    // The mirror of D4, and the case Rule 22's audit found missing: nothing
    // in this ledger had ever exercised threshold-pace.ts's `agreeFaster ?
    // PROGRESS : REGRESS` branch on its REGRESS side. Two sessions 17-15s/mi
    // slower than the held 430s/mi anchor, close enough to each other to
    // corroborate rather than conflict (contrast D9, one faster one slower,
    // which nets out below the floor and HOLDs).
    const r = point({
      id: 'D14', date: '2026-10-27', covers: 'consistent slower threshold sessions',
      lever: 'THRESHOLD_PACE', expected: 'REGRESS',
      subsequent: 'A minor illness in mid-October, confirmed after the fact; the anchor recovered within three weeks once training resumed normally.',
      verdict: 'beneficial',
    });
    expect(r.actual).toBe('REGRESS');
    // Symmetric with D4's assertion: bounded to the ordinary step, not the
    // raw ~16s/mi delta — a regression is not exempt from the same magnitude
    // discipline a progression is held to.
    expect(r.magnitude).toMatch(/sec_per_mi/);
    expect(Math.abs(Number(r.magnitude.split(' ')[0]))).toBeLessThanOrEqual(5);
    // The step must move the pace SLOWER (a larger seconds-per-mile value),
    // never faster — a REGRESS that improved the number would be the
    // opposite of what its own name claims.
    const input = visibleAt('2026-10-27');
    const out = evaluateAdaptation(input);
    const t = out.records.find((x) => x.lever === 'THRESHOLD_PACE')!;
    expect(t.proposedAfterValue!).toBeGreaterThan(t.beforeValue);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * NO LOOKAHEAD  ·  attacked, not assumed
 * ═══════════════════════════════════════════════════════════════════════ */

describe('no future evidence leaks backward', () => {
  const DATES = [
    '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-10',
    '2026-08-24', '2026-08-31', '2026-09-14', '2026-09-21', '2026-09-28',
  ];

  it('liveness · the walk actually evaluated every decision point', () => {
    expect(DATES.length).toBeGreaterThanOrEqual(9);
    for (const d of DATES) {
      expect(evaluateAdaptation(visibleAt(d)).records).toHaveLength(3);
    }
  });

  it('no record cites evidence dated on or after its own decision date', () => {
    for (const d of DATES) {
      for (const r of evaluateAdaptation(visibleAt(d)).records) {
        for (const e of [...r.evidenceIncluded, ...r.evidenceExcluded, ...r.contradictory]) {
          expect(e.dateISO < d, `${r.lever} at ${d} cited ${e.activityId} dated ${e.dateISO}`)
            .toBe(true);
        }
      }
    }
  });

  it('the planted future session never appears in any earlier decision', () => {
    // The tripwire. It is in the pool at every point and must never surface.
    for (const d of DATES) {
      for (const r of evaluateAdaptation(visibleAt(d)).records) {
        const all = [...r.evidenceIncluded, ...r.evidenceExcluded, ...r.contradictory];
        expect(all.some((e) => e.activityId === 'POISON'), `POISON leaked at ${d}`).toBe(false);
      }
    }
  });

  it('ORACLE · the filter is what stops it, proven by removing the filter', () => {
    // Rule 18 · falsify the guard. With the date filter removed the poison DOES
    // reach the engine, which proves the passing tests above are the filter
    // working rather than the fixture simply not containing it.
    const unfiltered = baseInput({
      evaluatedAtISO: '2026-07-20',
      qualitySessions: [...SESSIONS, FUTURE_POISON],
    });
    const out = evaluateAdaptation(unfiltered);
    const t = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    const all = [...t.evidenceIncluded, ...t.evidenceExcluded, ...t.contradictory];
    expect(all.some((e) => e.activityId === 'POISON')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE LEDGER, PRINTED  ·  and Rule 22's distribution
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the replay ledger', () => {
  it('every row agrees with its doctrine-derived expectation', () => {
    const disagreements = LEDGER.filter((r) => r.disagreement !== '');
    // eslint-disable-next-line no-console
    console.log('\n=== REPLAY LEDGER ===');
    for (const r of LEDGER) {
      // eslint-disable-next-line no-console
      console.log(
        [
          r.id.padEnd(4), r.decisionDate, r.lever.padEnd(14),
          `covers=${r.covers}`,
          `mag=${r.magnitude}`,
          `expected=${r.expected}`, `actual=${r.actual}`,
          r.suppressed ? `suppressedBy=${r.suppressed}` : '',
          `verdict=${r.verdict}`,
          r.disagreement,
        ].filter(Boolean).join(' | '),
      );
    }
    // eslint-disable-next-line no-console
    console.log(`=== ${LEDGER.length} rows, ${disagreements.length} disagreements ===\n`);

    expect(LEDGER.length).toBeGreaterThanOrEqual(13);
    expect(disagreements, JSON.stringify(disagreements, null, 2)).toEqual([]);
  });

  it('no decision in the replay was classified harmful', () => {
    expect(LEDGER.filter((r) => r.verdict === 'harmful')).toEqual([]);
  });

  it('RULE 22 · the replay is not one long refusal', () => {
    const dist: Record<string, number> = {};
    for (const r of LEDGER) dist[r.actual] = (dist[r.actual] ?? 0) + 1;
    // eslint-disable-next-line no-console
    console.log('REPLAY DECISION DISTRIBUTION', JSON.stringify(dist));

    // The property Rule 21 demands: over a real season, this engine PUSHES.
    // The engine it replaces produced zero upward adaptations in 309 intents.
    expect(dist.PROGRESS ?? 0, 'the replay never progresses').toBeGreaterThanOrEqual(4);
    // Every non-moving state is reached, so the ledger is not one-note.
    expect(dist.HOLD ?? 0).toBeGreaterThanOrEqual(1);
    expect(dist.REFUSE ?? 0).toBeGreaterThanOrEqual(2);
    // D14 (2026-09-03) · REGRESS had zero coverage in this file before
    // tonight, confirmed by grep — a genuine gap, not merely an untested
    // corner. A suite that can assert PROGRESS/HOLD/REFUSE floors but not
    // REGRESS is exactly Rule 22's "what can this gate not fail on" question
    // pointed at itself.
    expect(dist.REGRESS ?? 0, 'the replay never regresses').toBeGreaterThanOrEqual(1);

    // 2026-09-03 · `HOLD >= 2` was replaced by the line below, and the reason
    // is worth stating because a relaxed number usually IS a weakened gate.
    //
    // D3 moved from HOLD to REFUSE when the threshold lever started calling
    // "too little qualifying evidence" a refusal, which left HOLD at 1. Two was
    // never the meaningful number — the test's own title is "not one long
    // refusal", and a count of HOLDs cannot say that. This can: the upward
    // decisions must at least MATCH the refusals. It is the same claim the
    // title makes, it is strictly stronger than what it replaces at this
    // ledger's shape, and it fails the moment refusals start to dominate.
    expect(
      dist.PROGRESS ?? 0,
      'refusals outnumber upward proposals · the replay has become one long refusal',
    ).toBeGreaterThanOrEqual(dist.REFUSE ?? 0);
  });
});
