/**
 * wire-format · THE ONE PLACE A NUMBER BECOMES A STRING FOR THE PHONE.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * The server sends seconds; the phone renders a string. Both sides format, and
 * until this module there was no canonical implementation on either — roughly
 * forty-eight pace and duration formatters across the repo, each written from
 * scratch at its call site, each subtly free to disagree with `FaffFmt` in
 * `native-v2/.../DesignV5/ValuesV5.swift`.
 *
 * They did disagree. Nineteen of them shared one bug:
 *
 *     const m = Math.floor(sPerMi / 60);
 *     const s = Math.round(sPerMi % 60);      // ← 479.7 gives 59.7 → 60
 *
 * Rounding the REMAINDER can carry it to 60, which the minute never learns
 * about. A pace of 479.7 s/mi printed `7:60/mi`; an elapsed time of 3599.7 s
 * printed `59:60`. The phone, rounding the TOTAL first, printed `8:00` and
 * `1:00:00` for the same values. Two surfaces, one run, two different numbers,
 * and nothing anywhere would have said so.
 *
 * Fractional seconds are not hypothetical here: paces are derived by division
 * (distance over duration), HealthKit and the watch average heart rates and
 * cadences, and node-pg hands numerics back as floats.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONTRACT WITH SWIFT
 *
 * Every function below is byte-identical to its `FaffFmt` counterpart, and
 * `lib/wire-format/_format_vectors.test.ts` generates the vector table that
 * `native-v2/Faff/FaffTests/ClientSweep/FormatVectors.generated.swift` holds,
 * so the two can never drift again without a test going red on both sides.
 *
 * Round the TOTAL, then split it. Never round a part.
 */

/** `7:42` from seconds per mile. Null for anything unreadable. */
export function paceMinSec(sPerMi: number | null | undefined): string | null {
  if (sPerMi == null || !Number.isFinite(sPerMi) || sPerMi <= 0) return null;
  const total = Math.round(sPerMi);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `7:42/mi`. */
export function pacePerMi(sPerMi: number | null | undefined): string | null {
  const p = paceMinSec(sPerMi);
  return p == null ? null : `${p}/mi`;
}

/**
 * `1:41:53` past an hour, `41:53` below it. Elapsed time and finish time.
 *
 * Zero is a READING, not an absence — a phase that spent no seconds in band
 * is a real answer and must not come back null. Matches `FaffFmt.clock`,
 * which guards `>= 0`.
 */
export function clock(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** `1:41:53` always, hours included at zero. A goal or a projection. */
export function raceTime(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  const t = Math.round(sec);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** `6.2` · one decimal, trailing `.0` kept off whole numbers. */
export function miles(mi: number | null | undefined): string | null {
  if (mi == null || !Number.isFinite(mi) || mi < 0) return null;
  const r = Math.round(mi * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** `6.2 mi`. */
export function milesUnit(mi: number | null | undefined): string | null {
  const m = miles(mi);
  return m == null ? null : `${m} mi`;
}

/**
 * `+24 s/mi` · a signed per-zone pace move. Slower is positive, which is the
 * direction the engine reports, and the sign is always drawn.
 *
 * The minus is U+2212, not a hyphen, matching `FaffFmt.paceDeltaSec`.
 *
 * ROUNDS AWAY FROM ZERO, SYMMETRICALLY, AND NOT WITH `Math.round`.
 *
 * This is the one formatter here that takes a negative, and it is where the
 * two languages disagreed. `Math.round` breaks ties toward POSITIVE INFINITY,
 * so `Math.round(-24.5)` is `-24`; Swift's `.rounded()` breaks them away from
 * zero, so the phone said `−25 s/mi` for the same value. The cross-language
 * harness caught it on its first run.
 *
 * Away-from-zero is the side that was fixed toward, because it is the only one
 * that treats a gain and a loss of the same size the same way: `Math.round`
 * would print +24.5 as `+25` and −24.5 as `−24`, quietly flattering every
 * slowdown by half a second.
 */
export function paceDeltaSec(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  const v = Math.sign(sec) * Math.round(Math.abs(sec));
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v)} s/mi`;
}

/** `152` bpm, or null when there is nothing to read. */
export function bpm(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return String(Math.round(v));
}
