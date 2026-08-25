/**
 * lib/postrun-siege/invariants.ts · WHAT A POST-RUN SURFACE MAY SAY.
 *
 * Each function below takes what a surface produced and the row it produced it
 * from, and returns the list of things it said that the row does not support.
 * Empty means the surface was honest — either it told the truth or it refused.
 *
 * They are separate from the test file on purpose: `_controls.test.ts` feeds
 * them FORGED output carrying a planted fabrication, and a checker that cannot
 * catch a planted lie cannot be trusted to catch a real one.
 */

import { FORBIDDEN_IN_PROSE } from './shapes';
import type { ZoneTable } from '@/lib/training/zones';

/** A violation, in words a reader can act on. */
export type Violation = string;

/* ══════════════════════════════════════════════════════════════════════════
 * PROSE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A template literal writes `null` down. `Easy ${miNum(mi)} mi` printed "Easy
 * null mi" on any row whose distance the reader refused, which is the app
 * failing in front of the runner on the screen he opens after every run.
 */
export function checkNoDebugTokens(lines: readonly string[]): Violation[] {
  const out: Violation[] = [];
  for (const line of lines) {
    for (const bad of FORBIDDEN_IN_PROSE) {
      // Word-bounded, so a shoe called "Nullify" or a pace of 9:00 is safe.
      // Escaped: "[object Object]" is a character class if it is not.
      const esc = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^A-Za-z0-9_])${esc}([^A-Za-z0-9_]|$)`).test(line)) {
        out.push(`prose printed the token "${bad}": ${JSON.stringify(line)}`);
      }
    }
  }
  return out;
}

/**
 * Coach voice, from CLAUDE.md: short, direct, no hype, no exclamation marks,
 * no emoji, no em dashes, never scold.
 */
export function checkCoachVoice(lines: readonly string[]): Violation[] {
  const out: Violation[] = [];
  for (const line of lines) {
    if (line.includes('!')) out.push(`exclamation mark: ${JSON.stringify(line)}`);
    if (/[—–]/.test(line)) out.push(`em or en dash: ${JSON.stringify(line)}`);
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line)) {
      out.push(`emoji: ${JSON.stringify(line)}`);
    }
  }
  return out;
}

/**
 * NO SURFACE MAY CLAIM MORE DISTANCE THAN THE ROW CARRIES.
 *
 * The defect this was written for: a 20-mile long run with a prescribed
 * 6-mile marathon-pace finish, abandoned at mile 3, printed
 *
 *     Long run done · 0mi easy + 6mi @ MP 6:40 · avg HR 150.
 *
 * Every field in that sentence is real and the sum is fiction. The prescribed
 * finish leg was never checked against what was actually run.
 *
 * `actualMi` null means the row carries no distance, in which case a surface
 * may not state one at all.
 */
export function checkNoDistanceInflation(
  lines: readonly string[],
  actualMi: number | null,
): Violation[] {
  const out: Violation[] = [];
  // `8:00/mi` and `12s/mi` must not match: a slash or a letter sits where the
  // separator would be, and `\s*` does not cross either.
  const re = /(\d+(?:\.\d+)?)\s*mi\b/g;
  for (const line of lines) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const claimed = Number(m[1]);
      if (actualMi == null) {
        out.push(`stated ${claimed} mi on a row carrying no distance: ${JSON.stringify(line)}`);
        continue;
      }
      // Half a mile of slack: the copy rounds legs to whole miles, so a
      // 6.4-mile finish on a 6.4-mile run prints "6mi" and a 5.6-mile one
      // prints "6mi" too. Anything past that is not rounding.
      if (claimed > actualMi + 0.5) {
        out.push(
          `claimed ${claimed} mi on a run of ${actualMi.toFixed(2)} mi: ${JSON.stringify(line)}`);
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ARITHMETIC
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The three headline numbers multiply out.
 *
 * Distance, time and pace are not independent, and the whole reason
 * `lib/runs/run-facts.ts` exists is that three surfaces once printed
 * `11.0 mi · 1:28:18 · 3:37/mi` off one row.
 */
export function checkTripleMultipliesOut(f: {
  distanceMi: number | null;
  timeSec: number | null;
  paceSecPerMi: number | null;
}): Violation[] {
  if (f.distanceMi == null || f.timeSec == null || f.paceSecPerMi == null) return [];
  const implied = f.paceSecPerMi * f.distanceMi;
  // One second of slack for float noise. This is exact arithmetic, not a band.
  if (Math.abs(implied - f.timeSec) > 1) {
    return [`${f.distanceMi} mi at ${f.paceSecPerMi} s/mi is ${implied.toFixed(0)}s, ` +
            `but the clock says ${f.timeSec}s`];
  }
  return [];
}

/**
 * A distribution distributes. Five shares are either absent or they sum to
 * exactly 100 — never 99, which leaves a gap at the end of a bar the renderer
 * fills straight from the percentage, and never five zeros, which is the
 * absence of a distribution wearing one's shape.
 */
export function checkZoneShares(
  z: { z1: number; z2: number; z3: number; z4: number; z5: number } | null,
): Violation[] {
  if (z == null) return [];
  const parts = [z.z1, z.z2, z.z3, z.z4, z.z5];
  const out: Violation[] = [];
  for (const p of parts) {
    if (!Number.isInteger(p) || p < 0) out.push(`zone share ${p} is not a whole non-negative percentage`);
  }
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== 100) out.push(`zone shares sum to ${sum}, not 100`);
  return out;
}

/**
 * Every heart rate belongs to exactly one band.
 *
 * The bands used to compute each floor and each ceiling from two independent
 * roundings, so at LTHR 162 they published Z2 138-144 beside Z3 146-152: 138
 * was in two zones and 145 was in none.
 */
export function checkZoneTableTiles(t: ZoneTable): Violation[] {
  const out: Violation[] = [];
  const z = t.zones;
  for (let i = 1; i < z.length; i++) {
    if (z[i].lower !== z[i - 1].upper + 1) {
      out.push(`${z[i - 1].shortLabel} ends at ${z[i - 1].upper} and ${z[i].shortLabel} ` +
               `starts at ${z[i].lower} · ${z[i].lower > z[i - 1].upper + 1 ? 'gap' : 'overlap'}`);
    }
  }
  for (const band of z) {
    if (band.upper < band.lower) out.push(`${band.shortLabel} runs ${band.lower}-${band.upper}`);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROVENANCE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rule one, on the climb figure. A reading may be carried without being
 * presented as measured, but a figure marked measured has to come from an
 * instrument that measures.
 */
export function checkElevationReading(
  r: { ft: number; source: string; measured: boolean } | null,
  trustedMeasuredSources: readonly string[],
): Violation[] {
  if (r == null) return [];
  const out: Violation[] = [];
  if (r.ft < 0) out.push(`climb of ${r.ft} ft · a gain is not negative`);
  if (!Number.isFinite(r.ft)) out.push(`climb of ${r.ft} ft is not a number`);
  if (r.measured && !trustedMeasuredSources.includes(r.source)) {
    out.push(`a "${r.source}" figure is presented as measured`);
  }
  return out;
}
