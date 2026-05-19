/**
 * Max HR validation module.
 *
 * First instance of the ADAPTIVE PATTERN (see lib/adaptive-pattern.ts).
 * MUST conform to the philosophy: evidence-weighted, context-aware,
 * conservative on the upside, trend-based, transparent.
 *
 * Cross-references three independent signals against the stored max HR:
 *
 *   1. PEAK SCAN — top HR readings across 18 months, filtered through
 *      the spike rules below. A "validated peak" that exceeds stored
 *      max means stored is certainly wrong.
 *
 *   2. RACE-ANCHORED LTHR — average HR sustained over an HM or 10K
 *      is a strong proxy for LTHR. Back-calculate max from the
 *      research-anchored ratio bands. A race-derived estimate that's
 *      meaningfully higher than stored means stored is probably wrong.
 *
 *   3. CURRENT-MAX SANITY — if HM avg HR / stored max > 92%, the
 *      runner sustained an implausible % of true max for 13.1 miles.
 *      LTHR caps at ~92% for trained runners and ~95% for elites.
 *
 * Returns a structured verdict. Never mutates the stored max — that
 * requires explicit user confirmation per spec.
 *
 * ── SPIKE FILTER RULES (R1–R4) ───────────────────────────────────
 * The peak scan rejects readings that look like sensor artifacts.
 * Strava exposes per-activity maxHr (the single highest reading) and
 * avgHr; we don't fetch per-second streams yet, so some checks can
 * only be partially enforced. The rules:
 *
 *   R1 — VALIDATED-EFFORT CONTEXT (enforced)
 *     The peak must come from an activity classified as a real hard
 *     effort: workoutType 1 (race) or 3 (workout), OR name matches
 *     /race|interval|repeat|track|tempo|threshold|hill/i. Easy-run
 *     spikes are dropped because the wrist sensor commonly correlates
 *     with cadence + GPS jitter on relaxed runs.
 *
 *   R2 — PLAUSIBLE RANGE (enforced)
 *     Peak must be in [140, 220] bpm. Outside that range = sensor
 *     failure. (140 is below any race max for a trained runner; 220
 *     is the theoretical ceiling.)
 *
 *   R3 — SUSTAIN ≥5 SECONDS (deferred to streams)
 *     A real peak holds for several heartbeats. Single-sample spikes
 *     are artifacts. Requires per-second HR stream data — TODO once
 *     /activities/{id}/streams is wired into the cache.
 *
 *   R4 — WITHIN 15 BPM OF PRECEDING 30s ROLLING AVG (deferred to streams)
 *     A real peak ramps into existence. A jump of >15 bpm in seconds
 *     is a sensor glitch. Also stream-dependent — TODO.
 *
 * Until R3+R4 land, we apply a coarser heuristic from summary data:
 * if max_hr - avg_hr > 50 bpm AND the activity is NOT validated-effort,
 * treat the peak as suspect (drops obvious outliers).
 *
 * ── "SUGGESTED" MIDPOINT RULE ─────────────────────────────────────
 * For each race we compute [estimateLow, estimateHigh]. The single
 * recommended value the UI shows ("Suggested: 179 bpm") is the
 * arithmetic midpoint, then rounded to the nearest integer bpm:
 *
 *     suggested = round((estimateLow + estimateHigh) / 2)
 *
 * Midpoint chosen over a single-factor rule (e.g. avg/0.90) because
 * the LTHR ratio for any one runner is genuinely uncertain across
 * the 88-92% (HM) or 92-95% (10K) bands; midpoint avoids over-
 * committing to one end of the literature.
 *
 * ── DISMISSAL BEHAVIOR ────────────────────────────────────────────
 * If the user clicks "Keep current," the banner suppresses for 30
 * days OR until a new validated peak exceeds stored max by 3+ bpm,
 * whichever comes first. Dismissal stored in
 * users.max_hr_validation_dismissed_at — set on dismiss, cleared
 * when banner re-fires.
 */

import { query } from './db';

export interface MaxHrValidationVerdict {
  hasFinding: boolean;
  currentMaxHr: number | null;
  topPeaks: Array<{
    hr: number;
    name: string;
    date: string;
    distanceMi: number;
    workoutType: number | null;
    isValidatedEffort: boolean;
    avgHrInActivity: number | null;
  }>;
  raceEstimate: {
    sourceRaceName: string;
    sourceRaceDate: string;
    sourceDistanceMi: number;
    avgHrInRace: number;
    /** Low end of estimated max range (LTHR / 0.92 for HM, 0.95 for 10K). */
    estimateLow: number;
    /** High end (LTHR / 0.88 for HM, 0.92 for 10K). */
    estimateHigh: number;
    /** Midpoint — see "SUGGESTED MIDPOINT RULE" in module header. */
    estimateMid: number;
    /** The ratio band used ('HM' = 88-92%, '10K' = 92-95%). */
    ratioBand: 'HM' | '10K' | 'race';
  } | null;
  recommendation:
    | { kind: 'looks-correct'; reason: string; falsifier: string }
    | { kind: 'peak-exceeds-current'; peakHr: number; reason: string; falsifier: string }
    | { kind: 'race-suggests-higher'; suggested: number; reason: string; falsifier: string }
    | { kind: 'insufficient-data'; reason: string; falsifier: string };
  /** When true, the user dismissed this within the last 30 days AND
   *  no new evidence has accumulated. UI should hide the banner. */
  dismissed: boolean;
}

interface ActivityRow {
  id: string;
  data: {
    name?: string;
    maxHr?: number | null;
    avgHr?: number | null;
    date?: string;
    startLocal?: string;
    distanceMi?: number;
    movingTimeS?: number;
    workoutType?: number | null;
    canonicalLabel?: string;
    canonicalFinishS?: number;
    type?: string;
  };
}

/** R1: workoutType or name-pattern says "this was a hard effort." */
function isValidatedEffort(d: ActivityRow['data']): boolean {
  if (d.workoutType === 1 || d.workoutType === 3) return true;
  const name = (d.name || '').toLowerCase();
  return /race|interval|repeat|track|tempo|threshold|hill/.test(name);
}

/** Coarse spike heuristic from summary data (until R3+R4 ship via
 *  per-second streams). Rejects readings where the peak sits >50 bpm
 *  above the activity's avg HR on a NON-validated-effort run. The
 *  >50 bpm gap is the easy-run-spike fingerprint: relaxed avg, brief
 *  GPS-correlated jump to the runner's intervals ceiling. */
function passesSummaryHeuristic(d: ActivityRow['data']): boolean {
  const peak = Number(d.maxHr) || 0;
  const avg = Number(d.avgHr) || 0;
  if (peak === 0 || avg === 0) return true; // can't judge → trust
  if (isValidatedEffort(d)) return true;     // R1 lets it through
  return (peak - avg) <= 50;
}

async function pickAnchorRace(userId: string): Promise<{
  data: ActivityRow['data'];
  canonicalDistanceMi: number;
  ratioBand: 'HM' | '10K' | 'race';
} | null> {
  const yearAgo = new Date(Date.now() - 365 * 86_400_000)
    .toISOString().slice(0, 10);
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'avgHr')::NUMERIC BETWEEN 130 AND 185
        AND ((data->>'workoutType')::INTEGER = 1
             OR data->>'canonicalLabel' IS NOT NULL)
      ORDER BY (data->>'date') DESC
      LIMIT 50`,
    [userId, yearAgo],
  );
  // Prefer HM (tightest LTHR proxy), then 10K, then any other race.
  const hm = rows.find((r) => r.data.canonicalLabel === 'Half');
  if (hm) return { data: hm.data, canonicalDistanceMi: 13.109, ratioBand: 'HM' };
  const tenK = rows.find((r) => r.data.canonicalLabel === '10K');
  if (tenK) return { data: tenK.data, canonicalDistanceMi: 6.214, ratioBand: '10K' };
  const fiveK = rows.find((r) => r.data.canonicalLabel === '5K');
  if (fiveK) return { data: fiveK.data, canonicalDistanceMi: 3.107, ratioBand: '10K' }; // 5K uses 10K band approximation
  const race = rows.find((r) => r.data.workoutType === 1);
  if (race) return { data: race.data, canonicalDistanceMi: Number(race.data.distanceMi) || 13.109, ratioBand: 'race' };
  return null;
}

async function pickTopPeaks(userId: string): Promise<MaxHrValidationVerdict['topPeaks']> {
  const eighteenMonthsAgo = new Date(Date.now() - 540 * 86_400_000)
    .toISOString().slice(0, 10);
  // R2: plausible-range filter at the SQL layer
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'maxHr')::NUMERIC BETWEEN 140 AND 220
      ORDER BY (data->>'maxHr')::NUMERIC DESC
      LIMIT 80`,
    [userId, eighteenMonthsAgo],
  );
  // Apply summary heuristic spike filter
  const filtered = rows.filter((r) => passesSummaryHeuristic(r.data));
  // Top 5 with validated-effort priority
  const validated = filtered.filter((r) => isValidatedEffort(r.data));
  const others = filtered.filter((r) => !isValidatedEffort(r.data));
  const picks = [...validated.slice(0, 5), ...others.slice(0, 2)].slice(0, 5);
  return picks.map((r) => ({
    hr: Math.round(Number(r.data.maxHr) || 0),
    name: r.data.name || 'Run',
    date: r.data.date || (r.data.startLocal || '').slice(0, 10),
    distanceMi: Number(r.data.distanceMi) || 0,
    workoutType: r.data.workoutType ?? null,
    isValidatedEffort: isValidatedEffort(r.data),
    avgHrInActivity: r.data.avgHr ? Math.round(Number(r.data.avgHr)) : null,
  }));
}

/** Has the user dismissed the validation within the last 30 days,
 *  AND no new validated peak has exceeded stored max by 3+ bpm
 *  since then? When yes, UI hides the banner. */
async function checkDismissal(
  userId: string,
  currentMaxHr: number | null,
  topPeaks: MaxHrValidationVerdict['topPeaks'],
): Promise<boolean> {
  try {
    const rows = await query<{ dismissed_at: Date | null }>(
      `SELECT max_hr_validation_dismissed_at AS dismissed_at
         FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const at = rows[0]?.dismissed_at;
    if (!at) return false;
    const ageDays = (Date.now() - new Date(at).getTime()) / 86_400_000;
    // Hard expiry — 30 days
    if (ageDays > 30) return false;
    // New-evidence override: if a validated peak has appeared SINCE
    // the dismissal AND it exceeds current max by 3+ bpm, re-fire.
    if (currentMaxHr) {
      const dismissedAtISO = new Date(at).toISOString().slice(0, 10);
      const newEvidence = topPeaks.some(
        (p) => p.isValidatedEffort && p.hr >= currentMaxHr + 3 && p.date >= dismissedAtISO,
      );
      if (newEvidence) return false;
    }
    return true;
  } catch {
    return false; // schema not migrated yet — show banner
  }
}

export async function validateMaxHr(
  userId: string,
  currentMaxHr: number | null,
): Promise<MaxHrValidationVerdict> {
  const [topPeaks, anchor] = await Promise.all([
    pickTopPeaks(userId),
    pickAnchorRace(userId),
  ]);
  const dismissed = await checkDismissal(userId, currentMaxHr, topPeaks);

  // ── Race-anchored estimate ────────────────────────────────────
  // RATIO BANDS (locked from research):
  //   HM avg HR sits at 88–92% of true max for trained runners.
  //     → max = avgHr / 0.92 (LOW)  to  avgHr / 0.88 (HIGH)
  //   10K avg HR sits at 92–95% of true max.
  //     → max = avgHr / 0.95 (LOW)  to  avgHr / 0.92 (HIGH)
  //   "race" fallback (other distances) uses HM band — conservative.
  let raceEstimate: MaxHrValidationVerdict['raceEstimate'] = null;
  if (anchor && anchor.data.avgHr) {
    const avgHr = Math.round(Number(anchor.data.avgHr) || 0);
    let loFactor: number;
    let hiFactor: number;
    if (anchor.ratioBand === 'HM') {
      loFactor = 0.92; hiFactor = 0.88;
    } else if (anchor.ratioBand === '10K') {
      loFactor = 0.95; hiFactor = 0.92;
    } else {
      loFactor = 0.92; hiFactor = 0.88; // conservative HM band
    }
    const estimateLow = Math.round(avgHr / loFactor);
    const estimateHigh = Math.round(avgHr / hiFactor);
    const estimateMid = Math.round((estimateLow + estimateHigh) / 2);
    raceEstimate = {
      sourceRaceName: anchor.data.name || 'Race',
      sourceRaceDate: anchor.data.date
        || (anchor.data.startLocal || '').slice(0, 10),
      sourceDistanceMi: anchor.canonicalDistanceMi,
      avgHrInRace: avgHr,
      estimateLow,
      estimateHigh,
      estimateMid,
      ratioBand: anchor.ratioBand,
    };
  }

  // ── Recommendation in priority order ──────────────────────────
  //
  // Per the adaptive-pattern philosophy (lib/adaptive-pattern.ts):
  // single observations don't fire. Each rule below requires either
  // multiple corroborating peaks, a very-clear single-peak signal
  // (≥5 bpm above stored — unambiguous), OR a race-anchored signal
  // backed by physiology math. The cost of bumping max HR on a
  // sensor glitch is real (it widens Z2 ceiling and lets the runner
  // ride too hard on easy days), so the threshold has to be high.

  // 1. Validated peaks ABOVE stored — fires when either:
  //    (a) ≥2 validated peaks exceed stored, OR
  //    (b) Top validated peak exceeds stored by ≥5 bpm (unambiguous)
  //    NOT just any single peak ≥ stored+1.
  if (currentMaxHr && topPeaks.length > 0) {
    const validatedAbove = topPeaks.filter(
      (p) => p.isValidatedEffort && p.hr > currentMaxHr,
    );
    const topValidated = validatedAbove[0];
    const meetsMultiPeak = validatedAbove.length >= 2;
    const meetsClearSingle = topValidated && (topValidated.hr - currentMaxHr) >= 5;
    if (topValidated && (meetsMultiPeak || meetsClearSingle)) {
      const peakSummary = meetsMultiPeak
        ? `${validatedAbove.length} validated runs in the last 18 months ` +
          `peaked above ${currentMaxHr}: ${validatedAbove
            .slice(0, 3)
            .map((p) => `${p.hr} (${p.name})`)
            .join(', ')}.`
        : `Your highest validated HR is ${topValidated.hr} bpm during ` +
          `"${topValidated.name}" (${topValidated.date}) — that's ` +
          `${topValidated.hr - currentMaxHr} bpm above stored ${currentMaxHr}, ` +
          `clear enough to flag.`;
      return {
        hasFinding: true,
        currentMaxHr,
        topPeaks,
        raceEstimate,
        dismissed,
        recommendation: {
          kind: 'peak-exceeds-current',
          peakHr: topValidated.hr,
          reason: peakSummary,
          falsifier:
            meetsMultiPeak
              ? `We'd reconsider if you can identify one of these readings as a sensor glitch ` +
                `(e.g. avg HR was implausibly low for the workout intensity).`
              : `We'd reconsider if you flag that ${topValidated.name} reading as a sensor ` +
                `glitch. With only one above-stored reading, this is high-confidence only ` +
                `because of the ≥5 bpm gap.`,
        },
      };
    }
  }

  // 2. Race-derived estimate ≥5 bpm above stored — stored is probably wrong.
  if (currentMaxHr && raceEstimate && raceEstimate.estimateLow > currentMaxHr + 4) {
    const sustainedPct = Math.round(raceEstimate.avgHrInRace / currentMaxHr * 100);
    const ratioCap = raceEstimate.ratioBand === '10K' ? '95%' : '92%';
    const distLabel = raceEstimate.sourceDistanceMi >= 13 ? 'a half marathon'
      : raceEstimate.sourceDistanceMi >= 6 ? '10K'
      : 'the race';
    return {
      hasFinding: true,
      currentMaxHr,
      topPeaks,
      raceEstimate,
      dismissed,
      recommendation: {
        kind: 'race-suggests-higher',
        suggested: raceEstimate.estimateMid,
        reason:
          `Your ${raceEstimate.sourceRaceName} avg HR of ${raceEstimate.avgHrInRace} ` +
          `implies a true max of ${raceEstimate.estimateLow}–${raceEstimate.estimateHigh} bpm. ` +
          `Stored max ${currentMaxHr} means you held ${sustainedPct}% of max for ${distLabel} ` +
          `— LTHR caps at ~${ratioCap} for most runners. ` +
          `Suggested ${raceEstimate.estimateMid} bpm (midpoint of estimated range).`,
        falsifier:
          `We'd reconsider if your next HM-effort run shows avg HR > ${Math.round(currentMaxHr * 0.94)} ` +
          `— that'd mean you really can hold a higher %max than the rule of thumb.`,
      },
    };
  }

  // 3. No max set yet
  if (!currentMaxHr) {
    return {
      hasFinding: false,
      currentMaxHr,
      topPeaks,
      raceEstimate,
      dismissed,
      recommendation: {
        kind: 'insufficient-data',
        reason: 'No max HR set yet — log a hard workout or set it manually.',
        falsifier: 'Any race or interval session with HR data will give the validator something to work with.',
      },
    };
  }

  // 4. Stored looks consistent.
  return {
    hasFinding: false,
    currentMaxHr,
    topPeaks,
    raceEstimate,
    dismissed,
    recommendation: {
      kind: 'looks-correct',
      reason: raceEstimate
        ? `Stored ${currentMaxHr} bpm is consistent with ` +
          `${raceEstimate.sourceRaceName} avg ${raceEstimate.avgHrInRace} ` +
          `(${Math.round(raceEstimate.avgHrInRace / currentMaxHr * 100)}% of max — within ` +
          `the ${raceEstimate.ratioBand === '10K' ? '92-95%' : '88-92%'} LTHR band).`
        : `Stored ${currentMaxHr} bpm; log a half or 10K with HR data ` +
          `to validate against race performance.`,
      falsifier:
        `We'd raise this estimate if a validated peak from a race or ` +
        `interval session comes in 3+ bpm above ${currentMaxHr}, or if ` +
        `a future HM avg HR implies a max above ${currentMaxHr + 5}.`,
    },
  };
}
