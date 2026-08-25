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

/* ══════════════════════════════════════════════════════════════════════════
 * THE BANDS MUST TILE (2026-08-24)
 *
 * Every table below used to compute `lower` and `upper` INDEPENDENTLY, from
 * the two fractions the doctrine row prints. Two independent roundings of two
 * adjacent fractions do not meet, and at LTHR 162 they did not:
 *
 *     Z1  0–138    Z2  138–144    Z3  146–152    Z4  154–160    Z5  162–178
 *          ↑ 138 is in TWO zones        ↑ 145, 153 and 161 are in NONE
 *
 * Both halves reach the runner. 138 resolves to Z1 because `.find()` returns
 * the first match, so a heart rate at 85.2% of threshold — Z2 by the doctrine
 * table's own words — is charted as Recovery. And 145 matched nothing at all,
 * which two separate `classify` helpers papered over by snapping to the
 * nearest band MIDPOINT. The phone is handed the band table as a legend and
 * the shares as a chart, on one screen: it printed "Z2 138–144" beside a Z2
 * bar holding time spent at 145.
 *
 * The fix is to read the doctrine table the way it is written. `2 Aerobic /
 * Endurance | 85–89%` and `3 Tempo | 90–94%` are not two closed intervals
 * with a hole between them; they are consecutive bands, and 89.5% is in the
 * second one. So each zone's FLOOR stays exactly where doctrine puts it —
 * 85%, 90%, 95%, 100% of LTHR are the meaningful physiological entry points
 * and every one of them is unchanged — and each CEILING becomes the next
 * floor minus one beat. The top zone keeps its own published ceiling.
 *
 * Arithmetic, not a new claim: no fraction moved. `HR.friel-lthr-zones`,
 * `HR.lthr-five-zone-collapse` and `HR.pct-hrmax-zones` all check ceilings to
 * ±1 bpm and all still pass, because adjacent doctrine fractions differ by
 * exactly one percentage point and `computeZones` only admits an LTHR under
 * 210 — where one point is always 1 or 2 beats.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Turn a list of floor fractions plus one final ceiling into bands that tile:
 * contiguous, non-overlapping, covering every integer bpm from 0 upward.
 *
 * `floors[0]` is the bottom zone's floor and is expected to be 0 — a heart
 * rate below the first real threshold is still Recovery, not nothing.
 */
function tiledBands(
  anchorBpm: number,
  floors: readonly number[],
  topCeiling: number,
): Array<{ lower: number; upper: number }> {
  const lowers = floors.map((f) => Math.round(anchorBpm * f));
  return lowers.map((lower, i) => ({
    lower,
    // The next zone's floor is where this zone stops. One beat below it is
    // the last beat this zone owns.
    upper: i + 1 < lowers.length ? lowers[i + 1] - 1 : Math.round(anchorBpm * topCeiling),
  }));
}

// ── LTHR-based (Friel 7-zone, simplified to 5 for app UI) ────────────────

/** Friel zones, condensed to the 5 most-actionable for marathoners.
 *  We collapse 5a/5b/5c (cruise/VO2/anaerobic) since the in-app coach
 *  uses Z5 = "max effort, save for hill repeats / VO2 reps". The detailed
 *  Friel split is still available via the `friel7Zones` helper.
 */
export function lthrZones(lthr: number, _maxHrHint?: number): ZoneTable {
  const b = tiledBands(lthr, [0, 0.85, 0.90, 0.95, 1.00], 1.10);
  return {
    method: 'lthr-friel',
    anchor: { label: 'LTHR', bpm: lthr },
    citation: 'Research/03-heart-rate-zones.md §6 (Friel)',
    zones: [
      { idx: 1, label: 'Recovery',  shortLabel: 'Z1', ...b[0],
        purpose: 'Recovery, walking, true easy days · clear the legs, no stress' },
      { idx: 2, label: 'Aerobic',   shortLabel: 'Z2', ...b[1],
        purpose: 'Aerobic base · long runs and the bulk of weekly mileage' },
      { idx: 3, label: 'Tempo',     shortLabel: 'Z3', ...b[2],
        purpose: 'Marathon pace, sub-threshold steady efforts' },
      { idx: 4, label: 'Threshold', shortLabel: 'Z4', ...b[3],
        purpose: 'Just below LT · cruise intervals, controlled hard' },
      { idx: 5, label: 'VO2 / Max', shortLabel: 'Z5', ...b[4],
        purpose: 'At and above LT · short reps, hill repeats, race finishes' },
    ],
  };
}

/** Full Joe Friel 7-zone table (5a/5b/5c separated). For runners who want detail. */
export function friel7Zones(lthr: number): ZoneTable {
  const b = tiledBands(lthr, [0, 0.85, 0.90, 0.95, 1.00, 1.03, 1.07], 1.15);
  return {
    method: 'lthr-friel',
    anchor: { label: 'LTHR', bpm: lthr },
    citation: 'Research/03-heart-rate-zones.md §6 (Friel 7-zone)',
    zones: [
      { idx: 1, label: 'Recovery',          shortLabel: 'Z1',  ...b[0], purpose: 'Recovery / very easy' },
      { idx: 2, label: 'Aerobic',           shortLabel: 'Z2',  ...b[1], purpose: 'Long-run base' },
      { idx: 3, label: 'Tempo',             shortLabel: 'Z3',  ...b[2], purpose: 'Sub-LT steady' },
      { idx: 4, label: 'SubThreshold',      shortLabel: 'Z4',  ...b[3], purpose: 'Just below LT' },
      { idx: 5, label: 'Threshold',         shortLabel: 'Z5a', ...b[4], purpose: 'At LT, cruise intervals' },
      { idx: 6, label: 'Aerobic capacity',  shortLabel: 'Z5b', ...b[5], purpose: 'VO2max 3-5 min reps' },
      { idx: 7, label: 'Anaerobic',         shortLabel: 'Z5c', ...b[6], purpose: 'Short max reps' },
    ],
  };
}

// ── %MHR-based fallback (Coggan/Daniels-ish 5-zone) ─────────────────────

/**
 * The five ACSM zones as FRACTIONS OF HRmax, Z1…Z5, low then high.
 *
 * Lifted out of `pctMaxZones` on 2026-08-21 so it can be named and reused
 * rather than re-typed. `lib/coach/zone-target.ts` reads it to work out which
 * zone a race's published HR band actually lands in — a derivation that had
 * previously been done by hand, and wrongly.
 *
 * Cite: Research/03-heart-rate-zones.md §4, the table under
 * "### 5-Zone (ACSM / generic / commercial wearables)". `HR.pct-hrmax-zones`
 * and `ZONETARGET.race-zone-comes-from-the-race-hr-band` both parse that table
 * at run time; neither hardcodes the numbers below on the doctrine side.
 */
export const PCT_MAX_ZONE_BANDS: readonly (readonly [number, number])[] = [
  [0.50, 0.60],
  [0.60, 0.70],
  [0.70, 0.80],
  [0.80, 0.90],
  [0.90, 1.00],
];

/**
 * %HRmax zones — the consumer-wearable default. Use only when LTHR unknown.
 *
 * The citation used to read "§3 + §5". Neither is this table: §3 is
 * "Field-Testing HRmax" and §5 is the Karvonen %HRR system, whose own
 * "Karvonen vs. %HRmax" subsection exists precisely to say that the two are
 * NOT the same prescription at the same percentage. The table reproduced here
 * is §4's five-zone ACSM one, and that is what it now cites.
 */
export function pctMaxZones(maxHr: number): ZoneTable {
  // Tiled, for the reason above. This table's boundaries are shared outright
  // — Z1 is 50-60% and Z2 is 60-70%, so 0.60 × HRmax was the ceiling of one
  // zone and the floor of the next, and every boundary beat resolved to the
  // LOWER zone. Floors come from `PCT_MAX_ZONE_BANDS` unchanged, Z1's
  // included: unlike the Friel table this one publishes a real bottom (50% of
  // HRmax) and `HR.pct-hrmax-zones` checks it. A reading below that is genuine
  // but outside the doctrine table, and `classify` places it in Z1 without the
  // table having to claim a band it does not have.
  const b = tiledBands(maxHr, PCT_MAX_ZONE_BANDS.map((z) => z[0]), 1.00);
  return {
    method: 'pct-mhr',
    anchor: { label: 'MaxHR', bpm: maxHr },
    citation: 'Research/03-heart-rate-zones.md §4 (5-Zone ACSM %HRmax fallback)',
    zones: [
      { idx: 1, label: 'Very Light', shortLabel: 'Z1', ...b[0],
        purpose: 'Warmup, cooldown, recovery' },
      { idx: 2, label: 'Aerobic',    shortLabel: 'Z2', ...b[1],
        purpose: 'Aerobic base, long runs' },
      { idx: 3, label: 'Moderate',   shortLabel: 'Z3', ...b[2],
        purpose: 'Marathon pace, steady' },
      { idx: 4, label: 'Threshold',  shortLabel: 'Z4', ...b[3],
        purpose: 'Tempo, lactate threshold' },
      { idx: 5, label: 'Maximum',    shortLabel: 'Z5', ...b[4],
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
  // 2026-08-24 · READ FROM THE TABLE, not re-derived from 0.89.
  //
  // This line said `Math.round(thresholdBpm * 0.89)` and its own comment said
  // "Friel Z2 upper" — two definitions of one boundary, which is the shape
  // this whole layer exists to end. They agreed until the bands were tiled,
  // and then they did not: Z2's published top is the beat below Z3's floor,
  // and at LTHR 162 that is 145 while 0.89 rounds to 144. The verdict a
  // runner reads and the band the same screen prints beside it may not
  // disagree about where easy stops.
  const easyCeilingBpm = lthrZones(thresholdBpm).zones[1].upper + heat;
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
