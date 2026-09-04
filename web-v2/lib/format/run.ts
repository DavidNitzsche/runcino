/**
 * lib/format/run.ts · one place that decides HOW a run's numbers are written.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PAIR THIS COMPLETES
 *
 * `lib/runs/coherence.ts` is the single decision point for WHICH number a run
 * prints — which clock, which pace, which distance, and when to refuse. This
 * is the single decision point for HOW that number is written down. They are
 * different questions and both were answered per-file until 2026-08-24.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE INCIDENT
 *
 * One request. One float. Two strings.
 *
 *     app/api/v5/today/route.ts:587   const distanceMi = facts.distanceMi
 *       → :685  into composeV5Today  → lib/faff/v5-today.ts fmtMi   → "3.1 mi"
 *       → :667  into deriveRecap     → lib/coach/run-recap.ts       → "3.0 mi"
 *
 * The poster and the recap sit on the same screen, built by the same handler
 * from the same variable, and they disagreed about a run's distance. Neither
 * was reading a different number; they were writing the same number down two
 * ways:
 *
 *     Math.round(3.05 * 10) / 10   →  3.1        (the poster, the log, the
 *                                                 briefing hero, block, brief)
 *     (3.05).toFixed(1)            →  "3.0"      (the recap, the fact reciter,
 *                                                 health state, calibration)
 *
 * Both are ordinary, both look obviously correct, and they differ because
 * 3.05 is not 3.05: the nearest double is 3.0499999999999998. `toFixed`
 * rounds that exact binary value and gets 3.0. `x * 10` rounds ONCE on the
 * multiply — 3.0499999999999998 × 10 is exactly 30.5 in IEEE-754 — and then
 * `Math.round` takes 30.5 up to 31. Two roundings, opposite answers.
 *
 * It is not rare. Every distance whose hundredths digit is 5 and whose
 * tenths digit is even hits it: 0.15, 1.15, 2.05, 3.05, 6.05, 7.15.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS PICKS, AND WHY
 *
 * Round HALF-UP on the number's own decimal value.
 *
 * `runs.data.distanceMi` arrives as a Postgres numeric — a DECIMAL quantity
 * that became a double on the way in. `11.01`, `3.05` and `0.84` are what the
 * recorder said, and the binary residue underneath them is an artefact of the
 * transport, not a measurement. Rounding the residue (what `toFixed` does) is
 * rounding the artefact. So the residue is normalised away first, and then
 * the half-way case goes up, which is what a reader expects of a number that
 * looks like 3.05.
 *
 * `Math.round(x * 10) / 10` gets the same answer on every value tested here,
 * but only by luck: it happens to round twice in the same direction. It is
 * not written that way below because a rule that is right by accident cannot
 * be reasoned about the next time someone changes it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A SECOND DEFECT, FIXED IN PASSING
 *
 * Most of the pace and clock formatters in the repo are shaped like
 *
 *     `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
 *
 * which splits the value BEFORE rounding it. At 419.6 s/mi the minutes floor
 * to 6 and the seconds round to 60, and the surface prints `6:60/mi`. The
 * same shape in a clock prints `1:28:60`. `lib/coach/run-recap.ts` had
 * already found and documented this locally; every other copy still has it.
 *
 * Everything below rounds to whole seconds FIRST and then splits, so the
 * carry happens where it belongs.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POLICED BY `_format_lint.test.ts`
 *
 * Modelled on `lib/conservation/_reader_lint.test.ts`, including the check
 * that these functions have PRODUCTION callers — the defect that started this
 * whole line of work was a correct function with zero call sites and a
 * passing unit test.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE ROUNDING PRIMITIVE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Strip the binary residue from a decimal quantity that made the trip through
 * a double.
 *
 * 15 significant digits is the width at which every double that came from a
 * short decimal round-trips back to that decimal, and it is narrow enough to
 * erase the residue: 3.0499999999999998 becomes 3.05. Nothing a run carries
 * needs more precision than this — the widest is a distance in the hundreds
 * of miles measured to five decimals.
 */
function decimal(v: number): number {
  return Number(v.toPrecision(15));
}

/**
 * Round to `places` decimals, half-way cases going UP, on the decimal value
 * rather than on its binary approximation.
 *
 * Exported so a caller that needs the NUMBER rather than the string rounds it
 * the same way the string would be rounded. A surface that rounds its own
 * copy is how the poster and the recap came apart.
 */
export function roundTo(v: number, places = 1): number {
  const f = 10 ** places;
  return decimal(Math.round(decimal(v) * f) / f);
}

/**
 * CONTRACT-1 (2026-09-03) · the ONE rule for turning `plan_workouts.
 * distance_mi` (or any equivalent raw value) into the total distance a
 * runner reads for a workout. Today's dose (`lib/training/spec-card.ts`'s
 * `cardFromSpec`) and the phone/watch payload (`lib/watch/build-workout.ts`)
 * both call this — not two independently-written expressions that happen to
 * agree today. Traced 2026-09-03 after a report showed 6.0 mi on one surface
 * and 6.5 on another for what was assumed to be the same workout: the two
 * numbers turned out to come from different databases (production vs. an
 * isolated QA seed), not a real code defect — but the two call sites were
 * still applying DIFFERENT transforms (`roundTo(_, 1)` vs. a raw `Number()`)
 * to the same column, which is exactly the kind of hair's-width divergence
 * that becomes a real bug the next time either side changes alone (Rule 9).
 * "The day's total is the plan's own figure, not a re-summed one" — this
 * never sums phase distances, it only normalizes the one stored value.
 */
export function canonicalWorkoutDistanceMi(raw: number | string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? roundTo(n, 1) : 0;
}

/** A finite, positive, formattable number — or null. Zero is not a distance,
 *  a pace or a duration, and every formatter here refuses it as such. */
function usable(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/** Seconds → `m:ss`, rounded to whole seconds FIRST so 59.6 carries. */
function minSec(totalSec: number): string {
  const t = Math.round(totalSec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · DISTANCE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A run's distance as a bare string: `"6"`, `"3.1"`, `"11"`.
 *
 * A whole number loses its `.0`. That is the poster's long-standing
 * behaviour and it is the one the runner sees most, so the surfaces that
 * printed `"6.0 mi"` move to `"6 mi"` rather than the other way round.
 */
export function miNum(mi: number | null | undefined): string | null {
  if (!usable(mi)) return null;
  const r = roundTo(mi, 1);
  // A RUN THAT HAPPENED MAY NOT PRINT AS ZERO (2026-08-24).
  //
  // One decimal turns every distance under 0.05 mi into the string "0", and
  // "0" is the one value this formatter is documented to refuse — `usable`
  // rejects a zero because zero is not a distance. So a mis-started watch
  // logging 0.01 mi, or a treadmill entry of 0.03, printed a number the same
  // module says cannot be a distance, and the recap read "Easy 0 mi at
  // 5:00/mi" — a pace across nothing.
  //
  // Below the point where one decimal can carry the value, two decimals do.
  // Nothing else changes: 0.05 and up round exactly as before. Below 0.005 mi
  // — eight metres — two decimals cannot carry it either, and there is no
  // distance here worth writing down; that refuses like any other absent one.
  if (r === 0) {
    const r2 = roundTo(mi, 2);
    return r2 === 0 ? null : r2.toFixed(2);
  }
  return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
}

/** A run's distance with its unit: `"6 mi"`, `"3.1 mi"`. Null when absent. */
export function fmtMi(mi: number | null | undefined): string | null {
  const n = miNum(mi);
  return n == null ? null : `${n} mi`;
}

/**
 * Distance to two decimals, for the places that must not round: an audit
 * line, a refusal that quotes what a number actually was, a split total.
 */
export function fmtMi2(mi: number | null | undefined): string | null {
  return usable(mi) ? `${roundTo(mi, 2).toFixed(2)} mi` : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · PACE
 * ═══════════════════════════════════════════════════════════════════════ */

/** Seconds per mile as `"8:01"`, with no unit. For a table column whose
 *  header already says `/mi`. */
export function fmtPace(sPerMi: number | null | undefined): string | null {
  return usable(sPerMi) ? minSec(sPerMi) : null;
}

/** Seconds per mile as `"8:01/mi"`. For prose and for a standalone stat. */
export function fmtPaceSlash(sPerMi: number | null | undefined): string | null {
  const p = fmtPace(sPerMi);
  return p == null ? null : `${p}/mi`;
}

/** A pace BAND as `"7:45–8:10/mi"`. Falls back to the single end that
 *  exists, so a half-known band still prints something true. */
export function fmtPaceBand(
  loSPerMi: number | null | undefined,
  hiSPerMi: number | null | undefined,
): string | null {
  const lo = fmtPace(loSPerMi);
  const hi = fmtPace(hiSPerMi);
  if (lo && hi) return lo === hi ? `${lo}/mi` : `${lo}–${hi}/mi`;
  return lo ? `${lo}/mi` : hi ? `${hi}/mi` : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · DURATION
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A clock: `"39:49"` under an hour, `"1:28:18"` over it.
 *
 * Rounds to whole seconds before splitting, so a duration of 3599.7 s prints
 * `1:00:00` and not `59:60`.
 */
export function fmtClock(sec: number | null | undefined): string | null {
  if (!usable(sec)) return null;
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  if (h === 0) return minSec(t);
  const m = Math.floor((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * A finish time, always `h:mm:ss` even under an hour.
 *
 * A race result is compared against other race results, and a column where
 * some rows read `58:12` and others `1:02:44` does not sort by eye. This is
 * the shape `races.meta.finishTime` stores and the shape `parseHMS` expects
 * back, so it is also the shape an editor must write.
 */
export function fmtFinish(sec: number | null | undefined): string | null {
  if (!usable(sec)) return null;
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * A whole-minute duration in CASUAL register: `"54 min"` under an hour,
 * `"1h 56m"` at or above it.
 *
 * `fmtClock` above is the CLOCK register — `1:56:00` — correct for a time
 * that will be compared second-by-second (a finish time, a split). This is
 * for an ESTIMATE already rounded to the minute before it gets here (Today's
 * "about ␣ min" kicker, sessionMinutes' own rounding), where a clock's
 * trailing `:00` asserts a precision nobody measured and the minute count
 * alone reads as one long, un-scannable number past about 90.
 *
 * David, 2026-08-25, on a 116-minute long run reading "about 116 min":
 * "lets also do time in hours if its over 60 min."
 */
export function fmtMinutesCasual(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  const whole = Math.round(min);
  if (whole < 60) return `${whole} min`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * A signed difference between two clocks: `"+1:12"`, `"−0:38"`.
 *
 * A true minus sign, not a hyphen: the hyphen reads as a dash in the middle
 * of a sentence and these appear in prose.
 */
export function fmtDelta(deltaSec: number | null | undefined): string | null {
  if (deltaSec == null || !Number.isFinite(deltaSec)) return null;
  const t = Math.round(Math.abs(deltaSec));
  if (t === 0) return 'even';
  return `${deltaSec > 0 ? '+' : '−'}${minSec(t)}`;
}
