/**
 * Citation helpers for deterministic Coach decisions.
 *
 * The Coach's LLM brain returns citations the model picked. The
 * deterministic brain doesn't have an LLM in the loop, so we map
 * decisions → citations explicitly here. Same `Citation` shape;
 * users can't tell the difference at the UI layer.
 *
 * Sources: every citation here points at the canonical research
 * library under `Research/` (see `Research/INDEX.md`). The
 * deprecated synthesis docs (`docs/coaching-research.md`,
 * `docs/amp-research.md`) are no longer used.
 *
 * The `rc()` / `ar()` helpers below remain only as compatibility
 * shims for any external caller — internal mappings use `cite(...,
 * 'research', 'NN')` from `./doctrine/cite`. Same pattern as the
 * Stage-1+ doctrine modules (pace_zones.ts, hr_zones.ts,
 * weather.ts, workouts.ts).
 */
import { cite } from './doctrine/cite';
import type { Citation } from './types';

/** Legacy shim — build a coaching-research citation from a §-prefixed
 *  section ID. Kept for any external caller; the helpers below now
 *  issue canonical `Research/` citations directly. */
export function rc(section: string, snippet?: string): Citation {
  return { doc: 'docs/coaching-research.md', section, snippet };
}

/** Legacy shim — build an amp-research citation. See `rc()`. */
export function ar(section: string, snippet?: string): Citation {
  return { doc: 'docs/amp-research.md', section, snippet };
}

/** Citations for a given workout type. Drawn from the canonical
 *  workout-vocabulary library (Research/04) and the foundational
 *  training reference (Research/00a). */
export function citationsForWorkoutType(type: string): Citation[] {
  switch (type) {
    case 'recovery':
      return [
        cite(
          '§1 Recovery runs',
          'Slower than E. ~MP + 90+ s/mi, or 60-70% HRmax. Duration 20-45 min. Should not exceed ~10-15% of weekly mileage.',
          'research', '04',
        ),
        cite(
          '§In-Week Recovery › Recovery Run vs. Easy Run',
          'Recovery run: RPE 2-3, ≤60% HRmax, 60-90 s/mi slower than easy, 20-45 min — purpose is circulation, not adaptation.',
          'research', '00b',
        ),
      ];
    case 'general_aerobic':
    case 'easy':
      return [
        cite(
          '§2 Easy / general aerobic runs',
          '30-75 min typical; 15-25% slower than MP; 70-81% HRmax. 70-85% of weekly mileage.',
          'research', '04',
        ),
        cite(
          '§Aerobic Base Development',
          'Easy/moderate volume drives mitochondrial biogenesis and the aerobic adaptations that determine endurance performance.',
          'research', '00a',
        ),
      ];
    case 'medium_long':
      return [
        cite(
          '§3 Medium-long runs',
          'A second weekly run of 11-15 miles, distinct from the long run. Same pace as long run: E to low M effort. Pfitzinger marathon and HM plans use it through base and specific phases.',
          'research', '04',
        ),
      ];
    case 'long_steady':
    case 'long_progression':
    case 'long_mp_block':
    case 'long_fast_finish':
      return [
        cite(
          '§4.2 Base long run',
          '90 min minimum for endurance benefit; cap at ~25-30% of weekly mileage. 10-22+ mi for marathoners.',
          'research', '04',
        ),
        cite(
          '§4.4 Marathon-pace long run',
          '14-22 mi total with 8-16 mi at MP. Easy warmup (2-4 mi) + MP block + optional easy cooldown. The defining marathon-specific session.',
          'research', '04',
        ),
      ];
    case 'tempo_continuous':
    case 'threshold':
    case 'threshold_intervals':
    case 'sub_threshold':
      return [
        cite(
          '§5 Threshold workouts',
          'Threshold work targets LT2 (lactate threshold) and the band just below it. Goal: extend the velocity at which lactate clearance matches production.',
          'research', '04',
        ),
        cite(
          '§Training Intensity Distribution (TID)',
          'Polarized (~80/5/15) for 5K/10K specific; pyramidal (~80/15/5) for HM and marathon — both elite distributions converge on ≥75% Z1.',
          'research', '00a',
        ),
      ];
    case 'vo2':
      return [
        cite(
          '§6 VO2max workouts',
          'VO2max work targets max aerobic power. Daniels rule: each interval 3-5 min; total at-pace volume ≤8% of weekly mileage; recovery roughly equals interval duration.',
          'research', '04',
        ),
      ];
    case 'marathon_specific':
    case 'marathon_specific_combo':
    case 'marathon_specific_long':
      return [
        cite(
          '§11 Marathon-specific workouts',
          'Defining sessions of the marathon specific phase — Canova special block, Canova 2K repeats, long MP runs, pre-fatigue MP work.',
          'research', '04',
        ),
      ];
    case 'strides':
    case 'hill_sprints':
      return [
        cite(
          '§7 Speed / economy workouts',
          'Short, fast, full-recovery work to develop neuromuscular coordination, running economy, and stride mechanics. Daniels: cap R pace at 5% of weekly mileage.',
          'research', '04',
        ),
      ];
    case 'race':
      return [
        cite(
          '§9 The Taper: Final 2-3 Weeks',
          'Marathon taper 14-21 days with 40-60% peak-week volume reduction. The largest cut is to easy mileage; intensity is preserved through the taper.',
          'research', '08',
        ),
      ];
    case 'shakeout':
      return [
        cite(
          '§9.1 Taper duration by distance',
          'The largest cut is to easy mileage; intensity is preserved through the taper. Run frequency is maintained at ~80% of normal. Add no novel workout types.',
          'research', '08',
        ),
      ];
    case 'rest':
      return [
        cite(
          '§The Three Categories of Recovery',
          'Adaptation occurs during recovery, not during training stress. Recovery is in-week, cutback weeks, and post-race.',
          'research', '00b',
        ),
      ];
    default:
      return [
        cite(
          '§Training Intensity Distribution (TID)',
          'TID is the proportion of training time/sessions across Z1 (easy), Z2 (threshold), Z3 (hard). Polarized, pyramidal, threshold-dominant, and HVLIT distributions.',
          'research', '00a',
        ),
      ];
  }
}

/** Citations for the readiness signal — references the doctrine
 *  sections that govern green / yellow / red bands. */
export function citationsForReadiness(level: 'green' | 'yellow' | 'red'): Citation[] {
  // Same doctrine regardless of level; the rationale text varies.
  return [
    cite(
      '§Training Load and Injury Risk › ACWR risk zones',
      'ACWR sweet spot 0.8-1.3 = lowest injury risk; 1.3-1.5 caution; ≥1.5 substantially elevated risk. Heuristic, not a rule.',
      'research', '00a',
    ),
    cite(
      '§Training Intensity Distribution (TID)',
      'All elite distance runners converge on ≥75% of training volume in Z1 — easy volume is uniquely sustainable.',
      'research', '00a',
    ),
    ...(level !== 'green' ? [
      cite(
        '§In-Week Recovery › Hard/Easy Alternation',
        'Threshold: 1 day easy after. VO2max or long+MP: 2 days easy. Never stack two hard days back-to-back.',
        'research', '00b',
      ),
    ] : []),
  ];
}

/** Citations referenced when the Coach modifies the plan because of
 *  load (single-session spike cap, ACWR drift). */
export function citationsForLoadAdjustment(): Citation[] {
  return [
    cite(
      '§Training Load and Injury Risk › The 10% rule — reconsidered',
      'Single-run length spike >110% of longest run in prior 30 d → 64% increased overuse injury risk (BJSM 5,200-runner cohort). Weekly mileage change correlated weakly with injury.',
      'research', '00a',
    ),
    cite(
      '§Training Load and Injury Risk › Practical load rules',
      'Long-run cap rule: single long run should not exceed 110% of the longest run in the prior 30 days. Add stress one-at-a-time — mileage OR intensity, not both.',
      'research', '00a',
    ),
  ];
}

/** Citations for taper-related decisions. */
export function citationsForTaper(): Citation[] {
  return [
    cite(
      '§9.1 Taper duration by distance',
      'Marathon: 14-21 day taper, 40-60% reduction from peak-week volume. Largest cuts go to easy mileage; intensity is preserved.',
      'research', '08',
    ),
    cite(
      '§9.1 Taper duration by distance',
      'Run frequency is maintained at ~80% of normal — do not suddenly add rest days. Add no novel workout types in the final 10 days.',
      'research', '08',
    ),
  ];
}
