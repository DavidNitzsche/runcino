/**
 * Doctrine §13 — Training load and injury risk.
 *
 * Extracted from docs/coaching-research.md §13.1, §13.2.
 * The 10% rule is not the most important variable. Single-session
 * spikes are. ACWR sweet spot is 0.8–1.3.
 */
import { cite, type Cited } from '.';

/** Single-session spike — the strongest predictor of injury per the
 *  2025 5,200-runner cohort study. */
export const SINGLE_SESSION_SPIKE: Cited<{
  /** % above the longest recent run that triggers each risk band. */
  bands: Array<{ pctAboveLongestRecent: number; injuryRiskMultiplierNote: string }>;
  /** "Useful ceiling" the research recommends. */
  ceilingPctAboveLongestRecent: number;
  /** Days back when computing "longest recent run". */
  longestRecentLookbackDays: number;
}> = {
  value: {
    bands: [
      { pctAboveLongestRecent: 30,  injuryRiskMultiplierNote: '+64 % injury risk vs no spike' },
      { pctAboveLongestRecent: 100, injuryRiskMultiplierNote: '+52 % injury risk' },
      { pctAboveLongestRecent: 1000, injuryRiskMultiplierNote: '>2× injury risk for >100 % spikes' },
    ],
    ceilingPctAboveLongestRecent: 10,
    longestRecentLookbackDays: 30,
  },
  note: 'The dangerous thing isn\'t a 15 % weekly mileage increase — it\'s putting all of that increase into one run.',
  citations: [
    cite('§13.1', 'Running a single session 10 percent or more longer than the longest run in the past 30 days raised injury risk substantially'),
    cite('§13.1', '10–30 % spike: 64 % higher injury risk; 30–100 % spike: 52 % higher; >100 % spike: more than doubled'),
    cite('§13.2', 'A maximum 10 percent jump on any single session is a useful ceiling.'),
  ],
};

/** Acute:chronic workload ratio sweet spot from HSS 2024 marathon
 *  research. */
export const ACWR_BAND: Cited<{
  sweetSpotLow: number;
  sweetSpotHigh: number;
  acuteWindowDays: number;
  chronicWindowDays: number;
}> = {
  value: { sweetSpotLow: 0.8, sweetSpotHigh: 1.3, acuteWindowDays: 7, chronicWindowDays: 28 },
  note: 'Sweet spot 0.8–1.3 minimises injury risk. ACWR > 1.5 is the danger zone; < 0.8 means under-loaded.',
  citations: [
    cite('§13.1', 'the largest study of marathon training to date (HSS, 2024) supported ACWR as a marathon-relevant guide, with the sweet spot of 0.8 to 1.3 minimizing injury risk.'),
  ],
};

/** Counter-intuitive: under-load also raises injury risk on race day. */
export const UNDER_LOAD_RISK: Cited<{
  /** Runners arrived underprepared and the race itself injured them. */
  finding: 'lower_training_load_higher_race_day_injury';
}> = {
  value: { finding: 'lower_training_load_higher_race_day_injury' },
  note: 'The Comrades research found lower training loads associated with higher injury risk during the race itself, because runners weren\'t prepared for the demands.',
  citations: [cite('§13.2', 'The Comrades research found lower training loads were associated with higher injury risk during the race itself')],
};

/** The 10 % weekly-mileage rule is not the strongest predictor.
 *  Recorded here mainly to flag what NOT to over-rely on. */
export const TEN_PERCENT_RULE: Cited<{
  reliability: 'weakly_supported';
  stronger_predictor: 'single_session_spike';
}> = {
  value: { reliability: 'weakly_supported', stronger_predictor: 'single_session_spike' },
  citations: [cite('§13.1', 'Week-to-week mileage changes and the acute:chronic workload ratio (ACWR) showed weaker or no association.')],
};
