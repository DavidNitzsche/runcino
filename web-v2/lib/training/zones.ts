/**
 * HR zone calculator — Friel LTHR-based (primary) or %MHR fallback.
 *
 * Doctrine:
 *   - Research/03-heart-rate-zones.md §6 (Friel 7-zone LTHR system)
 *   - Research/03-heart-rate-zones.md §3 (HRmax %, Tanaka/Gellish formulas)
 *
 * Why LTHR primary: for trained runners %MHR has SEE ±10–15 bpm vs
 * a single 30-min TT yielding LTHR within ~2 bpm of lactate-validated
 * threshold. Two runners with the same HRmax can have LTHRs 20+ bpm
 * apart — anchoring to LTHR maps zones to actual physiological
 * transitions instead of a guess.
 *
 * We default to LTHR-based zones if LTHR is known. Fall back to %MHR
 * Coggan-style 5-zone if only HRmax exists. Honest about which method
 * we used so the UI can say so.
 */

export type ZoneMethod = 'lthr-friel' | 'pct-mhr';

export interface HRZone {
  idx: number;            // 1..5 for %MHR, 1..7 for Friel (5a/5b/5c → 5,6,7)
  label: string;          // "Recovery", "Aerobic", "Tempo", etc.
  shortLabel: string;     // "Z1", "Z2", "Z3"
  lower: number;          // bpm
  upper: number;          // bpm
  purpose: string;        // human-readable purpose
}

export interface ZoneTable {
  method: ZoneMethod;
  anchor: { label: string; bpm: number };  // e.g. "LTHR: 162" or "MaxHR: 188"
  zones: HRZone[];
  citation: string;       // Research file pointer
  note?: string;          // e.g. "estimated from your half-marathon avg HR"
}

// ── LTHR-based (Friel 7-zone, simplified to 5 for app UI) ────────────────

/** Friel zones, condensed to the 5 most-actionable for marathoners.
 *  We collapse 5a/5b/5c (cruise/VO2/anaerobic) since the in-app coach
 *  uses Z5 = "max effort, save for hill repeats / VO2 reps". The detailed
 *  Friel split is still available via the `friel7Zones` helper.
 */
export function lthrZones(lthr: number, _maxHrHint?: number): ZoneTable {
  const r = (lo: number, hi: number) => ({
    lower: Math.round(lthr * lo),
    upper: Math.round(lthr * hi),
  });
  return {
    method: 'lthr-friel',
    anchor: { label: 'LTHR', bpm: lthr },
    citation: 'Research/03-heart-rate-zones.md §6 (Friel)',
    zones: [
      { idx: 1, label: 'Recovery',  shortLabel: 'Z1', ...r(0,    0.85),
        purpose: 'Recovery, walking, true easy days · clear the legs, no stress' },
      { idx: 2, label: 'Aerobic',   shortLabel: 'Z2', ...r(0.85, 0.89),
        purpose: 'Aerobic base · long runs and the bulk of weekly mileage' },
      { idx: 3, label: 'Tempo',     shortLabel: 'Z3', ...r(0.90, 0.94),
        purpose: 'Marathon pace, sub-threshold steady efforts' },
      { idx: 4, label: 'Threshold', shortLabel: 'Z4', ...r(0.95, 0.99),
        purpose: 'Just below LT · cruise intervals, controlled hard' },
      { idx: 5, label: 'VO2 / Max', shortLabel: 'Z5', ...r(1.00, 1.10),
        purpose: 'At and above LT · short reps, hill repeats, race finishes' },
    ],
  };
}

/** Full Joe Friel 7-zone table (5a/5b/5c separated). For runners who want detail. */
export function friel7Zones(lthr: number): ZoneTable {
  const r = (lo: number, hi: number) => ({
    lower: Math.round(lthr * lo),
    upper: Math.round(lthr * hi),
  });
  return {
    method: 'lthr-friel',
    anchor: { label: 'LTHR', bpm: lthr },
    citation: 'Research/03-heart-rate-zones.md §6 (Friel 7-zone)',
    zones: [
      { idx: 1, label: 'Recovery',          shortLabel: 'Z1',  ...r(0,    0.85), purpose: 'Recovery / very easy' },
      { idx: 2, label: 'Aerobic',           shortLabel: 'Z2',  ...r(0.85, 0.89), purpose: 'Long-run base' },
      { idx: 3, label: 'Tempo',             shortLabel: 'Z3',  ...r(0.90, 0.94), purpose: 'Sub-LT steady' },
      { idx: 4, label: 'SubThreshold',      shortLabel: 'Z4',  ...r(0.95, 0.99), purpose: 'Just below LT' },
      { idx: 5, label: 'Threshold',         shortLabel: 'Z5a', ...r(1.00, 1.02), purpose: 'At LT, cruise intervals' },
      { idx: 6, label: 'Aerobic capacity',  shortLabel: 'Z5b', ...r(1.03, 1.06), purpose: 'VO2max 3-5 min reps' },
      { idx: 7, label: 'Anaerobic',         shortLabel: 'Z5c', ...r(1.07, 1.15), purpose: 'Short max reps' },
    ],
  };
}

// ── %MHR-based fallback (Coggan/Daniels-ish 5-zone) ─────────────────────

/** %HRmax zones — the consumer-wearable default. Use only when LTHR unknown. */
export function pctMaxZones(maxHr: number): ZoneTable {
  const r = (lo: number, hi: number) => ({
    lower: Math.round(maxHr * lo),
    upper: Math.round(maxHr * hi),
  });
  return {
    method: 'pct-mhr',
    anchor: { label: 'MaxHR', bpm: maxHr },
    citation: 'Research/03-heart-rate-zones.md §3 + §5 (%MHR fallback)',
    zones: [
      { idx: 1, label: 'Very Light', shortLabel: 'Z1', ...r(0.50, 0.60),
        purpose: 'Warmup, cooldown, recovery' },
      { idx: 2, label: 'Aerobic',    shortLabel: 'Z2', ...r(0.60, 0.70),
        purpose: 'Aerobic base, long runs' },
      { idx: 3, label: 'Moderate',   shortLabel: 'Z3', ...r(0.70, 0.80),
        purpose: 'Marathon pace, steady' },
      { idx: 4, label: 'Threshold',  shortLabel: 'Z4', ...r(0.80, 0.90),
        purpose: 'Tempo, lactate threshold' },
      { idx: 5, label: 'Maximum',    shortLabel: 'Z5', ...r(0.90, 1.00),
        purpose: 'VO2 max intervals, short bursts' },
    ],
  };
}

// ── Auto-select ─────────────────────────────────────────────────────────

/**
 * Pick the right method given what we know about the runner.
 * Returns null only when we have neither LTHR nor MaxHR.
 */
export function computeZones(input: { lthr?: number | null; maxHr?: number | null }): ZoneTable | null {
  if (input.lthr && input.lthr > 100 && input.lthr < 210) return lthrZones(input.lthr, input.maxHr ?? undefined);
  if (input.maxHr && input.maxHr > 140 && input.maxHr < 230) return pctMaxZones(input.maxHr);
  return null;
}

// ── LTHR estimation from race data ──────────────────────────────────────

/**
 * Estimate LTHR from a race average HR.
 * Doctrine: Research/03 §6 plus Friel's race-distance offsets:
 *   - half-marathon avg HR ≈ LTHR (for trained runners in ~70-100 min)
 *   - marathon avg HR ≈ LTHR − 5 to −8 bpm (run slightly below threshold)
 *   - 10K avg HR ≈ LTHR + 3 to +5 bpm
 *   - 5K avg HR ≈ LTHR + 5 to +10 bpm (close to VO2max territory)
 *
 * Returns the estimated LTHR plus a confidence note.
 */
export function estimateLTHR(args: {
  raceDistanceMi: number;
  avgHrBpm: number;
}): { lthr: number; confidence: 'high' | 'med' | 'low'; note: string } | null {
  if (!args.avgHrBpm || args.avgHrBpm < 100 || args.avgHrBpm > 210) return null;
  const d = args.raceDistanceMi;
  const hr = args.avgHrBpm;
  // Half-marathon — best LTHR proxy
  if (d >= 12.5 && d <= 14) {
    return { lthr: hr, confidence: 'high', note: 'half-marathon avg HR ≈ LTHR (best estimate)' };
  }
  // Marathon — needs adjustment
  if (d >= 25 && d <= 27) {
    return { lthr: Math.round(hr + 6), confidence: 'med', note: 'marathon avg HR + 6 bpm (marathons run ~5-8 bpm below LT)' };
  }
  // 10K
  if (d >= 5.8 && d <= 6.4) {
    return { lthr: Math.round(hr - 4), confidence: 'med', note: '10K avg HR − 4 bpm' };
  }
  // 5K
  if (d >= 2.9 && d <= 3.3) {
    return { lthr: Math.round(hr - 8), confidence: 'low', note: '5K avg HR − 8 bpm (close to VO2max, weak LTHR proxy)' };
  }
  return null;
}

/** Estimate true MaxHR from LTHR — trained endurance runners are typically
 *  20–25 bpm above LTHR. Returns the lower bound (conservative). */
export function estimateMaxHRFromLTHR(lthr: number): number {
  return Math.round(lthr + 22);
}

// ── Easy-run HR judgment ─────────────────────────────────────────────────

export type EasyHrVerdict = 'aerobic' | 'gray-zone' | 'above-threshold';

/**
 * 2026-07-06 · P1-43 fix · judge an easy/recovery run's average HR against
 * the runner's OWN threshold (never a hardcoded constant). Pure · exported
 * for tests · run-state.ts computes this server-side so every surface
 * renders the same personalized read.
 *
 * Bands (Friel LTHR zones above · Research/03-heart-rate-zones.md §6):
 *   · aerobic         · avgHr ≤ Z2 upper (0.89 × LTHR) · where easy days belong
 *   · gray-zone       · Z2 upper < avgHr < LTHR · Z3/Z4 — too hard for an
 *                       easy day, but not at threshold
 *   · above-threshold · avgHr ≥ LTHR · a quality effort wearing an easy label
 *
 * heatBumpBpm shifts both boundaries up — the HR analog of heat-band.ts
 * widening the slow side for pace (Research/06-weather-adjustments.md §1).
 * Per-finding context filter (CLAUDE.md 2026-05-19 round 4): heat resolves
 * HERE, on this observation, not on some parent surface.
 *
 * Returns null on implausible inputs — skip the judgment, never fabricate.
 */
export function judgeEasyRunHr(args: {
  avgHrBpm: number;
  thresholdBpm: number;
  heatBumpBpm?: number;
}): { verdict: EasyHrVerdict; deltaBpm: number; easyCeilingBpm: number } | null {
  const { avgHrBpm, thresholdBpm } = args;
  const heat = Math.max(0, Math.round(args.heatBumpBpm ?? 0));
  if (!isFinite(avgHrBpm) || avgHrBpm < 60 || avgHrBpm > 230) return null;
  if (!isFinite(thresholdBpm) || thresholdBpm <= 100 || thresholdBpm >= 210) return null;
  const easyCeilingBpm = Math.round(thresholdBpm * 0.89) + heat;  // Friel Z2 upper
  const effectiveThreshold = thresholdBpm + heat;
  const verdict: EasyHrVerdict =
    avgHrBpm <= easyCeilingBpm ? 'aerobic'
    : avgHrBpm < effectiveThreshold ? 'gray-zone'
    : 'above-threshold';
  return {
    verdict,
    // Delta vs the (un-bumped) threshold · the display number ("−12 vs
    // threshold"). Heat moves the verdict bands, not the raw distance.
    deltaBpm: Math.round(avgHrBpm - thresholdBpm),
    easyCeilingBpm,
  };
}
