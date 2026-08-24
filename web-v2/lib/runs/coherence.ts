/**
 * lib/runs/coherence.ts · a row may not print two answers to one question.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SHAPE
 *
 * A DERIVED value stored beside the inputs it was derived from, where the two
 * can drift apart. Nothing forces them to agree, and every reader picks one
 * without knowing the other exists.
 *
 * `run-shape.ts` fixed the class where a key NAME is wrong — a literal nobody
 * checks, resolving to a null that reads as "not measured". This module fixes
 * the class one level along: every key name is right, every value is present,
 * and they contradict each other.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE INCIDENT
 *
 * 2026-08-23. One canonical row, eleven miles:
 *
 *     distanceMi  11.01     durationSec 5298     ← 8:01/mi, the watch's clock
 *     paceSPerMi  217       movingSec   2389     ← 3:37/mi, 16.6 mph
 *     avgPaceMinPerMi "8:01"                     ← the watch again, as a string
 *
 * Three surfaces rendered three different runs: the poster `11.0 mi · 1:28:18
 * · 3:37/mi`, run detail `39:49`, the log `39:49`. The recap said "Easy 11.0
 * mi at 3:37/mi. A touch quicker than the 9:22/mi easy target."
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW IT GOT THERE — AND WHY THIS IS A WRITE BUG WITH A READ FIX
 *
 * Not a bad number from Strava. Strava's own row was internally consistent:
 * 11.01 mi in 2389 s at 3:37/mi, every member agreeing with every other. The
 * watch's row was internally consistent too: 11.01 mi in 5298 s at 8:01/mi.
 *
 * The merge absorber (`lib/runs/canonical.ts`) then walked the loser's keys
 * ONE AT A TIME. `durationSec` was already set on the canonical, so the tier
 * ladder protected it — tier-1 Strava does not overwrite tier-5 watch. But
 * `movingTimeS`, `movingSec`, `paceSPerMi` and `elapsedTimeS` were ABSENT on
 * the watch row (the watch writes `durationSec`, `movingSec`, `timeMoving` and
 * `avgPaceMinPerMi`, and nothing else in this family), and the absorber's
 * fill-when-missing branch is TIER-BLIND: a missing field is "always
 * populated", whatever it came from.
 *
 * So the canonical ended up holding HALF of the watch's arithmetic and HALF of
 * Strava's. Neither half was wrong about its own source. The row was wrong
 * about itself.
 *
 * That is the general lesson, and it is stronger than "the device beats a
 * third party": a member of an arithmetic family may not enter a row from a
 * source that did not also supply the rest of the family. Provenance is a
 * property of the FAMILY, not of the field.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DOES
 *
 * Reconciles a row against ITSELF and refuses what its own facts disprove.
 * Every rule here is arithmetic — a ratio between two numbers the same row
 * carries. There is no threshold on human speed, no physiological claim, and
 * therefore no doctrine registry entry: the guard is equally correct for an
 * elite and for a walker, and it cannot go stale when the research does.
 *
 * Fixed at the READ, deliberately. It repairs every surface and every
 * historical row at once, with no migration, and without rewriting what any
 * source actually said. The absorber fix (`familyGuardedFill`) stops NEW rows
 * acquiring the shape; this stops the existing ones printing it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REFUSAL IS AN ANSWER
 *
 * Where a row's own facts contradict beyond tolerance and no coherent value
 * survives, this returns null and records WHY in `refusals`. It does not
 * substitute a plausible number.
 *
 * The 2026-08-23 row is the case in point. Its moving time is not 2389 s (the
 * row disproves that) and it is not 5298 s either — 5298 is the ELAPSED clock,
 * and handing it back as "moving time" would be a modelled number wearing a
 * measurement's clothes. The honest answer is that this run's moving time is
 * unknown. Callers get null and a reason, and say so.
 *
 * A blank where a lie used to be is a fix, not a regression.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED AGAINST PRODUCTION (256 rows, 2026-08-24, faff_readonly)
 *
 *   clock.moving-disproved  ·  1 canonical row  (2026-08-23, 54.9% "paused")
 *   clock.moving-impossible ·  0 rows           (sound — moving never exceeds
 *                                                elapsed anywhere)
 *   pace.display-vs-numeric ·  41 rows carry both · 6 differ by >15 s/mi,
 *                              worst 264 s/mi
 *   energy.total-vs-active  ·  32 rows carry both · 32 disagree, ratio
 *                              1.21–1.38 (this is CORRECT data, wrongly read)
 *   hr.zones-vs-avg         ·  5 canonical rows carry an all-zero zone
 *                              distribution beside a real average HR
 *   splits.total-vs-distance·  39 of 102 rows differ by >0.25 mi, worst 2.80
 *
 * Re-run `_coherence_gate.test.ts` positive controls before trusting any
 * number here; the counts are a snapshot, the invariants are the durable part.
 */

import {
  type RunData,
  runDistanceMi,
  runAvgHr,
  paceToSec,
} from '@/lib/runs/run-shape';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · TOLERANCES
 *
 * Each is a RATIO or a unit the row itself supplies. None is a claim about
 * how fast a person can run.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The largest share of a run that may plausibly be paused before its stored
 * moving time stops being believable.
 *
 * Half. A runner waiting at lights, refilling a bottle or stopping to stretch
 * can lose a lot of a run to pauses; losing MORE than half of it and still
 * calling the remainder the same session is not a run this app has to render
 * faithfully. Well past any honest pause pattern, and comfortably tight enough
 * to catch a third party's arithmetic error.
 *
 * Kept byte-identical to `MAX_PAUSED_SHARE` in `run-shape.ts` — the pace guard
 * and the clock guard must not disagree about what "too paused" means. The
 * gate asserts they match.
 */
export const MAX_PAUSED_SHARE = 0.5;

/**
 * How far a stored display STRING may sit from the number it claims to format
 * before the two are not describing the same quantity.
 *
 * 15 s/mi. Rounding a pace to whole seconds costs under a second; a gap of a
 * quarter-minute per mile is a different measurement, not a formatting
 * artefact. This is the threshold the 2026-08-23 incident was found with.
 */
export const MAX_DISPLAY_DRIFT_S_PER_MI = 15;

/**
 * How far the splits' own distances may sum from the run's distance before the
 * array stops being a decomposition OF that run.
 *
 * A quarter mile. GPS smoothing and a partial final mile account for a few
 * hundredths; a quarter mile is the point past which the array describes a
 * different run — as on 2026-08-01, where five splits totalling 4.14 mi sit on
 * a 1.34-mile row.
 */
export const MAX_SPLIT_SUM_DRIFT_MI = 0.25;

/** How far HR zone percentages may sum from 100 and still be a distribution. */
export const MAX_ZONE_SUM_DRIFT_PCT = 2;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE RESULT
 * ═══════════════════════════════════════════════════════════════════════ */

/** Which clock a pace was computed against. Never inferred by a caller. */
export type PaceBasis = 'moving' | 'elapsed';

/**
 * One value this row was not allowed to print, and why.
 *
 * `field` is the key that was refused. `family` names the registry entry whose
 * invariant it broke. `detail` is a plain sentence for a log or an audit — it
 * never reaches a runner's screen, so it may be specific.
 */
export interface Refusal {
  family: string;
  field: string;
  detail: string;
}

/**
 * A row's time/distance/effort facts, reconciled against each other.
 *
 * Every field is null when the row does not support it — either because
 * nothing measured it, or because the row's own other facts disprove it. The
 * two cases are distinguished by `refusals`: a null with a matching refusal
 * was DISPROVED, a null without one was never measured.
 */
export interface RunCoherence {
  distanceMi: number | null;

  /**
   * Wall-clock seconds — how long the runner was out, stoplights included.
   *
   * `durationSec` first, `elapsedTimeS` only as a fallback. That order is not
   * cosmetic: on `watch` rows (29/29 in prod) and `strava` rows (32/32),
   * `elapsedTimeS` is a BYTE COPY of `movingTimeS` and carries no elapsed
   * information at all. Only the old-Strava era (84 of 88 rows) and
   * `apple_health` (12 of 14) store a genuine wall clock there.
   */
  elapsedSec: number | null;

  /**
   * Moving seconds — time the runner was actually moving.
   *
   * NULL, with a refusal, when the row's own elapsed clock disproves it. Never
   * silently substituted with the elapsed clock: that would present a
   * wall-clock measurement as a moving-time one.
   */
  movingSec: number | null;

  /** Seconds per mile, against `paceBasis`. */
  paceSecPerMi: number | null;

  /**
   * Which clock `paceSecPerMi` was divided by.
   *
   * A caller that prints a pace without printing its basis is printing an
   * ambiguous number. `'moving'` is the pace the runner ran; `'elapsed'` is
   * the pace the clock says. They differ by up to 43 s/mi on real rows here.
   */
  paceBasis: PaceBasis | null;

  /** Miles per hour, always consistent with `paceSecPerMi`. */
  speedMph: number | null;

  /**
   * Time-in-zone percentages, or null when the row's distribution contradicts
   * its own average heart rate.
   */
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;

  /**
   * True when `data.splits` sums to this run's distance within tolerance, so
   * the array may be presented as a decomposition OF this run. False when it
   * describes some other distance. Null when there are no measurable splits.
   */
  splitsCoverRun: boolean | null;

  /** Everything this row was not allowed to print, with the reason. */
  refusals: Refusal[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */

/** A finite number, or null. Rejects NaN, Infinity, '' and non-numeric text. */
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A finite POSITIVE number, or null. Zero is not a duration or a distance. */
function pos(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

/**
 * The share of `elapsed` that a stored `moving` implies was spent paused.
 *
 * Negative when moving exceeds elapsed, which is impossible rather than merely
 * implausible — you cannot move for longer than you were out.
 */
export function impliedPausedShare(movingSec: number, elapsedSec: number): number {
  return 1 - movingSec / elapsedSec;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE RECONCILER
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Reconcile one row's derived values against the inputs stored beside them.
 *
 * Pure. No I/O, no clock, no doctrine. Given the same row it returns the same
 * answer forever, which is what makes it safe to put behind every surface.
 */
export function reconcileRun(d: RunData): RunCoherence {
  const refusals: Refusal[] = [];
  const distanceMi = runDistanceMi(d);

  /* ── the elapsed clock ────────────────────────────────────────────────
   * `durationSec` is the device's own total. `elapsedTimeS` is a fallback
   * because on watch and strava rows it is a copy of the moving time — see
   * the `elapsedSec` field note. */
  const elapsedSec = pos(d.durationSec) ?? pos(d.elapsedTimeS);

  /* ── the moving clock, checked against the elapsed one ────────────────── */
  const storedMoving = pos(d.movingTimeS) ?? pos(d.movingSec);
  let movingSec: number | null = storedMoving;

  if (storedMoving != null && elapsedSec != null) {
    const paused = impliedPausedShare(storedMoving, elapsedSec);
    if (paused < 0) {
      // Impossible, not implausible.
      movingSec = null;
      refusals.push({
        family: 'clock.moving-impossible',
        field: 'movingTimeS',
        detail:
          `moving time ${storedMoving}s exceeds the row's own elapsed clock ` +
          `${elapsedSec}s · a run cannot move for longer than it lasted`,
      });
    } else if (paused > MAX_PAUSED_SHARE) {
      // Believable arithmetic, unbelievable pause. Refuse rather than replace:
      // handing back `elapsedSec` here would print a wall clock as a moving one.
      movingSec = null;
      refusals.push({
        family: 'clock.moving-disproved',
        field: 'movingTimeS',
        detail:
          `moving time ${storedMoving}s against an elapsed ${elapsedSec}s ` +
          `implies ${(paused * 100).toFixed(1)}% of the run was paused · ` +
          `moving time is unknown for this run`,
      });
    }
  }

  /* ── pace, and the clock it belongs to ────────────────────────────────
   * A stored pace is believed only when a surviving clock agrees with it.
   * Otherwise pace is recomputed, and the basis is always reported. */
  let paceSecPerMi: number | null = null;
  let paceBasis: PaceBasis | null = null;

  if (distanceMi != null && distanceMi > 0) {
    if (movingSec != null) {
      paceSecPerMi = movingSec / distanceMi;
      paceBasis = 'moving';
    } else if (elapsedSec != null) {
      paceSecPerMi = elapsedSec / distanceMi;
      paceBasis = 'elapsed';
    }
  }

  /* ── the stored pace number, against the clock we just trusted ────────── */
  const storedPace = pos(d.paceSPerMi);
  if (storedPace != null && paceSecPerMi != null
      && Math.abs(storedPace - paceSecPerMi) > MAX_DISPLAY_DRIFT_S_PER_MI) {
    refusals.push({
      family: 'pace.stored-vs-clock',
      field: 'paceSPerMi',
      detail:
        `stored pace ${storedPace.toFixed(0)}s/mi disagrees with the row's ` +
        `own ${paceBasis} clock (${paceSecPerMi.toFixed(0)}s/mi) · recomputed`,
    });
  }

  /* ── the stored pace STRING, against the same clock ────────────────────
   * On 115 of 115 production rows `avgPaceMinPerMi` is derived from
   * `durationSec` while `paceSPerMi` is derived from `movingTimeS`. They are
   * not two spellings of one number; they are two different quantities under
   * names that both read as "average pace". Neither may be read as THE pace. */
  const storedPaceStr = paceToSec(d.avgPaceMinPerMi);
  if (storedPaceStr != null && paceSecPerMi != null
      && Math.abs(storedPaceStr - paceSecPerMi) > MAX_DISPLAY_DRIFT_S_PER_MI) {
    refusals.push({
      family: 'pace.display-vs-numeric',
      field: 'avgPaceMinPerMi',
      detail:
        `display pace "${String(d.avgPaceMinPerMi)}" (${storedPaceStr}s/mi) is ` +
        `an elapsed-clock pace; the reconciled ${paceBasis} pace is ` +
        `${paceSecPerMi.toFixed(0)}s/mi · the string is not arithmetic and ` +
        `must not be read as the pace`,
    });
  }

  /* ── speed, always derived from the pace we settled on ────────────────
   * `avgSpeedMph` is stored on 170 rows and agrees with the stored pace
   * everywhere today (worst 4.7 s/mi). It is derived here anyway: agreeing
   * today is luck, and a second stored spelling of one quantity is exactly
   * what this module exists to stop being read. */
  const speedMph = paceSecPerMi != null && paceSecPerMi > 0 ? 3600 / paceSecPerMi : null;

  const storedMph = pos(d.avgSpeedMph);
  if (storedMph != null && paceSecPerMi != null
      && Math.abs(3600 / storedMph - paceSecPerMi) > MAX_DISPLAY_DRIFT_S_PER_MI) {
    refusals.push({
      family: 'speed.stored-vs-pace',
      field: 'avgSpeedMph',
      detail:
        `stored speed ${storedMph} mph implies ${(3600 / storedMph).toFixed(0)}s/mi, ` +
        `against the row's reconciled ${paceSecPerMi.toFixed(0)}s/mi · recomputed`,
    });
  }

  /* ── HR zones, against the row's own average HR ────────────────────────
   * A distribution has to distribute. Five zeros beside a measured average of
   * 138 bpm is not "the runner spent no time in any zone" — it is a
   * computation that produced nothing, rendered as a bar chart of nothing. */
  const hrZonePcts = reconcileHrZones(d, refusals);

  /* ── splits, against the run's own distance ───────────────────────────── */
  const splitsCoverRun = reconcileSplitsTotal(d, distanceMi, refusals);

  return {
    distanceMi,
    elapsedSec,
    movingSec,
    paceSecPerMi,
    paceBasis,
    speedMph,
    hrZonePcts,
    splitsCoverRun,
    refusals,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · DROP-IN READERS
 *
 * The call sites this module exists for are not holding a typed `RunData`.
 * They are holding a row `SELECT`ed out of `data` with the same key names on
 * it, and each one has hand-rolled its own COALESCE ladder in a slightly
 * different order — `movingTimeS || durationSec || elapsedTimeS` in one file,
 * `movingTimeS || movingSec || elapsedTimeS` in the next, `movingTimeS ||
 * elapsedTimeS` in a third. Twenty-odd ladders, no two identical, every one of
 * them a place a row can answer one question two ways.
 *
 * These take the loose object so a migration is a one-line substitution rather
 * than a refactor, which is what makes it safe to do to twenty files at once.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Narrow any loose row-ish object to `RunData` without asserting anything. */
function loose(row: unknown): RunData {
  return (row && typeof row === 'object' ? row : {}) as RunData;
}

/**
 * Moving seconds, or null when the row's own elapsed clock disproves them.
 *
 * Replaces `Number(r.movingTimeS) || Number(r.durationSec) || ...` ladders.
 * NOTE THE BEHAVIOUR CHANGE that makes it worth doing: those ladders fall
 * through to the elapsed clock, so a row with no moving measurement returns
 * its wall clock under a moving-time name. This does not. A caller that wants
 * "how long was the runner out" should ask `coherentElapsedSec`, which is a
 * different question with a different answer.
 */
export function coherentMovingSec(row: unknown): number | null {
  return reconcileRun(loose(row)).movingSec;
}

/** Wall-clock seconds — how long the runner was out. */
export function coherentElapsedSec(row: unknown): number | null {
  return reconcileRun(loose(row)).elapsedSec;
}

/**
 * The best available clock for "how long did this run take", and which one it
 * is. Moving time when the row supports it, the wall clock otherwise.
 *
 * For callers that genuinely need A duration and cannot render a blank — a
 * weekly time total, a feed row. The `basis` rides along so nothing has to
 * guess, and so a surface that cares can say which clock it is showing.
 */
export function coherentDurationSec(row: unknown): { sec: number; basis: PaceBasis } | null {
  const c = reconcileRun(loose(row));
  if (c.movingSec != null) return { sec: c.movingSec, basis: 'moving' };
  if (c.elapsedSec != null) return { sec: c.elapsedSec, basis: 'elapsed' };
  return null;
}

/**
 * Average pace in seconds per mile, with the clock it was divided by.
 *
 * Replaces both `Number(d.paceSPerMi)` and `parsePaceToSec(d.avgPaceMinPerMi)`
 * at every call site that currently picks one of them. Those two keys are not
 * two spellings of one number — on 115 of 115 production rows the string is
 * the ELAPSED pace and the number is the MOVING pace — so a reader that picks
 * either is printing an unlabelled quantity.
 */
export function coherentPace(row: unknown): { secPerMi: number; basis: PaceBasis } | null {
  const c = reconcileRun(loose(row));
  if (c.paceSecPerMi == null || c.paceBasis == null) return null;
  return { secPerMi: c.paceSecPerMi, basis: c.paceBasis };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE PIECES, SEPARATELY TESTABLE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The zone distribution, or null when the row disproves it.
 *
 * Refused when the five percentages do not sum to 100 (within tolerance) AND
 * the row carries a real average heart rate. Both halves matter: a row with no
 * HR at all has nothing to contradict, and an absent distribution is not a
 * defect — only a PRESENT one that disagrees with its own inputs is.
 */
export function reconcileHrZones(
  d: RunData,
  refusals: Refusal[] = [],
): RunCoherence['hrZonePcts'] {
  const z = d.hrZonePcts;
  if (!z || typeof z !== 'object') return null;

  const parts = [z.z1, z.z2, z.z3, z.z4, z.z5].map(num);
  if (parts.some((p) => p == null)) return null;

  const sum = (parts as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) <= MAX_ZONE_SUM_DRIFT_PCT) return z;

  const avgHr = runAvgHr(d);
  if (avgHr == null) {
    // Nothing to contradict. A distribution with no HR beside it is unusable
    // rather than false, and the caller's own null-handling covers it.
    return null;
  }

  refusals.push({
    family: 'hr.zones-vs-avg',
    field: 'hrZonePcts',
    detail:
      `zone percentages sum to ${sum} beside a measured average of ${avgHr} bpm · ` +
      `a run with a heart rate spent its time in some zone · distribution refused`,
  });
  return null;
}

/**
 * Whether `data.splits` decomposes THIS run.
 *
 * Returns null when no split element carries a readable distance — there are
 * six historical split shapes and several carry pace and HR but no distance,
 * which is a shape limitation, not a contradiction.
 *
 * `distanceMi` wins on disagreement, and that is not arbitrary: the run-level
 * distance is what weekly volume, plan adherence and every distance-keyed
 * doctrine table are summed from, and it is the figure the recorder reported
 * for the session. The split array is the derived decomposition of it.
 */
export function reconcileSplitsTotal(
  d: RunData,
  distanceMi: number | null,
  refusals: Refusal[] = [],
): boolean | null {
  const arr = d.splits;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (distanceMi == null || distanceMi <= 0) return null;

  let total = 0;
  let measured = 0;
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    // The distance-bearing keys across the six observed shapes. `distance` is
    // Strava's, in METRES; the rest are already miles.
    const mi = num(s.distanceMi) ?? num(s.mi)
      ?? (num(s.distance) != null ? (num(s.distance) as number) / 1609.344 : null);
    if (mi == null || mi <= 0) continue;
    total += mi;
    measured++;
  }
  if (measured === 0) return null;

  const drift = Math.abs(total - distanceMi);
  if (drift <= MAX_SPLIT_SUM_DRIFT_MI) return true;

  refusals.push({
    family: 'splits.total-vs-distance',
    field: 'splits',
    detail:
      `${measured} split(s) total ${total.toFixed(2)} mi against a run of ` +
      `${distanceMi.toFixed(2)} mi (${drift.toFixed(2)} mi apart) · the array ` +
      `does not decompose this run`,
  });
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
  * 7 · ENERGY · two measurements, two names, one COALESCE
 *
 * `data.calories` and `data.kcal` are BOTH correct and they are NOT the same
 * quantity:
 *
 *   · `calories` — Strava/HealthKit TOTAL energy, basal included. 65 rows.
 *   · `kcal`     — the watch's ACTIVE energy from HKLiveWorkoutBuilder. 67 rows.
 *
 * On the 32 rows carrying both, `calories` is 1.21× to 1.38× `kcal` (mean
 * 1.31×) — exactly the basal share of an hour's running. Every one of the 32
 * "disagrees", and every one of them is right.
 *
 * So this family needs no data fix and no refusal. What it needs is for
 * nothing to COALESCE them, because a column that is total energy on one row
 * and active energy on the next moves ~30% for no reason the runner can see.
 * Two live readers do exactly that; see the registry entry for where.
 *
 * These accessors exist so the choice has to be made by name.
 * ═══════════════════════════════════════════════════════════════════════ */

/** TOTAL energy for the run, basal included. Third-party computed. */
export function runTotalEnergyKcal(d: RunData): number | null {
  return pos(d.calories);
}

/** ACTIVE energy for the run, as the watch measured it. Excludes basal. */
export function runActiveEnergyKcal(d: RunData): number | null {
  return pos(d.kcal);
}
