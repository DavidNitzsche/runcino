/**
 * VDOT — Daniels' fitness index derived from race performance.
 *
 * Cite: Research/01-pace-zones-vdot.md §vdot-table (Daniels Running Formula,
 * J. Daniels, 3rd ed., extended through VDOT 85 per project memory).
 *
 * Strategy:
 *   1. For each race in the past 6 months, look up the VDOT corresponding
 *      to (finish_time, distance).
 *   2. Return the highest (best). This naturally excludes slow C-races
 *      because a C-race effort produces a lower VDOT.
 *   3. Also exclude races flagged priority='C' explicitly.
 *
 * Algorithm: invert the Daniels race-time table by binary-searching over
 * VDOT and computing predicted race time at each VDOT, returning the VDOT
 * whose predicted time matches the actual finish.
 *
 * Daniels' race-time formula (s):
 *   For a given distance d (km) and VDOT v:
 *   - vO2 demand of running at speed s (m/min): VO2 = 0.000104·s² + 0.182·s − 4.6
 *   - %VO2max sustainable for time t (min): %v = 0.8 + 0.1894·exp(-0.012778·t) +
 *                                                  0.2989·exp(-0.1932·t)
 *   - Find s such that VO2(s) = v · %v(t) where t = (d·1000)/s
 *   - The whole thing is solved iteratively.
 */

/** Distance in km from a label. */
function kmFromMi(mi: number): number { return mi * 1.609344; }

/** Daniels' VO2 cost of running at speed s (m/min). */
function vo2Cost(metersPerMin: number): number {
  return -4.6 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

/** Daniels' %VO2max sustainable for time t (min). */
function pctVO2(min: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) +
               0.2989558 * Math.exp(-0.1932605 * min);
}

/** Unclamped VDOT for (finish_seconds, distance_mi). Internal — the raw
 *  Daniels value before the [30,85] table clamp. Used by both the public
 *  `vdotFromRace` (which clamps) and `predictRaceTime` (which inverts). */
function rawVdot(finishSeconds: number, distanceMi: number): number | null {
  if (!finishSeconds || finishSeconds <= 0 || !distanceMi || distanceMi <= 0) return null;
  const meters = kmFromMi(distanceMi) * 1000;
  const minutes = finishSeconds / 60;
  const speed = meters / minutes; // m/min
  const vo2 = vo2Cost(speed);
  const pct = pctVO2(minutes);
  const vdot = vo2 / pct;
  return isFinite(vdot) ? vdot : null;
}

/** Given (finish_seconds, distance_mi), return the VDOT that predicts
 *  exactly that finish time. Returns null if outside [30, 85]. */
export function vdotFromRace(finishSeconds: number, distanceMi: number): number | null {
  if (!finishSeconds || finishSeconds < 60) return null;
  const vdot = rawVdot(finishSeconds, distanceMi);
  if (vdot == null) return null;
  if (vdot < 30 || vdot > 85) return null;
  return Math.round(vdot * 10) / 10; // 1 decimal place
}

/**
 * Invert the Daniels race-time table: given a VDOT and a distance, predict
 * the finish time (seconds). This is the projection direction — "at your
 * current fitness, racing distance D today would take ~T."
 *
 * `rawVdot` is monotonically decreasing in finish time (slower time → lower
 * VDOT), so we binary-search the time whose predicted VDOT matches the
 * target. Bounds span 2:30/mi (elite) to 25:00/mi (walk) — any realistic
 * VDOT∈[30,85] resolves inside that window. Returns null on bad input.
 *
 * Cite: Daniels Running Formula §VDOT table (same formula as `vdotFromRace`).
 */
export function predictRaceTime(vdot: number, distanceMi: number): number | null {
  if (!vdot || vdot <= 0 || !distanceMi || distanceMi <= 0) return null;
  let lo = distanceMi * 150;   // 2:30/mi floor
  let hi = distanceMi * 1500;  // 25:00/mi ceiling
  let mid = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const v = rawVdot(mid, distanceMi);
    if (v == null) break;
    if (v > vdot) lo = mid; // predicted VDOT too high → time too fast → go slower
    else hi = mid;
  }
  return Math.round(mid);
}

/**
 * 2026-06-03 · derive Daniels T-pace (s/mi) from a VDOT score.
 *
 * Uses predictRaceTime(vdot, 13.1) to get the runner's HM-implied
 * finish time, then applies the canonical HM → T conversion (HM pace
 * minus 5 s/mi · matches spec-builder.tPaceFromGoal for HM). This is
 * the doctrinal mapping: HM race effort is roughly T-pace, so HM-VDOT
 * is the cleanest anchor for T-pace derivation.
 *
 * Used by the plan generator's Rule 3 pace-anchor blend (mid-block
 * doctrine) · runners whose current VDOT is below goal-implied VDOT
 * get early-week paces anchored to currentT, ramping toward goalT.
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace
 * Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 3
 */
export function tPaceFromVdot(vdot: number | null | undefined): number | null {
  if (!vdot || !Number.isFinite(vdot) || vdot <= 0) return null;
  const hmSec = predictRaceTime(vdot, 13.1);
  if (hmSec == null) return null;
  const hmPaceSPerMi = hmSec / 13.1;
  // HM pace minus 5 s/mi · same offset as spec-builder.tPaceFromGoal
  // for the half-marathon branch (lines 315-316).
  return Math.round(hmPaceSPerMi - 5);
}

/**
 * 2026-06-11 · invert tPaceFromVdot: given an observed/prescribed threshold
 * pace (s/mi), return the VDOT whose T-pace matches it. The honest read of a
 * tempo workout — "you sustained T-pace X, which is the threshold pace for
 * VDOT Y" — instead of vdotFromRace's "you raced X all-out" understatement.
 *
 * tPaceFromVdot is monotonically decreasing in VDOT (fitter → faster T-pace),
 * so binary-search the [30,85] table. Returns null on bad input.
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace (inverse of tPaceFromVdot).
 */
export function vdotFromTpace(tPaceSPerMi: number): number | null {
  if (!tPaceSPerMi || tPaceSPerMi <= 0) return null;
  let lo = 30, hi = 85;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const tp = tPaceFromVdot(mid);
    if (tp == null) return null;
    // T-pace slower (larger s/mi) than target → VDOT too low → search up.
    if (tp > tPaceSPerMi) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/**
 * 2026-06-11 · invert marathon pace → VDOT. M-pace is even more sub-maximal
 * than T-pace, so reading a marathon-pace segment as an all-out race understates
 * fitness the most. M-pace(v) = predictRaceTime(v, 26.2188)/26.2188; binary
 * search the table. Cite: Research/01-pace-zones-vdot.md §Daniels-M-pace.
 */
export function vdotFromMpace(mPaceSPerMi: number): number | null {
  if (!mPaceSPerMi || mPaceSPerMi <= 0) return null;
  let lo = 30, hi = 85;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const t = predictRaceTime(mid, 26.2188);
    if (t == null) return null;
    if (t / 26.2188 > mPaceSPerMi) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/** Map a workout-type string to its training zone, for the zone-aware VDOT read
 *  in vdotFromRun. Null when the type doesn't pin a zone. */
export function zoneFromType(t: string | null | undefined):
  'threshold' | 'marathon' | 'interval' | 'race' | null {
  const w = String(t ?? '').toLowerCase();
  if (w === 'threshold' || w === 'tempo' || w === 'cruise') return 'threshold';
  if (w === 'marathon_pace' || w === 'mp' || w === 'marathon') return 'marathon';
  if (w === 'intervals' || w === 'interval' || w === 'vo2' || w === 'vo2max') return 'interval';
  if (w === 'race' || w === 'time_trial' || w === 'tune_up' || w === 'race_week_tuneup') return 'race';
  return null;
}

/** Format seconds → "1:44:50" (h:mm:ss) or "59:30" (m:ss). */
export function formatRaceTime(seconds: number | null | undefined): string | null {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Parse a race time string → seconds.
 *
 * Accepts three shapes:
 *   · "H:MM:SS"  → hours + minutes + seconds  (e.g. "1:34:54" finish time)
 *   · "H:MM"     → hours + minutes            (e.g. "1:30" HM goal)
 *   · "MM:SS"    → minutes + seconds          (e.g. "23:15" 5K time)
 *
 * 2026-06-03 · was treating "1:30" as 90 seconds (MM:SS interpretation) ·
 * but race GOALS commonly omit seconds ("1:30" sub-1:30 HM, "3:00" sub-3
 * marathon). Heuristic: first part ≤ 9 → H:MM, else MM:SS. Real races
 * don't take 10+ hours and 5K/10K times fit in 9:99 MM:SS anyway.
 *
 * Cite: David's race meta `goalDisplay: "1:30"` for AFC Half · used to
 * silently produce 90s = 0.025 hr in vdot calcs · obviously broken.
 */
export function parseRaceTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  // Two-part form · H:MM vs MM:SS heuristic.
  const first = +m[1];
  const second = +m[2];
  // First part ≤ 9 → H:MM (sub-9hr race · covers 5K-to-ultra goals).
  if (first <= 9) return first * 3600 + second * 60;
  // First part > 9 → MM:SS (any race longer than 10 min · 5K/10K finishes).
  return first * 60 + second;
}

export interface RaceVdotCandidate {
  source: 'race';
  slug: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C' | null;
  distance_mi: number;
  finish_seconds: number;
  /** Effective VDOT after the stale-anchor fade (= vdot_raw inside the
   *  full-value window). This is the value every consumer should treat
   *  as "current fitness estimate". */
  vdot: number;
  /** Raw Daniels VDOT of the performance, no age adjustment. */
  vdot_raw: number;
  /** Anchor age at evaluation time (days from race date to `today`). */
  age_days: number;
}

export interface RunVdotCandidate {
  source: 'run';
  id: string;
  date: string;
  workout_type: string | null;
  distance_mi: number;
  finish_seconds: number;
  vdot: number;
  vdot_raw: number;
  age_days: number;
}

export type VdotCandidate = RaceVdotCandidate | RunVdotCandidate;

/**
 * Workout types considered "quality" — runs done at honest, sustained effort
 * such that the pace × duration tells us something real about fitness.
 *
 * Easy/recovery runs are excluded: a conversational-pace run from a runner
 * sandbagging easy days produces a wildly understated VDOT, so we don't read
 * VDOT off them at all.
 */
const QUALITY_RUN_TYPES = new Set([
  'threshold', 'tempo', 'cruise', 'intervals', 'vo2', 'vo2max',
  'marathon_pace', 'mp', 'race', 'time_trial', 'tune_up',
]);

/**
 * Derive VDOT from a single sustained training run.
 *
 * Treats the run as a "virtual race" at its actual pace + distance and
 * inverts Daniels' formula (same as vdotFromRace). The catch: a run is only
 * VDOT-readable if effort was honest, otherwise pace doesn't reflect fitness.
 * Gates:
 *   - Workout type is in QUALITY_RUN_TYPES (the plan called for hard work), OR
 *   - avg HR ≥ 80% of max HR (independent evidence of threshold-or-harder effort)
 * AND distance ≥ 4 miles (shorter runs are too noisy to lock VDOT off of).
 *
 * Returns null when the run doesn't pass the gate or VDOT lands outside [30,85].
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace + §VDOT-table (same
 * Daniels formula as vdotFromRace, applied to workout pace).
 */
export function vdotFromRun(input: {
  finishSeconds: number;
  distanceMi: number;
  workoutType?: string | null;
  avgHr?: number | null;
  maxHr?: number | null;
  /** 2026-06-11 · the prescribed training zone (from the plan, when the run
   *  matched a plan quality day). Overrides the zone inferred from workoutType.
   *  Lets a threshold/marathon-pace effort read by its zone instead of as a
   *  race — see below. */
  zone?: 'threshold' | 'marathon' | 'interval' | 'race' | null;
}): number | null {
  if (!input.finishSeconds || input.finishSeconds < 60) return null;
  if (!input.distanceMi || input.distanceMi < 4) return null;

  const wType = String(input.workoutType ?? '').toLowerCase();
  const isQuality = QUALITY_RUN_TYPES.has(wType);
  const hrFloor = input.maxHr ? input.maxHr * 0.80 : null;
  const isHardEffort =
    input.avgHr != null && hrFloor != null && input.avgHr >= hrFloor;

  if (!isQuality && !isHardEffort) return null;

  // 2026-06-11 · zone-aware read. A sustained sub-maximal effort (threshold,
  // marathon pace) is NOT an all-out race — reading it via vdotFromRace
  // understates VDOT ~3 points, so a tempo at the right pace could never move
  // current fitness off a stale race anchor (David's repeated ask). Invert the
  // Daniels ZONE mapping for those. Intervals (I-pace ≈ 3-5K race pace) and
  // races read correctly as a race, so they keep vdotFromRace. bestRecentVdot
  // takes the MAX, so this can only RAISE current fitness from honest training,
  // never lower it.
  const zone = input.zone ?? zoneFromType(wType);
  const pace = input.finishSeconds / input.distanceMi;
  if (zone === 'threshold') return vdotFromTpace(pace);
  if (zone === 'marathon') return vdotFromMpace(pace);
  return vdotFromRace(input.finishSeconds, input.distanceMi);
}

/**
 * Best (highest) VDOT from races AND optional training runs within the
 * lookback window.
 *
 * Race candidates: skip C-races; skip without finish time; cap at lookback.
 * Run candidates: gated by vdotFromRun's quality filter (see above).
 *
 * Tie-break: race VDOT counts at face value; run VDOT is penalized by 1
 * point for sort purposes (a single real race always wins ties against
 * a training-derived estimate). This is the "race wins ties" doctrine.
 *
 * 2026-06-09 · race-killer F1 — STALE-ANCHOR FADE. The hard window used
 * to cliff: the day an anchor crossed `lookbackDays` it vanished and the
 * next-best (often much slower) race took over overnight. Production
 * case: Disney HM (Feb 1, 47.9) was due to exit the 180-day window on
 * Aug 1 — VDOT 47.9 → 44.1 (LA Marathon), HM projection 1:34:54 →
 * 1:41:55, fifteen days before the A-race, with zero fitness change.
 *
 * Now: candidates keep FULL value through `lookbackDays`, then fade at
 * 0.1 VDOT per 14 days for up to `FADE_TAIL_DAYS` more before dropping
 * out entirely. This is estimator smoothing, not physiology — the same
 * staleness judgment the hard window already encoded, applied gradually
 * instead of as a step function. Newer evidence (a race or qualifying
 * run) still takes over the moment it scores higher — the fade only
 * governs how an aging anchor exits. Fresh anchors are unaffected:
 * age ≤ lookbackDays → effective ≡ raw. Recency-over-age precedent:
 * Research/02-race-time-prediction.md §"estimate the exponent from two
 * RECENT races". Cite: docs/ADVERSARIAL-AUDIT-REPORT.md §F1.
 */
const FADE_PER_14D = 0.1;
const FADE_TAIL_DAYS = 120;

export function bestRecentVdot(
  races: Array<{ slug: string; name: string; date: string; priority: 'A'|'B'|'C'|null; distance_mi: number | null; finish_seconds: number | null }>,
  todayISO: string,
  lookbackDays = 180,
  runs?: Array<{
    id: string;
    date: string;
    workout_type: string | null;
    distance_mi: number | null;
    finish_seconds: number | null;
    avg_hr?: number | null;
    max_hr?: number | null;
    /** Prescribed training zone for the zone-aware read (vdotFromRun). */
    zone?: 'threshold' | 'marathon' | 'interval' | 'race' | null;
  }>,
): { best: VdotCandidate | null; considered: VdotCandidate[] } {
  const todayMs = Date.parse(todayISO + 'T12:00:00Z');
  // Hard cutoff now includes the fade tail; the fade handles 180→300.
  const cutoff = new Date(todayMs - (lookbackDays + FADE_TAIL_DAYS) * 86400000).toISOString().slice(0, 10);

  const ageDays = (dateISO: string): number =>
    Math.max(0, Math.round((todayMs - Date.parse(dateISO + 'T12:00:00Z')) / 86400000));
  const effective = (raw: number, age: number): number => {
    const over = Math.max(0, age - lookbackDays);
    const faded = raw - (over / 14) * FADE_PER_14D;
    return Math.round(faded * 10) / 10;
  };

  const raceCandidates: RaceVdotCandidate[] = [];
  for (const r of races) {
    if (!r.date || !r.distance_mi || !r.finish_seconds) continue;
    if (r.date < cutoff) continue;
    if (r.priority === 'C') continue;
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v == null) continue;
    const age = ageDays(r.date);
    raceCandidates.push({
      source: 'race',
      slug: r.slug, name: r.name, date: r.date, priority: r.priority,
      distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
      vdot: effective(v, age), vdot_raw: v, age_days: age,
    });
  }

  const runCandidates: RunVdotCandidate[] = [];
  if (runs && runs.length > 0) {
    for (const r of runs) {
      if (!r.date || r.date < cutoff) continue;
      if (!r.distance_mi || !r.finish_seconds) continue;
      const v = vdotFromRun({
        finishSeconds: r.finish_seconds,
        distanceMi: r.distance_mi,
        workoutType: r.workout_type,
        avgHr: r.avg_hr ?? null,
        maxHr: r.max_hr ?? null,
        zone: r.zone ?? null,
      });
      if (v == null) continue;
      const age = ageDays(r.date);
      runCandidates.push({
        source: 'run',
        id: r.id, date: r.date, workout_type: r.workout_type,
        distance_mi: r.distance_mi, finish_seconds: r.finish_seconds,
        // Run candidates live in a 60-day loader window — well inside
        // lookbackDays, so effective ≡ raw today; kept uniform anyway.
        vdot: effective(v, age), vdot_raw: v, age_days: age,
      });
    }
  }

  // Sort key: races at (effective) face value, runs -1 so a real race
  // wins ties against a training-derived estimate.
  const sortKey = (c: VdotCandidate) => (c.source === 'race' ? c.vdot : c.vdot - 1);
  const considered = [...raceCandidates, ...runCandidates]
    .sort((a, b) => sortKey(b) - sortKey(a));
  return { best: considered[0] ?? null, considered };
}
