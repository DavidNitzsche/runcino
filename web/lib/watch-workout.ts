/**
 * S6/native-bridge · today's workout, structured for the watchOS app.
 *
 * Converts the existing WorkoutTemplate catalog (lib/workout-descriptions.ts)
 * into a flat phases array the watch can walk with a simple cursor.
 *
 * The shape was locked in docs/native/01-watchos-scoping.md:
 *
 *   {
 *     workoutId, name, summary, totalEstimatedMinutes,
 *     phases: [
 *       {
 *         type: 'warmup' | 'work' | 'recovery' | 'cooldown',
 *         label, durationSec, targetPaceSPerMi, tolerancePaceSPerMi?,
 *         haptic: 'start' | 'transition-work' | 'transition-recovery' | 'transition-cooldown'
 *       }
 *     ],
 *     completionEndpoint, expiresAt
 *   }
 *
 * The web TodayCard renders this same workout in natural-language
 * form via describeWorkout(); both code paths share the same
 * WorkoutTemplate catalog so what David sees on phone matches what
 * his watch executes.  Single source of truth.
 *
 * REST DAYS return null · the watch surface doesn't render anything.
 * RACE DAYS return null · race-day pacing is deferred from MVP per
 * the scoping doc.
 */

import type { ResolvedFitness } from './fitness-types';
import type { PlanWeekDay } from './synthetic-plan';
import type { DanielsPaceSet } from './vdot';
import { pacesFromVdot } from './vdot';

export type WatchPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';

export type WatchHaptic =
  | 'start'
  | 'transition-work'
  | 'transition-recovery'
  | 'transition-cooldown'
  | 'end';

export interface WatchPhase {
  /** Phase class — drives the watch UI screen choice (WORK / RECOVERY etc.). */
  type: WatchPhaseType;
  /** Display label · "Warmup", "Interval 3/6", "Recovery 3/6". */
  label: string;
  /** Phase duration in seconds. */
  durationSec: number;
  /** Target pace · null for warmup/cooldown/recovery (no pace gate). */
  targetPaceSPerMi: number | null;
  /** Tolerance band · |delta| > this triggers drift haptic.  Only
   *  set on work phases. */
  tolerancePaceSPerMi?: number;
  /** Haptic cue at the START of this phase. */
  haptic: WatchHaptic;
  /** How the rep is measured.  Omitted == 'time' (the watch defaults to
   *  time, so older payloads are unaffected).  'distance' reps count down
   *  by GPS distance, not the clock — e.g. a 6 mi easy run or an 800 m rep. */
  repUnit?: 'time' | 'distance';
  /** Fixed rep distance in miles · set only on distance reps. durationSec is
   *  still carried as a time estimate (totals, fallback). */
  distanceMi?: number;
}

export interface WatchWorkout {
  /** Stable id — used by the completion writeback to identify which
   *  workout was executed.  Format: ISO date + workout label slug. */
  workoutId: string;
  /** Short display name on the watch's idle/start screen. */
  name: string;
  /** One-line summary · "6×800 @ 6:31 · 60s rec". */
  summary: string;
  /** Estimated total duration in minutes (sum of phase durations). */
  totalEstimatedMinutes: number;
  /** Flat phases array · watch walks with a cursor. */
  phases: WatchPhase[];
  /** Backend endpoint the iPhone bridge POSTs completion data to.
   *  Watch writes HKWorkout via HealthKit; iPhone observes via
   *  HKObserverQuery and pushes the structured data here. */
  completionEndpoint: string;
  /** ISO timestamp after which this workout payload should not be
   *  used (e.g., it's stale because "today" has rolled over). */
  expiresAt: string;
}

// ── Pace target resolution ───────────────────────────────────────

const FALLBACK_PACES: DanielsPaceSet = pacesFromVdot(45)!;

function paceMidpoint(band: { lowS: number; highS: number }): number {
  return Math.round((band.lowS + band.highS) / 2);
}

function paceHalfBand(band: { lowS: number; highS: number }): number {
  return Math.max(5, Math.round((band.highS - band.lowS) / 2));
}

function paceForZone(zone: 'E' | 'M' | 'T' | 'I' | 'R' | 'race-pace', paces: DanielsPaceSet, racePaceBand: { lowS: number; highS: number }): { target: number; tolerance: number } {
  if (zone === 'race-pace') {
    return { target: paceMidpoint(racePaceBand), tolerance: paceHalfBand(racePaceBand) };
  }
  const band = paces[zone];
  return { target: paceMidpoint(band), tolerance: paceHalfBand(band) };
}

// ── Duration string parser ───────────────────────────────────────

/**
 * Parse a duration string from a WorkoutTemplate ("15 min", "90 sec",
 * "7 min", "1 mi" — when mile-based) into seconds.
 *
 * Mile-based durations need a pace assumption to convert.  For
 * threshold work, "1 mi at T-pace" → T-pace * 1 = ~6:30.  Caller
 * passes the relevant pace if mile-based duration is expected.
 */
export function parseDurationSec(duration: string, milePaceSec?: number): number {
  const trimmed = duration.trim().toLowerCase();
  const minMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*min/);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
  const secMatch = trimmed.match(/^(\d+)\s*sec/);
  if (secMatch) return parseInt(secMatch[1], 10);
  const miMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*mi/);
  if (miMatch && milePaceSec) {
    return Math.round(parseFloat(miMatch[1]) * milePaceSec);
  }
  // Unparseable — default to 5 minutes so the watch doesn't crash;
  // logged for follow-up.
  return 300;
}

/**
 * Classify a rep's measure: a time interval ("7 min", "90 sec") or a fixed
 * distance ("800 m", "1 km", "1 mi").  Distance reps carry distanceMi so the
 * watch counts down by GPS distance; durationSec is still derived (via pace)
 * as a time estimate for totals + fallback.  Time is checked first so "15 min"
 * is never misread as "15 mi".
 */
export function parseRepMeasure(
  duration: string,
  milePaceSec?: number,
): { unit: 'time' | 'distance'; durationSec: number; distanceMi?: number } {
  const t = duration.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?\s*min/.test(t) || /^\d+\s*sec/.test(t)) {
    return { unit: 'time', durationSec: parseDurationSec(duration, milePaceSec) };
  }
  const distance = (mi: number) => ({
    unit: 'distance' as const,
    distanceMi: mi,
    durationSec: milePaceSec ? Math.round(mi * milePaceSec) : 300,
  });
  const km = t.match(/^(\d+(?:\.\d+)?)\s*km\b/);
  if (km) return distance(parseFloat(km[1]) * 0.621371);
  const mi = t.match(/^(\d+(?:\.\d+)?)\s*mi/);
  if (mi) return distance(parseFloat(mi[1]));
  const m = t.match(/^(\d+(?:\.\d+)?)\s*m\b/);   // "800 m", "800m" — \b excludes "min"
  if (m) return distance(parseFloat(m[1]) / 1609.344);
  return { unit: 'time', durationSec: parseDurationSec(duration, milePaceSec) };
}

// ── Workout-class classifiers ────────────────────────────────────

function isWarmup(label: string): boolean {
  return /^warm\s*up/i.test(label);
}

function isCooldown(label: string): boolean {
  return /^cool\s*down/i.test(label);
}

// ── The conversion ───────────────────────────────────────────────

/**
 * Convert a PlanWeekDay (today's workout from the synthetic plan)
 * + user's fitness into the watchOS phases payload.
 *
 * Returns null for rest, race, or unsupported workout types.  The
 * iPhone bridge interprets null as "nothing to push to watch today."
 */
export function buildWatchWorkout(
  day: PlanWeekDay,
  todayIso: string,
  fitness: ResolvedFitness | null,
): WatchWorkout | null {
  // Skip non-watch-applicable days.
  if (day.type === 'rest') return null;
  if (day.type === 'race') return null;  // race-day pacing deferred per scoping

  const paces = fitness?.paces ?? FALLBACK_PACES;
  const racePaceBand = fitness?.racePaceBand ?? { lowS: 450, highS: 470, label: 'Race pace' };

  // ── Easy / recovery / long · single-phase workout ──
  if (day.type === 'easy' || day.type === 'recovery' || day.type === 'long') {
    const ePace = paceForZone('E', paces, racePaceBand);
    // Duration estimate · distanceMi at the slow end of E pace (more
    // honest than midpoint for distance-based workouts).
    const durationSec = Math.round(day.distanceMi * paces.E.highS);
    return {
      workoutId: `${todayIso}-${slugify(day.label)}`,
      name: day.label,
      summary: `${day.distanceMi.toFixed(1)} mi at easy pace`,
      totalEstimatedMinutes: Math.round(durationSec / 60),
      phases: [
        {
          type: 'work',  // it's the whole workout · "warmup" doesn't apply
          label: day.label,
          durationSec,
          targetPaceSPerMi: ePace.target,
          tolerancePaceSPerMi: ePace.tolerance,
          haptic: 'start',
          repUnit: 'distance',          // an easy run is "go N miles", not a clock
          distanceMi: day.distanceMi,
        },
      ],
      completionEndpoint: '/api/watch/workouts/complete',
      expiresAt: expiresAtFromToday(todayIso),
    };
  }

  // ── Quality · multi-phase with intervals ──
  // Lookup the template by label.  Template provides structured
  // warmup + loop + cooldown.
  const template = lookupTemplate(day.label);
  if (!template) {
    // Unknown quality workout label.  Fall back to a single phase
    // at easy pace · the watch still has something to execute.
    const durationSec = Math.round(day.distanceMi * paces.E.highS);
    return {
      workoutId: `${todayIso}-${slugify(day.label)}`,
      name: day.label,
      summary: `${day.distanceMi.toFixed(1)} mi`,
      totalEstimatedMinutes: Math.round(durationSec / 60),
      phases: [
        {
          type: 'work',
          label: day.label,
          durationSec,
          targetPaceSPerMi: paceForZone('E', paces, racePaceBand).target,
          tolerancePaceSPerMi: 30,
          haptic: 'start',
          repUnit: 'distance',
          distanceMi: day.distanceMi,
        },
      ],
      completionEndpoint: '/api/watch/workouts/complete',
      expiresAt: expiresAtFromToday(todayIso),
    };
  }

  // Expand the template into a flat phases array.
  const phases: WatchPhase[] = [];
  let intervalNumber = 0;
  let intervalTotal = 0;
  // First pass: count total work intervals across all loop steps for
  // the "Interval N/M" labels.
  for (const step of template.steps) {
    if (step.kind === 'loop') {
      const workItems = step.items.filter((i) => i.zoneRef && i.zoneRef !== 'race-pace' || i.zoneRef === 'race-pace').filter((i) => !/jog|recover|easy/i.test(i.verb + (i.suffix ?? '')));
      intervalTotal += step.times * workItems.length;
    }
  }
  // Edge case: no loop steps means no "intervals" · keep 0/0 from
  // showing on the watch.
  const hasIntervals = intervalTotal > 0;

  for (let stepIdx = 0; stepIdx < template.steps.length; stepIdx++) {
    const step = template.steps[stepIdx];
    if (step.kind === 'simple') {
      const durationSec = parseDurationSec(step.duration);
      const phaseType: WatchPhaseType =
        isWarmup(step.name) ? 'warmup' :
        isCooldown(step.name) ? 'cooldown' :
        'work';
      const ePace = paceForZone('E', paces, racePaceBand);
      phases.push({
        type: phaseType,
        label: step.name,
        durationSec,
        targetPaceSPerMi: phaseType === 'warmup' || phaseType === 'cooldown' ? null : ePace.target,
        haptic: phaseType === 'cooldown' ? 'transition-cooldown' :
                phaseType === 'warmup' ? 'start' :
                'transition-work',
      });
    } else {
      // Loop step · expand into times × items phases
      for (let rep = 0; rep < step.times; rep++) {
        for (const item of step.items) {
          const isRecovery = /jog|recover|easy/i.test(item.verb + ' ' + (item.suffix ?? ''));
          const phaseType: WatchPhaseType = isRecovery ? 'recovery' : 'work';
          const zoneRef = item.zoneRef && (item.zoneRef === 'E' || item.zoneRef === 'M' || item.zoneRef === 'T' || item.zoneRef === 'I' || item.zoneRef === 'R' || item.zoneRef === 'race-pace') ? item.zoneRef : null;
          const pace = zoneRef ? paceForZone(zoneRef, paces, racePaceBand) : null;
          const milePaceForDuration = pace?.target;
          // Time vs distance rep · current templates are time-based, but a
          // step authored as "800 m" / "1 mi" comes through as a distance rep.
          const measure = parseRepMeasure(item.duration, milePaceForDuration);

          if (phaseType === 'work' && hasIntervals) intervalNumber += 1;

          const label = phaseType === 'work' && hasIntervals
            ? `Interval ${intervalNumber}/${intervalTotal}`
            : phaseType === 'recovery' && hasIntervals
              ? `Recovery ${intervalNumber}/${intervalTotal}`
              : item.verb;

          phases.push({
            type: phaseType,
            label,
            durationSec: measure.durationSec,
            targetPaceSPerMi: phaseType === 'work' ? (pace?.target ?? null) : null,
            tolerancePaceSPerMi: phaseType === 'work' ? (pace?.tolerance ?? 10) : undefined,
            haptic: phaseType === 'work' ? 'transition-work' : 'transition-recovery',
            repUnit: measure.unit,
            distanceMi: measure.distanceMi,
          });
        }
      }
    }
  }

  // First phase haptic is always 'start' (overrides whatever the
  // step said; it's the workout opening cue, not a transition).
  if (phases.length > 0) phases[0].haptic = 'start';

  const totalSec = phases.reduce((s, p) => s + p.durationSec, 0);

  return {
    workoutId: `${todayIso}-${slugify(day.label)}`,
    name: day.label,
    summary: buildSummary(template, phases, paces),
    totalEstimatedMinutes: Math.round(totalSec / 60),
    phases,
    completionEndpoint: '/api/watch/workouts/complete',
    expiresAt: expiresAtFromToday(todayIso),
  };
}

// ── Internal helpers (template catalog access) ───────────────────

/**
 * Re-imports the TEMPLATES catalog from workout-descriptions so we
 * don't duplicate the structured workout definitions.  Single source
 * of truth: TEMPLATES drives both the natural-language web rendering
 * AND the watch's structured phases.
 *
 * The catalog isn't exported from workout-descriptions (intentional
 * encapsulation), so we resolve via a focused query: build a temp
 * WorkoutDescription via describeWorkout and reverse-derive structure
 * — but that loses zoneRef.  Instead we re-declare a minimal
 * structural lookup here.  Future cleanup: export TEMPLATES from
 * workout-descriptions.ts and import here.
 *
 * For now, return null when label doesn't match a known structured
 * workout — caller falls back to single-phase shape.
 */
function lookupTemplate(label: string): null | {
  steps: Array<
    | { kind: 'simple'; name: string; duration: string; zoneRef: 'E' | 'M' | 'T' | 'I' | 'R' | 'race-pace' | string; zoneLabel: string }
    | { kind: 'loop'; name: string; times: number; items: Array<{ verb: string; duration: string; zoneRef?: 'E' | 'M' | 'T' | 'I' | 'R' | 'race-pace' | string; zoneLabel?: string; paceOverride?: string; suffix?: string }> }
  >;
} {
  // Inline minimal catalog · matches the most common labels in
  // lib/synthetic-plan.ts BASE/BUILD/PEAK phases.  Future cleanup:
  // export TEMPLATES from workout-descriptions.ts; this duplication
  // is acknowledged technical debt scoped to the watch MVP.
  const catalog: Record<string, ReturnType<typeof lookupTemplate>> = {
    'Threshold · Cruise Intervals': {
      steps: [
        { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
        { kind: 'loop', name: 'Cruise Intervals', times: 5, items: [
          { verb: 'Run', duration: '7 min', zoneRef: 'T', zoneLabel: 'threshold' },
          { verb: 'Jog', duration: '90 sec', paceOverride: 'easy', suffix: 'to recover' },
        ]},
        { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
      ],
    },
    'Threshold · HM Blocks': {
      steps: [
        { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
        { kind: 'loop', name: 'HM-Pace Blocks', times: 3, items: [
          { verb: 'Run', duration: '13 min', zoneRef: 'race-pace', zoneLabel: 'half-marathon goal' },
          { verb: 'Jog', duration: '3 min', paceOverride: 'easy', suffix: 'to recover' },
        ]},
        { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
      ],
    },
    'Intervals': {
      steps: [
        { kind: 'simple', name: 'Warm Up', duration: '15 min', zoneRef: 'E', zoneLabel: 'easy' },
        { kind: 'loop', name: 'VO₂max Intervals', times: 6, items: [
          { verb: 'Run', duration: '3 min', zoneRef: 'I', zoneLabel: 'VO2max' },
          { verb: 'Jog', duration: '2 min', paceOverride: 'easy', suffix: 'to recover' },
        ]},
        { kind: 'simple', name: 'Cool Down', duration: '10 min', zoneRef: 'E', zoneLabel: 'easy' },
      ],
    },
  };
  return catalog[label] ?? null;
}

function buildSummary(
  _template: { steps: Array<unknown> },
  phases: WatchPhase[],
  paces: DanielsPaceSet,
): string {
  const workPhases = phases.filter((p) => p.type === 'work');
  const recoveryPhases = phases.filter((p) => p.type === 'recovery');
  if (workPhases.length === 0) return 'Easy run';
  if (recoveryPhases.length > 0 && workPhases.length === recoveryPhases.length) {
    // Interval workout · format as N×duration @ pace
    const firstWork = workPhases[0];
    const firstRec = recoveryPhases[0];
    const workMins = Math.round(firstWork.durationSec / 60);
    const recMins = Math.round(firstRec.durationSec / 60);
    const pacePretty = firstWork.targetPaceSPerMi
      ? fmtPace(firstWork.targetPaceSPerMi)
      : 'target';
    return `${workPhases.length}×${workMins} min @ ${pacePretty} · ${recMins} min rec`;
  }
  const _ = paces; // unused; future enhancement
  return 'Quality workout';
}

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function expiresAtFromToday(todayIso: string): string {
  // Workout payload is good through end-of-tomorrow-morning.  Watch
  // re-fetches if the user opens the app past that window.
  const tomorrow = new Date(todayIso + 'T08:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString();
}
