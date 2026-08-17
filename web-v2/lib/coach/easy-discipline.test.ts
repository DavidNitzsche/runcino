/**
 * lib/coach/easy-discipline.test.ts
 *
 * Locks the three things that decide whether this observation is trustworthy:
 *
 *   1 · THE PATTERN GATE. It fires on a sustained pattern and stays silent on
 *       anything less. The failure mode being prevented is a system that
 *       grades individual runs, which the owner deliberately removed
 *       (feedback_no_reactive_coach).
 *   2 · PER-RUN CONTEXT FILTERING, including the asymmetry that makes it
 *       honest: heat and cardiac drift kill the HR read but NOT the pace read,
 *       because neither makes a runner faster.
 *   3 · THE WORDS. Coach voice, and every line carries a number and an action.
 *
 * The DB shell (loadEasyDiscipline) is not exercised here, matching the house
 * policy in coach-log.test.ts: the composed WORDS and the pure gate are locked,
 * the query shell is exercised in prod.
 */
import { describe, it, expect } from 'vitest';
import {
  detectEasyDiscipline,
  classifyEasyRun,
  composeEasyDisciplineEntry,
  composeEasyDisciplineResolved,
  raceWindowFor,
  weekKeyOf,
  FILTER_INVALIDATES,
  EASY_HRMAX_CEILING_PCT,
  HEAT_CONFOUND_TEMP_F,
  TERRAIN_CONFOUND_FT_PER_MI,
  DRIFT_CONFOUND_MINUTES,
  type EasyRunObservation,
  type EasyDisciplineInput,
} from './easy-discipline';

const TODAY = '2026-08-17';
const MAX_HR = 179;
/** round(179 * 0.78) = 140 */
const CEILING = Math.round(MAX_HR * EASY_HRMAX_CEILING_PCT);
const BAND: [number, number] = [533, 573]; // 8:53 to 9:33 per mile

/** Five clean easy days across four distinct weeks · the minimum shape that
 *  can establish a pattern at all. Cool, flat, no race near, under an hour. */
const DATES = ['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-14'];

function run(over: Partial<EasyRunObservation> = {}): EasyRunObservation {
  return {
    dateISO: '2026-08-10',
    distanceMi: 6,
    paceSPerMi: 550, // inside the band
    avgHrBpm: 132, // under the ceiling
    durationSec: 3300,
    tempF: 62,
    baselineTempF: 62,
    elevGainFt: 30,
    daysFromNearestRace: null,
    ...over,
  };
}

function input(runs: EasyRunObservation[], over: Partial<EasyDisciplineInput> = {}): EasyDisciplineInput {
  return {
    todayISO: TODAY,
    maxHrBpm: MAX_HR,
    prescribedEasyCapBpm: null,
    easyPaceBandSPerMi: BAND,
    runs,
    ...over,
  };
}

/** Five easy days all run over the HR ceiling · the establishing shape. */
const hardHrDays = () => DATES.map((dateISO) => run({ dateISO, avgHrBpm: 152 }));
/** The same five, all back under it. */
const easyHrDays = () => DATES.map((dateISO) => run({ dateISO, avgHrBpm: 132 }));

describe('the pattern gate', () => {
  it('fires on a sustained pattern across several weeks', () => {
    const f = detectEasyDiscipline(input(hardHrDays()));
    expect(f.state).toBe('established');
    expect(f.basis).toBe('hr');
    expect(f.qualifying).toBe(5);
    expect(f.over).toBe(5);
    expect(f.distinctWeeks).toBeGreaterThanOrEqual(3);
  });

  it('stays silent on a single bad day', () => {
    const f = detectEasyDiscipline(input([run({ dateISO: '2026-08-10', avgHrBpm: 165 })]));
    expect(f.state).toBe('quiet');
    expect(f.quietReason).toBe('insufficient_evidence');
  });

  it('stays silent when the runs are enough in number but crammed into one week', () => {
    const oneWeek = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
    const f = detectEasyDiscipline(input(oneWeek.map((dateISO) => run({ dateISO, avgHrBpm: 152 }))));
    expect(new Set(oneWeek.map(weekKeyOf)).size).toBeLessThan(3);
    expect(f.state).toBe('quiet');
    expect(f.quietReason).toBe('insufficient_evidence');
  });

  it('stays silent when a real pattern has gone stale', () => {
    // Same five hard days, shifted so the newest is well past the staleness
    // bound. The pattern was real; it is no longer a habit.
    const old = ['2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'];
    const f = detectEasyDiscipline(input(old.map((dateISO) => run({ dateISO, avgHrBpm: 152 }))));
    expect(f.state).toBe('quiet');
    expect(f.quietReason).toBe('stale');
  });

  it('resolves, and says so, when the pattern breaks', () => {
    const f = detectEasyDiscipline(input(easyHrDays()));
    expect(f.state).toBe('quiet');
    expect(f.quietReason).toBe('resolved');
    expect(f.qualifying).toBe(5);
    expect(f.over).toBe(0);
  });

  it('needs a clear majority, not a bare one', () => {
    // Three of five over · 0.6, under the two-thirds bar.
    const runs = DATES.map((dateISO, idx) => run({ dateISO, avgHrBpm: idx < 3 ? 152 : 132 }));
    const f = detectEasyDiscipline(input(runs));
    expect(f.over / f.qualifying).toBeCloseTo(0.6);
    expect(f.state).toBe('quiet');
    expect(f.quietReason).toBe('resolved');
  });
});

describe('per-run context filters', () => {
  it('excludes a hot day from the HR read', () => {
    const v = classifyEasyRun(run({ tempF: HEAT_CONFOUND_TEMP_F + 5 }), CEILING, MAX_HR, BAND);
    expect(v.exclusions).toContain('heat');
    expect(v.hrEligible).toBe(false);
  });

  it('still counts that hot day toward the PACE read · heat does not make you faster', () => {
    const v = classifyEasyRun(
      run({ tempF: HEAT_CONFOUND_TEMP_F + 5, paceSPerMi: 500 }),
      CEILING,
      MAX_HR,
      BAND,
    );
    expect(v.hrEligible).toBe(false);
    expect(v.paceEligible).toBe(true);
    expect(v.fasterThanBand).toBe(true);
  });

  it('excludes a hilly day from both reads', () => {
    const v = classifyEasyRun(
      run({ distanceMi: 6, elevGainFt: 6 * (TERRAIN_CONFOUND_FT_PER_MI + 20) }),
      CEILING,
      MAX_HR,
      BAND,
    );
    expect(v.exclusions).toContain('terrain');
    expect(v.hrEligible).toBe(false);
    expect(v.paceEligible).toBe(false);
  });

  it('prefers a real grade-adjusted pace over the net-climb proxy when it lands', () => {
    // Flat net climb, but GAP says the effort was 12% harder than raw pace ·
    // a hilly out-and-back the proxy would have missed entirely.
    const v = classifyEasyRun(
      run({ elevGainFt: 10, paceSPerMi: 550, gapSPerMi: 616 }),
      CEILING,
      MAX_HR,
      BAND,
    );
    expect(v.exclusions).toContain('terrain');
  });

  it('excludes a taper day near a race from both reads', () => {
    const v = classifyEasyRun(
      run({ daysFromNearestRace: 3, raceWindowDays: 14 }),
      CEILING,
      MAX_HR,
      BAND,
    );
    expect(v.exclusions).toContain('race_recency');
    expect(v.hrEligible).toBe(false);
    expect(v.paceEligible).toBe(false);
  });

  it('excludes illness and a layoff return from both reads', () => {
    for (const key of [{ illness: true }, { layoffReturn: true }]) {
      const v = classifyEasyRun(run(key), CEILING, MAX_HR, BAND);
      expect(v.hrEligible).toBe(false);
      expect(v.paceEligible).toBe(false);
    }
  });

  it('excludes a long run from the HR read only · cardiac drift', () => {
    const v = classifyEasyRun(
      run({ durationSec: (DRIFT_CONFOUND_MINUTES + 15) * 60, paceSPerMi: 500 }),
      CEILING,
      MAX_HR,
      BAND,
    );
    expect(v.exclusions).toContain('cardiac_drift');
    expect(v.hrEligible).toBe(false);
    expect(v.paceEligible).toBe(true);
  });

  it('keeps the whole finding silent when the only over-ceiling days are excluded', () => {
    // Four clean, under-ceiling days plus one blistering hot one. The hot day
    // is exactly the run a naive detector would have counted against him.
    const runs = [
      ...DATES.slice(0, 4).map((dateISO) => run({ dateISO, avgHrBpm: 132 })),
      run({ dateISO: DATES[4], avgHrBpm: 170, tempF: 95 }),
    ];
    const f = detectEasyDiscipline(input(runs));
    expect(f.state).toBe('quiet');
    expect(f.verdicts.find((v) => v.dateISO === DATES[4])?.exclusions).toContain('heat');
  });

  it('never counts an excluded run against him · exclusions only shrink the set', () => {
    const clean = detectEasyDiscipline(input(hardHrDays()));
    const withNoise = detectEasyDiscipline(
      input([...hardHrDays(), run({ dateISO: '2026-08-16', avgHrBpm: 178, illness: true })]),
    );
    expect(withNoise.qualifying).toBe(clean.qualifying);
    expect(withNoise.over).toBe(clean.over);
  });

  it('documents which basis every filter invalidates', () => {
    // The asymmetry IS the design · guard it so a future edit cannot quietly
    // make heat disqualify the pace read too.
    expect(FILTER_INVALIDATES.heat).toEqual(['hr']);
    expect(FILTER_INVALIDATES.cardiac_drift).toEqual(['hr']);
    expect(FILTER_INVALIDATES.terrain).toEqual(['hr', 'pace']);
    expect(FILTER_INVALIDATES.race_recency).toEqual(['hr', 'pace']);
  });
});

describe('basis selection', () => {
  it('prefers HR when it is available', () => {
    expect(detectEasyDiscipline(input(hardHrDays())).basis).toBe('hr');
  });

  it('falls back to pace when HR is missing', () => {
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: null, paceSPerMi: 500 }));
    const f = detectEasyDiscipline(input(runs));
    expect(f.basis).toBe('pace');
    expect(f.state).toBe('established');
    expect(f.over).toBe(5);
  });

  it('falls back to pace when heat has disqualified the HR read', () => {
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: 152, tempF: 95, paceSPerMi: 500 }));
    const f = detectEasyDiscipline(input(runs));
    expect(f.basis).toBe('pace');
    expect(f.caveats.join(' ')).toMatch(/Heart rate is not the basis here/);
  });

  it('lets HR veto the pace read when the two disagree', () => {
    // The owner's real shape. Faster than the prescribed band on every day,
    // but heart rate on those same days averages inside the easy window. HR
    // is the governor, so "you ran them too hard" is not what the evidence
    // says, and the module must not say it.
    // Without an HRmax anchor there is no HR evidence at all, so the pace
    // read stands on its own · the veto needs something to veto with.
    const runs = DATES.map((dateISO) => run({ dateISO, paceSPerMi: 500, avgHrBpm: 137 }));
    expect(detectEasyDiscipline(input(runs, { maxHrBpm: null })).state).toBe('established');

    const g = detectEasyDiscipline(
      input(DATES.map((dateISO) => run({ dateISO, paceSPerMi: 500, avgHrBpm: 137, tempF: 95 }))),
    );
    expect(g.basis).toBe('pace');
    expect(g.state).toBe('quiet');
    expect(g.quietReason).toBe('hr_contradicts_pace');
    expect(g.caveats.join(' ')).toMatch(/does not support running them too hard/);
  });

  it('does not let HR veto when HR agrees the runs were hard', () => {
    const g = detectEasyDiscipline(
      input(DATES.map((dateISO) => run({ dateISO, paceSPerMi: 500, avgHrBpm: 152, tempF: 95 }))),
    );
    expect(g.basis).toBe('pace');
    expect(g.state).toBe('established');
  });

  it('says nothing at all when neither basis exists', () => {
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: null }));
    const f = detectEasyDiscipline(input(runs, { maxHrBpm: null, easyPaceBandSPerMi: null }));
    expect(f.state).toBe('quiet');
    expect(f.quietReason).toBe('no_basis');
  });
});

describe('coherence with the plan\'s own easy cap', () => {
  it('never flags a runner for obeying a cap looser than doctrine', () => {
    // The owner's real shape: doctrine ceiling 140, the plan printed 144.
    // Runs at 143 are over doctrine and under the app's own instruction.
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: 143 }));
    const f = detectEasyDiscipline(input(runs, { prescribedEasyCapBpm: 144 }));
    expect(f.ceilingBpm).toBe(144);
    expect(f.targetBpm).toBe(140);
    expect(f.state).toBe('quiet');
  });

  it('still fires above the looser cap, and names the divergence', () => {
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: 152 }));
    const f = detectEasyDiscipline(input(runs, { prescribedEasyCapBpm: 144 }));
    expect(f.state).toBe('established');
    expect(f.caveats.join(' ')).toMatch(/144 bpm, above the 140 bpm doctrine ceiling/);
  });
});

describe('what the evidence supports, and what it does not', () => {
  it('calls it discipline only when the pace was also faster than the band', () => {
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: 152, paceSPerMi: 500 }));
    const f = detectEasyDiscipline(input(runs));
    expect(f.read).toBe('ran_faster_than_band');
  });

  it('blames the band, not the runner, when he was inside it', () => {
    const runs = DATES.map((dateISO) => run({ dateISO, avgHrBpm: 152, paceSPerMi: 555 }));
    const f = detectEasyDiscipline(input(runs));
    expect(f.read).toBe('in_band_but_high_hr');
    expect(f.caveats.join(' ')).toMatch(/not proof of a discipline problem/);
  });

  it('always carries at least one caveat when it fires', () => {
    expect(detectEasyDiscipline(input(hardHrDays())).caveats.length).toBeGreaterThan(0);
  });
});

describe('doctrine windows', () => {
  it('uses the race distance to size the context window', () => {
    expect(raceWindowFor(26.2, true)).toBe(28);
    expect(raceWindowFor(13.1, true)).toBe(14);
    expect(raceWindowFor(26.2, false)).toBe(21);
    expect(raceWindowFor(3.1, false)).toBe(7);
  });
});

describe('the words', () => {
  const voiceOk = (s: string) => {
    expect(s).not.toMatch(/—|!|Research\//);
    expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  };

  it('the HR line carries the number, the doctrine and the action', () => {
    const f = detectEasyDiscipline(input(DATES.map((d) => run({ dateISO: d, avgHrBpm: 152, paceSPerMi: 500 }))));
    const { title, body } = composeEasyDisciplineEntry(f);
    voiceOk(body);
    voiceOk(title);
    expect(body).toMatch(/85% of max/); // the number he ran
    expect(body).toMatch(/Easy is 65 to 78/); // the doctrine
    expect(body).toMatch(/Run the easy ones under 140/); // the action
  });

  it('the band-is-wrong line does not blame him', () => {
    const f = detectEasyDiscipline(input(DATES.map((d) => run({ dateISO: d, avgHrBpm: 152, paceSPerMi: 555 }))));
    const { body } = composeEasyDisciplineEntry(f);
    voiceOk(body);
    expect(body).toMatch(/not your discipline/);
    expect(body).toMatch(/HR cap/);
  });

  it('the pace line carries the band and the action', () => {
    const f = detectEasyDiscipline(
      input(DATES.map((d) => run({ dateISO: d, avgHrBpm: null, paceSPerMi: 500 }))),
    );
    const { body } = composeEasyDisciplineEntry(f);
    voiceOk(body);
    expect(body).toMatch(/Five of your last five easy days/);
    expect(body).toMatch(/Easy is 8:53 to 9:33/);
    expect(body).toMatch(/Run them at 8:53 or slower/);
  });

  it('the resolve line closes the loop without hype', () => {
    const f = detectEasyDiscipline(input(easyHrDays()));
    const { title, body } = composeEasyDisciplineResolved(f);
    voiceOk(body);
    expect(title).toBe('EASY DAYS');
    expect(body).toMatch(/back under the ceiling/);
    expect(body).toMatch(/five of five/);
  });

  it('every composed line is short · two sentences or so, never a paragraph', () => {
    for (const f of [
      detectEasyDiscipline(input(hardHrDays())),
      detectEasyDiscipline(input(DATES.map((d) => run({ dateISO: d, avgHrBpm: null, paceSPerMi: 500 })))),
    ]) {
      expect(composeEasyDisciplineEntry(f).body.length).toBeLessThan(260);
    }
    expect(composeEasyDisciplineResolved(detectEasyDiscipline(input(easyHrDays()))).body.length)
      .toBeLessThan(260);
  });
});
