/**
 * prescriptions.ts — turn a workout type + the runner's profile into a
 * fully-broken-out prescription: warmup, main set with reps + paces +
 * HR targets, recovery, cooldown, the WHY. No coach abbreviations
 * unless the abbrev is glossed alongside.
 *
 * Pace targets are derived from a race goal (treated as FTP-equivalent)
 * using Daniels-/Friel-aligned %FTP bands. HR targets use Friel LTHR
 * zones. Without a race goal we leave paces qualitative and HR-driven.
 *
 * Doctrine:
 *   Research/01-pace-zones-vdot.md (Daniels pace bands)
 *   Research/03-heart-rate-zones.md §6 (Friel LTHR zones)
 *   Research/04-workout-vocabulary.md (warmup/cooldown defaults)
 */

import { computeZones, type ZoneTable } from './zones';

export type WorkoutType =
  | 'easy' | 'long' | 'tempo' | 'threshold' | 'intervals' | 'race'
  | 'shakeout' | 'rest' | 'unplanned';

export interface PrescriptionStep {
  label: string;          // "Warmup", "Reps", "Recovery", "Cooldown"
  distance_mi?: number;   // e.g. 1.5
  reps?: number;          // e.g. 3 for 3 × 1mi
  rep_distance_mi?: number;
  duration?: string;      // "2:00" for recoveries
  pace_target?: string;   // "6:48 /mi" or "9:00-9:15 /mi"
  hr_target?: string;     // "156-162 bpm (Z4)"
  note: string;           // execution instruction

  // When this step is a REPEAT block (intervals/threshold reps), the work
  // segment + recovery are folded into one card. The top-level pace/hr/
  // distance describe the WORK rep; recovery describes the rest.
  recovery?: {
    duration: string;       // "2:00"
    pace_target?: string;   // "easy jog"
    note: string;
  };
}

export interface Prescription {
  type: WorkoutType;
  headline: string;       // "Threshold reps — engine's ceiling"
  why: string;            // one-sentence rationale
  steps: PrescriptionStep[];
  total_mi: number;
  citation: string;
  zones?: ZoneTable | null;
}

interface ProfileInputs {
  lthr?: number | null;
  goal_seconds?: number | null;        // race goal total seconds
  goal_distance_mi?: number | null;    // race distance
}

// ── Pace derivation ─────────────────────────────────────────────────────

/** Derive a Threshold Pace (s/mi) from a race goal. For HM goal it's
 *  ~HM pace + 5-10s; for marathon goal it's ~HM pace - 15s ≈ M + 15-25s.
 *  If no goal, return null and callers should fall back to HR-only cues. */
function tPaceSecPerMi(p: ProfileInputs): number | null {
  if (!p.goal_seconds || !p.goal_distance_mi) return null;
  const goalSPerMi = Math.round(p.goal_seconds / p.goal_distance_mi);
  // Half marathon goal pace ≈ T-pace + ~5s/mi for most runners.
  // Marathon goal pace ≈ T-pace + 15-25s.
  if (p.goal_distance_mi >= 25) return goalSPerMi - 18; // marathon
  if (p.goal_distance_mi >= 12) return goalSPerMi - 5;  // half
  if (p.goal_distance_mi >= 5)  return goalSPerMi + 8;  // 10K
  return goalSPerMi + 15;                                // 5K
}

function fmtPace(sPerMi: number | null): string | null {
  if (sPerMi == null || sPerMi <= 0 || !isFinite(sPerMi)) return null;
  const m = Math.floor(sPerMi / 60);
  return `${m}:${String(Math.round(sPerMi % 60)).padStart(2, '0')}`;
}

function fmtPaceRange(loS: number | null, hiS: number | null): string | null {
  const lo = fmtPace(loS), hi = fmtPace(hiS);
  if (!lo || !hi) return null;
  return `${lo}-${hi} /mi`;
}

function paces(p: ProfileInputs) {
  const t = tPaceSecPerMi(p);
  return {
    easy:      t ? fmtPaceRange(t + 60,  t + 110) : null, // T + 60-110s
    long:      t ? fmtPaceRange(t + 55,  t + 90)  : null, // T + 55-90s
    marathon:  t ? fmtPace(t + 18)                : null, // T + 18s
    tempo:     t ? fmtPaceRange(t + 5,   t + 18)  : null, // T + 5-18s
    threshold: t ? fmtPace(t)                     : null, // exact T
    interval:  t ? fmtPace(t - 18)                : null, // T - 18s (~10K pace)
    rep:       t ? fmtPace(t - 30)                : null, // T - 30s (~5K pace)
  };
}

function hrTargets(p: ProfileInputs) {
  const z = p.lthr ? computeZones({ lthr: p.lthr }) : null;
  if (!z) return null;
  const get = (idx: number) => {
    const zz = z.zones.find((x) => x.idx === idx);
    if (!zz) return null;
    // Z1 has no meaningful lower bound (no one runs at 0 bpm) — show "< upper"
    // Z5 has no meaningful upper bound (no one's max is hardcoded here) — show "> lower"
    // Everything else: lower-upper range
    if (zz.idx === 1) return `< ${zz.upper} bpm (${zz.shortLabel} ${zz.label})`;
    if (zz.idx === 5) return `> ${zz.lower} bpm (${zz.shortLabel} ${zz.label})`;
    return `${zz.lower}–${zz.upper} bpm (${zz.shortLabel} ${zz.label})`;
  };
  return {
    z1: get(1), z2: get(2), z3: get(3), z4: get(4), z5: get(5),
    table: z,
  };
}

// ── Per-workout builders ────────────────────────────────────────────────

export function prescriptionFor(
  type: WorkoutType,
  weeklyMi: number,
  p: ProfileInputs,
  /** Optional: the plan's target distance for THIS day. When provided,
   *  the prescription scales its steps to match — so a planned 12.1mi
   *  long run produces steps that add to 12.1, not the weekly default. */
  targetMi?: number,
): Prescription {
  const pc = paces(p);
  const hr = hrTargets(p);

  switch (type) {
    case 'easy': {
      // Prefer the plan's target distance for this day; fall back to a
      // weekly-volume-derived estimate when no target is passed.
      const total = targetMi != null && targetMi > 0
        ? Math.round(targetMi * 10) / 10
        : Math.round(weeklyMi * 0.18 || 5);
      return {
        type, total_mi: total,
        headline: 'Easy aerobic',
        why: 'Build the aerobic engine without taxing the legs. The discipline is keeping it easy.',
        citation: 'Research/00a-distance-running-training.md §easy-volume',
        zones: hr?.table,
        steps: [{
          label: 'Run',
          distance_mi: total,
          pace_target: pc.easy ?? 'conversational pace',
          hr_target:   hr?.z2  ?? 'Z2 — conversational',
          note: 'Should be able to talk in full sentences. Cap effort, hold form. If HR drifts up late, slow down rather than push.',
        }],
      };
    }

    case 'long': {
      // Use the plan's target distance when present; the day card and the
      // step breakdown must agree.
      const total = targetMi != null && targetMi > 0
        ? Math.round(targetMi * 10) / 10
        : Math.round(weeklyMi * 0.32 || 12);
      const mpMi  = Math.round(total * 0.35 * 10) / 10;
      const easyMi = Math.round((total - mpMi) * 10) / 10;
      const hasMpSegment = weeklyMi >= 35 && pc.marathon;
      const steps: PrescriptionStep[] = hasMpSegment
        ? [
            { label: 'Easy build', distance_mi: easyMi, pace_target: pc.long ?? 'easy', hr_target: hr?.z2 ?? 'Z2',
              note: 'Steady aerobic. Build the engine.' },
            { label: 'Marathon-pace finish', distance_mi: mpMi, pace_target: pc.marathon!, hr_target: hr?.z3 ?? 'Z3',
              note: 'The point of the workout. Find race rhythm. Steady, even effort.' },
          ]
        : [{ label: 'Run', distance_mi: total, pace_target: pc.long ?? 'easy', hr_target: hr?.z2 ?? 'Z2',
              note: 'Time on feet > pace. Fuel ~45 min in and every 30 after.' }];
      return {
        type, total_mi: total,
        headline: hasMpSegment ? 'Long run · marathon-pace finish' : 'Long run · aerobic',
        why: 'The single most important workout of the week. Time on feet builds everything else.',
        citation: 'Research/00a §long-run',
        zones: hr?.table,
        steps,
      };
    }

    case 'threshold': {
      const reps = weeklyMi >= 45 ? 4 : weeklyMi >= 35 ? 3 : 2;
      const repMi = 1;
      const recoveryMi = (reps - 1) * 0.3;
      const repsBlockMi = reps * repMi + recoveryMi;
      let wuMi = 1.5, cdMi = 1;
      // If the plan has a specific target for today, pad warmup + cooldown
      // (60/40 split) so the prescription totals match the planned distance.
      if (targetMi != null && targetMi > 0) {
        const need = Math.max(0, targetMi - repsBlockMi);
        wuMi = Math.round(need * 0.6 * 10) / 10;
        cdMi = Math.round(need * 0.4 * 10) / 10;
      }
      const total = wuMi + repsBlockMi + cdMi;
      return {
        type, total_mi: Math.round(total * 10) / 10,
        headline: `Threshold · repeat ${reps} times`,
        why: 'Lift the lactate threshold — the engine\'s ceiling. The pace you could hold for an hour.',
        citation: 'Research/04 §intervals-and-threshold',
        zones: hr?.table,
        steps: [
          { label: 'Warmup', distance_mi: wuMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Start easy, build into rep pace in the last 0.25 mi.' },
          { label: `Repeat ${reps}×`, reps, rep_distance_mi: repMi,
            pace_target: pc.threshold ?? 'comfortably hard',
            hr_target: hr?.z4 ?? 'Z4 — just below threshold',
            note: 'Each mile at the same pace — rep 1 must match rep ' + reps + '. If you can\'t hold pace on the last rep, the pace was too aggressive (drop 3-5s/mi next time).',
            recovery: { duration: '2:00', pace_target: 'easy jog',
              note: 'Honest jog between reps, not standing. HR drops 15-20 bpm but doesn\'t fully recover. Skip the recovery after the final rep — straight into cooldown.' },
          },
          { label: 'Cooldown', distance_mi: cdMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Loosen the legs. Don\'t skip — it shortens recovery for tomorrow.' },
        ],
      };
    }

    case 'tempo': {
      const tempoMi = weeklyMi >= 45 ? 5 : weeklyMi >= 35 ? 4 : 3;
      let wuMi = 1.5, cdMi = 1;
      if (targetMi != null && targetMi > 0) {
        const need = Math.max(0, targetMi - tempoMi);
        wuMi = Math.round(need * 0.6 * 10) / 10;
        cdMi = Math.round(need * 0.4 * 10) / 10;
      }
      const total = wuMi + tempoMi + cdMi;
      return {
        type, total_mi: total,
        headline: `Tempo · ${tempoMi} continuous miles`,
        why: 'Sub-threshold steady — teach the body to clear lactate, not bury it. Marathon pace territory.',
        citation: 'Research/04 §tempo',
        zones: hr?.table,
        steps: [
          { label: 'Warmup', distance_mi: wuMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Build gradually — the last 0.5mi should approach tempo pace.' },
          { label: 'Tempo', distance_mi: tempoMi, pace_target: pc.tempo ?? 'comfortably hard', hr_target: hr?.z3 ?? 'Z3',
            note: 'Continuous, controlled, even pace. If breathing turns ragged, you\'re too hot — back off 5-10s/mi.' },
          { label: 'Cooldown', distance_mi: cdMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Easy jog to flush the legs.' },
        ],
      };
    }

    case 'intervals': {
      const reps = weeklyMi >= 45 ? 6 : 5;
      const repMi = 0.5; // 800m ≈ 0.5mi
      const recoveryMi = (reps - 1) * 0.25;
      const repsBlockMi = reps * repMi + recoveryMi;
      let wuMi = 1.5, cdMi = 1;
      if (targetMi != null && targetMi > 0) {
        const need = Math.max(0, targetMi - repsBlockMi);
        wuMi = Math.round(need * 0.6 * 10) / 10;
        cdMi = Math.round(need * 0.4 * 10) / 10;
      }
      const total = wuMi + repsBlockMi + cdMi;
      return {
        type, total_mi: Math.round(total * 10) / 10,
        headline: `Intervals · repeat ${reps} times`,
        why: 'VO2 max — the engine\'s peak output. Short reps at race-finish effort.',
        citation: 'Research/04 §intervals',
        zones: hr?.table,
        steps: [
          { label: 'Warmup', distance_mi: wuMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Easy + 4 × 20s strides at the end to fire the system.' },
          { label: `Repeat ${reps}×`, reps, rep_distance_mi: repMi,
            pace_target: pc.interval ?? 'hard, controlled',
            hr_target: hr?.z5 ?? 'Z5 — at or above threshold',
            note: 'Even splits from rep 1 to rep ' + reps + '. Hit the target on rep 1 — don\'t go out faster expecting to fade. If you can\'t hold pace on the last rep, drop 2-3 sec/rep next time.',
            recovery: { duration: '1:30', pace_target: 'easy jog',
              note: 'Short recovery is the point — incomplete rest is what drives the adaptation. Skip after the final rep — go straight into cooldown.' },
          },
          { label: 'Cooldown', distance_mi: cdMi, pace_target: pc.easy ?? 'easy',
            note: 'Walk first if needed, then jog easy.' },
        ],
      };
    }

    case 'shakeout': {
      return {
        type, total_mi: 2,
        headline: 'Pre-race shakeout',
        why: 'Fire the neuromuscular system without taxing it. Loosen the legs.',
        citation: 'Research/08-pacing-and-race-week.md §day-before',
        zones: hr?.table,
        steps: [
          { label: 'Run', distance_mi: 2, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Easy. Keep it under 25 minutes total.' },
          { label: 'Strides', reps: 4, duration: '20 sec',
            note: '4 × 20-second strides at near-race pace with full recovery between. NOT a workout — neuromuscular activation only.' },
        ],
      };
    }

    case 'race': {
      const total = p.goal_distance_mi ?? 13.1;
      return {
        type, total_mi: total,
        headline: 'Race day',
        why: 'All training points here. Execute the plan.',
        citation: 'Research/08 §race-execution',
        zones: hr?.table,
        steps: [
          { label: 'Race', distance_mi: total,
            pace_target: pc.marathon ?? 'race pace',
            hr_target: hr?.z3 ?? 'Z3-Z4',
            note: 'Hold the plan in the first 5K. Pacing decisions made in mile 1 cost you in mile 12. Negative split if possible — go out controlled, finish strong.' },
        ],
      };
    }

    case 'rest': {
      return {
        type, total_mi: 0,
        headline: 'Rest day',
        why: 'Rest is the work. Glycogen restocks, micro-tears repair, the nervous system resets.',
        citation: 'Research/00b-recovery-protocols.md §rest-physiology',
        zones: null,
        steps: [{
          label: 'Today',
          note: 'No running. Sleep, mobility, fuel. A week with two hard days plus rest produces more fitness than a week of seven moderate days.',
        }],
      };
    }

    default:
      return {
        type, total_mi: 0,
        headline: 'No workout scheduled',
        why: 'When a plan is active, the workout for this day will appear here.',
        citation: '',
        zones: hr?.table,
        steps: [],
      };
  }
}
