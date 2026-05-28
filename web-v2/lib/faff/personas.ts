/**
 * Persona fixtures — drive the /today simulator (Phase 13).
 *
 * Each persona produces a GlanceState shape that mirrors what
 * `loadGlanceState()` would return for that runner archetype. The
 * simulator bypasses the DB lookup when `?persona=<name>` is on the
 * URL and feeds these payloads straight to the adapter, so every
 * day-state can be visually verified against real-shape data without
 * needing a runner of each kind in the database.
 *
 * Cardinal Rule #4 — single source of truth: when a persona's
 * underlying assumption changes (e.g. the new-user setup tile list
 * shrinks), the canonical change lands in:
 *   /Volumes/WP/06 Claude Code/Faff/apps/web/src/fixtures/personas.ts
 * then mirrored here. (The Faff repo holds project HQ; Runcino/web-v2
 * is the deploy target — see docs/CUTOVER-2026-05-28.md.)
 *
 * Personas in v1:
 *   · david       — base phase, easy day today (matches the live DB user)
 *   · lilian      — net-new user, no plan, no race (drives new_user)
 *   · tyler       — A-race in 3 days (drives race_week)
 *   · sarah       — sick, plan paused 2 days ago (drives sick)
 *   · marcus      — niggle in left hamstring, mild (drives niggle)
 *   · helen       — yesterday was planned but missed (drives missed for that)
 *   · alex        — nailed today's quality session (drives done_nailed)
 *   · maya        — skipped today (drives skipped — Phase 10)
 *
 * The simulator does NOT cover every state with a persona — the resolver's
 * priority order is the source of truth. Personas cover the typical
 * journey: new user → base → quality → done → race week → setback.
 */

import type { GlanceState, GlanceWeekDay } from '@/lib/coach/glance-state';
import type { ReadinessBreakdown } from '@/lib/coach/readiness';

export type PersonaKey =
  | 'david'
  | 'lilian'
  | 'tyler'
  | 'sarah'
  | 'marcus'
  | 'helen'
  | 'alex'
  | 'maya';

/**
 * Catalogue — used by the simulator UI to render a chip list and route
 * each chip into `getPersonaGlanceState()`. Keep the order stable so the
 * simulator URLs stay shareable.
 */
export const PERSONA_CATALOGUE: Array<{
  key: PersonaKey;
  label: string;
  state: string;
  description: string;
}> = [
  {
    key: 'david',
    label: 'David · base',
    state: 'easy',
    description: 'Base phase, easy 6.1 today, build week 6 of 13, 80d to A-race.',
  },
  {
    key: 'lilian',
    label: 'Lilian · new',
    state: 'new_user',
    description: 'Net-new sign-up. No plan, no race, no HK data. Setup poster.',
  },
  {
    key: 'tyler',
    label: 'Tyler · race week',
    state: 'race_week',
    description: 'A-race in 3 days. Taper on, volume dropping, sleep emphasized.',
  },
  {
    key: 'sarah',
    label: 'Sarah · sick',
    state: 'sick',
    description: 'Mild flu. Plan paused 2 days ago. RHR elevated +8, HRV down.',
  },
  {
    key: 'marcus',
    label: 'Marcus · niggle',
    state: 'niggle',
    description: 'Left hamstring tightness. Mild. Pain 2/10. Run smart today.',
  },
  {
    key: 'helen',
    label: 'Helen · missed',
    state: 'missed',
    description: 'Yesterday was a planned 8mi tempo. Skipped passively. Catch up or move on?',
  },
  {
    key: 'alex',
    label: 'Alex · nailed',
    state: 'done_nailed',
    description: 'Quality session done today. 6×800 at 3:02/mi. Body strong.',
  },
  {
    key: 'maya',
    label: 'Maya · skipped',
    state: 'skipped',
    description: 'Tapped SKIP this morning. Not sick, just chose not to run.',
  },
];

/**
 * Produce a GlanceState for the given persona. Deterministic — no
 * Date.now() or randomness — so the simulator's render is reproducible.
 */
export function getPersonaGlanceState(key: PersonaKey): GlanceState {
  switch (key) {
    case 'david':       return david();
    case 'lilian':      return lilian();
    case 'tyler':       return tyler();
    case 'sarah':       return sarah();
    case 'marcus':      return marcus();
    case 'helen':       return helen();
    case 'alex':        return alex();
    case 'maya':        return maya();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/** A fixed Thursday in build week 6 — the canonical "today" for personas
 *  that don't override the date. Matches the live faff.run/today date
 *  shown in the v3 cutover screenshots so /today?persona=david visually
 *  reproduces the real surface. */
const FIXED_TODAY = '2026-05-28';

// Real ReadinessBreakdown shape is:
//   { score: number; band: 'sharp'|'ready'|'moderate'|'pull-back'; label: string;
//     inputs: ReadinessInput[] }
// (see lib/coach/readiness.ts). Personas use minimal inputs[] because the
// simulator only needs the surface signals — score + band + label drive
// Poster colour and Sibling tile dots; inputs[] only matters when the
// /health readiness modal opens, which the simulator doesn't exercise.

function readinessSharp(score = 88): ReadinessBreakdown {
  return { score, band: 'sharp', label: 'SHARP', inputs: [] };
}

function readinessReady(score = 78): ReadinessBreakdown {
  return { score, band: 'ready', label: 'READY', inputs: [] };
}

function readinessModerate(score = 62): ReadinessBreakdown {
  return { score, band: 'moderate', label: 'MODERATE', inputs: [] };
}

function readinessPullBack(score = 38): ReadinessBreakdown {
  return { score, band: 'pull-back', label: 'PULL BACK', inputs: [] };
}

/** New-user fallback — no HK data means readiness can't compute. The
 *  resolver hits `new_user` first, so this score never reaches the
 *  Sibling MiniTile dots. Picking a midline value with the 'moderate'
 *  band keeps the type honest. */
function readinessUnknown(): ReadinessBreakdown {
  return { score: 50, band: 'moderate', label: 'MODERATE', inputs: [] };
}

/** Build a 7-day week — Mon..Sun — keyed on workout types. Order is
 *  Mon=0..Sun=6 in `dow` (matches the production loader's convention). */
function buildWeek(
  weekStartMon: string,
  todayIso: string,
  spec: Array<{
    plannedType: string;
    plannedMi: number;
    plannedLabel?: string | null;
    doneMi?: number;
    activityId?: string | null;
  }>,
): GlanceWeekDay[] {
  const monDate = Date.parse(weekStartMon + 'T12:00:00Z');
  return spec.map((s, i) => {
    const isoDate = new Date(monDate + i * 86400000).toISOString().slice(0, 10);
    return {
      date: isoDate,
      dow: i,
      plannedMi: s.plannedMi,
      plannedType: s.plannedType,
      plannedLabel: s.plannedLabel ?? null,
      doneMi: s.doneMi ?? 0,
      activityId: s.activityId ?? null,
      isToday: isoDate === todayIso,
      isPast: isoDate < todayIso,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────
// David — base phase, easy 6.1, build week 6 of 13. Mirrors live DB.
// ──────────────────────────────────────────────────────────────────────

function david(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',      plannedMi: 5.8, doneMi: 5.8, activityId: 'mon-1' },
    { plannedType: 'threshold', plannedMi: 7.9, plannedLabel: '5×1k',  doneMi: 7.9, activityId: 'tue-1' },
    { plannedType: 'easy',      plannedMi: 5.8, doneMi: 5.8, activityId: 'wed-1' },
    { plannedType: 'easy',      plannedMi: 6.1 },
    { plannedType: 'easy',      plannedMi: 6.1 },
    { plannedType: 'rest',      plannedMi: 0  },
    { plannedType: 'long',      plannedMi: 12.1, plannedLabel: '12mi long' },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'David',
    weekDone: 19.5,
    weekPlanned: 43.8,
    weekDays,
    phaseLabel: 'BASE',
    sleep7Avg: 6.7,
    sleep7Deficit: 5.6,
    rhrCurrent: 46,
    rhrBaseline: 49,
    hrvCurrent: 62,
    hrvBaseline: 56,
    loadAcwr: 1.22,
    cadenceBaseline: 174,
    daysToARace: 80,
    nextARaceName: "America's Finest City",
    readiness: readinessReady(83),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Lilian — net-new sign-up. No plan, no race, no HK data.
// ──────────────────────────────────────────────────────────────────────

function lilian(): GlanceState {
  // Plain 7-day calendar window with NO planned workouts — drives the
  // resolver's new_user branch.
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'unplanned', plannedMi: 0 },
    { plannedType: 'unplanned', plannedMi: 0 },
    { plannedType: 'unplanned', plannedMi: 0 },
    { plannedType: 'unplanned', plannedMi: 0 },
    { plannedType: 'unplanned', plannedMi: 0 },
    { plannedType: 'unplanned', plannedMi: 0 },
    { plannedType: 'unplanned', plannedMi: 0 },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Lilian',
    weekDone: 0,
    weekPlanned: null,
    weekDays,
    phaseLabel: null,
    sleep7Avg: null,
    sleep7Deficit: 0,
    rhrCurrent: null,
    rhrBaseline: null,
    hrvCurrent: null,
    hrvBaseline: null,
    loadAcwr: null,
    cadenceBaseline: null,
    daysToARace: null,
    nextARaceName: null,
    readiness: readinessUnknown(),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Tyler — A-race in 3 days. Taper on. Last full-volume block last week.
// ──────────────────────────────────────────────────────────────────────

function tyler(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',     plannedMi: 4.0, doneMi: 4.0, activityId: 'tyler-mon' },
    { plannedType: 'tempo',    plannedMi: 5.0, plannedLabel: '3mi @ T', doneMi: 5.0, activityId: 'tyler-tue' },
    { plannedType: 'easy',     plannedMi: 3.5, doneMi: 3.5, activityId: 'tyler-wed' },
    { plannedType: 'easy',     plannedMi: 3.0 },                          // today T-3
    { plannedType: 'shakeout', plannedMi: 2.0, plannedLabel: 'shakeout' }, // T-2
    { plannedType: 'rest',     plannedMi: 0  },                           // T-1 race-eve
    { plannedType: 'race',     plannedMi: 13.1, plannedLabel: 'A-RACE' }, // T-0
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Tyler',
    weekDone: 12.5,
    weekPlanned: 30.6,
    weekDays,
    phaseLabel: 'TAPER',
    sleep7Avg: 7.4,
    sleep7Deficit: 0.7,
    rhrCurrent: 48,
    rhrBaseline: 50,
    hrvCurrent: 71,
    hrvBaseline: 68,
    loadAcwr: 0.92,
    cadenceBaseline: 178,
    daysToARace: 3,
    nextARaceName: 'Brooklyn Half',
    readiness: readinessSharp(88),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Sarah — mild flu, plan paused 2 days ago. RHR elevated, HRV down.
// ──────────────────────────────────────────────────────────────────────
// Note: the v1 resolver doesn't read a "sick" flag yet (see glance-adapter
// resolveDayState comment §5 niggle / sick deferred). This persona is here
// to STAGE the visual once that signal lands — the simulator hard-routes
// to 'sick' via the ?state= override.

function sarah(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',  plannedMi: 5.0, doneMi: 5.0, activityId: 'sarah-mon' },
    { plannedType: 'long',  plannedMi: 10.0, doneMi: 10.0, activityId: 'sarah-tue' },
    { plannedType: 'easy',  plannedMi: 5.0 },   // sick day 1
    { plannedType: 'easy',  plannedMi: 5.0 },   // today · sick day 2
    { plannedType: 'easy',  plannedMi: 5.0 },
    { plannedType: 'rest',  plannedMi: 0 },
    { plannedType: 'long',  plannedMi: 12.0 },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Sarah',
    weekDone: 15.0,
    weekPlanned: 42.0,
    weekDays,
    phaseLabel: 'BASE',
    sleep7Avg: 7.9, // sleeping more, but ill
    sleep7Deficit: 0,
    rhrCurrent: 62,
    rhrBaseline: 53,
    hrvCurrent: 38,
    hrvBaseline: 58,
    loadAcwr: 0.84,
    cadenceBaseline: 172,
    daysToARace: 96,
    nextARaceName: 'Chicago Marathon',
    readiness: readinessPullBack(38),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Marcus — left hamstring tightness, mild (pain 2/10). Run smart today.
// ──────────────────────────────────────────────────────────────────────

function marcus(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',      plannedMi: 5.0, doneMi: 5.0, activityId: 'marcus-mon' },
    { plannedType: 'threshold', plannedMi: 7.0, plannedLabel: '4×1k',
      doneMi: 7.0, activityId: 'marcus-tue' },
    { plannedType: 'easy',      plannedMi: 4.0, doneMi: 4.0, activityId: 'marcus-wed' },
    { plannedType: 'easy',      plannedMi: 5.0 },                       // today
    { plannedType: 'easy',      plannedMi: 5.0 },
    { plannedType: 'rest',      plannedMi: 0 },
    { plannedType: 'long',      plannedMi: 11.0, plannedLabel: '11mi' },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Marcus',
    weekDone: 16.0,
    weekPlanned: 37.0,
    weekDays,
    phaseLabel: 'BUILD',
    sleep7Avg: 7.0,
    sleep7Deficit: 3.0,
    rhrCurrent: 51,
    rhrBaseline: 50,
    hrvCurrent: 52,
    hrvBaseline: 55,
    loadAcwr: 1.18,
    cadenceBaseline: 176,
    daysToARace: 63,
    nextARaceName: 'Portland Half',
    readiness: readinessModerate(64),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Helen — yesterday was planned 8mi tempo. Missed passively. Today asks
// "catch up or move on?"
// ──────────────────────────────────────────────────────────────────────

function helen(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',  plannedMi: 5.0, doneMi: 5.0, activityId: 'helen-mon' },
    { plannedType: 'easy',  plannedMi: 5.0, doneMi: 5.0, activityId: 'helen-tue' },
    { plannedType: 'tempo', plannedMi: 8.0, plannedLabel: '5mi @ T' }, // yesterday — missed
    { plannedType: 'easy',  plannedMi: 6.0 },                          // today
    { plannedType: 'easy',  plannedMi: 5.0 },
    { plannedType: 'rest',  plannedMi: 0  },
    { plannedType: 'long',  plannedMi: 13.0, plannedLabel: '13mi' },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Helen',
    weekDone: 10.0,
    weekPlanned: 42.0,
    weekDays,
    phaseLabel: 'BUILD',
    sleep7Avg: 6.4,
    sleep7Deficit: 7.7,
    rhrCurrent: 56,
    rhrBaseline: 54,
    hrvCurrent: 49,
    hrvBaseline: 51,
    loadAcwr: 0.78,
    cadenceBaseline: 170,
    daysToARace: 49,
    nextARaceName: 'Lake Tahoe Marathon',
    readiness: readinessModerate(68),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Alex — quality session done today. 6×800 at 3:02/mi. Body strong.
// ──────────────────────────────────────────────────────────────────────

function alex(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',      plannedMi: 5.0, doneMi: 5.0, activityId: 'alex-mon' },
    { plannedType: 'easy',      plannedMi: 5.0, doneMi: 5.0, activityId: 'alex-tue' },
    { plannedType: 'easy',      plannedMi: 4.0, doneMi: 4.0, activityId: 'alex-wed' },
    { plannedType: 'intervals', plannedMi: 6.0, plannedLabel: '6×800',
      doneMi: 6.0, activityId: 'alex-thu' },                            // today · DONE
    { plannedType: 'easy',      plannedMi: 4.0 },
    { plannedType: 'rest',      plannedMi: 0  },
    { plannedType: 'long',      plannedMi: 14.0, plannedLabel: '14mi' },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Alex',
    weekDone: 20.0,
    weekPlanned: 38.0,
    weekDays,
    phaseLabel: 'BUILD',
    sleep7Avg: 7.6,
    sleep7Deficit: 0,
    rhrCurrent: 44,
    rhrBaseline: 46,
    hrvCurrent: 78,
    hrvBaseline: 70,
    loadAcwr: 1.10,
    cadenceBaseline: 180,
    daysToARace: 42,
    nextARaceName: 'Long Beach Half',
    readiness: readinessSharp(91),
    todaySkipped: false,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Maya — actively skipped today. Not sick. Plan continues tomorrow.
// ──────────────────────────────────────────────────────────────────────

function maya(): GlanceState {
  const weekDays = buildWeek('2026-05-25', FIXED_TODAY, [
    { plannedType: 'easy',      plannedMi: 5.0, doneMi: 5.0, activityId: 'maya-mon' },
    { plannedType: 'threshold', plannedMi: 7.0, plannedLabel: '5×1k',
      doneMi: 7.0, activityId: 'maya-tue' },
    { plannedType: 'easy',      plannedMi: 5.0, doneMi: 5.0, activityId: 'maya-wed' },
    { plannedType: 'easy',      plannedMi: 6.0 },     // today · SKIPPED
    { plannedType: 'easy',      plannedMi: 5.0 },
    { plannedType: 'rest',      plannedMi: 0  },
    { plannedType: 'long',      plannedMi: 12.0, plannedLabel: '12mi' },
  ]);
  return {
    today: FIXED_TODAY,
    greetingName: 'Maya',
    weekDone: 17.0,
    weekPlanned: 40.0,
    weekDays,
    phaseLabel: 'BUILD',
    sleep7Avg: 6.9,
    sleep7Deficit: 4.3,
    rhrCurrent: 50,
    rhrBaseline: 49,
    hrvCurrent: 60,
    hrvBaseline: 58,
    loadAcwr: 1.05,
    cadenceBaseline: 175,
    daysToARace: 55,
    nextARaceName: 'Big Sur Marathon',
    readiness: readinessReady(78),
    todaySkipped: true,
  };
}
