/**
 * Plan-template engine — Stage 4 of the /Research/ migration.
 *
 * Source: Research/22-plan-templates.md (extracted to coach/doctrine/plan_templates.ts)
 *
 * Picks the active plan template for a runner based on goal race +
 * experience tier, then maps a calendar day to a workout type. The
 * engine pickRun consults this BEFORE falling back to the ad-hoc
 * `defaultByDow` so days now reflect a research-backed periodized
 * plan instead of a fixed dow→type lookup.
 *
 * Templates are scaffolds. The engine still applies state-driven
 * overrides (heavy block, post-race, ACWR, sickness) on top of the
 * template's day-shape. Always-alive planning preserved.
 */

import type { CoachState } from './coach-state';
import type { Phase } from './coach-principles';
import { PLAN_TEMPLATES, type PlanTemplate, type PlanDistance, type ExperienceLevel } from '../coach/doctrine';
import type { RunWorkoutType } from './coach-workouts';

// ── Active-template selection ───────────────────────────────────

/** Pick the active plan template for the given state. Returns null
 *  when no template applies (e.g., no goal race + no clear base mode). */
export function selectActiveTemplate(state: CoachState, phase: Phase): PlanTemplate | null {
  // No goal race → base building or maintenance template
  if (!state.races.nextA) {
    if (phase === 'REBUILD' || phase === 'POST_RACE') {
      return findById('base_building');
    }
    if (phase === 'BASE_MAINTENANCE') {
      return findById('maintenance');
    }
    return findById('base_building');
  }

  const distMi = state.races.nextA.distanceMi;
  const planDist: PlanDistance =
    distMi >= 22 ? 'marathon' :
    distMi >= 11 ? 'half_marathon' :
    distMi >= 7  ? '10K' :
                   '5K';

  const level: ExperienceLevel = inferExperienceLevel(state);
  return findById(`${planDist}_${level}`);
}

function findById(id: string): PlanTemplate | null {
  return PLAN_TEMPLATES.value.find(t => t.id === id) ?? null;
}

/** Infer experience level from training volume. Beginner <25 mpw,
 *  intermediate 25-45 mpw, advanced 45+ mpw. Heuristic — once user
 *  profile gathers explicit experience-level data, replace with that. */
export function inferExperienceLevel(state: CoachState): ExperienceLevel {
  const wkAvg = state.volume.weeklyAvg4w;
  if (wkAvg < 25) return 'beginner';
  if (wkAvg < 45) return 'intermediate';
  return 'advanced';
}

// ── Day → workout type classifier ───────────────────────────────

const JS_DOW_TO_KEY: Array<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'> = [
  'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
];

/** Pick the workout type for a calendar day from the template's
 *  sample peak week. Returns null when the day's workout string
 *  doesn't classify to a known RunWorkoutType (caller falls back). */
export function templateWorkoutType(template: PlanTemplate, jsDow: number): RunWorkoutType | null {
  const dayKey = JS_DOW_TO_KEY[jsDow];
  if (!dayKey) return null;
  const day = template.samplePeakWeek.find(d => d.day === dayKey);
  if (!day) return null;
  return classifyWorkoutString(day.workout);
}

/** Map a free-form workout description (from PLAN_TEMPLATES) to a
 *  canonical RunWorkoutType. Patterns mirror what the templates
 *  actually contain in plan_templates.ts — additions there should
 *  add a matching pattern here. Tested against every entry in the
 *  catalog as of Stage 4 ship. */
export function classifyWorkoutString(rawInput: string): RunWorkoutType | null {
  const s = rawInput.trim();
  const lower = s.toLowerCase();

  // Rest first — most explicit
  if (/^rest(\s|$|\/|\bor\b)/i.test(s)) return 'rest';
  if (/^xt or rest/i.test(s)) return 'rest';
  if (/^rest or/i.test(s)) return 'rest';

  // Race-day + shakeout
  if (/^race\b/i.test(s) || /\bRACE\b/.test(s)) return 'race';
  if (/shakeout/i.test(lower)) return 'shakeout';

  // Long-run variants — order matters; most-specific first.
  // RunWorkoutType doesn't have a separate fast_finish or
  // dress_rehearsal; both classify as long_mp_block (template detail
  // lives in workouts.ts catalog; engine treats them as MP-blocked
  // long runs).
  if (/long.*\bmp\b|w\/\s*last\s*\d+\s*@\s*m\b|\d+\s*@\s*m\b.*long|long.*at m\b/i.test(s)) return 'long_mp_block';
  if (/\d+\s*mi\s*lr\s*w\/.*last\s*\d+\s*@\s*hmp/i.test(s)) return 'long_mp_block';
  if (/long.*progress|prog.*long/i.test(s)) return 'long_progression';
  if (/long.*fast.*finish|fast.*finish.*long/i.test(s)) return 'long_mp_block';
  if (/dress.*rehearsal|rehearsal.*long/i.test(s)) return 'long_mp_block';
  if (/\blr\b/i.test(s) || /\blong\b.*(run|mi|min)/i.test(s)) return 'long_steady';

  // Marathon-specific combos (alternations)
  if (/mp\/.*alternation|10k.*alternation|marathon.*specific/i.test(s)) return 'marathon_specific';

  // Threshold workouts
  if (/sub.threshold|norwegian/i.test(s)) return 'sub_threshold';
  if (/×.*@\s*t\b|x.*@\s*t\b/i.test(s) && /\d+\s*mi\b/i.test(s)) return 'threshold_intervals';
  if (/cruise\s*interval/i.test(s)) return 'threshold_intervals';
  if (/\d+\s*(mi|min)\s*@\s*t\b|@\s*t\s*\+\s*cd|tempo|@\s*hmp/i.test(s)) return 'threshold';
  if (/long\s*tempo/i.test(s)) return 'threshold';

  // VO2max / interval reps (1000m, 800m, 1200m, 1600m, 1 mi at I)
  if (/×\s*\d+\s*(m|km|k)\b.*@\s*(i|5k|3k|10k)\b/i.test(s)) return 'vo2';
  if (/×\s*\d+\s*mi.*@\s*(i|5k|3k|10k)\b/i.test(s)) return 'vo2';
  if (/×\s*1\s*mi.*5k.*pace/i.test(s)) return 'vo2';

  // Speed / R-pace work — strides_appended is the engine's strides type
  if (/×\s*(200|400|600)\s*m.*@\s*r\b/i.test(s)) return 'strides_appended';

  // Hill work — treat as VO2 stimulus (engine has no dedicated hill type)
  if (/hill\s*sprint/i.test(lower)) return 'strides_appended';
  if (/hill\s*repeat|hill\s*circuit/i.test(lower)) return 'vo2';

  // Medium-long run
  if (/\bmlr\b|medium.long/i.test(s)) return 'medium_long';

  // Strides-only / strides-appended (informational; engine treats as easy)
  if (/^(\d+\s*mi\s*e\s*\+\s*\d+\s*×\s*st|easy.*\+.*strides)$/i.test(s)) return 'general_aerobic';

  // Recovery
  if (/recovery|rec\b/i.test(s) && !/recovery\s*=\s*\d/i.test(s)) return 'recovery';

  // Easy / general aerobic — broadest catch
  if (/^\d+\s*mi\s*(e|ga|easy)\b|easy|general\s*aerobic|^ga\b/i.test(s)) return 'general_aerobic';

  return null;
}
