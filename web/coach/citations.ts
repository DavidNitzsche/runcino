/**
 * Citation helpers for deterministic Coach decisions.
 *
 * The Coach's LLM brain returns citations the model picked. The
 * deterministic brain doesn't have an LLM in the loop, so we map
 * decisions → citations explicitly here. Same `Citation` shape;
 * users can't tell the difference at the UI layer.
 */
import type { Citation } from './types';

/** Build a coaching-research citation from a §-prefixed section ID. */
export function rc(section: string, snippet?: string): Citation {
  return { doc: 'docs/coaching-research.md', section, snippet };
}

/** Build an amp-research citation. */
export function ar(section: string, snippet?: string): Citation {
  return { doc: 'docs/amp-research.md', section, snippet };
}

/** Citations for a given workout type. Drawn from coaching-research §5
 *  (workout types) and §3 / §13 / §8 where the type intersects them. */
export function citationsForWorkoutType(type: string): Citation[] {
  switch (type) {
    case 'recovery':
      return [
        rc('§5.1', 'Truly easy, often well below conversational pace. 30 to 50 minutes. Their job is circulation and active recovery, not adaptation.'),
        rc('§8.2', 'active recovery (easy spinning or jogging at very low intensity)'),
      ];
    case 'general_aerobic':
    case 'easy':
      return [
        rc('§5.2', '60 to 90 minutes at an easy but not slow pace, roughly 15 to 25 percent slower than marathon pace'),
        rc('§4.1', 'Easy aerobic running … drives the adaptations that determine marathon performance more than any other workout type'),
      ];
    case 'medium_long':
      return [
        rc('§5.3', "A second weekly run of 11 to 15 miles, distinct from the long run. … Two per week separates serious marathoners from the field."),
      ];
    case 'long_steady':
    case 'long_progression':
    case 'long_mp_block':
    case 'long_fast_finish':
      return [
        rc('§5.4', '16 to 22 miles or 2 to 3 hours. … The 90-minute threshold matters.'),
        rc('§5.7', 'probably the single most predictive workout of marathon outcome'),
      ];
    case 'tempo_continuous':
    case 'threshold':
    case 'threshold_intervals':
    case 'sub_threshold':
      return [
        rc('§5.5', 'Lactate threshold has the highest correlation with marathon performance of any single physiological marker.'),
        rc('§3.1', 'pyramidal during base/build, then polarized during the peak phase'),
      ];
    case 'vo2':
      return [
        rc('§5.6', '95 to 100 percent of VO2max … total work volume around 3 to 6 miles'),
      ];
    case 'marathon_specific':
    case 'marathon_specific_combo':
    case 'marathon_specific_long':
      return [
        rc('§5.7', 'The defining sessions of the peak phase. … This is probably the single most predictive workout of marathon outcome.'),
      ];
    case 'strides':
    case 'hill_sprints':
      return [
        rc('§5.8', 'preserve neuromuscular sharpness and running economy without taxing the aerobic or metabolic systems'),
      ];
    case 'race':
      return [
        rc('§14', 'in the final two weeks, the fitness is built. The job is to arrive at the start line rested without losing edge.'),
      ];
    case 'shakeout':
      return [
        rc('§14', 'keep some short, sharp work at race pace through the taper. Eliminating intensity entirely is detrimental.'),
      ];
    case 'rest':
      return [
        rc('§8.3', 'Most adaptation happens during recovery, not during training.'),
      ];
    default:
      return [
        rc('§3.1', 'Training intensity distribution'),
      ];
  }
}

/** Citations for the readiness signal — references the doctrine
 *  sections that govern green / yellow / red bands. */
export function citationsForReadiness(level: 'green' | 'yellow' | 'red'): Citation[] {
  // Same doctrine regardless of level; the rationale text varies.
  return [
    rc('§13.1', 'the largest study of marathon training to date (HSS, 2024) supported ACWR as a marathon-relevant guide, with the sweet spot of 0.8 to 1.3'),
    rc('§3.1', 'The honest answer is that both produce mitochondrial gains, but easy volume is uniquely sustainable.'),
    ...(level !== 'green' ? [rc('§8.3', 'every hard training stress requires a recovery period of 24 to 72 hours')] : []),
  ];
}

/** Citations referenced when the Coach modifies the plan because of
 *  load (single-session spike cap, ACWR drift). */
export function citationsForLoadAdjustment(): Citation[] {
  return [
    rc('§13.1', 'Single-session spikes were the strongest predictor of injury.'),
    rc('§13.2', 'A maximum 10 percent jump on any single session is a useful ceiling.'),
  ];
}

/** Citations for taper-related decisions. */
export function citationsForTaper(): Citation[] {
  return [
    rc('§14', '40 to 60 percent reduction from peak. The largest cuts go to easy mileage, not to quality work.'),
    rc('§14', 'maintain run frequency at approximately 80 percent of normal'),
  ];
}
