// ─────────────────────────────────────────────────────────────────────────────
// Heat on the wrist
//
// David, 2026-08-24, decisions 1-5 in docs/design/watch-0821/HEAT-ADJUSTMENT.md:
// current temperature or the feature does not get built; the eased band goes
// back to the phone so both surfaces say one number; the run is graded against
// the eased band; `heatAdjusted` gets wired in the same pass; and indoors is
// something the runner SAYS at Start, never inferred.
//
// This module owns one decision — by how much, and whether at all. The
// physiology is not re-derived here: every number comes from the shared
// Research/06 model in lib/training/heat-model.ts, which five other surfaces
// already read. A second heat engine is the bug this file exists to avoid, and
// the codebase has shipped that bug before.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//
//   · It does not touch tolerance. Research/06 says nothing about band width,
//     so widening one would be an invented constant. The band moves; it does
//     not stretch.
//
//   · It does not add a second bail-out threshold. The §3 WBGT gate already
//     exists as `detectHeatBail` (lib/plan/adapt.ts), already runs on this
//     path, and already surfaces through `loadSessionMoved`. Writing a fresh
//     "too hot for a target" cutoff here would be a number with no citation
//     competing with a number that has one.
//
//   · It does not adjust a race. Race pace is priced in the execution plan,
//     and pricing it twice is a shipped bug this repo has already paid for.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchCurrentConditions, resolveHomeLatLng } from '@/lib/weather/openmeteo';
import { effortSlowdownPct, abilityTierFromVdot } from '@/lib/training/heat-model';
import { loadLatestVdotForUser } from '@/lib/training/projection-snapshots';
import { runnerToday } from '@/lib/runtime/runner-tz';

/** The shape this needs from a phase. Structural, so tests need no builder. */
export interface HeatAdjustablePhase {
  targetPaceSPerMi?: number | null;
  // `number | null` rather than `number` since PRERUN-1, so `ExpandedPhase` —
  // whose `durationSec` is nullable — satisfies this without a cast. The loop
  // already narrows with `typeof … === 'number'` before touching it, so the
  // widening changes no behaviour; it only stops a caller from having to lie
  // about its own type to reach the one implementation.
  durationSec?: number | null;
  distanceMi?: number | null;
}

export interface WatchHeatOutcome {
  /** True only when at least one target actually moved. */
  applied: boolean;
  /** Composed Research/06 slowdown, percent. 0 when nothing applied. */
  slowdownPct: number;
  tempF: number | null;
  dewpointF: number | null;
  /** Age of the observation used, minutes. Null when none was used. */
  observedAgeMin: number | null;
  /**
   * Why nothing was applied. Null when it was. These are diagnostic strings,
   * not runner-facing copy — the runner-facing sentence is built by the
   * caller in the lobby's `note` register.
   */
  reason: 'race' | 'no_location' | 'no_current_conditions' | 'not_warm_enough' | null;
}

const NONE: WatchHeatOutcome = {
  applied: false, slowdownPct: 0, tempF: null, dewpointF: null,
  observedAgeMin: null, reason: null,
};

/**
 * Below this the adjustment is noise. Research/06 §1's table is zero at and
 * below 50°F, so anything that rounds to less than a second per mile is the
 * model saying "no correction" in a slightly different way — and moving a
 * target by half a second would put a different number on the wrist and the
 * phone for no physiological reason.
 */
const MIN_MEANINGFUL_S_PER_MI = 1;

/**
 * Shift every phase target for today's real conditions. Mutates `phases`.
 *
 * Returns what it did, so the caller can say it once in the lobby and set
 * `heatAdjusted` honestly. Every failure path returns `applied: false` and
 * leaves the phases untouched — a missing thermometer must read as "do not
 * adjust", never as "adjust by zero", and never as an invented temperature.
 */
export async function adjustPhasesForHeat(
  userId: string,
  phases: HeatAdjustablePhase[],
  opts: {
    isRace: boolean;
    intervalStyle: boolean;
    /** Planned session length, for the Research/06 duration scale. */
    totalSec: number;
    /** Test seam. Omit in production. */
    deps?: Partial<HeatDeps>;
  },
): Promise<WatchHeatOutcome> {
  const deps: HeatDeps = { ...defaultDeps, ...(opts.deps ?? {}) };

  if (opts.isRace) return { ...NONE, reason: 'race' };

  const home = await deps.resolveHomeLatLng(userId).catch(() => null);
  if (!home) return { ...NONE, reason: 'no_location' };

  const now = await deps.fetchCurrentConditions(home.lat, home.lng).catch(() => null);
  if (!now) return { ...NONE, reason: 'no_current_conditions' };

  const vdot = await deps.loadLatestVdotForUser(userId).catch(() => null);

  const pct = effortSlowdownPct({
    tempF: now.temp_f,
    dewpointF: now.dewpoint_f,
    humidityPct: now.humidity_pct,
    cloudCoverPct: now.cloud_cover_pct,
    durationS: opts.totalSec,
    intervalStyle: opts.intervalStyle,
    tier: abilityTierFromVdot(vdot),
  });

  const factor = 1 + pct / 100;

  // Does it move anything a runner could act on? Judged against the FASTEST
  // target present, because that is the one a percentage moves least.
  const targets = phases
    .map((p) => p.targetPaceSPerMi)
    .filter((t): t is number => typeof t === 'number' && isFinite(t) && t > 0);
  const quickest = targets.length > 0 ? Math.min(...targets) : null;
  const moved = quickest != null ? quickest * factor - quickest : 0;
  if (pct <= 0 || quickest == null || moved < MIN_MEANINGFUL_S_PER_MI) {
    return {
      ...NONE,
      reason: 'not_warm_enough',
      tempF: now.temp_f,
      dewpointF: now.dewpoint_f,
      observedAgeMin: now.age_min,
    };
  }

  applyHeatEasing(phases, pct);

  return {
    applied: true,
    slowdownPct: pct,
    tempF: now.temp_f,
    dewpointF: now.dewpoint_f,
    observedAgeMin: now.age_min,
    reason: null,
  };
}

/**
 * Move every pace target in a phase list by an ALREADY-DECIDED slowdown.
 *
 * Split out of `adjustPhasesForHeat` 2026-08-24 (PRERUN-1) so the phone's
 * pre-run card can apply the SAME arithmetic to the SAME phase list without
 * deciding anything of its own. The percentage is still decided in exactly one
 * place — `effortSlowdownPct`, off `Research/06` — and the phone gets it by
 * reading back what the wrist was given (`loadHeatEasing`), never by asking
 * the weather a second time.
 *
 * The alternative was for the card to re-multiply its own formatted pace
 * strings, which is both a second implementation of this loop and a parse of
 * something we had just printed. This is the one loop, exported.
 *
 * Mutates `phases`. No-op for a non-positive percentage.
 */
export function applyHeatEasing(phases: HeatAdjustablePhase[], pct: number): void {
  if (!isFinite(pct) || pct <= 0) return;
  const factor = 1 + pct / 100;
  for (const p of phases) {
    const t = p.targetPaceSPerMi;
    if (typeof t !== 'number' || !isFinite(t) || t <= 0) continue;
    const eased = Math.round(t * factor);

    // A DISTANCE phase's duration was DERIVED from its target, so it has to
    // move with it or the lobby's total under-reports a session the runner is
    // being asked to run slower. A TIME phase's duration is the prescription
    // itself — ten minutes stays ten minutes, covering less ground.
    if (p.distanceMi != null && typeof p.durationSec === 'number') {
      p.durationSec = Math.round(p.durationSec * (eased / t));
    }
    p.targetPaceSPerMi = eased;
  }
}

/**
 * The runner-facing sentence, lobby `note` register. Said once, before the
 * run. Nothing on a running face ever mentions weather — a runner mid-effort
 * cannot act on a temperature, and the band they are being held to already
 * carries the adjustment.
 */
export function heatNote(o: WatchHeatOutcome): string | null {
  if (!o.applied || o.tempF == null) return null;
  const t = Math.round(o.tempF);
  const dp = o.dewpointF != null ? Math.round(o.dewpointF) : null;
  const conditions = dp != null && dp >= 60
    ? `${t} degrees, dewpoint ${dp}`
    : `${t} degrees`;
  return `${conditions}. Targets eased for the heat.`;
}

// ── injection seam ───────────────────────────────────────────────────────────

export interface HeatDeps {
  resolveHomeLatLng: typeof resolveHomeLatLng;
  fetchCurrentConditions: typeof fetchCurrentConditions;
  loadLatestVdotForUser: typeof loadLatestVdotForUser;
}

const defaultDeps: HeatDeps = {
  resolveHomeLatLng,
  fetchCurrentConditions,
  loadLatestVdotForUser,
};

// ─────────────────────────────────────────────────────────────────────────────
// Remembering what we asked for
//
// David's decision 3: "The completed run is judged against the EASED band."
//
// That sentence has a consequence that is easy to miss and expensive to ship.
// The recap judges a completed run against `frozenTargetSPerMi`, which it
// reads out of the watch completion payload — i.e. the target the watch was
// GIVEN. Once this module eases that target, the recap is already comparing
// against the eased band, and its own Research/06 correction in
// `intervalPacing` then prices the same heat a SECOND time. A hot run would
// read better than the identical effort in the cold, which is precisely the
// double-pricing decision 3 names.
//
// The recap therefore has to know that the band it read was already eased.
// It cannot re-derive that: the easing is a function of the conditions at
// BUILD time, and the recap only has the conditions during the run.
//
// So the server records what it asked for. No wire change, no watch change,
// no new column: a `coach_intents` row keyed by date, read back the same way
// the completion payload itself is read. When several payloads are built on
// one day the newest wins, which is the one the runner actually left with.
//
// 2026-08-25 · "the newest wins" holds only for builds that happen BEFORE the
// run. A build after it is not a payload the runner left with, and the read is
// `ORDER BY ts DESC LIMIT 1`, so a later same-day build with a genuinely
// different decision still re-prices a run that is already finished. The two
// guards below cut this down to the case where the weather actually moved the
// number: recording is refused outright for any date that is not the runner's
// today, and an unchanged decision writes nothing at all. Closing the residual
// means keying the record to the build the watch CONSUMED, which is a contract
// change across the completion payload rather than a guard in this file.
// ─────────────────────────────────────────────────────────────────────────────

export const HEAT_EASING_REASON = 'watch_heat_easing';
export const heatEasingField = (dateIso: string) => `heat-${dateIso}`;

/**
 * The decision, rounded the way it is stored. Two builds that reached the same
 * easing are the same record, however far apart they ran and however fresh the
 * observation behind each one was.
 */
const decisionPct = (pct: number) => Math.round(pct * 1000) / 1000;

/**
 * Fire-and-forget. A failure here must never cost the runner their workout.
 *
 * ── WHY THIS FUNCTION REFUSES MOST OF THE CALLS IT GETS ──────────────────────
 *
 * It is reached from `buildWatchToday`, which is the whole body of
 * GET /api/watch/today. The phone hits that endpoint on cold launch, on every
 * `scenePhase → .active` (60s throttle) and on every watch-reachability change.
 * A read handler that mints a coaching row on each of those mints a lot of
 * them, and until 2026-08-25 both of its brakes were off:
 *
 *   · The idempotency guard was `value::text = $3` against a blob that carried
 *     `observedAgeMin`, the age of the weather observation in minutes. That
 *     number differs between any two calls, so the guard could essentially
 *     never match.
 *
 *   · There was no date guard, and `adjustPhasesForHeat` reads CURRENT
 *     conditions with no date at all. `?date=` previews of another day were
 *     therefore stamped with the weather of the day the preview was taken.
 *
 * The owner's account carried 40 `watch_heat_easing` rows written between 00:56
 * and 18:19 UTC on ONE day, spanning nine `field` keys, `heat-2026-08-18`
 * through `heat-2026-08-30`. Past dates and future dates. One key had 11 rows
 * to itself. A future reader tempted to simplify either guard away should read
 * that sentence again: both of these are load-bearing.
 *
 * Row count is the cheap half of the harm. `loadHeatEasing` reads
 * `ORDER BY ts DESC LIMIT 1`, so the record a run is graded against is whatever
 * the last app-open wrote, not what the wrist actually held during the run.
 * Opening the app at 3pm after a 6am run re-priced that run's heat.
 */
export async function recordHeatEasing(
  userId: string,
  dateIso: string,
  o: WatchHeatOutcome,
): Promise<void> {
  if (!o.applied || o.slowdownPct <= 0) return;
  const pct = decisionPct(o.slowdownPct);
  if (pct <= 0) return;

  // GUARD 1 · only the day being lived.
  //
  // The easing above was computed from the weather RIGHT NOW. That is only a
  // true statement about `dateIso` when `dateIso` is today. A preview of
  // Saturday's long run taken on a hot Wednesday may still SHOW its easing on
  // the card, which is useful, but it must not leave a coaching record for a
  // day whose weather has not happened: Saturday's recap would then un-price
  // heat that was never applied to Saturday's band.
  //
  // A date we cannot establish is not today. Fail closed: writing a possibly
  // future-dated coaching row is the harm this guard exists to stop, and the
  // cost of skipping the record is that the recap prices the heat itself.
  const today = await runnerToday(userId).catch((e) => {
    console.warn('[watch/heat] recordHeatEasing · runnerToday failed:',
      (e as Error)?.message ?? e);
    return null;
  });
  if (today == null || dateIso !== today) return;

  // GUARD 2 · one record per DECISION, not one per call.
  //
  // The thing meant to be unique is the runner, the reason, the date and the
  // easing itself. `observedAgeMin` and the exact temperature are provenance:
  // they still go into the stored value because the phone's pre-run card names
  // the conditions, but they no longer decide whether a row is written.
  //
  // Read through `loadHeatEasing` rather than a NOT EXISTS, so "have we
  // already asked for this" is answered by the same lens the recap uses. Its
  // three-state contract carries the whole decision here: an equal pct is a
  // duplicate, a different pct is a genuinely changed decision and gets its
  // own row, and a FAILED read (null) writes. That last one is deliberate. A
  // missing record makes the recap price the heat a second time on a band that
  // was already eased, which is the exact double-pricing this mechanism
  // exists to prevent; one duplicate row is much the cheaper mistake.
  const already = await loadHeatEasing(userId, dateIso);
  if (already !== null && already.pct === pct) return;

  const { pool } = await import('@/lib/db/pool');
  const value = JSON.stringify({
    pct,
    tempF: o.tempF,
    dewpointF: o.dewpointF,
    observedAgeMin: o.observedAgeMin,
  });
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     VALUES ($1::uuid, $1::uuid, NOW(), '${HEAT_EASING_REASON}', $2, $3)`,
    [userId, heatEasingField(dateIso), value],
  ).catch((e) => {
    console.warn('[watch/heat] recordHeatEasing failed:', (e as Error)?.message ?? e);
  });
}

/**
 * How much this day's watch targets were eased.
 *
 *   · a number  — this is what we asked for (0 = nothing was recorded, which
 *                 is the honest answer for a cool day and for every run built
 *                 before this shipped)
 *   · null      — the read FAILED and we do not know
 *
 * The distinction is load-bearing, so this does not collapse them. Absent and
 * failed do NOT lead to the same outcome: absent means the recap should price
 * the heat itself, failed means the recap has no idea whether the band it is
 * holding was already eased. Returning 0 for both would make a lost database
 * connection silently double-price a hot run — the exact bug this whole
 * mechanism exists to prevent, reintroduced through the error path.
 *
 * Callers fail CLOSED on null: assume the band was eased and do not price it
 * again. On a cool day that costs nothing, because the correction is ~0. On a
 * hot day it grades the runner slightly harder rather than flattering them,
 * which is the right direction for a coach to be wrong in.
 */
export async function loadHeatEasingPct(
  userId: string,
  dateIso: string,
): Promise<number | null> {
  const r = await loadHeatEasing(userId, dateIso);
  return r === null ? null : r.pct;
}

/**
 * The whole recorded easing, not just the percentage.
 *
 * PRERUN-1 · the phone's pre-run card needs two things the pct alone cannot
 * give it: the same eased targets the wrist is holding, and the CONDITIONS to
 * name when it says so. "Targets eased for the heat" with no temperature is a
 * claim the runner cannot check.
 *
 * Same three-state contract as `loadHeatEasingPct` and for the same reason:
 *   · a record   — this is exactly what the watch was given
 *   · pct 0      — nothing was eased (cool day, or built before this shipped)
 *   · null       — the read FAILED and we do not know
 */
export async function loadHeatEasing(
  userId: string,
  dateIso: string,
): Promise<{ pct: number; tempF: number | null; dewpointF: number | null } | null> {
  const { rowOrNull } = await import('@/lib/db/read');
  const { pool } = await import('@/lib/db/pool');
  // `rowOrNull` distinguishes all three states the caller needs: a row, no
  // row, or a read that failed. Hand-rolling the catch here is what put this
  // file in front of the swallowed-failure gate in the first place.
  const row = await rowOrNull<{ value: unknown }>(
    'watch/heat.loadHeatEasing',
    pool.query(
      `SELECT value FROM coach_intents
        WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
          AND reason = '${HEAT_EASING_REASON}'
          AND field = $2
        ORDER BY ts DESC LIMIT 1`,
      [userId, heatEasingField(dateIso)],
    ),
  );
  const NONE_RECORDED = { pct: 0, tempF: null, dewpointF: null };
  if (row === null) return null;                 // the read failed
  if (row === undefined || row.value == null) return NONE_RECORDED;  // nothing was eased

  let parsed: unknown = row.value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  const v = parsed as { pct?: unknown; tempF?: unknown; dewpointF?: unknown } | null;
  const pct = Number(v?.pct);
  // A row we wrote but cannot read is "unknown", not "zero" — same reasoning
  // as a failed read, and the caller fails closed on both.
  if (!isFinite(pct)) return null;
  const numOrNull = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : null);
  return { pct: pct > 0 ? pct : 0, tempF: numOrNull(v?.tempF), dewpointF: numOrNull(v?.dewpointF) };
}
