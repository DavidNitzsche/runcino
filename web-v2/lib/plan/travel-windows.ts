/**
 * lib/plan/travel-windows.ts · TRAVEL-1 (2026-08-28) · travel as a plan input.
 *
 * Owner ruling: "traveling but I'll want to stay as consistent with my runs
 * as possible. But something the phone should surface, not me and you in the
 * backend." The runner enters the dates they are away (the `travel_windows`
 * table, written from the phone); this pass shapes the composed plan so the
 * block keeps them running through the window instead of pretending the
 * window is not there.
 *
 * WHAT A TRAVEL DAY IS. An easy-preferred day, NOT a rest day. The owner runs
 * on the road, and Research/12-travel-timezone.md's own post-flight table
 * prescribes running on every day of a trip ("15–25 min easy shake-out" on
 * arrival day, "30–45 min easy + strides; avoid hard efforts" on day +1) —
 * quality is what waits ("Day +3 | First quality session permissible"). A
 * window here carries no flight times and no time zones, so the pass takes
 * the conservative reading that holds for any trip: no quality session and no
 * full long run ON a travel day, easy dose UNCHANGED. Where doctrine is
 * silent — how much easier an easy day should be while traveling — the pass
 * does nothing, which is the neutral behaviour: same easy miles, a note that
 * says why the day looks the way it does.
 *
 * THE THREE MOVES, in the order they run per week:
 *
 *   1 · LONG RUN off a travel day. If the week's long run lands inside a
 *       window and a clean seat exists in the same composed week (an easy day
 *       outside every window whose neighbours are not hard days), the long
 *       run and the easy day swap whole. No seat → the day runs easy at the
 *       week's own easy-day size, honestly noted — the miles that come off
 *       are gone, not redistributed (same "never makes miles up" stance as
 *       replan-scenarios.ts).
 *
 *   2 · QUALITY off a travel day. Same seat search, same swap. No seat → the
 *       session runs easy at its authored distance (the dose drops to easy,
 *       the miles stay — consistency is the point of the feature).
 *
 *   3 · EASY days inside a window keep their distance and gain the travel
 *       note, so the runner sees the plan knows.
 *
 * WHAT IT NEVER TOUCHES:
 *   · Race weeks (`isRaceWeek`) — the race-week composer owns that structure,
 *     and pre-race travel is Research/12's days-on-site problem, which is
 *     advice, not plan-shaping.
 *   · Race days (`type === 'race'`) — an embedded tune-up keeps its day.
 *   · Rest days — resting while traveling needs no correction.
 *   · Weekly volume, beyond the honest trim of an unseatable long run.
 *
 * GATED: no windows → composePlan never calls this and output is
 * byte-identical to before.
 *
 * Pure — no DB, no clock. The impure half (table CRUD + loaders) is
 * ./travel-store.ts, split exactly like convergence.ts / convergence-loader.
 */

import type { ComposedWeek, DayPlan, DOW } from './generate';

export interface TravelWindow {
  /** Inclusive ISO date range (YYYY-MM-DD). */
  startISO: string;
  endISO: string;
  note?: string | null;
}

/** One shaping decision, recorded into authored_state.travel_shaped so a day
 *  that looks unusual says why on the plan's own record. */
export interface TravelShapedChange {
  date: string;
  action: 'long_moved' | 'long_eased' | 'quality_moved' | 'quality_eased' | 'easy_noted';
  /** For the two _moved actions · where the session landed. */
  toDate?: string;
}

/** Coach copy · one voice for every surface that renders these days. */
export const TRAVEL_EASY_NOTE = 'Travel day. Keep it easy, keep the streak.';
export const TRAVEL_QUALITY_EASED_NOTE =
  'Travel day. Run this easy on the road. Quality resumes at home.';
export const TRAVEL_LONG_EASED_NOTE =
  'Travel day. The full long run does not fit here. Easy miles keep the week honest.';

/** What an unseatable long run becomes when the week has no easy day to size
 *  it from · mirrors RUNUP_EASY_CAP_MI in generate.ts ("an easy run, not a
 *  session"), used only as the last-resort fallback below. */
export const TRAVEL_LONG_EASY_FALLBACK_MI = 6;

const isoDay = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay() as DOW;

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True when `dateISO` falls inside any window (inclusive both ends). */
export function isTravelDay(dateISO: string, windows: readonly TravelWindow[]): boolean {
  for (const w of windows) {
    if (w?.startISO && w?.endISO && w.startISO <= dateISO && dateISO <= w.endISO) return true;
  }
  return false;
}

/** ISO dates inside any window, clamped to [fromISO, toISO] inclusive.
 *  The adapter's reschedule guard reads the plan through this. */
export function travelDatesBetween(
  windows: readonly TravelWindow[],
  fromISO: string,
  toISO: string,
): Set<string> {
  const out = new Set<string>();
  for (const w of windows) {
    if (!w?.startISO || !w?.endISO || w.endISO < fromISO || w.startISO > toISO) continue;
    let d = w.startISO < fromISO ? fromISO : w.startISO;
    const end = w.endISO > toISO ? toISO : w.endISO;
    while (d <= end) {
      out.add(d);
      d = addDaysISO(d, 1);
    }
  }
  return out;
}

/** A day counts as hard for seat-adjacency: the swap must not create
 *  back-to-back hard days (Research/00a hard-easy principle, the same probe
 *  chooseRescheduleDate runs). */
function isHardDay(d: DayPlan | null): boolean {
  return !!d && (d.isQuality || d.isLong || d.type === 'race' || d.type === 'long');
}

/**
 * Count of stimulus-gap violations in one composed week · a MIRROR of
 * `validateComposedPlan` §9 (Research/00b hard-easy spacing · intervals need
 * 2 easy days after, threshold/tempo/long need 1, cyclic within the week,
 * over-constrained weeks skipped). Mirrored for the same reason
 * replan-scenarios.ts mirrors
 * the validator's constants: a seat this pass picks has to be a seat the
 * boundary will accept, or the shaping produces a plan the validator then
 * refuses. A swap is accepted only when it does not INCREASE this count.
 */
function gapViolationCount(days: DayPlan[]): number {
  const reqGap = (t: string): number => (t === 'intervals' ? 2 : t === 'easy' ? 0 : 1);
  const hard = days
    .filter((d) => (d.isQuality || d.isLong) && d.type !== 'race' && d.type !== 'shakeout' && d.type !== 'race_week_tuneup')
    .map((d) => ({ dow: d.dow, g: reqGap(d.type) }))
    .sort((a, b) => a.dow - b.dow);
  if (hard.length < 2) return 0;
  const requiredTotal = hard.reduce((s, h) => s + h.g, 0);
  if (requiredTotal > 7 - hard.length) return 0;
  let v = 0;
  for (let i = 0; i < hard.length; i++) {
    const cur = hard[i];
    const nxt = hard[(i + 1) % hard.length];
    const between = ((nxt.dow - cur.dow + 7) % 7) - 1;
    if (between < cur.g) v++;
  }
  return v;
}

/** Swap everything except the day-of-week between two composed days. The
 *  whole day moves — label, notes, work shape, race-pace segment — so the
 *  session stays one set of numbers wherever it sits (MIDRACE-SHAPE-1's
 *  lesson: a label without its shape, or a shape without its label, is two
 *  contradictory instructions on one row). */
function swapDayContents(a: DayPlan, b: DayPlan): void {
  const aDow = a.dow;
  const bDow = b.dow;
  const aCopy = { ...a };
  const bCopy = { ...b };
  for (const k of Object.keys(a)) delete (a as unknown as Record<string, unknown>)[k];
  for (const k of Object.keys(b)) delete (b as unknown as Record<string, unknown>)[k];
  Object.assign(a, bCopy);
  Object.assign(b, aCopy);
  a.dow = aDow;
  b.dow = bDow;
}

/** A session demoted to easy stops carrying the session's machinery — same
 *  fields MIDRACE-SHAPE-1's clearWorkShape deletes, plus the tune-up pace. */
function demoteToEasy(d: DayPlan): void {
  d.type = 'easy';
  d.isQuality = false;
  d.isLong = false;
  d.subLabel = 'EASY';
  delete d.raceGoalPaceSec;
  delete d.workShape;
  delete d.progressionLever;
  delete d.challengeZone;
  delete d.longRunKind;
}

/**
 * Shapes composed weeks around the runner's travel windows. Mutates `weeks`
 * in place (the embedMidBlockRaces / guardGoalRaceRunUp convention) and
 * returns the record of what moved. Runs inside composePlan AFTER the
 * mid-block race embed (a race day must already be a race day so this pass
 * can leave it alone) and BEFORE guardGoalRaceRunUp + finalizeComposedPlan
 * (so the run-up guard and the VOL-1 reconcile see the shaped week).
 */
export function shapeTravelWindows(
  weeks: ComposedWeek[],
  opts: {
    startMondayISO: string;
    travelWindows: readonly TravelWindow[];
  },
): TravelShapedChange[] {
  const windows = (opts.travelWindows ?? []).filter(
    (w) => /^\d{4}-\d{2}-\d{2}$/.test(w?.startISO ?? '')
      && /^\d{4}-\d{2}-\d{2}$/.test(w?.endISO ?? '')
      && w.startISO <= w.endISO,
  );
  if (windows.length === 0) return [];

  const startDow = isoDay(opts.startMondayISO);
  const totalDays = weeks.length * 7;
  const dateOf = (o: number) => addDaysISO(opts.startMondayISO, o);
  const dayAt = (o: number): DayPlan | null => {
    if (o < 0 || o >= totalDays) return null;
    const wi = Math.floor(o / 7);
    const dow = ((startDow + o) % 7) as DOW;
    return weeks[wi]?.days.find((d) => d.dow === dow) ?? null;
  };

  const changes: TravelShapedChange[] = [];

  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi];
    // The race-week composer owns race-week structure · never reshaped.
    if (!week || week.isRaceWeek) continue;

    const weekOffsets: number[] = [];
    for (let o = wi * 7; o < (wi + 1) * 7 && o < totalDays; o++) weekOffsets.push(o);

    /** An easy day outside every window that the session can move to without
     *  breaking hard-easy spacing. Two probes, both required:
     *
     *  · physical adjacency across week seams (the ±1 calendar days must not
     *    be hard — the same probe chooseRescheduleDate runs, and the only one
     *    that can see the previous week's Sunday long);
     *  · the validator's own §9 cyclic gap rule, simulated post-swap — a seat
     *    the boundary would refuse is not a seat.
     *
     *  `vacatingOffset` is the travel day being emptied — after the swap it
     *  is easy, so it never disqualifies a seat next to it. */
    const cleanSeat = (vacatingOffset: number): number | null => {
      const vacating = dayAt(vacatingOffset);
      if (!vacating) return null;
      const before = gapViolationCount(week.days);
      let best: number | null = null;
      let bestDist = Infinity;
      for (const o of weekOffsets) {
        if (o === vacatingOffset) continue;
        const d = dayAt(o);
        if (!d || d.type !== 'easy' || d.isQuality || d.isLong) continue;
        if (!(d.distanceMi > 0)) continue;
        if (isTravelDay(dateOf(o), windows)) continue;
        const prev = o - 1 === vacatingOffset ? null : dayAt(o - 1);
        const next = o + 1 === vacatingOffset ? null : dayAt(o + 1);
        if (isHardDay(prev) || isHardDay(next)) continue;
        // Simulate the swap · reject any seat that adds a §9 gap violation.
        swapDayContents(vacating, d);
        const after = gapViolationCount(week.days);
        swapDayContents(vacating, d);
        if (after > before) continue;
        const dist = Math.abs(o - vacatingOffset);
        // Nearest seat keeps the week's rhythm · ties resolve later-in-week,
        // deterministically.
        if (dist < bestDist || (dist === bestDist && best != null && o > best)) {
          best = o;
          bestDist = dist;
        }
      }
      return best;
    };

    // Pass 1 · the long run. Runs before quality so a week where both need a
    // seat gives the only seat to the long run (the week's anchor session).
    for (const o of weekOffsets) {
      const d = dayAt(o);
      if (!d || !isTravelDay(dateOf(o), windows)) continue;
      if (d.type === 'race') continue;
      if (!(d.isLong || d.type === 'long')) continue;
      const seat = cleanSeat(o);
      if (seat != null) {
        const s = dayAt(seat)!;
        swapDayContents(d, s);
        // The vacated travel day is now the easy day · say why it is here.
        d.notes = TRAVEL_EASY_NOTE;
        changes.push({ date: dateOf(o), action: 'long_moved', toDate: dateOf(seat) });
      } else {
        // No seat · the day runs easy at the week's own easy size. The lost
        // long miles are gone, not redistributed.
        const easySizes = week.days
          .filter((x) => x.type === 'easy' && !x.isLong && !x.isQuality && x.distanceMi > 0)
          .map((x) => x.distanceMi);
        const cap = easySizes.length > 0
          ? Math.max(...easySizes)
          : TRAVEL_LONG_EASY_FALLBACK_MI;
        // LONGRUN-TRACE-1 · a race-pace finish this long run carried leaves a
        // mark when the demotion deletes it, exactly like the other four
        // passes that can shorten a segment after authoring. The sub_label is
        // the segment's carrier between compose and persist.
        const seg = String(d.subLabel ?? '').match(/(\d+(?:\.\d+)?)\s*mi\s*@\s*(HM|MP|M|T)\b/i);
        if (seg) {
          d.racePaceChange = {
            fromMi: Number(seg[1]),
            toMi: 0,
            reason: 'travel window · long run eased to easy',
            kind: d.longRunKind ?? null,
          };
        }
        demoteToEasy(d);
        d.distanceMi = Math.min(d.distanceMi, cap);
        d.notes = TRAVEL_LONG_EASED_NOTE;
        changes.push({ date: dateOf(o), action: 'long_eased' });
      }
    }

    // Pass 2 · quality sessions.
    for (const o of weekOffsets) {
      const d = dayAt(o);
      if (!d || !isTravelDay(dateOf(o), windows)) continue;
      if (d.type === 'race') continue;
      if (!d.isQuality || d.isLong) continue;
      const seat = cleanSeat(o);
      if (seat != null) {
        const s = dayAt(seat)!;
        swapDayContents(d, s);
        d.notes = TRAVEL_EASY_NOTE;
        changes.push({ date: dateOf(o), action: 'quality_moved', toDate: dateOf(seat) });
      } else {
        // No seat · the session runs easy at its authored distance. The
        // miles stay (consistency is the runner's stated goal); only the
        // intensity comes off, per Research/12 "avoid hard efforts".
        demoteToEasy(d);
        d.notes = TRAVEL_QUALITY_EASED_NOTE;
        changes.push({ date: dateOf(o), action: 'quality_eased' });
      }
    }

    // Pass 3 · plain easy days in the window keep their dose, gain the note.
    for (const o of weekOffsets) {
      const d = dayAt(o);
      if (!d || !isTravelDay(dateOf(o), windows)) continue;
      if (d.type !== 'easy' || d.isQuality || d.isLong || !(d.distanceMi > 0)) continue;
      if (d.notes === TRAVEL_EASY_NOTE || d.notes === TRAVEL_QUALITY_EASED_NOTE
        || d.notes === TRAVEL_LONG_EASED_NOTE) continue;
      // A day already carrying race context (a mini-taper day around an
      // embedded tune-up) keeps it · the travel fact is prepended, never
      // allowed to erase the race instruction.
      d.notes = /mini-taper|race/i.test(d.notes ?? '')
        ? `Travel day. ${d.notes}`
        : TRAVEL_EASY_NOTE;
      changes.push({ date: dateOf(o), action: 'easy_noted' });
    }
  }

  return changes;
}
