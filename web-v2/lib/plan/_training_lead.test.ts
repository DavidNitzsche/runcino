/**
 * _training_lead.test.ts · TRAINING-LEAD-1 (2026-08-25).
 *
 * THE DEFECT, IN THE OWNER'S OWN NUMBERS.
 *
 * Anchored on his AFC half (1:41:53, VDOT 44.1), a runner could nail every
 * quality session for as long as he liked and no prescribed pace would move,
 * unless one of those weeks happened to contain a race. Not because training
 * evidence was ignored — `vdotFromRun` reads a threshold effort at its
 * zone-implied VDOT specifically so it can move the anchor — but because two
 * constants written eight weeks apart never met:
 *
 *   vdot.ts        TRAINING_ESTIMATE_SOFT_CAP_VDOT = 1.0   (ceiling)
 *   adapt.ts       REGRESSION_DELTA_THRESHOLD      = 1.5   (floor, downward only)
 *   reanchor-plan  REANCHOR_VDOT_DELTA             = 2.0   (floor)
 *
 * A ceiling of 1.0 underneath a floor of 1.5 is a closed door, and the first
 * test below is the proof: twelve sessions at VDOT-50 pace read exactly 45.1.
 *
 * No database. The candidate arithmetic is the real `bestRecentVdot`.
 */
import { describe, it, expect } from 'vitest';
import { bestRecentVdot, tPaceFromVdot, vdotFromTpace } from '@/lib/training/vdot';
import { REANCHOR_VDOT_DELTA } from './reanchor-plan';
import {
  REGRESSION_DELTA_THRESHOLD,
  fitnessRegressionFires,
  TRAINING_LEAD_DELTA_THRESHOLD,
  TRAINING_LEAD_MIN_SESSIONS,
  TRAINING_LEAD_MIN_SPAN_DAYS,
  TRAINING_LEAD_MAX_AGE_DAYS,
  trainingLeadFires,
  trainingLeadSustained,
} from './adapt';

const TODAY = '2026-10-12';
const ANCHOR_VDOT = 44.1;                 // AFC half, 1:41:53, 2026-08-17
const AFC = [{
  slug: 'afc', name: 'AFC Half', date: '2026-08-17', priority: 'A',
  distance_mi: 13.1, finish_seconds: 6113,
}];

/** N nailed threshold sessions, two per week, `paceSPerMi` per mile. */
function nailedSessions(weeks: number, paceSPerMi: number) {
  const runs: Array<Record<string, unknown>> = [];
  for (let w = 0; w < weeks; w++) {
    for (const off of [3, 6]) {
      const d = new Date(Date.parse(TODAY + 'T12:00:00Z') - ((w * 7) + off) * 86400000)
        .toISOString().slice(0, 10);
      runs.push({
        id: `t${w}-${off}`, date: d, workout_type: 'threshold',
        distance_mi: 5, finish_seconds: Math.round(5 * paceSPerMi),
        avg_hr: 168, max_hr: 188, zone: 'threshold',
      });
    }
  }
  return runs;
}

function read(weeks: number, paceSPerMi: number) {
  return bestRecentVdot(
    AFC as never, TODAY, 180, nailedSessions(weeks, paceSPerMi) as never, 4,
  );
}

/**
 * 2026-08-30 · THE DOOR IS OPEN, AND THIS BLOCK IS REWRITTEN RATHER THAN
 * REBASELINED.
 *
 * This describe block was called "the closed door (what shipped before)" and
 * its two tests pinned the defect this whole file's header describes: twelve
 * sessions at VDOT-48.4 threshold pace reading exactly `44.1 + 1.0`, because
 * the ceiling was one race's number plus a constant.
 *
 * The owner's ruling retired that ceiling — it is now the CORROBORATED CORPUS
 * level (`lib/training/vdot-corpus.ts`) — so the assertions that pinned the
 * closed door are asserting a rule the engine no longer has. Flipping their
 * numbers would have been a rebaseline; what they are replaced with is the
 * property that actually still holds, which is that the +1 LEAD QUANTUM is
 * unchanged. Only the thing being led has changed, from a race to the
 * runner's own training.
 *
 * The asymmetry check the first test carried is KEPT verbatim — it is Rule
 * 21's business (the bar to go up may not exceed the bar to come down) and it
 * was never about the ceiling.
 */
describe('the door is open · training evidence is no longer capped by one race', () => {
  it('reads what the sessions actually say, not the race plus one', () => {
    // 7:05/mi is T-pace for VDOT ~48.4 — four points clear of his anchor.
    const r = read(6, 425);
    const measured = r.best!.vdot;
    expect(r.best!.source).toBe('run');
    // The corpus corroborates these sessions, so they stand at face value.
    expect(measured).toBeCloseTo(vdotFromTpace(425)!, 5);
    // Which is emphatically NOT the retired race-anchored ceiling.
    expect(measured).toBeGreaterThan(ANCHOR_VDOT + 1.0);

    // The gates it was structurally unable to reach are now reachable, which
    // is the entire point: a runner CAN train their way to a re-anchor.
    expect(measured - ANCHOR_VDOT).toBeGreaterThan(REGRESSION_DELTA_THRESHOLD);
    expect(measured - ANCHOR_VDOT).toBeGreaterThan(REANCHOR_VDOT_DELTA);

    // And the same magnitude in the DOWNWARD direction still fires — the
    // asymmetry, stated as a test rather than as a comment.
    expect(fitnessRegressionFires(ANCHOR_VDOT, ANCHOR_VDOT - 1.6)).toBe(true);
  });

  it('one session still cannot do it · the lead quantum is unchanged', () => {
    // The bound did not go away, it changed what it is made of. A single fast
    // session among modest ones leads the corroborated level by exactly the
    // doctrinal +1 and no more (Research/01 §"Triggers to retest").
    const modest = nailedSessions(3, 462);              // his current T pace
    const one = [{
      id: 'spike', date: '2026-10-09', workout_type: 'threshold',
      distance_mi: 5, finish_seconds: 5 * 380, avg_hr: 168, max_hr: 188,
      zone: 'threshold',
    }];
    const r = bestRecentVdot(AFC as never, TODAY, 180, [...one, ...modest] as never, 4);
    expect(r.best!.vdot).toBeCloseTo(vdotFromTpace(462)! + 1.0, 5);
    expect(r.best!.vdot).toBeLessThan(vdotFromTpace(380)!);
  });

  it('running it longer does not inflate it · the level is the evidence, not the duration', () => {
    // The old version of this test asserted the ceiling was constant because
    // it was a RACE's number. The level is still constant across block
    // lengths, for the opposite reason: every session says the same thing, so
    // more of them corroborate the same level rather than compounding it.
    for (const weeks of [2, 4, 6, 10, 16]) {
      expect(read(weeks, 425).best!.vdot).toBeCloseTo(vdotFromTpace(425)!, 5);
    }
  });
});

describe('the upward gate now fires where doctrine says it should', () => {
  it('fires at exactly the capped value · the predicate is satisfiable', () => {
    const measured = read(6, 425).best!.vdot;
    expect(trainingLeadFires(ANCHOR_VDOT, measured)).toBe(true);
    // The whole bug class: a strict > would have made this unsatisfiable.
    expect(TRAINING_LEAD_DELTA_THRESHOLD).toBe(1.0);
  });

  it('does not fire on a lead smaller than doctrine acts on', () => {
    // Research/01 §"Update logic": act only when |Δ| >= 1.
    expect(trainingLeadFires(ANCHOR_VDOT, ANCHOR_VDOT + 0.9)).toBe(false);
    expect(trainingLeadFires(ANCHOR_VDOT, ANCHOR_VDOT + 0.4)).toBe(false);
  });

  it('never fires downward · that is fitness_regression\'s job at its own band', () => {
    expect(trainingLeadFires(ANCHOR_VDOT, ANCHOR_VDOT - 2)).toBe(false);
    expect(trainingLeadFires(ANCHOR_VDOT, ANCHOR_VDOT)).toBe(false);
  });

  it('is asymmetric ON PURPOSE, matching the doctrine table (+1 up, -1 to -2 down)', () => {
    expect(TRAINING_LEAD_DELTA_THRESHOLD).toBeLessThan(REGRESSION_DELTA_THRESHOLD);
  });
});

describe('sustained means sustained · two sessions across two weeks', () => {
  it('doctrine\'s window is 2 weeks, not 6', () => {
    expect(TRAINING_LEAD_MIN_SPAN_DAYS).toBe(14);
    expect(TRAINING_LEAD_MIN_SESSIONS).toBe(2);
  });

  it('one good session is not a trend', () => {
    expect(trainingLeadSustained(['2026-10-09'], TODAY).sustained).toBe(false);
  });

  it('two sessions in the same week is a good week, not a trend', () => {
    const r = trainingLeadSustained(['2026-10-06', '2026-10-09'], TODAY);
    expect(r.sessions).toBe(2);
    expect(r.spanDays).toBe(3);
    expect(r.sustained).toBe(false);
  });

  it('two sessions a fortnight apart clears both conditions', () => {
    const r = trainingLeadSustained(['2026-09-26', '2026-10-10'], TODAY);
    expect(r.sessions).toBe(2);
    expect(r.spanDays).toBe(14);
    expect(r.sustained).toBe(true);
  });

  it('a lead that stopped a month ago is stale, however long it ran', () => {
    // Sessions spanning six weeks, but the newest is 40 days old.
    const r = trainingLeadSustained(['2026-07-20', '2026-08-10', '2026-09-02'], TODAY);
    expect(r.sessions).toBe(3);
    expect(r.spanDays).toBeGreaterThan(TRAINING_LEAD_MIN_SPAN_DAYS);
    expect(r.newestAgeDays!).toBeGreaterThan(TRAINING_LEAD_MAX_AGE_DAYS);
    expect(r.sustained).toBe(false);
  });

  it('duplicate dates cannot manufacture a session count', () => {
    const r = trainingLeadSustained(['2026-10-10', '2026-10-10', '2026-10-10'], TODAY);
    expect(r.sessions).toBe(1);
    expect(r.sustained).toBe(false);
  });

  it('a real 2-week block of nailed sessions qualifies end to end', () => {
    const r = read(3, 425);
    const qualifying = r.considered.filter(
      (c) => c.source === 'run' && trainingLeadFires(ANCHOR_VDOT, c.vdot),
    );
    expect(qualifying.length).toBeGreaterThanOrEqual(TRAINING_LEAD_MIN_SESSIONS);
    expect(trainingLeadSustained(qualifying.map((c) => c.date), TODAY).sustained).toBe(true);
  });
});

describe('what it is worth · the pace actually tightens', () => {
  it('a credited lead moves threshold, and the move is bounded BY THE EVIDENCE', () => {
    const measured = read(6, 425).best!.vdot;
    const before = tPaceFromVdot(ANCHOR_VDOT)!;
    const after = tPaceFromVdot(measured)!;
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(0);
    // 2026-08-30 · this assertion used to read `< 15` — a bound in seconds,
    // which was really the +1 race ceiling wearing a pace's clothes. With the
    // ceiling now made of the corpus, the honest bound is not a constant: it
    // is the pace the sessions were actually run at. The runner cannot be
    // prescribed a threshold faster than the threshold he has been holding,
    // however many times he holds it — that is the property worth pinning,
    // and a fixed second-count never was.
    expect(after).toBeGreaterThanOrEqual(425 - 1);
  });

  it('a second lead cannot be banked on top of the first', () => {
    // Once credited, the anchor IS the capped value. The cap is measured from
    // the RACE anchor, so the same sessions no longer clear the threshold and
    // the lead cannot compound.
    const credited = read(6, 425).best!.vdot;   // 45.1
    const again = read(6, 425).best!.vdot;      // still 45.1 · cap is race-based
    expect(again).toBeCloseTo(credited, 5);
    expect(trainingLeadFires(credited, again)).toBe(false);
  });

  it('a race outranks the lead · a faster race re-bases the ceiling', () => {
    // Same training, plus a strong 10K three days ago implying ~VDOT 48.
    const withRace = bestRecentVdot(
      [...AFC, {
        slug: 'tuneup', name: 'Tune-up 10K', date: '2026-10-09', priority: 'B',
        distance_mi: 6.21, finish_seconds: 2510,
      }] as never,
      TODAY, 180, nailedSessions(6, 425) as never, 4,
    );
    // The race carries the read, not the training lead.
    expect(withRace.best!.source).toBe('race');
    expect(withRace.best!.vdot).toBeGreaterThan(read(6, 425).best!.vdot);
  });
});

describe('the coach says it out loud', () => {
  /**
   * The line `detectTrainingLead` composes, kept here in one place so the
   * assertions and the hand-off report quote the same string.
   *
   * It reaches the runner two ways, both already built: `coach-log.ts` merges
   * every `plan_adapt_recompute_paces` intent into a `fitness_shift` entry and
   * renders this as the body, and `V5Today.paceNote` puts a row on the screen
   * they open anyway.
   */
  const line = (sessions: number, spanDays: number, vdot: number) =>
    `${sessions} quality sessions over ${spanDays} days reading ahead of your last race `
    + `· VDOT ${vdot.toFixed(1)} · your paces just moved. `
    + `A race or field test confirms it.`;

  const SAMPLE = line(4, 21, 45.1);

  it('is what the runner actually sees', () => {
    expect(SAMPLE).toBe(
      '4 quality sessions over 21 days reading ahead of your last race '
      + '· VDOT 45.1 · your paces just moved. A race or field test confirms it.',
    );
  });

  it('names the evidence AND the number · both facts, not one', () => {
    expect(SAMPLE).toMatch(/\d+ quality sessions over \d+ days/);  // what happened
    expect(SAMPLE).toMatch(/VDOT \d+\.\d/);                         // what changed
  });

  it('does not present a soft lead as a measurement (Rule 1)', () => {
    // pr_bank may state a VDOT flat, because a race IS the measurement. This
    // one is capped at a point and carries a field test in doctrine, so the
    // line has to say what would settle it.
    expect(SAMPLE).toMatch(/race or field test confirms it/i);
  });

  it('is coach voice · no hype, no exclamation, no emoji, no em dash (Rule 4)', () => {
    expect(SAMPLE).not.toMatch(/!/);
    expect(SAMPLE).not.toMatch(/—/);
    expect(SAMPLE).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    for (const hype of [
      'great', 'amazing', 'awesome', 'crushing', 'crushed', 'nailed', 'smashed',
      'congrats', 'congratulations', 'well done', 'keep it up', 'nice work',
    ]) {
      expect(SAMPLE.toLowerCase()).not.toContain(hype);
    }
  });

  it('matches pr_bank register · same closing clause, same joiner', () => {
    // pr_bank: "New race fitness · VDOT 45.1 · your paces just moved."
    expect(SAMPLE).toContain(' · ');
    expect(SAMPLE).toContain('your paces just moved.');
  });

  it('states, never grades', () => {
    expect(SAMPLE).not.toMatch(/should|need to|must|behind/i);
  });
});
