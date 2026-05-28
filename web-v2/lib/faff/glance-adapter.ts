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

  // Stat trio · varies per state. v1 keeps it consistent for base-4 (PLANNED/PACE/HR-CAP placeholders).
  const stat_trio = buildStatTrio(state, today, glance);

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
    case 'quality':
    case 'long':
      return [
        {
          value: today.plannedMi > 0 ? today.plannedMi.toFixed(today.plannedMi % 1 === 0 ? 0 : 1) : '—',
          label: 'PLANNED MI',
        },
        {
          // Pace / cap placeholders · proper engine wiring comes in Phase 3.
          value: glance.rhrCurrent != null ? String(glance.rhrCurrent) : '—',
          label: 'RHR BPM',
        },
        {
          value: glance.sleep7Avg != null ? glance.sleep7Avg.toFixed(1) : '—',
          label: 'SLEEP 7D',
        },
      ];
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
    case 'niggle':
      return {
        state,
        title,
        tiles,
        prose: 'Listen to it. The body is the signal.',
        bail_trigger: 'pain > 4/10',
      };
    case 'sick':
      return {
        state,
        title,
        tiles,
        prose: 'Plan paused. Resumes at easy when you mark recovered.',
        return_condition: 'no fever 24h + RHR within baseline',
      };
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

function dowMonthDay(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getUTCDay()]} · ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
