/**
 * Strength prescription module — Amp-aware.
 *
 * The doc (§6) treats heavy resistance + plyometric training as
 * non-optional for marathoners — 2 sessions/week year-round, periodized
 * to oppose the running cycle. Reduces injury risk ~50% (multiple
 * meta-analyses) and improves running economy (which is the limiter
 * for trained marathoners).
 *
 * David trains on the Amp at home — a smart digital-resistance machine
 * with programmable workouts. The Amp can do everything the doc
 * prescribes: heavy compounds (squats, deadlifts, hip thrusts), plyo-
 * adjacent power work (jump squats, step-ups), and mobility flows.
 *
 * Until Amp's API lands (and/or HealthKit pipes the workout through),
 * strength prescription is a guidance layer: Coach says "today is a
 * heavy day, do 30 min on the Amp focused on lower-body compounds."
 * The user marks it done. Tracking grows from there.
 */

import { strengthCadence, type StrengthCadence, type StrengthSessionType, type Phase } from './coach-principles';
import type { CoachState } from './coach-state';

export interface StrengthPrescription {
  type: StrengthSessionType;          // heavy / power / maintenance / mobility / rest
  /** Display label for the dashboard card. */
  label: string;
  /** Approximate session duration in minutes. */
  durationMin: number;
  /** Plain-English description — what to do today on Amp. */
  description: string;
  /** Specific Amp program suggestions (when applicable). User picks
   *  one from this list inside the Amp app. */
  ampSuggestions: string[];
  /** Movement focus for the session — the doc-grounded "what muscles
   *  and patterns matter". */
  focus: string[];
}

/** Decide whether today gets a strength session, and if so what type.
 *
 *  Rules:
 *    1. Phase determines weekly cadence (see strengthCadence).
 *    2. Place sessions opposite to hard run days. Heavy lifts AFTER
 *       quality runs (so you're not pre-fatigued for the run); power
 *       work BEFORE long-run day if at all (24h recovery for the
 *       neuromuscular system). Maintenance + mobility anywhere.
 *    3. Don't double up on a quality run day with heavy lifts.
 *    4. Drop entirely in final 10 days before an A race.
 */
export function prescribeStrength(
  state: CoachState,
  phase: Phase,
  todayDow: number,
  todayIsHardRun: boolean,
): StrengthPrescription | null {
  const daysToA = state.races.nextA?.daysAway ?? null;
  const cadence = strengthCadence(phase, daysToA);
  if (cadence.perWeek === 0) return null;

  // Strength days this week = number of strength sessions logged so
  // far in the current calendar week. Engine state surfaces this.
  const completed = state.recovery.strengthDaysThisWeek ?? 0;
  if (completed >= cadence.perWeek) return null;  // already met the cadence

  // Determine which composition slot we're filling. cadence.composition
  // lists the session types in order — index by completed count.
  const desired = cadence.composition[completed] ?? cadence.composition[cadence.composition.length - 1];

  // Day-of-week placement. Heavy lifts on Mon/Thu, power on Wed (after
  // tempo, before long run), maintenance on Tue/Fri, mobility on
  // recovery days. If today doesn't fit, return null — the engine will
  // show the planned strength day in the week shape but skip today.
  const PHASE_PLACEMENT: Record<StrengthSessionType, number[]> = {
    heavy:        [1, 4],       // Mon, Thu
    power:        [3],          // Wed
    maintenance:  [2, 5],       // Tue, Fri
    mobility:     [0, 2],       // Sun, Tue
    rest:         [],
  };

  const allowed = PHASE_PLACEMENT[desired];
  if (!allowed.includes(todayDow)) return null;

  // Don't double-up on a hard run day with heavy lifts (recovery cost
  // compounds). Mobility and maintenance are fine.
  if (todayIsHardRun && (desired === 'heavy' || desired === 'power')) return null;

  return buildPrescription(desired, phase);
}

function buildPrescription(type: StrengthSessionType, phase: Phase): StrengthPrescription {
  switch (type) {
    case 'heavy':
      return {
        type: 'heavy',
        label: 'Heavy lift',
        durationMin: 35,
        description: '3-5 sets × 3-6 reps at 80%+ 1RM · focus on intent and bar speed, not failure · long rest between sets (2-3 min)',
        ampSuggestions: ['Lower Body Strength', 'Posterior Chain Power', 'Heavy Compound Day'],
        focus: ['Squat (back / front / goblet)', 'Deadlift (conventional / RDL / single-leg)', 'Hip thrust', 'Calf raise — heavy, slow eccentric'],
      };
    case 'power':
      return {
        type: 'power',
        label: 'Power + plyo',
        durationMin: 30,
        description: '3-5 sets × 5-10 contacts · fully recovered between sets · explosive intent on every rep',
        ampSuggestions: ['Plyometric Athletic', 'Jump + Lift Combo', 'Lower-Body Power'],
        focus: ['Jump squats', 'Pogo hops', 'Box jumps', 'A-skips / B-skips', 'Step-ups (explosive)'],
      };
    case 'maintenance':
      return {
        type: 'maintenance',
        label: 'Strength · maintain',
        durationMin: 20,
        description: 'Lower volume, intensity preserved · maintain force capacity, not chasing gains',
        ampSuggestions: ['Lower Body 20', 'Quick Strength Maintenance', 'Glute & Core Activation'],
        focus: ['Bilateral squat (3 × 5 at 75% 1RM)', 'Single-leg work', 'Calf raises', 'Core anti-rotation'],
      };
    case 'mobility':
      return {
        type: 'mobility',
        label: 'Mobility flow',
        durationMin: 20,
        description: 'Hip openers, ankle / calf / Achilles range, T-spine, glute activation · no heavy load',
        ampSuggestions: ['Mobility Flow', 'Hip + Ankle Range', 'Recovery Day'],
        focus: ['Hip flexor / 90/90 / pigeon', 'Ankle dorsiflexion', 'Calf wall stretch', 'T-spine rotation', 'Glute bridges'],
      };
    case 'rest':
      return {
        type: 'rest', label: 'No strength today',
        durationMin: 0, description: 'Skip — recovery is the workout.',
        ampSuggestions: [], focus: [],
      };
  }
}

/** Compose the cadence note + what the user has done this week so the
 *  rationale on the dashboard explains where today fits in the
 *  weekly strength rhythm. */
export function strengthWeekContext(state: CoachState, phase: Phase): { cadence: StrengthCadence; completed: number; remaining: number } {
  const cadence = strengthCadence(phase, state.races.nextA?.daysAway ?? null);
  const completed = state.recovery.strengthDaysThisWeek ?? 0;
  const remaining = Math.max(0, cadence.perWeek - completed);
  return { cadence, completed, remaining };
}
