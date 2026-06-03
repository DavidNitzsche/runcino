/**
 * lib/faff/phase-focus.ts · per-distance phase focus + race-day copy.
 *
 * Replaces the hardcoded marathon-centric strings in
 * components/faff-app/constants.ts § PHASE. The old strings:
 *
 *   build  · "where a sub-3 gets built"        ← marathon goal time
 *   race   · "California International Marathon · 26.2 miles · Hold 6:51/mi"
 *                                              ← David's specific A-race
 *
 * Shipped on EVERY runner's plan regardless of race distance. A wife
 * signed up for AFC half marathon (1:30 goal) was reading "sub-3"
 * marathon copy on her BUILD phase + "Hold 6:51/mi at CIM" on her
 * race day. That is the bug this module closes.
 *
 * Usage:
 *   const { name, focus } = phaseFocus('build', goalRace);
 *
 * The author keeps the existing copy *voice* (Magness / Pfitz cadence,
 * imperative second-person) but templates the distance + goal pace.
 *
 * For runners with no goal race set, falls back to neutral copy that
 * never references a specific distance or time.
 */

import type { GoalRace } from '@/components/faff-app/types';
import type { PhaseKey } from '@/components/faff-app/constants';

export interface PhaseFocusCopy {
  /** "BUILD" / "PEAK" / "TAPER" / "RACE DAY" / etc. Unchanged from PHASE constants. */
  name: string;
  /** Sub-title under the phase name. */
  sub: string;
  /** The FOCUS line · 1-2 sentences, distance + goal aware. */
  focus: string;
}

type DistanceBucket = '5k' | '10k' | 'half' | 'marathon' | 'ultra' | 'unknown';

/** Classify the race distance into a coaching bucket.
 *  Buckets · 5K / 10K / half / marathon / ultra. Anything beyond
 *  marathon (>27mi) reads as ultra. Unknown returns neutral copy. */
function bucketOf(goalRace: GoalRace | null): DistanceBucket {
  const mi = goalRace?.distanceMi;
  if (!mi || !Number.isFinite(mi)) return 'unknown';
  if (mi < 4.5) return '5k';      // 5K = 3.1mi · band 2.5-4.5
  if (mi < 8.5) return '10k';     // 10K = 6.2mi · band 4.5-8.5
  if (mi < 17)  return 'half';    // HM  = 13.1mi · band 8.5-17
  if (mi < 27)  return 'marathon'; // M   = 26.2mi · band 17-27
  return 'ultra';                 // 50K+
}

/** Format the goal-pace target as "M:SS/mi" if goal time + distance present. */
function goalPaceLabel(goalRace: GoalRace | null): string | null {
  if (!goalRace?.goal || !goalRace.distanceMi) return null;
  const sec = parseClockToSec(goalRace.goal);
  if (sec == null) return null;
  const paceSec = Math.round(sec / goalRace.distanceMi);
  const m = Math.floor(paceSec / 60);
  const s = String(paceSec % 60).padStart(2, '0');
  return `${m}:${s}/mi`;
}

function parseClockToSec(s: string): number | null {
  const parts = s.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/** Goal-time label for the race-day copy ("1:30 at AFC"). Falls back
 *  to just the race name when goal is absent. */
function goalLabel(goalRace: GoalRace | null): string {
  if (!goalRace) return 'your race';
  if (!goalRace.goal) return goalRace.name;
  return `${goalRace.goal} at ${goalRace.name}`;
}

/** Distance display in human form for the race-day copy. */
function distanceWord(bucket: DistanceBucket): string {
  switch (bucket) {
    case '5k':       return '5 kilometers';
    case '10k':      return '10 kilometers';
    case 'half':     return '13.1 miles';
    case 'marathon': return '26.2 miles';
    case 'ultra':    return 'the ultra distance';
    default:         return 'race distance';
  }
}

/** Pace-emphasis word per distance · drives quality-block focus copy. */
function paceEmphasis(bucket: DistanceBucket): {
  buildQuality: string;
  peakLoad: string;
  raceVerb: string;
} {
  switch (bucket) {
    case '5k':       return { buildQuality: 'VO2max and threshold', peakLoad: 'top-end sharpness', raceVerb: 'send' };
    case '10k':      return { buildQuality: 'threshold and VO2max', peakLoad: 'race-pace tolerance', raceVerb: 'hold' };
    case 'half':     return { buildQuality: 'threshold and race-pace volume', peakLoad: 'race-pace simulations', raceVerb: 'hold' };
    case 'marathon': return { buildQuality: 'threshold and marathon-pace volume', peakLoad: 'race-day rehearsals', raceVerb: 'hold' };
    case 'ultra':    return { buildQuality: 'aerobic depth and back-to-back longs', peakLoad: 'multi-hour Z2 + nutrition rehearsal', raceVerb: 'manage' };
    default:         return { buildQuality: 'threshold work', peakLoad: 'high-volume training', raceVerb: 'execute' };
  }
}

/**
 * Compose the per-phase copy for this runner's race.
 *
 * Race-specific bucket drives:
 *   · BUILD focus  · pace-emphasis word + quality framing
 *   · PEAK focus   · load framing
 *   · TAPER focus  · race-day reference uses real race name
 *   · RACE focus   · real distance + real goal pace + real race name
 *
 * Returns the neutral copy when goalRace is null (no race set).
 * `mesh` stays in the consumer's existing PHASE constants · this
 * module owns text only.
 */
export function phaseFocus(phase: PhaseKey, goalRace: GoalRace | null): PhaseFocusCopy {
  const bucket = bucketOf(goalRace);
  const pace = paceEmphasis(bucket);
  const paceLbl = goalPaceLabel(goalRace);
  const raceName = goalRace?.name ?? null;

  switch (phase) {
    case 'base':
      return {
        name: 'BASE',
        sub: 'Aerobic foundation',
        focus: 'Build the aerobic engine with easy volume and durability. The patient work that pays off later in the block.',
      };

    case 'build':
      return {
        name: 'BUILD',
        sub: `${capitalize(pace.buildQuality)} volume`,
        focus: `Sharpen ${pace.buildQuality}. The two-quality-day weeks where the back half of your ${bucket === 'unknown' ? 'race' : distanceWord(bucket)} gets built.`,
      };

    case 'peak':
      return {
        name: 'PEAK',
        sub: `Max volume & ${pace.peakLoad}`,
        focus: `Your highest weekly load of the block. Top-end fitness and ${pace.peakLoad} before the taper.`,
      };

    case 'taper':
      return {
        name: 'TAPER',
        sub: 'Freshen, sharpen, arrive primed',
        focus: raceName
          ? `Cut the volume, hold the intensity sharp, and roll into ${raceName} rested, fresh, and hungry to race.`
          : 'Cut the volume, hold the intensity sharp, and roll into race day rested and primed.',
      };

    case 'race': {
      // Race-day copy is the most specific · use real distance + goal pace + name.
      const dist = distanceWord(bucket);
      const paceClause = paceLbl ? ` ${capitalize(pace.raceVerb)} ${paceLbl} and don't bank time early.` : '';
      const raceName2 = raceName ?? 'your race';
      return {
        name: 'RACE DAY',
        sub: raceName2,
        focus: `Race day. ${dist}. Everything you built is on the line.${paceClause}`,
      };
    }

    case 'maintenance':
      return {
        name: 'MAINTENANCE',
        sub: 'Holding pattern · aerobic base',
        focus: 'No race in the build window yet. Hold the engine warm with steady volume, one weekly threshold, and the long run. We flip into BUILD when the next race gets close.',
      };

    case 'recovery':
      return {
        name: 'RECOVERY',
        sub: 'Post-race · easy + short',
        focus: 'Coming down from race effort. Easy short runs, full sleep, and let the legs rebuild. We re-enter BUILD when readiness is back at baseline.',
      };

    default:
      return { name: 'ACTIVE', sub: '', focus: 'Active block.' };
  }
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
