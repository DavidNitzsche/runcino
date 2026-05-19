/**
 * Apple Health VO2max — WELLNESS signal isolation layer.
 *
 * THE PRINCIPLE (locked):
 *   "Physiological estimates from consumer devices are wellness
 *    signals. Race performance is training signal. The app should
 *    never blur that line."
 *
 * Apple Watch systematically over-estimates VO2max by 8-15 points
 * for trained runners with low resting heart rates. A typical fit
 * user might show VDOT ~47 from races but Apple VO2max 61.7 — a
 * 14-point gap that is the DEFAULT state, not a finding.
 *
 * USE Apple VO2max for:
 *   ✓ Cold-start fallback: when a user has ZERO race history, the
 *     value minus ~10 is a rough starting VDOT (better than the
 *     level-based defaults of 35/45/55/65).
 *   ✓ Trend display: chart the value over time as informational.
 *   ✓ Extreme divergence (>20 points): flag possible data-quality
 *     issue — NEVER training implications.
 *
 * DO NOT use Apple VO2max for:
 *   ✗ Driving any pace prescription. Ever.
 *   ✗ Cross-checking VDOT under normal conditions.
 *   ✗ "Confidence boosting" when numbers agree.
 *   ✗ Aggregating into the VDOT calculation in any way.
 *
 * Naming note: the exported type/object is `Vo2MaxApple` (not
 * `Vo2Max`) so consumers can't accidentally treat it as a peer to
 * VDOT. The "Apple" suffix is deliberate.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/** Apple Health VO2max snapshot for the resolver/display layer. Note
 *  the deliberate `Apple` suffix — this is a CONSUMER-DEVICE estimate,
 *  not a peer to VDOT. */
export interface Vo2MaxApple {
  /** Apple Health VO2max value (25-90), or null when none has been
   *  entered. */
  value: number | null;
  /** Where the value came from. `'manual'` today; `'healthkit'` once
   *  the M2 integration lands. */
  source: 'manual' | 'none';
  /** ISO timestamp the value was last written. Drives the trend
   *  display. */
  updatedAt: string | null;
}

/** Build a Vo2MaxApple snapshot from raw DB values. */
export function buildVo2MaxApple(
  value: number | null,
  updatedAt: string | Date | null,
): Vo2MaxApple {
  if (value == null) {
    return { value: null, source: 'none', updatedAt: null };
  }
  const iso = updatedAt == null
    ? null
    : updatedAt instanceof Date
      ? updatedAt.toISOString()
      : updatedAt;
  return { value, source: 'manual', updatedAt: iso };
}

// ─────────────────────────────────────────────────────────────────────
// Cold-start VDOT fallback — Tier 2 of the resolver hierarchy.
//
// Tier 1 (preferred): aggregate VDOT from race history.
// Tier 2 (this):      when NO race exists AND Apple VO2max is set,
//                     subtract the empirically-observed over-estimate
//                     (8-15 points typical for trained runners with
//                     low RHR — we use 10 as a conservative middle).
// Tier 3 (last):      level-based default (35 / 45 / 55 / 65).
//
// Documented over-estimate range: 8-15 points. We pick 10 because:
//   - The cold-start path runs ONLY when there's no race data, so the
//     user is by definition early in the app's life — anchoring on
//     the low end of the over-estimate range avoids dropping their
//     prescribed paces below what the runner can actually hold.
//   - Once a race is logged, this fallback is bypassed entirely.
// ─────────────────────────────────────────────────────────────────────

/** Cold-start VDOT estimate from an Apple VO2max value. Returns null
 *  when there is no Apple VO2max value to use.
 *
 *  Math: max(20, value - 10). The 20 floor prevents an absurd Apple
 *  value (e.g. 25) from collapsing into a meaningless VDOT.
 *
 *  IMPORTANT: This is the ONLY path through which Apple VO2max
 *  influences VDOT. Once race history exists, the resolver MUST
 *  prefer race-derived VDOT and ignore this estimate entirely. */
export function coldStartVdotFromAppleVo2Max(apple: Vo2MaxApple): number | null {
  if (apple.value == null) return null;
  return Math.max(20, apple.value - 10);
}

/** Resolver tiers — for display + diagnostics. */
export type ResolvedVdotTier = 'race' | 'apple-cold-start' | 'level-default' | 'none';

export interface ResolvedVdot {
  /** Resolved VDOT (rounded to 1 decimal). null means no signal at all
   *  (no race, no Apple value, no level). */
  value: number | null;
  /** Which tier produced the value. */
  tier: ResolvedVdotTier;
}

/** Resolve a VDOT for cold-start scenarios using a tiered fallback.
 *  Caller passes the race-derived VDOT (from vdotSnapshot) and the
 *  Apple snapshot; this function applies the priority:
 *
 *    Tier 1 (race):           use raceDerivedVdot if present
 *    Tier 2 (apple-cold):     else value-10 floored at 20, if Apple set
 *    Tier 3 (level-default):  else 35 / 45 / 55 / 65 for level
 *    Tier 4 (none):           null
 *
 *  This function exists ONLY for cold-start / display contexts where
 *  showing *something* is better than nothing. It MUST NOT be called
 *  by the pace prescription pipeline — vdotSnapshot stays the only
 *  pace-driving source. See lib/vdot.ts for the pace pipeline. */
export function resolveVdotWithColdStart(
  raceDerivedVdot: number | null,
  apple: Vo2MaxApple,
  level: 'beginner' | 'intermediate' | 'advanced' | null,
): ResolvedVdot {
  if (raceDerivedVdot != null) {
    return { value: Math.round(raceDerivedVdot * 10) / 10, tier: 'race' };
  }
  const cold = coldStartVdotFromAppleVo2Max(apple);
  if (cold != null) {
    return { value: Math.round(cold * 10) / 10, tier: 'apple-cold-start' };
  }
  if (level != null) {
    const byLevel = { beginner: 35, intermediate: 45, advanced: 55 } as const;
    return { value: byLevel[level], tier: 'level-default' };
  }
  return { value: null, tier: 'none' };
}

// ─────────────────────────────────────────────────────────────────────
// Data-quality check — fires ONLY at >20 point gap.
//
// 8-15 points is the typical Apple over-estimation range for trained
// runners with low RHR (user's own example: VDOT 47 vs Apple 61.7, a
// 14-point gap that is NORMAL not exceptional). The original spec's
// ±3 agreement threshold would have produced a false positive on
// every fit user.
//
// At >20 points, the most likely explanation is a data-quality issue
// (HealthKit pulling from an unrelated workout app, a stale value,
// etc.). The check NEVER suggests a training implication.
// ─────────────────────────────────────────────────────────────────────

export interface Vo2MaxDataQualityFlag {
  /** Gap in VDOT points (always positive). */
  gapPoints: number;
  /** The Apple value triggering the flag. */
  appleValue: number;
  /** The race-derived VDOT being compared against. */
  vdotValue: number;
  /** User-facing message — explicitly framed as data-quality, never
   *  training. */
  message: string;
}

/** Return a flag ONLY when the Apple VO2max and race-derived VDOT
 *  differ by more than 20 points. Below that threshold, returns null
 *  (the 8-15 point gap is normal for trained runners and should NEVER
 *  be surfaced as a finding).
 *
 *  Caller is responsible for ensuring both values are present — this
 *  function deliberately doesn't massage nulls so the call site reads
 *  as "I have both, is the gap pathological?". */
export function checkVo2MaxDataQuality(
  apple: Vo2MaxApple,
  vdot: number | null,
): Vo2MaxDataQualityFlag | null {
  if (apple.value == null || vdot == null) return null;
  const gap = Math.abs(apple.value - vdot);
  if (gap <= 20) return null;
  return {
    gapPoints: Math.round(gap),
    appleValue: apple.value,
    vdotValue: Math.round(vdot * 10) / 10,
    message:
      `Apple VO2max ${apple.value} vs VDOT-implied ${Math.round(vdot)} is a ` +
      `${Math.round(gap)}-point gap. Apple Watch typically over-estimates ` +
      `VO2max by 8-15 points for trained runners — gaps over 20 usually ` +
      `mean a data-source issue. Verify your Apple Health VO2max isn't ` +
      `coming from an unrelated workout app.`,
  };
}
