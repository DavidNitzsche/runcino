/* ============================================================================
   Readiness Brief · sample envelopes
   One object per scenario, shaped to the backend `ReadinessBriefSeed` contract
   (see readiness-brief-backend-landed.md). Every field the design renders is
   present; null-tolerant chunks (oneLineMover, streaks, movers, subjectiveOverride,
   watchTomorrow, pillar.trend) are exercised across the four states.

   Guardrails honored in copy:
     · no prescription in the reading (action lives only in the COACH block)
     · raw metrics state both numbers, never a derived delta ("7.5h" + "target 7.5h")
     · subjective beats objective when they disagree
     · no false precision (directional language, no ± medical qualifiers)
   ============================================================================ */
(function () {
  // 14-day score trend helpers ------------------------------------------------
  const T = (arr) => arr.map((score, i) => ({
    date: `2026-05-${String(18 + i).padStart(2, '0')}`,
    score,
    band: score >= 80 ? 'sharp' : score >= 65 ? 'ready' : score >= 50 ? 'moderate' : 'pull-back',
  }));
  // pillar 14-pt sparkline helper
  const sp = (arr) => arr.map((value, i) => ({ date: `d${i}`, value }));

  // ── STATE: SHARP · full data · a good day ─────────────────────────────────
  const sharp = {
    date: '2026-06-01',
    score: 81, band: 'sharp', label: 'PRIMED',
    headline: 'The system is firing. Today is for hard work if the plan calls for it.',
    oneLineMover: 'HRV up 6 pts vs yesterday.',
    scoreTrend: T([70, 66, 72, 68, 74, 71, 69, 73, 76, 72, 75, 78, 77, 81]),
    trendNote: 'Up from a 73 average last week. You are trending into a peak.',
    pillars: [
      {
        key: 'sleep', label: 'SLEEP', weightPct: 28, band: 'good', weightContribution: 6,
        observedValue: '7.6h', observedSub: '7-night avg', baseline: 'target 7.5h',
        meaning: 'Sleep is sitting right on your training target. Consolidated overnight sleep is the strongest lever you have on recovery.',
        confounders: [
          { pillar: 'Schedule', explanation: 'Late nights / social debt can mask the trend', likely: false },
          { pillar: 'Caffeine', explanation: 'Caffeine after 2pm fragments deep sleep', likely: false },
        ],
        trend: sp([6.9, 7.1, 6.8, 7.3, 7.0, 7.2, 7.4, 7.1, 7.5, 7.3, 7.6, 7.4, 7.7, 7.6]),
        citation: 'Research/00b §Sleep',
        doctrine: 'Seven-night rolling average against a dynamic target · the target rises to 8.0h when acute load runs hot, because recovery requirements scale with absolute training load.',
      },
      {
        key: 'hrv', label: 'HRV', weightPct: 28, band: 'good', weightContribution: 7,
        observedValue: '72 ms', observedSub: '7-day rolling LnRMSSD', baseline: 'baseline 66 ms · SWC ±5',
        meaning: 'Rolling HRV is above your smallest-worthwhile-change band. Autonomic balance is trending the right way.',
        confounders: [
          { pillar: 'Load', explanation: 'Cumulative training load suppresses HRV', likely: false },
          { pillar: 'Alcohol', explanation: 'Even one drink blunts overnight HRV', likely: false },
        ],
        trend: sp([64, 62, 67, 65, 63, 66, 68, 67, 69, 68, 70, 69, 71, 72]),
        citation: 'Research/15 §HRV · Plews approach',
        doctrine: 'Per-night reading is noisy; the doctrine reads the 7-day rolling LnRMSSD against a smallest-worthwhile-change band (0.5× the SD of the prior 60 days). Inside the band = stable.',
      },
      {
        key: 'rhr', label: 'RHR', weightPct: 24, band: 'good', weightContribution: 3,
        observedValue: '48 bpm', observedSub: 'overnight', baseline: '60-day baseline 50 bpm',
        meaning: 'Resting heart rate is sitting below your nocturnal baseline, consistent with a rested state.',
        confounders: [
          { pillar: 'Heat', explanation: 'Warm room or dehydration nudges RHR up', likely: false },
        ],
        trend: sp([52, 51, 50, 51, 49, 50, 49, 50, 48, 49, 49, 48, 48, 48]),
        citation: 'Research/15 §RHR · 60-day baseline',
        doctrine: 'Compared against a 60-day nocturnal baseline. Below baseline reads as recovered; the penalty above baseline is clamped so a single hot night cannot dominate the score.',
      },
      {
        key: 'load', label: 'LOAD', weightPct: 15, band: 'ok', weightContribution: 2,
        observedValue: 'ACWR 1.08', observedSub: '7d : 28d ratio', baseline: 'band 0.8 – 1.3',
        meaning: 'Acute-to-chronic load is inside the band where fitness builds without a spike in risk. Ratio is 1.08, band is balanced.',
        confounders: [],
        trend: sp([0.92, 0.95, 0.98, 1.0, 1.02, 1.0, 1.04, 1.06, 1.03, 1.05, 1.07, 1.06, 1.08, 1.08]),
        citation: 'Research/15 §ACWR · directional check',
        doctrine: 'Gabbett 7:28-day ratio, read as a directional sanity check only (per the Impellizzeri critique). The panel states the ratio and its band · it never prescribes a change. That is the coach\u2019s call.',
      },
      {
        key: 'hr_recovery', label: 'HR REC', weightPct: 5, band: 'good', weightContribution: 1,
        observedValue: '26 bpm', observedSub: '60s post-workout drop', baseline: '30-day baseline 24 bpm',
        meaning: 'Heart-rate recovery in the first minute after effort is a touch faster than your baseline.',
        confounders: [
          { pillar: 'Hard session', explanation: 'A hard effort in the last 24h slows recovery', likely: false },
        ],
        trend: sp([22, 23, 21, 24, 23, 25, 24, 23, 25, 26, 24, 25, 26, 26]),
        citation: 'Research/15 §HR Recovery',
        doctrine: 'Heart-rate drop in the 60s after a workout, vs a 30-day baseline. Intentionally low-weight · it is a single-workout signal, so it nudges rather than drives the score.',
      },
    ],
    streaks: [
      { pillar: 'HRV', direction: 'above', days: 4, startDate: '2026-05-29', short: 'A stable, adapting autonomic system.',
        meaning: 'Rolling HRV has held above your worthwhile-change band 4 days running · a stable, adapting autonomic system.' },
    ],
    movers: [
      { pillar: 'HRV', deltaPts: 6, label: 'HRV up 6 pts vs yesterday' },
      { pillar: 'SLEEP', deltaPts: 3, label: 'Sleep up 3 pts vs yesterday' },
    ],
    subjectiveOverride: null,
    subjectiveCheckin: { answered: true, value: 8 },
    watchTomorrow: [
      'Load creeps toward the top of the band this weekend. If the long run lands as planned, ACWR sits near 1.2 · still inside.',
    ],
    composition: { baseline: 60, today: 81, net: 21 },
    coach: 'Green across the board. Hold your paces honest and don\u2019t bank time early · the engine is ready for it.',
  };

  // ── STATE: PULL-BACK · full data · sleep debt + early overreach ───────────
  const pullback = {
    date: '2026-06-01',
    score: 42, band: 'pull-back', label: 'PULL BACK',
    headline: 'Sleep and HRV dipped together. The pattern, not today\u2019s number, is the read.',
    oneLineMover: 'Sleep down 13 pts vs yesterday.',
    scoreTrend: T([66, 64, 68, 70, 67, 63, 58, 60, 55, 57, 52, 50, 47, 42]),
    trendNote: 'Down from a 65 average last week. The slope is what matters.',
    pillars: [
      {
        key: 'sleep', label: 'SLEEP', weightPct: 28, band: 'low', weightContribution: -13,
        observedValue: '6.1h', observedSub: '7-night avg', baseline: 'target 7.5h',
        meaning: 'Seven-night sleep is well under target. Single short nights are noise · it is the run of them that compounds into recovery debt.',
        confounders: [
          { pillar: 'Load', explanation: 'High training load raises the sleep you need to recover', likely: true },
          { pillar: 'Schedule', explanation: 'Late nights / social debt', likely: false },
          { pillar: 'Caffeine', explanation: 'Caffeine after 2pm fragments deep sleep', likely: false },
        ],
        trend: sp([7.2, 7.0, 6.8, 7.1, 6.6, 6.3, 6.0, 6.2, 5.9, 6.1, 5.8, 6.0, 6.2, 6.1]),
        citation: 'Research/00b §Sleep',
        doctrine: 'Seven-night rolling average against a dynamic target that rises with load. Below target for three or more consecutive nights raises a debt-accumulation flag · the dips have to be sustained to count.',
      },
      {
        key: 'hrv', label: 'HRV', weightPct: 28, band: 'low', weightContribution: -10,
        observedValue: '58 ms', observedSub: '7-day rolling LnRMSSD', baseline: 'baseline 66 ms · SWC ±5',
        meaning: 'Rolling HRV has dropped below your worthwhile-change band. When it persists, this is the early end of the functional-overreach pattern.',
        confounders: [
          { pillar: 'Sleep', explanation: 'A sleep deficit suppresses overnight HRV', likely: true },
          { pillar: 'Load', explanation: 'Cumulative training load', likely: true },
          { pillar: 'Alcohol', explanation: 'Even one drink blunts overnight HRV', likely: false },
          { pillar: 'Illness', explanation: 'The body fighting something off', likely: false },
        ],
        trend: sp([67, 66, 68, 65, 64, 62, 60, 61, 59, 60, 58, 59, 58, 58]),
        citation: 'Research/15 §HRV · Plews approach',
        doctrine: 'Rolling-7 below the smallest-worthwhile-change band for three or more days raises an early functional-overreach flag. The CV of the rolling series is the destabilization tell · rising CV means the system is losing its footing.',
      },
      {
        key: 'rhr', label: 'RHR', weightPct: 24, band: 'good', weightContribution: 3,
        observedValue: '49 bpm', observedSub: 'overnight', baseline: '60-day baseline 50 bpm',
        meaning: 'Resting heart rate is still at baseline · the one pillar holding steady while sleep and HRV slide.',
        confounders: [
          { pillar: 'Illness', explanation: 'A brewing illness shows here first', likely: false },
        ],
        trend: sp([50, 49, 50, 51, 50, 49, 50, 49, 50, 49, 50, 49, 49, 49]),
        citation: 'Research/15 §RHR · 60-day baseline',
        doctrine: 'A 60-day nocturnal baseline. Three or more bpm above baseline for three consecutive days is the cue to check your subjective state · RHR holding here is a genuinely reassuring sign.',
      },
      {
        key: 'load', label: 'LOAD', weightPct: 15, band: 'watch', weightContribution: -8,
        observedValue: 'ACWR 1.34', observedSub: '7d : 28d ratio', baseline: 'band 0.8 – 1.3',
        meaning: 'Acute load has pushed just past the top of the band. Ratio is 1.34, band is elevated · the most likely driver behind the sleep and HRV dips.',
        confounders: [],
        trend: sp([1.05, 1.08, 1.1, 1.14, 1.18, 1.2, 1.24, 1.22, 1.28, 1.26, 1.3, 1.32, 1.33, 1.34]),
        citation: 'Research/15 §ACWR · directional check',
        doctrine: 'Gabbett 7:28-day ratio, descriptive only. The panel states the ratio is 1.34 and the band is elevated. What to do about it belongs to the coach · the reading and the coach voice can\u2019t openly contradict.',
      },
      {
        key: 'hr_recovery', label: 'HR REC', weightPct: 5, band: 'ok', weightContribution: 0,
        observedValue: '23 bpm', observedSub: '60s post-workout drop', baseline: '30-day baseline 24 bpm',
        meaning: 'Post-workout heart-rate recovery is essentially at baseline.',
        confounders: [
          { pillar: 'Hard session', explanation: 'A hard effort in the last 24h slows recovery', likely: false },
        ],
        trend: sp([25, 24, 23, 24, 22, 23, 24, 23, 22, 24, 23, 23, 24, 23]),
        citation: 'Research/15 §HR Recovery',
        doctrine: 'Heart-rate drop in the 60s after a workout, vs a 30-day baseline. Low-weight by design · a single-workout signal that nudges the score rather than driving it.',
      },
    ],
    streaks: [
      { pillar: 'SLEEP', direction: 'below', days: 4, startDate: '2026-05-29', short: 'Roughly 11h of debt this week. The run of nights is what counts.',
        meaning: 'Sleep has been under the 7.5h target four nights running · roughly 11h of debt across the week. Cumulative debt is what compounds, not any single night.' },
      { pillar: 'HRV', direction: 'below', days: 3, startDate: '2026-05-30', short: 'The early edge of functional overreach.',
        meaning: 'Rolling HRV below the worthwhile-change band three days · the early edge of the functional-overreach pattern.' },
    ],
    movers: [
      { pillar: 'SLEEP', deltaPts: -13, label: 'Sleep down 13 pts vs yesterday' },
      { pillar: 'HRV', deltaPts: -10, label: 'HRV down 10 pts vs yesterday' },
      { pillar: 'LOAD', deltaPts: -8, label: 'Load down 8 pts vs yesterday' },
    ],
    subjectiveOverride: null,
    subjectiveCheckin: { answered: true, value: 5 },
    watchTomorrow: [
      'Sleep debt is building (~11h over the week). One 9h+ night starts resetting the trend.',
      'If HRV stays below the band another day, treat it as signal · not noise.',
      'HRV rolling-CV is at 5.6% · the early-destabilization band per Plews.',
    ],
    composition: { baseline: 53, today: 42, net: -11 },
    coach: 'This is a back-off read. Keep today easy and short, get an early night in, and we\u2019ll reassess in the morning.',
  };

  // ── STATE: SUBJECTIVE OVERRIDE · numbers look fine, the runner does not ───
  const override = JSON.parse(JSON.stringify(sharp));
  override.score = 74; override.band = 'ready'; override.label = 'READY';
  override.headline = 'The numbers read fine, but your check-in says otherwise. Your check-in wins.';
  override.oneLineMover = 'Objective score up 4 pts, but you rated yourself 3 / 10.';
  override.scoreTrend = T([70, 72, 71, 73, 70, 74, 72, 71, 73, 75, 72, 74, 73, 74]);
  override.trendNote = 'Objectively steady all week. Today the disagreement is the story.';
  override.subjectiveOverride = {
    subjectiveScore: 38, objectiveScore: 74, deltaAbs: 36,
    advice: 'Go with what your body is telling you. The watch is a proxy for what you already know · today, you know more than it does.',
  };
  override.subjectiveCheckin = { answered: true, value: 3 };
  override.streaks = [];
  override.movers = [{ pillar: 'SLEEP', deltaPts: 3, label: 'Sleep up 3 pts vs yesterday' }];
  override.watchTomorrow = [
    'If you still feel flat tomorrow with the numbers steady, that is worth a note to the coach.',
  ];
  override.composition = { baseline: 70, today: 74, net: 4 };
  override.coach = 'Trust the check-in. Make today a genuine easy day or take it off entirely · the numbers will keep.';

  // ── STATE: COLD START · no signal yet ─────────────────────────────────────
  const cold = {
    date: '2026-06-01',
    score: null, band: 'no-data', label: 'NO DATA',
    headline: 'Wear the watch overnight a few times and your brief lights up.',
    oneLineMover: null,
    scoreTrend: [],
    trendNote: null,
    pillars: [],
    streaks: [],
    movers: [],
    subjectiveOverride: null,
    subjectiveCheckin: { answered: false, value: null },
    watchTomorrow: [],
    composition: null,
    coldStart: {
      nightsLogged: 2, nightsNeeded: 7,
      note: 'A composite readiness read needs about 7 nights of overnight wear to learn what is normal for you. Two nights in.',
    },
    coach: null,
  };

  // ── STATE: PARTIAL · one pillar not reporting (HRV) ───────────────────────
  const partial = JSON.parse(JSON.stringify(sharp));
  partial.label = 'READY'; partial.band = 'ready'; partial.score = 71;
  partial.headline = 'HRV is not reporting yet today. The rest of the picture still reads steady.';
  partial.oneLineMover = null;
  partial.subjectiveCheckin = { answered: true, value: 7 };
  // blank the HRV pillar per the no-data contract
  partial.pillars = partial.pillars.map((p) => p.key !== 'hrv' ? p : {
    ...p, band: 'no-data', weightPct: 0, weightContribution: 0,
    observedValue: '·', observedSub: 'no readings today', baseline: 'baseline 66 ms',
    meaning: 'No HRV readings synced today. The score is composed from the four pillars that did report.',
    confounders: [], trend: [],
  });
  partial.streaks = [];
  partial.movers = [];
  partial.watchTomorrow = ['HRV has not synced today. If it stays dark, check the watch wore overnight.'];
  partial.composition = { baseline: 60, today: 71, net: 11 };

  window.READINESS_STATES = { sharp, pullback, override, partial, cold };
  window.READINESS_ORDER = [
    { key: 'sharp', label: 'Sharp' },
    { key: 'pullback', label: 'Pull-back' },
    { key: 'override', label: 'Subj. override' },
    { key: 'partial', label: 'Partial' },
    { key: 'cold', label: 'Cold start' },
  ];
})();
