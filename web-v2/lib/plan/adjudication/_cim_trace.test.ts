/**
 * lib/plan/adjudication/_cim_trace.test.ts · THE CIM BLOCK, ADJUDICATED.
 *
 * The live decision trace for the block authored 2026-09-03 against California
 * International Marathon, 2026-12-06. Re-run 2026-09-04 on CORRECTED history
 * after David rejected the first version on seven counts.
 *
 * ── WHY THE FIRST RUN WAS WRONG, KEPT SO IT IS NOT REPEATED ────────────────
 *
 * The first trace read history through `startLocal >= '2026-06-01'` and then
 * reported the result as "his longest run of 2026". It is Rule 14 exactly: a
 * query that ran without error over a population nobody intended, and Rule 16,
 * one number printed under another's label. Three classifications were wrong
 * and every one of them made him look less capable than he is:
 *
 *   longest run       18.0  ->  21.51 (2026-01-25)
 *   peak week         47.5  ->  48.5  (week of 2026-02-09)
 *   post-half at D+7  11.01 ->  the MAXIMUM of {21.51, 17.21, 11.01}
 *
 * And the fixture in this file pinned 18.0 as a literal, so the whole suite
 * passed on it. Rule 18: a test that agrees with itself proves nothing. The
 * numbers below are therefore pinned to the production query AND the query is
 * written out beside them, so the next reader can re-run it.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on the history being wrong, only on the ADJUDICATION of a
 * given history being wrong. If the numbers below drift from production this
 * file will keep passing. That is the failure that produced the first version,
 * and the only real defence is the query being written down here rather than
 * the numbers being trusted. `_history_provenance.test.ts` is where a live
 * check would go, and it does not exist yet, which is stated rather than
 * implied (Rule 20).
 */
import { describe, it, expect } from 'vitest';
import {
  athleteEvidenceFor, ceilingClaimFrom, checkPromotion, detectSimultaneousStressAddition,
  detectStackedStress, earningGateFor, heuristicRankScore, rankOptions,
  type DemonstratedHistory, type PlannedWeek,
} from '@/lib/plan/adjudication/adjudicate';
import type { ComparableSession, DecisionTrace, OptionAppraisal } from '@/lib/plan/adjudication/contract';

/**
 * CORRECTED history. Read 2026-09-04 from production with:
 *
 *   SELECT (data->>'startLocal')::date, (data->>'distanceMi')::numeric
 *   FROM runs
 *   WHERE user_uuid = <owner>
 *     AND NOT (data ? 'mergedIntoId')          -- Rule 14, the canonical predicate
 *     AND (data->>'startLocal') >= '2026-01-01' -- the WHOLE year, which is the fix
 *
 * Longest training runs: 21.51 (01-25), 20.02 (04-05), 20.00 (02-15), 19.00
 * (01-11), 18.00 (07-25). Races above those: Big Sur 26.81, LA 26.70.
 * Peak week 48.5 (w/c 02-09), then 47.5, 47.3, 45.8, 44.9, 44.7.
 */
const HISTORY_WINDOW = 'all of 2026, canonical rows only';

/** What he did at exactly D+7 after each half marathon he raced in 2026. */
const POST_HALF_D7: readonly ComparableSession[] = [
  { dateISO: '2026-01-25', what: 'D+7 after Rose Bowl Half', distanceMi: 21.51, avgPaceSecPerMi: null,
    avgHrBpm: null, executed: true, next7DaysMi: 18.4, notes: 'His longest run of 2026 came at this offset.' },
  { dateISO: '2026-02-08', what: 'D+7 after Disney Half', distanceMi: 17.21, avgPaceSecPerMi: null,
    avgHrBpm: null, executed: true, next7DaysMi: 21.2, notes: '83.3 mi in the 14 days after that half.' },
  { dateISO: '2026-08-23', what: 'D+7 after AFC Half', distanceMi: 11.01, avgPaceSecPerMi: null,
    avgHrBpm: null, executed: true, next7DaysMi: 22.9, notes: 'The smallest of the three, and the one the first trace mistook for a limit.' },
];

const HIST: DemonstratedHistory = {
  peakWeeklyMi: 48.5,
  longestRunMi: 21.51,
  // No plan-linked marathon-pace dose exists in his history: EXACT execution
  // identity only began stamping in September. Rule 11 says that is an absence,
  // not a zero, so it is null and the decision on M dose is UNKNOWN-classed and
  // gated rather than waved through on race evidence.
  maxCompletedMpMi: null,
  maxStressorsInAWeek: null,
  after: POST_HALF_D7,
  windowDescribed: HISTORY_WINDOW,
};

/** The block as authored, plan pln_7636bcc0a201bf2d. */
const WEEK_1026: PlannedWeek = {
  weekStartISO: '2026-10-26', weeklyMi: 60.0, longestMi: 21.5,
  stressors: ['6 mi at T', '9x3 min at I', '21.5 mi long'],
  mpMi: 0, isTaper: false, isRaceWeek: false,
};
const WEEK_1116: PlannedWeek = {
  weekStartISO: '2026-11-16', weeklyMi: 49.0, longestMi: 16.0,
  stressors: ['16 mi long with 4 mi at M'],
  mpMi: 4, isTaper: false, isRaceWeek: false,
};

function opt(o: OptionAppraisal['option'], describe: string, cls: OptionAppraisal['evidenceClass'], risk: string): OptionAppraisal {
  return { option: o, describe, evidenceClass: cls, heuristicRankScore: heuristicRankScore(cls), risk };
}

describe('CIM block · corrected history', () => {
  it('the 21.5 mile long run is SUPPORTED, not a reach · he has run 21.51', () => {
    const ev = athleteEvidenceFor({
      what: 'the 21.5 mile long run on 2026-11-01',
      asOfISO: '2026-11-01',
      prescribed: 21.5,
      demonstratedMaxToday: HIST.longestRunMi,
      demonstratedMaxProjected: 21.5, // the block's own 20.0 on 10-18, then this
      comparables: [],
      historyWindow: HISTORY_WINDOW,
    });
    expect(ev.evidenceClass).toBe('SUPPORTED');
    // The step the first trace called +19% is in fact very slightly negative.
    expect(ev.stepOverDemonstratedToday).toBeLessThan(0);
    expect(ev.demonstratedMaxToday.value).toBe(21.51);
    expect(ev.demonstratedMaxToday.provenance).toBe('ATHLETE_EVIDENCE');
  });

  it('the 60 mile week is ALLOWED today and SUPPORTED against what the block builds', () => {
    const today = athleteEvidenceFor({
      what: 'the 60.0 mile week of 2026-10-26',
      asOfISO: '2026-10-26',
      prescribed: 60.0,
      demonstratedMaxToday: HIST.peakWeeklyMi,
      demonstratedMaxProjected: null,
      comparables: [],
      historyWindow: HISTORY_WINDOW,
    });
    // +23.7% on 48.5. A real reach, inside the band a table permits.
    expect(today.evidenceClass).toBe('ALLOWED');

    // Judged against the runner the plan builds by then: the block asks 55.2 in
    // September and 59.5/59.6 in the first half of October, so 60.0 is the
    // smallest step in the chain rather than the largest.
    const projected = athleteEvidenceFor({
      what: 'the 60.0 mile week of 2026-10-26',
      asOfISO: '2026-10-26',
      prescribed: 60.0,
      demonstratedMaxToday: HIST.peakWeeklyMi,
      demonstratedMaxProjected: 59.6,
      comparables: [],
      historyWindow: HISTORY_WINDOW,
    });
    expect(projected.evidenceClass).toBe('SUPPORTED');
    // And the projection is labelled an assumption, never a measurement.
    expect(projected.demonstratedMaxProjected.provenance).toBe('POLICY_ASSUMPTION');
  });

  it('defect 3 · the post-half ceiling is the MAXIMUM of the set, and 16 mi clears it', () => {
    const claim = ceilingClaimFrom(HIST.after, (c) => c.distanceMi);
    expect(claim).not.toBeNull();
    expect(claim?.value).toBe(21.51);       // not 11.01
    expect(claim?.comparableCount).toBe(3);
    expect(claim?.valid).toBe(true);

    const ev = athleteEvidenceFor({
      what: 'the 16 mile long run seven days after Malibu',
      asOfISO: '2026-11-15',
      prescribed: 16.0,
      demonstratedMaxToday: claim?.value ?? null,
      demonstratedMaxProjected: null,
      comparables: HIST.after,
      ceilingQuantity: (c) => c.distanceMi,
      historyWindow: HISTORY_WINDOW,
    });
    expect(ev.evidenceClass).toBe('SUPPORTED');
  });

  it('defect 3 · a single comparable may not produce a refusal', () => {
    const one = [POST_HALF_D7[2]]; // the 11.01 alone, which is what the first trace used
    const claim = ceilingClaimFrom(one, (c) => c.distanceMi);
    expect(claim?.valid).toBe(false);
    expect(claim?.why).toContain('not a demonstrated capacity limit');
  });

  it('the 10-26 week is stacked but does NOT peak simultaneously', () => {
    const s = detectStackedStress(WEEK_1026, HIST);
    expect(s).not.toBeNull();
    expect(s?.stressors).toHaveLength(3);
    // The long run is level with his demonstrated max and the volume is inside
    // the allowed band, so the triple peak the layer exists to catch is absent.
    expect(s?.simultaneousPeak).toBe(false);
  });

  it('defect 6 · the 60 mile week carries an earning gate rather than a verdict', () => {
    const gate = earningGateFor({
      decisionId: 'cim-vol-1026',
      what: 'the 60.0 mile week',
      prescribed: 60.0,
      demonstratedMaxToday: 48.5,
      assessOnISO: '2026-10-12',
      requires: [
        { what: 'a 55 mile week completed', measurable: 'weekly canonical mileage >= 55.2 with no session graded MISSED', byISO: '2026-09-27' },
        { what: 'a 59 mile week completed', measurable: 'weekly canonical mileage >= 59.0 with no session graded MISSED', byISO: '2026-10-12' },
      ],
      ifUnmet: 'REDUCE',
      reduceTo: 55.0,
    });
    expect(gate.ifUnmet).toBe('REDUCE');
    expect(gate.assessOnISO < WEEK_1026.weekStartISO).toBe(true);
    expect(gate.explain).toContain('becomes supported if');
  });

  it('defect 4 · the ranking score is labelled a policy assumption, not an expectation', () => {
    const s = heuristicRankScore('SUPPORTED');
    expect(s?.provenance).toBe('POLICY_ASSUMPTION');
    expect(s?.basis).toContain('not measured');
    expect(heuristicRankScore('UNKNOWN')).toBeNull();
  });

  it('doctrine one-at-a-time · the 2026-09-21 week adds mileage AND intensity', () => {
    // Research/00a §"Practical load rules": "Either add mileage OR add intensity
    // in a given week, not both." The block goes 46.8 mi with 2 stressors to
    // 55.2 with 3. Two independent lines land on the same week: it is also the
    // only week rated above SUPPORTED on volume.
    const w0914: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 46.8, longestMi: 16.5,
      stressors: ['threshold', '16.5 mi long'], mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    const w0921: PlannedWeek = {
      weekStartISO: '2026-09-21', weeklyMi: 55.2, longestMi: 17.0,
      stressors: ['Dodgers 10k', 'tempo', '17 mi long'], mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    const f = detectSimultaneousStressAddition(w0921, [w0914]);
    expect(f).not.toBeNull();
    expect(f?.stressorsBefore).toBe(2);
    expect(f?.stressorsAfter).toBe(3);
    expect(f?.volumeStep).toBeGreaterThan(0.17);
  });

  it('a CUTBACK is not the baseline for an addition claim either', () => {
    // The defect this function shipped with. Comparing against the immediately
    // preceding week made every week after a planned dip look like a spike.
    // Measured on the live block, that misreported four of thirteen weeks.
    //
    // My first version of this test asserted the wrong thing and the test
    // caught me: against the trailing max, 2026-10-05 adds mileage (+7.8%) but
    // does NOT add intensity, because 2026-09-21 two weeks earlier already
    // carried three stressors. So the correct answer is no finding at all, and
    // the single-previous-week reading produced one.
    const w0921: PlannedWeek = { weekStartISO: '2026-09-21', weeklyMi: 55.2, longestMi: 17.0,
      stressors: ['race', 'tempo', 'long'], mpMi: 0, isTaper: false, isRaceWeek: false };
    const cutback: PlannedWeek = { weekStartISO: '2026-09-28', weeklyMi: 43.0, longestMi: 14.0,
      stressors: ['intervals'], mpMi: 0, isTaper: false, isRaceWeek: false };
    const w1005: PlannedWeek = { weekStartISO: '2026-10-05', weeklyMi: 59.5, longestMi: 18.5,
      stressors: ['intervals', 'tempo', 'long'], mpMi: 0, isTaper: false, isRaceWeek: false };

    expect(detectSimultaneousStressAddition(w1005, [w0921, cutback])).toBeNull();
  });

  it('the baseline is the trailing MAX, so a cutback cannot inflate the step', () => {
    // Same shape, but with a genuine stressor increase so the finding fires and
    // its volumeStep is observable. Against the cutback alone this is +38.4%;
    // against the trailing max it is +7.8%, because 55.2 is what he was
    // actually doing two weeks before.
    const w0921: PlannedWeek = { weekStartISO: '2026-09-21', weeklyMi: 55.2, longestMi: 17.0,
      stressors: ['tempo', 'long'], mpMi: 0, isTaper: false, isRaceWeek: false };
    const cutback: PlannedWeek = { weekStartISO: '2026-09-28', weeklyMi: 43.0, longestMi: 14.0,
      stressors: ['intervals'], mpMi: 0, isTaper: false, isRaceWeek: false };
    const w1005: PlannedWeek = { weekStartISO: '2026-10-05', weeklyMi: 59.5, longestMi: 18.5,
      stressors: ['intervals', 'tempo', 'long'], mpMi: 0, isTaper: false, isRaceWeek: false };

    const f = detectSimultaneousStressAddition(w1005, [w0921, cutback]);
    expect(f).not.toBeNull();
    expect(f?.stressorsBefore).toBe(2);   // the max, not the cutback's one
    expect(f?.volumeStep).toBeGreaterThan(0.05);
    expect(f?.volumeStep).toBeLessThan(0.10);   // +7.8%, not +38.4%
  });

  it('a week that is FLAT against the trailing max is not an addition at all', () => {
    // 2026-10-26 reads +30.4% against the preceding cutback and +0.7% against
    // the trailing max. The block is flat there, and the first version called
    // it a mileage increase.
    const w1012 = { weekStartISO: '2026-10-12', weeklyMi: 59.6, longestMi: 20.0,
      stressors: ['threshold', 'long'], mpMi: 0, isTaper: false, isRaceWeek: false };
    const w1019 = { weekStartISO: '2026-10-19', weeklyMi: 46.0, longestMi: 15.0,
      stressors: ['intervals', 'tempo'], mpMi: 0, isTaper: false, isRaceWeek: false };
    const w1026 = { weekStartISO: '2026-10-26', weeklyMi: 60.0, longestMi: 21.5,
      stressors: ['tempo', 'intervals', 'long'], mpMi: 0, isTaper: false, isRaceWeek: false };
    expect(detectSimultaneousStressAddition(w1026, [w1012, w1019])).toBeNull();
  });

  it('a taper week is not the baseline for an addition claim', () => {
    // Comparing against a prescribed dip makes the week after it look like a
    // spike. Rule 8 in miniature: a taper is never the runner's normal.
    const taper: PlannedWeek = {
      weekStartISO: '2026-09-07', weeklyMi: 24.4, longestMi: 6.2,
      stressors: ['Santa Monica 10k'], mpMi: 0, isTaper: false, isRaceWeek: true,
    };
    const after: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 46.8, longestMi: 16.5,
      stressors: ['threshold', '16.5 mi long'], mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    expect(detectSimultaneousStressAddition(after, [taper])).toBeNull();
  });

  it('promotion BLOCKS a one-at-a-time week that was pushed with no gate', () => {
    // Caught by falsification, not by design: disabling the promotion-level
    // block left the whole suite green, because the detector was tested and the
    // gate acting on it was not. Rule 18, on my own gate.
    const w0914: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 46.8, longestMi: 16.5,
      stressors: ['threshold', '16.5 mi long'], mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    const w0921: PlannedWeek = {
      weekStartISO: '2026-09-21', weeklyMi: 55.2, longestMi: 17.0,
      stressors: ['Dodgers 10k', 'tempo', '17 mi long'], mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    const base = (gate: DecisionTrace['earningGate']): DecisionTrace => ({
      decisionId: 'vol-0921', dateISO: '2026-09-21', what: '55.2 mi week', windowDays: 7,
      athlete: athleteEvidenceFor({
        what: '55.2 mi week', asOfISO: '2026-09-21', prescribed: 55.2,
        demonstratedMaxToday: 48.5, demonstratedMaxProjected: null,
        comparables: [], historyWindow: HISTORY_WINDOW,
      }),
      stacked: detectStackedStress(w0921, HIST),
      demand: null,
      options: [
        opt('PUSH', 'run 55.2', 'ALLOWED', 'adds mileage and a stressor together'),
        opt('HOLD', 'hold at 48.5', 'SUPPORTED', ''),
        opt('PULL_BACK', 'drop the tune-up', 'SUPPORTED', ''),
      ],
      chosen: 'PUSH',
      because: 'the block needs the volume',
      rejected: [], conflicts: [], citations: [],
      reassessOnISO: '2026-09-20',
      earningGate: gate,
    });

    const blockedRes = checkPromotion([base(null)], { weeks: [w0914, w0921] });
    expect(blockedRes.check.recoverability).toBe(false);
    expect(blockedRes.blockedBecause.join(' ')).toMatch(/add mileage AND intensity together/);
    expect(blockedRes.blockedBecause.join(' ')).toMatch(/2026-09-21/);

    // …and clears once the week carries a gate, because the rule asks for the
    // decision to be argued, not for the week to be forbidden.
    const gated = base(earningGateFor({
      decisionId: 'vol-0921', what: '55.2 mi week', prescribed: 55.2,
      demonstratedMaxToday: 48.5, assessOnISO: '2026-09-20',
      requires: [{ what: 'the 46.8 mi week completed', measurable: 'weekly mileage >= 46.8, no session graded MISSED', byISO: '2026-09-20' }],
      ifUnmet: 'REDUCE', reduceTo: 48.5,
    }));
    const okRes = checkPromotion([gated], { weeks: [w0914, w0921] });
    expect(okRes.check.recoverability).toBe(true);
  });

  it('the block passes promotion once every conditional carries a gate', () => {
    const mk = (id: string, week: PlannedWeek, chosen: DecisionTrace['chosen'], cls: OptionAppraisal['evidenceClass']): DecisionTrace => ({
      decisionId: id, dateISO: week.weekStartISO, what: id, windowDays: 7,
      athlete: athleteEvidenceFor({
        what: id, asOfISO: week.weekStartISO, prescribed: week.weeklyMi,
        demonstratedMaxToday: HIST.peakWeeklyMi, demonstratedMaxProjected: week.weeklyMi,
        comparables: [], historyWindow: HISTORY_WINDOW,
      }),
      stacked: detectStackedStress(week, HIST),
      demand: null,
      options: [
        opt('PUSH', 'run it as authored', cls, 'volume he has not held'),
        opt('HOLD', 'cap the week where it is', 'SUPPORTED', 'leaves adaptation on the table'),
        opt('PULL_BACK', 'cut a stressor', 'SUPPORTED', 'loses a session he can absorb'),
      ],
      chosen,
      because: 'the projected chain supports it and the gate checks the chain',
      rejected: [],
      conflicts: [],
      citations: [],
      reassessOnISO: '2026-10-12',
      earningGate: earningGateFor({
        decisionId: id, what: id, prescribed: week.weeklyMi, demonstratedMaxToday: 48.5,
        assessOnISO: '2026-10-12',
        requires: [{ what: 'a 55 mile week completed', measurable: 'weekly mileage >= 55.2', byISO: '2026-09-27' }],
        ifUnmet: 'REDUCE', reduceTo: 55.0,
      }),
    });

    const res = checkPromotion(
      [mk('cim-vol-1026', WEEK_1026, 'PUSH', 'ALLOWED'), mk('cim-long-1116', WEEK_1116, 'HOLD', 'SUPPORTED')],
      { weeks: [WEEK_1026, WEEK_1116] },
    );
    expect(res.blockedBecause).toEqual([]);
    expect(res.mayPromote).toBe(true);
    expect(res.earningGates).toHaveLength(2);
  });

  it('rankOptions prefers the supported push, which is the whole direction of the layer', () => {
    const ranked = rankOptions([
      opt('HOLD', 'hold', 'SUPPORTED', ''),
      opt('PUSH', 'push', 'SUPPORTED', ''),
      opt('PULL_BACK', 'pull back', 'SUPPORTED', ''),
    ]);
    expect(ranked[0].option).toBe('PUSH');
  });
});
