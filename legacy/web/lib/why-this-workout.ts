/**
 * "Why this workout", a short, plain-English reason for today's run.
 *
 * Three lines, no jargon, no hedging:
 *   1. WHAT, the kind of run, in normal words
 *   2. WHY NOW, where you are in the plan and what this block is for
 *   3. THE POINT, what this run actually does for you
 *
 * Pulls from the plan/coach data we already have. No fabricated science,
 * no "what the system knows vs doesn't" disclaimers, just a clear answer.
 */

export interface WhyThisWorkout {
  /** What kind of run, in plain words. */
  what: string;
  /** Where you are in the plan right now. */
  whereInPlan: string;
  /** What this run does for you. */
  thePoint: string;
}

function whatForType(type: string, label: string, distanceMi: number): string {
  const miles = distanceMi > 0 ? `${distanceMi % 1 === 0 ? distanceMi : distanceMi.toFixed(1)} mi` : '';
  const name = (() => {
    switch (type) {
      case 'easy':
      case 'general_aerobic': return 'Easy run';
      case 'long': return 'Long run';
      case 'recovery':
      case 'shakeout': return 'Recovery run';
      case 'tempo':
      case 'threshold':
      case 'sub_threshold':
      case 'threshold_intervals': return 'Threshold run';
      case 'intervals': return 'Speed intervals';
      case 'mp': return 'Race-pace run';
      case 'race': return 'Race day';
      case 'rest': return 'Rest day';
      default: return label || 'Run';
    }
  })();
  return miles ? `${name} · ${miles}` : name;
}

function whereInPlanFor(phase: string, phaseWeekIdx: number): string {
  const p = (phase ?? '').toLowerCase();
  if (p === 'base')   return `Base week ${phaseWeekIdx}, building your foundation.`;
  if (p === 'build')  return `Build week ${phaseWeekIdx}, adding miles and harder days.`;
  if (p === 'peak')   return `Peak week ${phaseWeekIdx}, your biggest, most race-like work.`;
  if (p === 'taper')  return `Taper week ${phaseWeekIdx}, easing back so you arrive fresh.`;
  if (p === 'race_week' || p === 'race week') return 'Race week, sharpening up for the big day.';
  if (p === 'post_race' || p === 'rebuild') return 'Recovery block, letting your body absorb the last race.';
  return `${phase} week ${phaseWeekIdx}`;
}

function thePointForType(type: string): string {
  switch (type) {
    case 'easy':
    case 'general_aerobic':
      return 'Builds your aerobic engine, the base everything else is built on. Keep it relaxed.';
    case 'long':
      return 'Time on your feet. Trains your body to keep going when the miles add up.';
    case 'recovery':
    case 'shakeout':
      return 'Keeps the blood moving and helps you recover. No pace targets, just shake the legs out.';
    case 'tempo':
    case 'threshold':
    case 'sub_threshold':
    case 'threshold_intervals':
      return 'Raises the pace you can hold before your legs start to burn. The single biggest needle-mover for race day.';
    case 'intervals':
      return 'Sharpens your top-end speed, which makes every easier pace feel easier.';
    case 'mp':
      return 'Rehearses goal race pace so it feels familiar on the day.';
    case 'race':
      return 'Race day, run your plan.';
    default:
      return 'Steady training that keeps your fitness moving forward.';
  }
}

export function buildWhyThisWorkout(
  type: string,
  label: string,
  distanceMi: number,
  phase: string,
  phaseWeekIdx: number,
  _vdot: number | null,
): WhyThisWorkout {
  return {
    what: whatForType(type, label, distanceMi),
    whereInPlan: whereInPlanFor(phase, phaseWeekIdx),
    thePoint: thePointForType(type),
  };
}
