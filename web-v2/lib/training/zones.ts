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
  /** Inclusive bpm floor · NULL when the band is open below. Friel's zone 1
   *  is "< 85% LTHR" and has no floor; writing 0 there was a claim that
   *  0 bpm is a recovery heart rate, and consumers believed it (the web run
   *  detail drew its HR scale from 0, and the phone's route-map ramp put a
   *  128 bpm mile 93% of the way up a 138-wide band and painted it Z2). */
  lower: number | null;
  /** Inclusive bpm ceiling · NULL when the band is open above. Friel's 5c is
   *  "> 106% LTHR" and has no ceiling; the old 1.10 × LTHR cap put a hard
   *  rep finish outside every band. */
  upper: number | null;
  /** The band's floor as a fraction of the anchor · NULL when open below.
   *  This is the doctrine number; `lower` is derived from it. */
  loPct: number | null;
  /** The band's ceiling as a fraction of the anchor, EXCLUSIVE · NULL when
   *  open above. The next band starts exactly here, which is what makes the
   *  bpm edges tile with no hole and no overlap. */
  hiPct: number | null;
  purpose: string;        // human-readable purpose
}

export interface ZoneTable {
  method: ZoneMethod;
  anchor: { label: string; bpm: number };  // e.g. "LTHR: 162" or "MaxHR: 188"
  zones: HRZone[];
  citation: string;       // Research file pointer
  note?: string;          // e.g. "estimated from your half-marathon avg HR"
}

// ── Band arithmetic ──────────────────────────────────────────────────────

/**
 * ZONE-BANDS-1 (2026-08-24) · turn a list of percent EDGES into bpm bands.
 *
 * The old code rounded each band's two percent bounds to bpm independently:
 *
 *     Z2 = round(0.85 × lthr) … round(0.89 × lthr)
 *     Z3 = round(0.90 × lthr) … round(0.94 × lthr)
 *
 * At LTHR 162 that is Z2 138…144 and Z3 146…152, so 145 belonged to no zone
 * at all, and 153 and 161 likewise. Z1's ceiling (round(0.85 × lthr) = 138)
 * collided with Z2's floor, so 138 belonged to two. Four faults from one
 * mistake: a band is not two independently-rounded numbers, it is the gap
 * between two EDGES, and the edges are shared.
 *
 * So: bucket in percent space, derive bpm from that. Given ordered fractions
 * e₁ < e₂ < … < eₙ, the bands are
 *
 *     (−∞, e₁)  [e₁, e₂)  …  [eₙ₋₁, eₙ)  [eₙ, +∞)
 *
 * and a bpm b sits in [eₖ, eₖ₊₁) exactly when anchor·eₖ ≤ b < anchor·eₖ₊₁.
 * The least integer bpm in that band is therefore `ceil(anchor × eₖ)`, and
 * the greatest is `ceil(anchor × eₖ₊₁) − 1`. Every integer bpm lands in
 * exactly one band, and each band's ceiling is the next one's floor minus
 * one. No hole, no overlap, by construction rather than by luck.
 *
 * `openLow` says whether there is a band BELOW the first edge. Friel has one
 * ("< 85% LTHR"); the ACSM %HRmax table starts at its first edge (50%).
 *
 * Every table is open ABOVE. Friel says so outright ("5c: > 106%"). The ACSM
 * table appears to close at 100%, but that 100% is the DEFINITION of HRmax
 * rather than a band edge, and this app's HRmax is frequently an ESTIMATE
 * (Tanaka, or the §11 crosswalk) which real efforts routinely exceed. A
 * reading above it is still the top zone, because there is no zone above it.
 * `PCT_MAX_ZONE_BANDS` keeps the published pairs verbatim for the claim that
 * reads them; this is a statement about classification, not about the table.
 *
 * Cite: Research/03-heart-rate-zones.md §6 (Friel) and §4 (ACSM). Bound by
 * `HR.zone-bands-tile-the-line` in lib/doctrine/registry.ts.
 */
export function bandsFromPctEdges(
  anchorBpm: number,
  edges: readonly number[],
  opts: { openLow: boolean },
): Array<{ lower: number | null; upper: number | null; loPct: number | null; hiPct: number | null }> {
  const loPcts: Array<number | null> = opts.openLow ? [null, ...edges] : [...edges];
  // Each band's EXCLUSIVE ceiling is the next band's floor. The top is open.
  const hiPcts: Array<number | null> = [...loPcts.slice(1), null];
  const bpmFloor = (pct: number | null) => (pct == null ? null : Math.ceil(anchorBpm * pct));
  return loPcts.map((loPct, i) => {
    const hiPct = hiPcts[i] ?? null;
    const floor = bpmFloor(hiPct);
    return {
      lower: bpmFloor(loPct),
      // Inclusive ceiling = the next band's floor − 1. Open above → null.
      upper: floor == null ? null : floor - 1,
      loPct,
      hiPct,
    };
  });
}

/**
 * Which zone a heart rate belongs to · the ONE classifier.
 *
 * Returns the zone's `idx`, or null when there is no table. Total over the
 * reals: the open bottom band catches everything below, the open top band
 * everything above, and a closed outer edge clamps rather than dropping the
 * reading — a heart rate that exceeds an ESTIMATED HRmax is still the top
 * zone, because there is no zone above it.
 *
 * Classifies against the derived integer bpm edges rather than re-deriving
 * the percent, so the answer always agrees with the band the runner is shown.
 */
export function zoneIdxForBpm(bpm: number, table: ZoneTable | null): number | null {
  if (!table || !table.zones.length || !isFinite(bpm)) return null;
  for (const z of table.zones) {
    const lo = z.lower;
    const hi = z.upper;
    if (lo != null && bpm < lo) break;          // below this band, and bands ascend
    if (hi == null || bpm <= hi) return z.idx;  // open top, or inside
  }
  // Below the lowest closed floor → the bottom band. Above the highest closed
  // ceiling → the top band. Both are clamps, not fabrications.
  return bpm < (table.zones[0].lower ?? -Infinity)
    ? table.zones[0].idx
    : table.zones[table.zones.length - 1].idx;
}

// ── LTHR-based (Friel 7-zone, simplified to 5 for app UI) ────────────────

/**
 * Friel's percent-of-LTHR EDGES, Research/03 §6's own table.
 *
 * The doctrine table publishes whole-percent runs — `< 85`, `85–89`, `90–94`,
 * `95–99`, `100–102`, `103–106`, `> 106` — which tile the whole percents
 * exactly. Their continuous extension is therefore half-open at each stated
 * floor: the row covering whole percents 85…89 is [85%, 90%), because the
 * next row starts at 90. Read any other way the rows leave gaps at 89.5% and
 * 94.5% and 99.5%, and gaps are precisely the defect this replaced — the
 * table's whole point is to cover every heart rate once.
 *
 * So the edges are the stated floors, with 5c's floor being 5b's stated
 * ceiling plus one whole percent. `HR.zone-bands-tile-the-line` re-derives
 * exactly this list out of the doc at run time rather than trusting it here.
 */
export const FRIEL_7_ZONE_EDGES: readonly number[] = [0.85, 0.90, 0.95, 1.00, 1.03, 1.07];

/** The same table with 5a/5b/5c merged · the five-zone view the app shows.
 *  Zones 1-4 keep the exact Friel edges; Z5 is everything at or above LTHR. */
export const FRIEL_5_ZONE_EDGES: readonly number[] = [0.85, 0.90, 0.95, 1.00];

/**
 * The top of Friel Z2 in bpm — the aerobic ceiling an easy run is capped at,
 * and judged against.
 *
 * ZONE-BANDS-1 (2026-08-24) · this existed as `Math.round(lthr * 0.89)`
 * written out by hand in THREE places (the plan's `hrCapEasy`, the watch's
 * `build-workout`, and `judgeEasyRunHr`), each of which had to be kept in
 * step with the zone table by hand and none of which was. `round(0.89 × 162)`
 * is 144; Z2's real ceiling is 145, because Z3 starts at 90% and 145 is 89.5%
 * of LTHR. So a run averaging 145 was capped-and-judged as too hard while the
 * zone bar beside it drew the same beat inside Z2. One derivation now.
 */
export function aerobicCeilingBpm(lthr: number): number {
  return Math.ceil(lthr * FRIEL_5_ZONE_EDGES[1]) - 1;
}

/**
 * The Friel Z4→Z5a seam in bpm — "at-or-under threshold," the pass line a
 * completed tempo/threshold/intervals effort is judged against.
 *
 * Existed as `Math.round(lthr * 0.975)` written out by hand in both
 * spec-builder.ts's post-run contingency rules and goal-projection.ts's
 * next-test-point pass criteria. One derivation now.
 */
export const THRESHOLD_PASS_HR_FRACTION = 0.975;

export function thresholdPassHrBpm(lthr: number): number {
  return Math.round(lthr * THRESHOLD_PASS_HR_FRACTION);
}

/** Friel zones, condensed to the 5 most-actionable for marathoners.
 *  We collapse 5a/5b/5c (cruise/VO2/anaerobic) since the in-app coach
 *  uses Z5 = "max effort, save for hill repeats / VO2 reps". The detailed
 *  Friel split is still available via the `friel7Zones` helper.
 */
export function lthrZones(lthr: number, _maxHrHint?: number): ZoneTable {
  const b = bandsFromPctEdges(lthr, FRIEL_5_ZONE_EDGES, { openLow: true });
  const meta = [
    { idx: 1, label: 'Recovery',  shortLabel: 'Z1',
      purpose: 'Recovery, walking, true easy days · clear the legs, no stress' },
    { idx: 2, label: 'Aerobic',   shortLabel: 'Z2',
      purpose: 'Aerobic base · long runs and the bulk of weekly mileage' },
    { idx: 3, label: 'Tempo',     shortLabel: 'Z3',
      purpose: 'Marathon pace, sub-threshold steady efforts' },
    { idx: 4, label: 'Threshold', shortLabel: 'Z4',
      purpose: 'Just below LT · cruise intervals, controlled hard' },
    { idx: 5, label: 'VO2 / Max', shortLabel: 'Z5',
      purpose: 'At and above LT · short reps, hill repeats, race finishes' },
  ];
  return {
    method: 'lthr-friel',
    anchor: { label: 'LTHR', bpm: lthr },
    citation: 'Research/03-heart-rate-zones.md §6 (Friel)',
    zones: meta.map((m, i) => ({ ...m, ...b[i] })),
  };
}

/** Full Joe Friel 7-zone table (5a/5b/5c separated). For runners who want detail. */
export function friel7Zones(lthr: number): ZoneTable {
  const b = bandsFromPctEdges(lthr, FRIEL_7_ZONE_EDGES, { openLow: true });
  const meta = [
    { idx: 1, label: 'Recovery',          shortLabel: 'Z1',  purpose: 'Recovery / very easy' },
    { idx: 2, label: 'Aerobic',           shortLabel: 'Z2',  purpose: 'Long-run base' },
    { idx: 3, label: 'Tempo',             shortLabel: 'Z3',  purpose: 'Sub-LT steady' },
    { idx: 4, label: 'SubThreshold',      shortLabel: 'Z4',  purpose: 'Just below LT' },
    { idx: 5, label: 'Threshold',         shortLabel: 'Z5a', purpose: 'At LT, cruise intervals' },
    { idx: 6, label: 'Aerobic capacity',  shortLabel: 'Z5b', purpose: 'VO2max 3-5 min reps' },
    { idx: 7, label: 'Anaerobic',         shortLabel: 'Z5c', purpose: 'Short max reps' },
  ];
  return {
    method: 'lthr-friel',
    anchor: { label: 'LTHR', bpm: lthr },
    citation: 'Research/03-heart-rate-zones.md §6 (Friel 7-zone)',
    zones: meta.map((m, i) => ({ ...m, ...b[i] })),
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
  // The published pairs' floors ARE the edges — 50/60/70/80/90 — because the
  // table is contiguous already (each row's ceiling is the next row's floor).
  // That contiguity is exactly what the old two-independent-roundings code
  // destroyed: at maxHr 190 it emitted Z1 …114 and Z2 114…, so 114 was in two
  // zones, and the `.find()` that read the table gave it to the lower one.
  const edges = PCT_MAX_ZONE_BANDS.map(([lo]) => lo);
  const b = bandsFromPctEdges(maxHr, edges, { openLow: false });
  const meta = [
    { idx: 1, label: 'Very Light', shortLabel: 'Z1', purpose: 'Warmup, cooldown, recovery' },
    { idx: 2, label: 'Aerobic',    shortLabel: 'Z2', purpose: 'Aerobic base, long runs' },
    { idx: 3, label: 'Moderate',   shortLabel: 'Z3', purpose: 'Marathon pace, steady' },
    { idx: 4, label: 'Threshold',  shortLabel: 'Z4', purpose: 'Tempo, lactate threshold' },
    { idx: 5, label: 'Maximum',    shortLabel: 'Z5', purpose: 'VO2 max intervals, short bursts' },
  ];
  return {
    method: 'pct-mhr',
    anchor: { label: 'MaxHR', bpm: maxHr },
    citation: 'Research/03-heart-rate-zones.md §4 (5-Zone ACSM %HRmax fallback)',
    zones: meta.map((m, i) => ({ ...m, ...b[i] })),
  };
}

// ── Age-predicted HRmax (Tanaka) · last-resort anchor ────────────────────

/**
 * Tanaka (2001): HRmax = 208 − 0.7 × age.
 *
 * Doctrine: Research/03-heart-rate-zones.md §2 ("Estimating HRmax —
 * Formulas") — Tanaka is the chosen formula for marathon runners and general
 * adults with no test data, and Research/REVIEW_NOTES.md flags 220 − age as
 * a weak-evidence formula to NEVER default to (±10-15 bpm SD, biased by
 * age). Bound by `HR.tanaka-age-predicted` in lib/doctrine/registry.ts,
 * which parses the formula's constants out of the doc at run time.
 *
 * Even Tanaka carries ±10 bpm SEE (95% CI ≈ ±20 bpm individually), so any
 * zone table anchored on it must say so — see computeZones' estimated note.
 * Null outside the ages the doc trusts (no formula is reliable under 16).
 */
export function tanakaMaxHr(age: number | null | undefined): number | null {
  const a = Number(age);
  if (!Number.isFinite(a) || a < 16 || a > 100) return null;
  return Math.round(208 - 0.7 * a);
}

// ── Auto-select ─────────────────────────────────────────────────────────

/**
 * Pick the right method given what we know about the runner.
 *
 * Precedence (Research/03 §17 "Picking a System": "If two systems disagree,
 * the more individualized one (LTHR > Karvonen > %HRmax) wins"):
 *
 *   1. LTHR · Friel zones — the individualized anchor.
 *   2. Measured/observed HRmax · %HRmax ACSM zones.
 *   3. Age · Tanaka-estimated HRmax · same %HRmax table, loudly labeled as
 *      an estimate ("treat as approximate" — §17's own words for this row).
 *      NEVER 220 − age (Research/REVIEW_NOTES.md weak-evidence table).
 *
 * Returns null only when we have none of LTHR / MaxHR / age.
 */
export function computeZones(input: { lthr?: number | null; maxHr?: number | null; age?: number | null }): ZoneTable | null {
  if (input.lthr && input.lthr > 100 && input.lthr < 210) return lthrZones(input.lthr, input.maxHr ?? undefined);
  if (input.maxHr && input.maxHr > 140 && input.maxHr < 230) return pctMaxZones(input.maxHr);
  const est = tanakaMaxHr(input.age);
  if (est != null) {
    const t = pctMaxZones(est);
    return {
      ...t,
      anchor: { label: 'MaxHR (est)', bpm: est },
      citation: 'Research/03-heart-rate-zones.md §2 (Tanaka age-predicted) + §4 (5-Zone ACSM %HRmax)',
      // Wide-band honesty: an age-predicted anchor is a population guess.
      // §2 "Practical Rule": 95% CI ≈ ±20 bpm individually. The bands are
      // rendered normally but the note is the contract that a surface
      // showing them must carry.
      note: `estimated from age ${Math.round(Number(input.age))} (Tanaka 208 − 0.7 × age) · individual error up to ±20 bpm · treat zones as approximate until a field test or race locks in LTHR`,
    };
  }
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
 *   · aerobic         · avgHr ≤ Z2 upper · where easy days belong
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
  const easyCeilingBpm = aerobicCeilingBpm(thresholdBpm) + heat;
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
