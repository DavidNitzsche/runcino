/**
 * GlanceState → Faff payload adapter.
 *
 * Bridges the existing production data loader (`lib/coach/glance-state.ts`)
 * to the Faff v3 component contracts (Poster / Sibling / WeekStrip).
 *
 * This file is the ONLY place where data-shape ↔ design-shape translation
 * happens for /today. New surfaces (/plan, /races, /health, /me) get
 * sibling adapter modules in this folder.
 *
 * Cardinal Rules respected:
 *   #1 (build it right): adapter is pure functions, no side effects, no
 *      LLM calls. Same input → same output.
 *   #3 (cite doctrine): the day-state resolution rules come from
 *      design/resolver/states.md (Faff repo). The 4-char WeekStrip
 *      vocabulary comes from design/components/WeekStrip.md §"Type label
 *      vocabulary" — closed set: EASY · INTS · TMPO · THRS · FART · QUAL ·
 *      LONG · REST · XTRN · RACE · —
 *   #4 (single source of truth): the canonical PosterPayload / SiblingPayload
 *      / WeekStripPayload types live in lib/faff/types.ts (mirror of
 *      Faff/shared/types.ts).
 *
 * Lifted: 2026-05-28 cutover.
 */

import type { GlanceState, GlanceWeekDay } from '@/lib/coach/glance-state';
import type {
  DayState,
  PosterPayload,
  PosterBreakdownRow,
  SiblingPayload,
  WeekStripPayload,
  WorkoutType,
  MiniTile,
  Stat,
} from '@/lib/faff/types';

// ──────────────────────────────────────────────────────────────────────
// 1. Day-state resolver
// ──────────────────────────────────────────────────────────────────────

/**
 * Map today's GlanceWeekDay + race horizon → one of 11 DayStates.
 *
 * Per design/resolver/states.md priority order (locked 2026-05-28):
 *   1. new_user · no active plan
 *   2. race_week · days_to_race ≤ 7
 *   3. done_nailed / done_ease_off · ran today (ease_off heuristic deferred → all done = nailed for v1)
 *   4. missed · today is past noon, was planned, not done (deferred · returns easy for now)
 *   5. niggle / sick · signals not yet in GlanceState · deferred
 *   6. base 4 · rest / long / quality / easy keyed off plannedType
 */
export function resolveDayState(glance: GlanceState | null): DayState {
  if (!glance) return 'new_user';
  if (!glance.today) return 'new_user';

  // 1. new_user: no plan = no weekDays populated meaningfully (still rendered
  //    by glance-state for the grid). Use the absence of plannedType across
  //    the whole week as the signal that there's no plan attached.
  const hasPlan = glance.weekDays.some(
    (d) => d.plannedType !== 'unplanned' && d.plannedType !== null,
  );
  if (!hasPlan) return 'new_user';

  // 2. race_week: T-7 → T-0 takeover.
  if (glance.daysToARace != null && glance.daysToARace >= 0 && glance.daysToARace <= 7) {
    return 'race_week';
  }

  // 2b. skipped · runner explicitly tapped SKIP on the poster.
  // Sits *after* race-week (the race takeover is sacred) but *before* the
  // base-4 so the skipped surface wins over the original easy/quality/long.
  // P-SKIP 2026-05-28 · see lib/coach/glance-state.ts → todaySkipped.
  if (glance.todaySkipped) return 'skipped';

  // 2c. sick / niggle · runner-logged health flags.
  // P-NIGGLE-SICK 2026-05-28. Sick takes precedence over niggle (illness
  // pauses the plan; niggle modifies but doesn't pause). Both sit AFTER
  // skipped and DEFER to race_week (T-7..T-0 takeover is sacred per
  // design/resolver/states.md §02), but TAKE PRECEDENCE over the base-4
  // so the health-aware surface wins over the original easy/quality/long.
  if (glance.activeSick) return 'sick';
  if (glance.activeNiggle) return 'niggle';

  const today = glance.weekDays.find((d) => d.date === glance.today);
  if (!today) return 'easy';

  // 3. done · ran today
  const ran = today.doneMi >= 0.5;
  if (ran) {
    // ease_off heuristic deferred — v1 routes all completed runs to nailed.
    // Future: compare doneMi vs plannedMi (>=125% = ease_off) + HR drift.
    return 'done_nailed';
  }

  // 4. missed · was planned, today is past, no run logged.
  //    Deferred for v1 — falls into the base-4 branch.

  // 5. niggle / sick · need separate signals (logbook entries, check-ins).
  //    Deferred for v1.

  // 6. base 4 · keyed off plannedType
  const t = (today.plannedType ?? '').toLowerCase();
  if (t === 'rest') return 'rest';
  if (t === 'long') return 'long';
  if (t === 'threshold' || t === 'tempo' || t === 'intervals' || t === 'fartlek' || t === 'progression') {
    return 'quality';
  }
  return 'easy';
}

// ──────────────────────────────────────────────────────────────────────
// 2. State gradient + verb dictionary (Poster builders)
// ──────────────────────────────────────────────────────────────────────

const GRADIENT_BY_STATE: Record<DayState, string> = {
  easy: 'g-easy',
  quality: 'g-quality',
  long: 'g-long',
  rest: 'g-rest',
  done_nailed: 'g-done',
  done_ease_off: 'g-ease',
  niggle: 'g-niggle',
  sick: 'g-sick',
  missed: 'g-missed',
  race_week: 'g-race',
  new_user: 'g-new',
  skipped: 'g-skip',
};

/**
 * Hero verb per state. Single deterministic value for v1 — no rotation,
 * matching what the Faff fixtures emit (per design/pages/today.md hero
 * table).
 */
function heroVerb(state: DayState, today: GlanceWeekDay | null): string {
  switch (state) {
    case 'easy':
      return today ? `EASY ${formatMi(today.plannedMi)}.` : 'EASY.';
    case 'quality':
      return today ? `QUALITY ${formatMi(today.plannedMi)}.` : 'QUALITY.';
    case 'long':
      return today ? `LONG ${formatMi(today.plannedMi)}.` : 'GO LONG.';
    case 'rest':
      return 'REST.';
    case 'done_nailed':
      return 'NAILED IT.';
    case 'done_ease_off':
      return 'EASE OFF TOMORROW.';
    case 'niggle':
      return 'LISTEN TO IT.';
    case 'sick':
      return 'RECOVER FIRST.';
    case 'missed':
      return 'MISSED THE TARGETS.';
    case 'race_week':
      return 'RACE WEEK.';
    case 'new_user':
      return 'WELCOME TO FAFF.';
    case 'skipped':
      return 'SKIPPED TODAY.';
  }
}

// ──────────────────────────────────────────────────────────────────────
// 3. Poster builder
// ──────────────────────────────────────────────────────────────────────

export function buildPoster(glance: GlanceState, state: DayState): PosterPayload {
  const today = glance.weekDays.find((d) => d.date === glance.today) ?? null;

  // Eyebrow — DOW · MON DD · PHASE TAG
  const eyebrow = composeEyebrow(glance);
  const phaseTag = glance.phaseLabel ? glance.phaseLabel.toUpperCase() : null;

  const verb = heroVerb(state, today);

  // Stat trio · varies per state per Direction A3 deck. easy keeps the
  // body-context trio (WEEK · RHR · SLEEP); quality/long switch to
  // workout-context (TOTAL MI · LTHR · EST. TIME and PLANNED MI · EST.
  // TIME · TO RACE respectively).
  const stat_trio = buildStatTrio(state, today, glance);

  // Workout-merge rows · Direction A3 (docs/2026-05-28-poster-workout-
  // merge.html). State-keyed in the adapter, NOT in Poster.tsx — the
  // component just renders what the payload emits.
  const workout_breakdown = buildWorkoutBreakdown(state, today, glance);

  // Hero number for race_week countdown
  const days_countdown =
    state === 'race_week' && glance.daysToARace != null && glance.nextARaceName
      ? {
          days: glance.daysToARace,
          dateLabel: glance.nextARaceName.toUpperCase(),
        }
      : null;

  // Hero number for done states (mileage banked)
  const hero_number =
    (state === 'done_nailed' || state === 'done_ease_off') && today
      ? {
          value: today.doneMi.toFixed(today.doneMi % 1 === 0 ? 0 : 1),
          unit: 'MI',
          duration: null,
        }
      : null;

  return {
    state,
    gradient_token: GRADIENT_BY_STATE[state],
    eyebrow,
    verb,
    verb_suffix: null,
    prose: null,
    phase_tag: phaseTag,
    stat_trio,
    hero_number,
    choice_row: null, // missed state · deferred for v1
    days_countdown,
    workout_breakdown,
  };
}

function composeEyebrow(glance: GlanceState): string {
  const parts: string[] = [];
  parts.push(dowMonthDay(glance.today));
  if (glance.phaseLabel) parts.push(glance.phaseLabel.toUpperCase());
  return parts.join(' · ');
}

function buildStatTrio(
  state: DayState,
  today: GlanceWeekDay | null,
  glance: GlanceState,
): Stat[] | null {
  if (!today) return null;
  switch (state) {
    case 'easy':
      // Direction A3 deck · EASY keeps the body-context trio. The workout-
      // merge rows above now carry the workout numbers; this row carries
      // the body context (week mi · RHR · sleep) the runner glances at
      // before stepping out.
      return [
        { value: glance.weekDone.toFixed(1), label: 'WEEK MI' },
        {
          value: glance.rhrCurrent != null ? String(glance.rhrCurrent) : '—',
          label: 'RHR BPM',
        },
        {
          value: glance.sleep7Avg != null ? glance.sleep7Avg.toFixed(1) : '—',
          label: 'SLEEP 7D',
        },
      ];
    case 'quality': {
      // Direction A3 deck · QUALITY switches to workout-context. TOTAL MI ·
      // LTHR · EST. TIME. LTHR comes from the runner profile (TODO: wire
      // through to a real profile-derived value · for now placeholder).
      const lthr = '—'; // TODO 2026-05-28 · wire to profile.lthr_bpm once
                       // GlanceState surfaces it. Doctrine: research/notes/
                       // lthr-auto-derivation.md tier 3+.
      const estTime = today.plannedMi > 0 ? formatEstTime(today.plannedMi, 480) : '—'; // ~8:00/mi placeholder for quality avg
      return [
        {
          value: today.plannedMi > 0
            ? today.plannedMi.toFixed(today.plannedMi % 1 === 0 ? 0 : 1)
            : '—',
          label: 'TOTAL MI',
        },
        { value: lthr, label: 'LTHR BPM' },
        { value: estTime, label: 'EST. TIME' },
      ];
    }
    case 'long': {
      // Direction A3 deck · LONG switches to workout/horizon-context.
      // PLANNED MI · EST. TIME · TO RACE (or WEEK MI as fallback when
      // no A-race horizon is on the calendar).
      const estTime = today.plannedMi > 0 ? formatEstTime(today.plannedMi, 495) : '—'; // ~8:15/mi long-day placeholder
      const horizon = glance.daysToARace != null
        ? { value: `${glance.daysToARace}d`, label: 'TO RACE', valueColor: 'race' as const }
        : { value: glance.weekDone.toFixed(1), label: 'WEEK MI' };
      return [
        {
          value: today.plannedMi > 0
            ? today.plannedMi.toFixed(today.plannedMi % 1 === 0 ? 0 : 1)
            : '—',
          label: 'PLANNED MI',
        },
        { value: estTime, label: 'EST. TIME' },
        horizon,
      ];
    }
    case 'done_nailed':
    case 'done_ease_off':
      return [
        { value: today.doneMi.toFixed(1), label: 'BANKED MI' },
        { value: glance.weekDone.toFixed(1), label: 'WEEK MI' },
        { value: '✓', label: 'PLAN HIT', valueColor: 'green' },
      ];
    case 'rest':
      return [
        { value: glance.weekDone.toFixed(1), label: 'WEEK MI' },
        { value: glance.sleep7Avg != null ? glance.sleep7Avg.toFixed(1) : '—', label: 'SLEEP 7D' },
        { value: glance.rhrCurrent != null ? String(glance.rhrCurrent) : '—', label: 'RHR BPM' },
      ];
    case 'race_week':
      return [
        {
          value: glance.daysToARace != null ? String(glance.daysToARace) : '—',
          label: 'DAYS',
          valueColor: 'race',
        },
        { value: glance.weekDone.toFixed(1), label: 'WEEK MI' },
        { value: glance.sleep7Avg != null ? glance.sleep7Avg.toFixed(1) : '—', label: 'SLEEP 7D' },
      ];
    case 'new_user':
    case 'missed':
    case 'niggle':
    case 'sick':
    case 'skipped':
      // P-SKIP 2026-05-28 · the skipped poster is just the verb on the
      // gradient — no stat trio. The body tiles (sleep/RHR/HRV/load) live
      // on the Sibling, where the user can still see what the day looked like.
    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// 3b. Workout-merge builder (Direction A3 · 2026-05-28)
//     docs/2026-05-28-poster-workout-merge.html §"DIRECTION A3 · No rules.
//     Just the rows." — rows live inside the gradient Poster, vertically
//     centered between the verb and the stat trio. No hairlines; caps
//     labels carry the structure.
// ──────────────────────────────────────────────────────────────────────

/**
 * Compose the 3-row workout breakdown the Poster renders mid-card. Returns
 * null for states without a workout to render structure for (done, rest,
 * skipped, missed, niggle, sick, new_user, race_week).
 *
 * Per-state row shape:
 *   easy    · PACE / HR CAP / DURATION
 *   long    · PACE / HR CAP / FUEL
 *   quality · WARMUP / [WORK|TEMPO|PROGRESSION] / COOLDOWN
 *   race    · PACE TARGET / STRATEGY / DISTANCE
 *
 * 2026-05-28 (migration 120) · when `today.plannedSpec` is present, real
 * Daniels-VDOT numbers are pulled from the per-workout spec the plan-builder
 * authored. The placeholder pace bands ("8:15–8:45/mi") and HR caps
 * ("148 bpm") below remain as guard rails for runners without a VDOT (no
 * race result yet) or for workouts the builder didn't emit a spec for
 * (e.g. mutations applied post-authoring that null'd the spec). Cite
 * research/doctrine/training/01-daniels-running-formula.md §VDOT-table-to-85
 * for the pace targets and research/notes/lthr-auto-derivation.md for the
 * HR ceilings.
 */
function buildWorkoutBreakdown(
  state: DayState,
  today: GlanceWeekDay | null,
  _glance: GlanceState,
): PosterBreakdownRow[] | null {
  if (!today) return null;
  const spec = today.plannedSpec;

  switch (state) {
    case 'easy': {
      const mi = today.plannedMi;
      const distLabel = mi > 0
        ? `${mi.toFixed(mi % 1 === 0 ? 0 : 1)} mi`
        : '—';
      // Spec-driven (real VDOT numbers): prefer when present and kind matches.
      if (spec && spec.kind === 'easy') {
        const paceSec = (spec.pace_target_s_per_mi_lo + spec.pace_target_s_per_mi_hi) / 2;
        const minutes = mi > 0 ? Math.round((mi * paceSec) / 60) : null;
        return [
          {
            label: 'PACE',
            body: 'Conversational · Z2',
            tail: `${fmtPace(spec.pace_target_s_per_mi_lo)}–${fmtPace(spec.pace_target_s_per_mi_hi)}/mi`,
          },
          {
            label: 'HR CAP',
            body: 'Stay aerobic',
            tail: spec.hr_cap_bpm != null ? `${spec.hr_cap_bpm} bpm` : '148 bpm',
          },
          {
            label: 'DURATION',
            body: minutes != null ? `~${minutes} min on feet` : 'Time on feet',
            tail: distLabel,
          },
        ];
      }
      // Fallback placeholders (no spec — runner has no VDOT, or workout
      // type/spec mismatch). TODO 2026-05-28 · pace band ("8:15–8:45/mi")
      // + HR cap (148 bpm) below stay as guard rails per Daniels VDOT
      // table + LTHR doctrine. Duration estimate placeholder 8.5 min/mi.
      const minutes = mi > 0 ? Math.round(mi * 8.5) : null;
      return [
        { label: 'PACE', body: 'Conversational · Z2', tail: '8:15–8:45/mi' },
        { label: 'HR CAP', body: 'Stay aerobic', tail: '148 bpm' },
        {
          label: 'DURATION',
          body: minutes != null ? `~${minutes} min on feet` : 'Time on feet',
          tail: distLabel,
        },
      ];
    }
    case 'long': {
      // Spec-driven · long-runs ship pace band + fuel checkpoints.
      if (spec && spec.kind === 'long') {
        const fuelTail = spec.fuel_mi.length > 0
          ? `mi ${spec.fuel_mi.join(' · ')}`
          : 'mi 4 · 8 · 11';
        return [
          {
            label: 'PACE',
            body: 'Aerobic band',
            tail: `${fmtPace(spec.pace_target_s_per_mi_lo)}–${fmtPace(spec.pace_target_s_per_mi_hi)}/mi`,
          },
          {
            label: 'HR CAP',
            body: 'Long-day ceiling',
            tail: spec.hr_cap_bpm != null ? `${spec.hr_cap_bpm} bpm` : '145 bpm',
          },
          { label: 'FUEL', body: 'Gel · water · gel', tail: fuelTail },
        ];
      }
      // Progression-flavored long runs (HM Finish / Progression sub_labels)
      // arrive here too — spec.kind is 'progression' in that case.
      if (spec && spec.kind === 'progression') {
        return [
          { label: 'WARMUP', body: `${fmtMi(spec.warmup_mi)} mi easy`, tail: `${fmtPace(spec.prog_start_s_per_mi)}/mi` },
          {
            label: 'PROGRESSION',
            body: 'Build easy → tempo',
            tail: `${fmtPace(spec.prog_start_s_per_mi)} → ${fmtPace(spec.prog_end_s_per_mi)}`,
          },
          { label: 'COOLDOWN', body: `${fmtMi(spec.cooldown_mi)} mi easy`, tail: spec.hr_cap_bpm != null ? `${spec.hr_cap_bpm} bpm cap` : 'finish strong' },
        ];
      }
      // Fallback placeholders. TODO 2026-05-28 · long-day pace/HR are
      // placeholders per VDOT L-pace + LTHR-margin doctrine.
      return [
        { label: 'PACE', body: 'Aerobic band', tail: '8:00–8:25/mi' },
        { label: 'HR CAP', body: 'Long-day ceiling', tail: '145 bpm' },
        { label: 'FUEL', body: 'Gel · water · gel', tail: 'mi 4 · 8 · 11' },
      ];
    }
    case 'quality': {
      // Pick the WORK row label + body off the runner's plannedType +
      // plannedLabel. plannedLabel examples from glance-state.ts:
      //   '6×800', '4×1k', '3mi @ T', '5×1k', '12mi long'
      const subtype = (today.plannedType ?? '').toLowerCase();
      const workBody = interpretWorkBody(today.plannedLabel);

      // Spec-driven · prefer real warmup/cooldown + rep pace from VDOT.
      if (spec && spec.kind === 'tempo') {
        return [
          {
            label: 'WARMUP',
            body: `${fmtMi(spec.warmup_mi)} mi easy`,
            tail: `~${Math.round((spec.warmup_mi * 510) / 60)} min`,
          },
          {
            label: 'TEMPO',
            body: workBody,
            tail: `${fmtPace(spec.tempo_pace_s_per_mi)}/mi`,
          },
          {
            label: 'COOLDOWN',
            body: `${fmtMi(spec.cooldown_mi)} mi easy`,
            tail: `~${Math.round((spec.cooldown_mi * 510) / 60)} min`,
          },
        ];
      }
      if (spec && spec.kind === 'progression') {
        return [
          { label: 'WARMUP', body: `${fmtMi(spec.warmup_mi)} mi easy`, tail: `${fmtPace(spec.prog_start_s_per_mi)}/mi` },
          {
            label: 'PROGRESSION',
            body: 'Build easy → tempo',
            tail: `${fmtPace(spec.prog_start_s_per_mi)} → ${fmtPace(spec.prog_end_s_per_mi)}`,
          },
          { label: 'COOLDOWN', body: `${fmtMi(spec.cooldown_mi)} mi easy`, tail: '~9 min' },
        ];
      }
      if (spec && (spec.kind === 'threshold' || spec.kind === 'intervals')) {
        const distStr = spec.rep_distance_m
          ? `${spec.rep_distance_m}m`
          : `${spec.rep_distance_mi ?? '?'} mi`;
        const restStr = spec.rep_rest_s >= 60
          ? `${Math.floor(spec.rep_rest_s / 60)}:${String(spec.rep_rest_s % 60).padStart(2, '0')}`
          : `${spec.rep_rest_s}s`;
        return [
          {
            label: 'WARMUP',
            body: `${fmtMi(spec.warmup_mi)} mi easy build`,
            tail: `~${Math.round((spec.warmup_mi * 510) / 60)} min`,
          },
          {
            label: 'WORK',
            body: `${spec.rep_count} × ${distStr} · ${restStr} jog rest`,
            tail: `${fmtPace(spec.rep_pace_s_per_mi)}/mi`,
          },
          {
            label: 'COOLDOWN',
            body: `${fmtMi(spec.cooldown_mi)} mi easy`,
            tail: `~${Math.round((spec.cooldown_mi * 510) / 60)} min`,
          },
        ];
      }

      // Fallback placeholders. TODO 2026-05-28 · pace tails ("3:02/mi",
      // "7:15/mi") + warmup/cooldown durations are placeholders per
      // Daniels VDOT R/I/T-pace doctrine.
      if (subtype === 'tempo') {
        return [
          { label: 'WARMUP', body: '1.5 mi easy', tail: '~13 min' },
          { label: 'TEMPO', body: workBody, tail: '7:15/mi' },
          { label: 'COOLDOWN', body: '1 mi easy', tail: '~8 min' },
        ];
      }
      if (subtype === 'progression') {
        return [
          { label: 'WARMUP', body: '1 mi easy', tail: '~9 min' },
          { label: 'PROGRESSION', body: 'Build from easy to tempo', tail: '8:30 → 7:15' },
          { label: 'COOLDOWN', body: '1 mi easy', tail: '~9 min' },
        ];
      }
      // threshold / intervals / fartlek default
      return [
        { label: 'WARMUP', body: '1.5 mi easy build', tail: '~12 min' },
        { label: 'WORK', body: workBody, tail: '3:02/mi' },
        { label: 'COOLDOWN', body: '1.5 mi easy', tail: '~13 min' },
      ];
    }
    // race-day (T-0) day-state isn't surfaced in the v1 DayState union
    // — race_week owns the whole T-7..T-0 window and renders the
    // countdown hero (days_countdown). When race-day breakdown rows
    // become their own surface, add a new DayState (e.g. `race_day`)
    // and a case here mapping to PACE TARGET / STRATEGY / DISTANCE per
    // Direction A3 §"A3 · RACE" (the deck doesn't actually render this
    // tier yet — kept as a deferred TODO 2026-05-28).
    case 'rest':
    case 'done_nailed':
    case 'done_ease_off':
    case 'skipped':
    case 'missed':
    case 'new_user':
    case 'niggle':
    case 'sick':
    case 'race_week':
      // No breakdown for these states · the workout either already
      // happened (done), doesn't exist (rest/new_user/skipped/missed),
      // is health-paused (niggle/sick), or the race-week countdown owns
      // the layout (race_week).
      return null;
    default:
      return null;
  }
}

/** Format seconds-per-mile as "m:ss" (mirrors WorkoutBreakdown's fmtPace).
 *  Used by buildWorkoutBreakdown when pulling real numbers off the spec. */
function fmtPace(secondsPerMi: number): string {
  const m = Math.floor(secondsPerMi / 60);
  const s = Math.round(secondsPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format a mile count: integer when whole, 1 decimal otherwise. */
function fmtMi(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/**
 * Parse a plan's freeform `plannedLabel` into a readable body sentence.
 * Used as the middle column of the QUALITY breakdown's WORK / TEMPO row.
 *
 * Recognised patterns (case-insensitive):
 *   '6×800'    → '6 × 800m · 90s jog rest'
 *   '6x800'    → same
 *   '4×1k'     → '4 × 1km · 2:00 jog rest'
 *   '5×1km'    → same
 *   '3mi @ T'  → '3 mi · sustained & controlled'
 *   '5mi @ T'  → '5 mi · sustained & controlled'
 *   anything else (or null) → 'Work block per plan'
 *
 * TODO 2026-05-28 · the jog-rest duration ("90s", "2:00") is doctrine
 * default per Daniels §"I/R workouts"; once the plan emits an explicit
 * rest field this should read it directly.
 */
function interpretWorkBody(plannedLabel: string | null): string {
  if (!plannedLabel) return 'Work block per plan';
  const raw = plannedLabel.trim();
  // Normalise × and lowercase the divider char for matching
  const norm = raw.replace(/×/g, 'x').toLowerCase();

  // N × Mm  · m for metres (e.g. "6x800", "8x400")
  const repsMetres = norm.match(/^(\d+)\s*x\s*(\d+)\s*m?$/);
  if (repsMetres) {
    const reps = repsMetres[1];
    const dist = repsMetres[2];
    return `${reps} × ${dist}m · 90s jog rest`;
  }
  // N × Mk / N × Mkm (e.g. "4x1k", "5×1km")
  const repsKm = norm.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*k(m)?$/);
  if (repsKm) {
    const reps = repsKm[1];
    const dist = repsKm[2];
    return `${reps} × ${dist}km · 2:00 jog rest`;
  }
  // N mi @ T (tempo) — e.g. "3mi @ T", "5mi @ T"
  const tempoMi = norm.match(/^(\d+(?:\.\d+)?)\s*mi\s*@\s*t$/);
  if (tempoMi) {
    const mi = tempoMi[1];
    return `${mi} mi · sustained & controlled`;
  }
  return 'Work block per plan';
}

/**
 * Format an estimated workout time from miles + per-mile pace (seconds).
 * Returns `~Xm` under an hour, `~H:MM` at or above.
 *
 *   formatEstTime(5.5, 480) → '~44m'           (5.5 × 8:00 = 44 min)
 *   formatEstTime(12, 510)  → '~1:42'          (12 × 8:30 = 102 min)
 *   formatEstTime(6.1, 510) → '~52m'           (6.1 × 8:30 ≈ 52 min)
 *
 * TODO 2026-05-28 · the `paceSec` argument is currently a placeholder
 * constant per workout type (~8:00/mi quality avg, ~8:15/mi long avg);
 * future round threads runner-specific VDOT-derived paces through.
 */
function formatEstTime(mi: number, paceSec: number): string {
  if (mi <= 0 || paceSec <= 0) return '—';
  const totalMin = Math.round((mi * paceSec) / 60);
  if (totalMin < 60) return `~${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `~${h}:${String(m).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────────────
// 4. Sibling builder
// ──────────────────────────────────────────────────────────────────────

const SIBLING_TITLES: Partial<Record<DayState, { main: string; suffix?: string }>> = {
  easy: { main: 'THE BODY', suffix: 'TODAY' },
  quality: { main: 'THE BODY', suffix: 'TODAY' },
  long: { main: 'THE BODY', suffix: 'TODAY' },
  rest: { main: 'THE BODY', suffix: 'TODAY' },
  done_nailed: { main: 'BANKED IT', suffix: 'TODAY' },
  done_ease_off: { main: 'WENT BIG', suffix: 'EASE OFF' },
  niggle: { main: 'BODY ALERT', suffix: 'WATCH IT' },
  sick: { main: 'PLAN PAUSED', suffix: 'RECOVER' },
  missed: { main: 'MISSED', suffix: 'CATCH UP?' },
  race_week: { main: 'RACE WEEK', suffix: 'TAPER ON' },
  new_user: { main: 'SET UP', suffix: 'GET ROLLING' },
  // P-SKIP 2026-05-28 · sibling reassures the runner the plan continues
  // unchanged. "TOMORROW · WE GO" — one day off is not the end of a block.
  skipped: { main: 'TOMORROW', suffix: 'WE GO' },
};

export function buildSibling(glance: GlanceState, state: DayState): SiblingPayload {
  const title = SIBLING_TITLES[state] ?? { main: 'THE BODY', suffix: 'TODAY' };

  // Common body tiles · sleep / RHR / HRV / load
  const tiles: MiniTile[] = bodyTiles(glance);

  // Per state, attach prose + state-specific tile additions.
  switch (state) {
    case 'easy':
    case 'quality':
    case 'long':
      return {
        state,
        title,
        tiles,
        prose: state === 'long'
          ? 'Keep it aerobic. Fuel by 45 minutes. Time on feet is the point.'
          : state === 'quality'
            ? 'Lock the target pace. Form first, splits hold themselves.'
            : "If you can't chat the whole way, you're going too hard.",
      };
    case 'rest':
      return { state, title, tiles };
    case 'done_nailed':
      return {
        state,
        title,
        tiles,
        prose: 'In the books. Refuel within the hour, sleep early.',
      };
    case 'done_ease_off':
      return {
        state,
        title,
        tiles,
        prose: 'Big day banked. Tomorrow goes easier than the plan says.',
        action_tile_index: 0,
      };
    case 'race_week':
      return {
        state,
        title,
        tiles,
        prose: 'Volume drops, intensity stays sharp. Trust the taper.',
      };
    case 'niggle': {
      const n = glance.activeNiggle;
      // Niggle-specific tiles: SEVERITY · DAYS ACTIVE · LAST RUN · BAIL
      // per the deck §SECTION 04 mockup. Body tiles drop off — focus is
      // the niggle, not the body baseline.
      const niggleTiles: MiniTile[] = n
        ? [
            {
              label: 'SEVERITY',
              value: String(n.severity),
              valueColor: n.severity <= 3 ? 'amber' : 'over',
              meta: 'out of 10',
              dot: n.severity <= 3 ? 'amber' : 'over',
            },
            {
              label: 'DAYS ACTIVE',
              value: String(n.days_active),
              meta: n.days_active >= 7 ? 'see a physio' : '→ physio at 7',
              dot: n.days_active >= 7 ? 'over' : 'green',
            },
            {
              label: 'BODY PART',
              value: formatBodyPart(n.body_part, n.side),
              meta: n.status === 'just_started' ? 'just started'
                : n.status === 'few_days' ? 'few days now' : 'weeks of it',
              dot: 'green',
            },
            {
              label: 'BAIL TRIGGER',
              value: '5/10',
              valueColor: 'over',
              meta: 'or post-mile-2 pain',
              dot: 'over',
            },
          ]
        : tiles;
      const physioCue =
        n && n.days_active >= 7
          ? ' Past day 7 is where coach guidance ends and clinical input begins.'
          : '';
      return {
        state,
        title,
        tiles: niggleTiles,
        prose: n
          ? `Grade ${n.severity}/10 · ${formatBodyPart(n.body_part, n.side).toLowerCase()} · day ${n.days_active + 1}. Listen to it. Bail if grade jumps to 5 or pain doesn't fade after mile 2.${physioCue}`
          : 'Listen to it. The body is the signal.',
        bail_trigger: 'pain > 4/10',
      };
    }
    case 'sick': {
      const s = glance.activeSick;
      // Sick-specific tiles: FEVER · SLEEP · RHR · PLAN per deck §SECTION 05
      const sickTiles: MiniTile[] = s
        ? [
            {
              label: 'FEVER',
              value: s.has_fever ? 'YES' : 'NO',
              valueColor: s.has_fever ? 'over' : 'green',
              meta: s.has_fever ? 'do not run' : 'fever-free',
              dot: s.has_fever ? 'over' : 'green',
            },
            {
              label: 'SLEEP',
              value: glance.sleep7Avg != null ? glance.sleep7Avg.toFixed(1) : '—',
              valueUnit: 'h',
              meta: 'body asking',
              dot: 'amber',
            },
            {
              label: 'RHR',
              value: glance.rhrCurrent != null ? String(glance.rhrCurrent) : '—',
              valueColor: glance.rhrCurrent != null && glance.rhrBaseline != null
                && glance.rhrCurrent - glance.rhrBaseline >= 5 ? 'over' : 'default',
              meta: glance.rhrCurrent != null && glance.rhrBaseline != null
                ? `${glance.rhrCurrent - glance.rhrBaseline >= 0 ? '+' : ''}${glance.rhrCurrent - glance.rhrBaseline} vs base`
                : '—',
              dot: glance.rhrCurrent != null && glance.rhrBaseline != null
                && glance.rhrCurrent - glance.rhrBaseline >= 5 ? 'over' : 'green',
            },
            {
              label: 'PLAN',
              value: 'PAUSED',
              meta: 'until you mark recovered',
              dot: 'none',
            },
          ]
        : tiles;
      const symptomList = s ? s.symptoms.map(humanSymptom).join(' · ') : '';
      return {
        state,
        title,
        tiles: sickTiles,
        prose: s
          ? `Day ${s.days_active + 1} · ${symptomList || 'illness logged'}. Plan paused. Returns to easy when fever-free for 24h and RHR within 5 bpm of baseline.`
          : 'Plan paused. Resumes at easy when you mark recovered.',
        return_condition: 'no fever 24h + RHR within baseline',
      };
    }
    case 'missed':
      return {
        state,
        title,
        tiles,
        prose: 'Yesterday is gone. Catch up or move on — both protect the plan.',
        recommendation: 'move_on',
      };
    case 'new_user':
      return {
        state,
        title,
        tiles, // placeholder · proper setup tiles come in onboarding phase
        prose: 'Connect Strava and pick a race. The rest builds from there.',
        completion_pct: 0,
      };
    case 'skipped':
      // P-SKIP 2026-05-28 · the body tiles still show — sleep / RHR / HRV
      // / load don't disappear because the runner chose to skip. The prose
      // is the reassurance: one day off is not the end of a block.
      return {
        state,
        title,
        tiles,
        prose: 'You called it. The plan picks back up tomorrow exactly as written. One day off is not the end of a block.',
      };
  }
}

function bodyTiles(glance: GlanceState): MiniTile[] {
  const tiles: MiniTile[] = [];

  // SLEEP
  if (glance.sleep7Avg != null) {
    const isLow = glance.sleep7Avg < 7;
    tiles.push({
      label: 'SLEEP',
      value: glance.sleep7Avg.toFixed(1),
      valueUnit: 'h',
      valueColor: isLow ? 'amber' : 'green',
      meta: '7d avg',
      dot: isLow ? 'amber' : 'green',
    });
  }

  // RHR
  if (glance.rhrCurrent != null && glance.rhrBaseline != null) {
    const delta = glance.rhrCurrent - glance.rhrBaseline;
    const elevated = delta >= 5;
    tiles.push({
      label: 'RHR',
      value: String(glance.rhrCurrent),
      valueUnit: 'bpm',
      valueColor: elevated ? 'amber' : 'default',
      meta: `${delta >= 0 ? '+' : ''}${delta} vs base`,
      dot: elevated ? 'amber' : 'green',
    });
  }

  // HRV
  if (glance.hrvCurrent != null && glance.hrvBaseline != null) {
    const delta = glance.hrvCurrent - glance.hrvBaseline;
    const suppressed = delta <= -8;
    tiles.push({
      label: 'HRV',
      value: String(glance.hrvCurrent),
      valueUnit: 'ms',
      valueColor: suppressed ? 'amber' : 'default',
      meta: `${delta >= 0 ? '+' : ''}${delta} vs base`,
      dot: suppressed ? 'amber' : 'green',
    });
  }

  // LOAD (ACWR)
  if (glance.loadAcwr != null) {
    const acwr = glance.loadAcwr;
    const hot = acwr > 1.3;
    const cold = acwr < 0.8;
    tiles.push({
      label: 'LOAD',
      value: acwr.toFixed(2),
      meta: hot ? 'spike risk' : cold ? 'detrain risk' : 'sweet spot',
      valueColor: hot ? 'over' : cold ? 'amber' : 'green',
      dot: hot ? 'over' : cold ? 'amber' : 'green',
    });
  }

  return tiles;
}

// ──────────────────────────────────────────────────────────────────────
// 5. WeekStrip builder (4-char vocabulary mapping)
// ──────────────────────────────────────────────────────────────────────

/**
 * Closed 4-char WeekStrip vocabulary per design/components/WeekStrip.md
 * §"Type label vocabulary" (locked 2026-05-28). Backend production data
 * uses freeform labels ('threshold', 'intervals', 'tempo', sub_label
 * like '6×800'); this map produces the disciplined 4-char label.
 */
function typeLabel(plannedType: string, plannedLabel: string | null): string {
  const t = plannedType.toLowerCase();
  if (t === 'rest') return 'REST';
  if (t === 'race') return 'RACE';
  if (t === 'long') return 'LONG';
  if (t === 'easy' || t === 'shakeout' || t === 'recovery') return 'EASY';
  if (t === 'cross' || t === 'strength') return 'XTRN';
  if (t === 'fartlek') return 'FART';
  if (t === 'tempo') return 'TMPO';
  if (t === 'threshold') return 'THRS';
  if (t === 'intervals') return 'INTS';
  // Quality fallback for unknown quality subtypes
  if (t === 'quality') return 'QUAL';
  // Sub-label sniffing as a last resort (legacy data without subtype)
  const sub = (plannedLabel ?? '').toLowerCase();
  if (sub.includes('×') || sub.includes('x')) return 'INTS';
  if (sub.includes('tempo')) return 'TMPO';
  if (sub.includes('threshold') || sub.includes('thr')) return 'THRS';
  return '—';
}

/**
 * Coerce Runcino's plannedType (freeform strings including 'unplanned')
 * to Faff's strict WorkoutType union — or null for an unplanned cell.
 */
function coerceWorkoutType(plannedType: string): WorkoutType | null {
  const t = plannedType.toLowerCase();
  switch (t) {
    case 'easy':
    case 'long':
    case 'quality':
    case 'rest':
    case 'race':
    case 'recovery':
    case 'shakeout':
    case 'cross':
    case 'strength':
      return t as WorkoutType;
    case 'threshold':
    case 'tempo':
    case 'intervals':
    case 'fartlek':
    case 'progression':
      return 'quality';
    case 'unplanned':
    default:
      return null;
  }
}

export function buildWeekStrip(glance: GlanceState): WeekStripPayload {
  const todayIso = glance.today;
  const days = glance.weekDays.map((d) => ({
    date: d.date,
    dow: d.dow as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    plannedType: coerceWorkoutType(d.plannedType),
    plannedDistance: d.plannedMi > 0 ? d.plannedMi : null,
    plannedTypeLabel: typeLabel(d.plannedType, d.plannedLabel),
    plannedLabel: d.plannedLabel,
    completedRunId: d.activityId,
    isToday: d.date === todayIso,
    isFuture: d.date > todayIso,
  }));

  // P-SKIP 2026-05-28 · when today is skipped, the WeekStrip card should
  // mirror the Poster's `skipped` state — dim accent, em-dash mileage,
  // SKIP label. User feedback: "will look just like REST" — so we
  // override the today card's plannedType to 'rest' (drives blue mute
  // accent), plannedDistance to null (mileage renders '—'), and
  // plannedTypeLabel to 'SKIP' (4-char vocab). The plannedType swap is
  // visual only — resolveDayState on the client now sees rest, but the
  // `SKIP` label tells the runner what actually happened.
  if (glance.todaySkipped) {
    const idx = days.findIndex((d) => d.isToday);
    if (idx >= 0) {
      days[idx] = {
        ...days[idx],
        plannedType: 'rest',
        plannedDistance: null,
        plannedTypeLabel: 'SKIP',
      };
    }
  }

  const weekStart = days[0]?.date ?? todayIso;

  return {
    weekStart,
    days,
    totals: {
      plannedMi: glance.weekPlanned ?? 0,
      completedMi: glance.weekDone,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function formatMi(mi: number): string {
  if (mi <= 0) return '0';
  return mi.toFixed(mi % 1 === 0 ? 0 : 1);
}

function formatBodyPart(
  bodyPart: string,
  side: 'left' | 'right' | 'both' | null,
): string {
  const part = bodyPart
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('It Band', 'ITB');
  if (!side) return part;
  if (side === 'both') return `Both ${part.toLowerCase()}s`;
  return `${side === 'left' ? 'L' : 'R'} ${part.toLowerCase()}`;
}

function humanSymptom(s: string): string {
  switch (s) {
    case 'head_cold': return 'head cold';
    case 'chest': return 'chest congestion';
    case 'fever': return 'fever';
    case 'gi': return 'GI';
    case 'aches': return 'body aches';
    case 'fatigue': return 'fatigue';
    case 'voice': return 'lost voice';
    case 'other': return 'other';
    default: return s;
  }
}

function dowMonthDay(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getUTCDay()]} · ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
