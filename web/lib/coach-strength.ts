/**
 * Strength prescription module — Amp-aware.
 *
 * Source docs:
 *   - docs/coaching-research.md §6 (heavy resistance + plyometrics
 *     for marathoners, 2 sessions/week year-round, periodized opposite
 *     to the run cycle, ~50% injury risk reduction).
 *   - docs/amp-research.md §11 (running-specific guidance: eccentric
 *     mode 1×/week minimum for tendon health, single-leg ankle-strap
 *     work has the largest carryover to running performance + injury
 *     prevention).
 *
 * The Amp:
 *   - Three core resistance modes — Fixed (constant), Band (light→heavy
 *     through the rep), Eccentric (heavier on the lowering phase).
 *   - 600+ movements across Strength, Pilates, HIIT, Mobility.
 *   - Apple Health integration → workouts will sync through HealthKit
 *     once that pipe lands (M2). Until then, prescriptions are
 *     guidance the user marks done.
 *
 * Each prescription names:
 *   - The Amp resistance mode that matches the day's intent
 *     (Eccentric for tendon work, Band for peak contraction, Fixed
 *     for baseline strength).
 *   - Specific Amp programs the user can pick from the app.
 *   - A movement focus list weighted toward runner-relevant work:
 *     glutes, single-leg hamstrings, calves, quad eccentrics, hip
 *     stabilizers.
 */

import { strengthCadence, type StrengthCadence, type StrengthSessionType, type Phase } from './coach-principles';
import type { CoachState } from './coach-state';

export type AmpMode = 'Fixed' | 'Band' | 'Eccentric' | 'Mobility';

export interface StrengthPrescription {
  type: StrengthSessionType;          // heavy / power / maintenance / mobility / rest
  /** Display label for the dashboard card. */
  label: string;
  /** Approximate session duration in minutes. */
  durationMin: number;
  /** Plain-English description — what to do today on Amp. */
  description: string;
  /** Amp resistance mode the day calls for. */
  ampMode: AmpMode;
  /** Specific Amp program suggestions (run-relevant, picked from real
   *  Amp library categories). User picks one in the Amp app. */
  ampSuggestions: string[];
  /** Movement focus — running-specific where possible per amp doc §11. */
  focus: string[];
}

export function prescribeStrength(
  state: CoachState,
  phase: Phase,
  todayDow: number,
  todayIsHardRun: boolean,
): StrengthPrescription | null {
  const daysToA = state.races.nextA?.daysAway ?? null;
  const cadence = strengthCadence(phase, daysToA);
  if (cadence.perWeek === 0) return null;

  const completed = state.recovery.strengthDaysThisWeek ?? 0;
  if (completed >= cadence.perWeek) return null;

  const desired = cadence.composition[completed] ?? cadence.composition[cadence.composition.length - 1];

  // Day-of-week placement (JS Date.getDay(), 0=Sun ... 6=Sat).
  // Heavy lifts on Mon/Thu (after recovery, before mid-week tempo).
  // Power on Wed (mid-week, alongside speed work neurologically).
  // Maintenance on Tue/Fri. Mobility on Sun/Tue.
  const PHASE_PLACEMENT: Record<StrengthSessionType, number[]> = {
    heavy:        [1, 4],
    power:        [3],
    maintenance:  [2, 5],
    mobility:     [0, 2],
    rest:         [],
  };
  const allowed = PHASE_PLACEMENT[desired];
  if (!allowed.includes(todayDow)) return null;

  // Don't double-up heavy/power on a hard-run day.
  if (todayIsHardRun && (desired === 'heavy' || desired === 'power')) return null;

  return buildPrescription(desired, phase);
}

function buildPrescription(type: StrengthSessionType, phase: Phase): StrengthPrescription {
  switch (type) {
    case 'heavy':
      // BASE / BUILD heavy day — runner-first. Doc §11 says eccentric
      // mode 1×/week minimum for tendon health; we route the heavy
      // session through Eccentric mode in BUILD when the runner is
      // accumulating eccentric load anyway from descents.
      return {
        type: 'heavy',
        label: 'Heavy lift · Amp',
        durationMin: 35,
        description: 'Heavy compound work · 3-5 sets × 3-6 reps at high cable tension · long rest (2-3 min) · focus on intent and bar speed, not failure. Amp\'s Eccentric mode (heavier on the lowering phase) doubles as runner-specific tendon protection — Achilles, patellar, hamstring complex.',
        ampMode: phase === 'BUILD' || phase === 'BASE' ? 'Eccentric' : 'Fixed',
        ampSuggestions: ['Lower Body Strength', 'Posterior Chain Power', 'Single-Leg Strength'],
        focus: [
          'Single-leg Romanian deadlift (Stiff Deadlift, single-leg variant) — hamstring + glute, eccentric overload',
          'Hip Thrust — glute max, the running propulsion engine',
          'Bulgarian split squat / Elevated Front Squat — quad eccentric tolerance for descents',
          'Single Leg Hamstring Curl (ankle strap) — direct hamstring strength',
          'Calf raise — slow eccentric, Achilles tendon stiffness',
        ],
      };

    case 'power':
      // BUILD / TAPER power day — neuromuscular, fully recovered.
      return {
        type: 'power',
        label: 'Power + plyo · Amp',
        durationMin: 30,
        description: 'Plyo + power · 3-5 sets × 5-10 contacts · fully recovered between sets · explosive intent. Amp\'s Band mode loads peak contraction at the top of the movement — ideal for jump squats, donkey kicks, hip-drive work. Caps neuromuscular sharpness without aerobic cost.',
        ampMode: 'Band',
        ampSuggestions: ['Plyometric Athletic', 'Jump + Lift Combo', 'Lower-Body Power'],
        focus: [
          'Resisted Jump Squat — explosive triple-extension',
          'Donkey Kick / Kickback to Extension Combo — glute drive',
          'Pogo hops — calf reactive strength',
          'Split Squat with explosive concentric — running-stride pattern',
          'A-skips / B-skips with cable resistance — running mechanics under load',
        ],
      };

    case 'maintenance':
      return {
        type: 'maintenance',
        label: 'Strength · maintain',
        durationMin: 20,
        description: 'Lower volume, intensity preserved · maintain force capacity, no chasing gains. Amp Fixed mode for predictable load comparison.',
        ampMode: 'Fixed',
        ampSuggestions: ['Lower Body 20', 'Quick Strength Maintenance', 'Glute & Core Activation'],
        focus: [
          'Bilateral squat (3 × 5 at 75% 1RM equivalent)',
          'Single-leg hip thrust (3 × 8 each side)',
          'Calf raise (slow eccentric, 3 × 8)',
          'Anti-rotation core (Half Kneeling Core Twist, Side Plank)',
        ],
      };

    case 'mobility':
      return {
        type: 'mobility',
        label: 'Mobility flow · Amp',
        durationMin: 20,
        description: 'Hip openers, ankle/calf range, T-spine, glute activation · light cable feedback through stretches · no heavy load. Amp\'s mobility library is underused by most owners — treat it as legitimate work, not filler.',
        ampMode: 'Mobility',
        ampSuggestions: ['Mobility Flow', 'Hip + Ankle Range', 'Recovery Day'],
        focus: [
          'Hip flexor / 90/90 / pigeon — desk-runner staple',
          'Ankle dorsiflexion + calf wall stretch — Achilles range',
          'T-spine rotation — stride rotation efficiency',
          'World\'s Greatest to Hamstring Stretch — full posterior chain',
          'Glute bridges (activation, no load)',
        ],
      };

    case 'rest':
      return {
        type: 'rest', label: 'No strength today',
        durationMin: 0, description: 'Skip — recovery is the workout.',
        ampMode: 'Fixed', ampSuggestions: [], focus: [],
      };
  }
}

export function strengthWeekContext(state: CoachState, phase: Phase): { cadence: StrengthCadence; completed: number; remaining: number } {
  const cadence = strengthCadence(phase, state.races.nextA?.daysAway ?? null);
  const completed = state.recovery.strengthDaysThisWeek ?? 0;
  const remaining = Math.max(0, cadence.perWeek - completed);
  return { cadence, completed, remaining };
}
