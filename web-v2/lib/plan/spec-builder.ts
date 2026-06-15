/**
 * lib/plan/spec-builder.ts · single source of truth for workout_spec +
 * pace_target_s_per_mi derivation from runner VDOT + LTHR.
 *
 * Extracted from app/api/admin/backfill-workout-spec/route.ts so the
 * generator + backfill cron + adapter all derive the same way.
 *
 * Inputs: workout type + distance + T-pace (from VDOT) + LTHR (optional).
 * Optional: prescription string (e.g. "6×800m @ I pace · 90s jog") ·
 *           when present, threshold + intervals branches read rep
 *           count / rep distance / rest seconds from the parsed
 *           prescription instead of hardcoded defaults. Fixes the
 *           sub_label vs workout_spec mismatch flagged 2026-06-02.
 *
 * Outputs: workout_spec jsonb + a primary pace_target_s_per_mi scalar
 * for the column (the "headline" pace for the type · used by chip render).
 *
 * Doctrine:
 *   · Daniels' Running Formula · T/I/M/E pace offsets
 *   · Research/01 §pace-zones
 *   · Friel zones for HR caps · Rule 16 (2026-06-03 doctrine fix):
 *     Easy + Long HR cap = 89% LTHR (top of Friel Z2 "Aerobic / Long-run
 *     base") OR 78% maxHR (Daniels E pace upper) — whichever is higher
 *     when both anchors are known.
 *
 *     Was: 80% LTHR for easy (=top of Friel Z1 RECOVERY · way too tight),
 *          85% LTHR for long.
 *     David's profile: LTHR 162, maxHR 188 → cap was 130 (recovery zone),
 *          now 144 (top of Friel Z2 = honest easy ceiling).
 *
 *     Universal applicability · every runner uses the same math. No UUID
 *     hardcodes, no carve-outs.
 */

import { parsePrescription, parseTempoShape } from './prescription-parser';

export type WorkoutSpec = Record<string, unknown> | null;

export interface SpecBuildResult {
  /** workout_spec column value · null for types where it's intentionally absent. */
  spec: WorkoutSpec;
  /** Primary pace target in seconds per mile for the pace_target_s_per_mi
   *  column · null for easy/recovery/rest (no specific target). */
  paceTargetSPerMi: number | null;
}

// ── HR helpers ──────────────────────────────────────────────────────────

/**
 * 2026-06-03 · Rule 16 (Easy HR cap doctrine fix · canonical).
 *
 * Easy + Long HR cap = MAX(89% LTHR, 78% maxHR) when both known, else
 * the available single anchor.
 *
 *  · 89% LTHR = top of Friel Z2 "Aerobic / Long-run base"
 *    (Research/03-heart-rate-zones.md §6 · matches lthrZones() Z2 upper)
 *  · 78% maxHR = top of Daniels E pace zone
 *    (Daniels Running Formula 3e · "easy / aerobic" upper bound)
 *
 * Was: lthr × 0.80 for easy (= top of Friel Z1 RECOVERY, way too tight)
 *      and lthr × 0.85 for long (= mid-Z2, also too tight).
 *
 * For a runner with LTHR 162 + maxHR 188 (David's profile):
 *   · old easy cap: 130 bpm (recovery zone · made every honest easy
 *     run trip OFF PLAN on warm days)
 *   · new easy cap: max(89% × 162, 78% × 188) = max(144, 147) = 147
 *   · matches Daniels E ceiling, accommodates real easy effort
 *
 * Same number for easy + long because LONG IS EASY EFFORT, just more
 * volume. The old 85% LTHR split between them was an artifact of
 * over-cautious Friel translation, not a doctrinal distinction.
 *
 * Why MAX-of-anchors: the two methods often disagree (different
 * physiologies map differently). Taking the max is the lenient,
 * honest read · forces a cap below "easy" only when BOTH anchors say
 * it should be lower. Runners whose maxHR is high relative to LTHR
 * (anaerobic-trained) get the maxHR-derived cap; runners whose LTHR
 * is high relative to maxHR (aerobic-trained) get the LTHR-derived
 * cap. Universal applicability without per-profile carve-outs.
 *
 * Watch app already used `lthr × 0.89` in lib/watch/build-workout.ts ·
 * this aligns the plan generator with the watch app · single doctrine.
 */
function hrCapEasy(lthr: number | null, maxHr: number | null = null): number | null {
  const lthrCap = lthr ? Math.round(lthr * 0.89) : null;
  const maxHrCap = maxHr ? Math.round(maxHr * 0.78) : null;
  if (lthrCap == null && maxHrCap == null) return null;
  if (lthrCap == null) return maxHrCap;
  if (maxHrCap == null) return lthrCap;
  return Math.max(lthrCap, maxHrCap);
}

/** Long-run HR cap · same as easy. Long IS easy effort, just more volume.
 *  Kept as a separate function for callsite clarity + future divergence. */
function hrCapLong(lthr: number | null, maxHr: number | null = null): number | null {
  return hrCapEasy(lthr, maxHr);
}

function hrLthrBpm(lthr: number | null): number | null {
  return lthr ?? null;
}

// ── Fuel timing ──────────────────────────────────────────────────────────

function fuelMi(dist: number | null): number[] {
  if (!dist || dist < 8) return [];
  const out: number[] = [];
  // First fuel at mi 5, then every 4 mi
  for (let m = 5; m < dist; m += 4) out.push(m);
  return out;
}

// ── Long-run finish segment ───────────────────────────────────────────────

/**
 * 2026-06-07 · Audit D / D1 · parse a long-run finish segment out of the
 * prescription (= the generator's sub_label, e.g. "LONG · 7mi @ HM" or
 * "LONG · 4mi @ M"). Before this, the long branch ignored the prescription
 * entirely and emitted a flat easy spec, so the watch executed a flat long
 * run under a label that promised an HM/M finish (the D1 mismatch).
 *
 * Doctrine: Research/22 §3 (HM Advanced) — "16 mi LR w/ last 8 mi @ HMP";
 * Intermediate phases — "LR with HMP segments". HM-pace segment = T+5,
 * marathon-pace segment = T+18 (Daniels; matches `mp`/`tPaceFromGoal`).
 *
 *   "LONG · 7mi @ HM" → { mi: 7, tag: 'HM' }
 *   "LONG · 4mi @ M"  → { mi: 4, tag: 'M' }   (also accepts "@ MP")
 *   "LONG"            → null
 */
function extractFinishSegment(
  prescription?: string | null,
): { mi: number; tag: 'HM' | 'M' } | null {
  if (!prescription) return null;
  const m = String(prescription).match(/(\d+(?:\.\d+)?)\s*mi\s*@\s*(HM|MP|M)\b/i);
  if (!m) return null;
  const mi = Number(m[1]);
  if (!Number.isFinite(mi) || mi <= 0) return null;
  // 'HM' → half-marathon pace; 'M'/'MP' → marathon pace.
  const tag: 'HM' | 'M' = m[2].toUpperCase().startsWith('H') ? 'HM' : 'M';
  return { mi, tag };
}

/**
 * Build a workout_spec + pace_target for a single workout row.
 *
 * Returns `{ spec: null, paceTargetSPerMi: null }` for types whose spec
 * is intentionally absent (rest / cross / strength). For easy / recovery,
 * spec is populated but paceTargetSPerMi stays null (no single headline
 * pace · the spec carries a lo/hi range).
 */
export function buildWorkoutSpec(
  type: string,
  distance_mi: number | null,
  tPaceSec: number,
  lthr: number | null,
  prescription?: string | null,
  // 2026-06-03 · Rule 16 · maxHR anchor for the easy/long HR cap.
  // Optional · when both lthr + maxHr present, hrCapEasy takes the
  // higher of the two anchor-derived caps. Callers that don't yet
  // thread maxHr fall back to lthr-only (89% LTHR · still honest
  // Friel Z2 ceiling, just no Daniels cross-check).
  maxHr: number | null = null,
  // 2026-06-09 state-audit fix · the runner's GOAL pace (s/mi) for the
  // race-day row. Only the 'race' branch reads it. Optional so legacy
  // callers (restore, adapt) keep compiling · they fall back to the
  // inverse-of-tPaceFromGoal derivation inside the race case.
  goalPaceSPerMi: number | null = null,
  // 2026-06-15 · true Daniels I-pace (s/mi) for the intervals/vo2max branch,
  // from iPaceFromVdot(currentVdot). When provided it REPLACES the legacy
  // `tPaceSec - 18` constant offset (which only approximates I-pace at high
  // VDOT and lands near threshold for a novice / 5K-goal runner — slower than
  // their own easy days). Optional · callers that don't pass it (marathon /
  // maintenance) keep the cruise-interval behavior unchanged.
  // Cite: Research/01-pace-zones-vdot.md §Daniels-I (I-pace ≈ 5K race pace).
  iPaceSec: number | null = null,
): SpecBuildResult {
  // 2026-06-02 · parse the prescription up front (e.g. "6×800m @ I
  // pace · 90s jog" → {reps:6, repDistanceMi:0.497, restS:90}). When
  // parseable, threshold + intervals branches use these instead of
  // the hardcoded defaults so the spec matches the prescription text.
  // Null when prescription is absent or doesn't carry a rep pattern
  // (e.g. "continuous tempo") · branches fall back to historical
  // defaults.
  const parsed = parsePrescription(prescription);
  // 2026-06-09 Phase 2 (3.2) · contingency rules per type. The watch
  // OFFERS the bail on breach (CONTINUE / TAKE THE BAIL · never
  // enforces); pass rules are post-run confirmation criteria (the same
  // numbers the WATCHING test reads); the race abort mirrors the
  // execution plan's mile-5 checkpoint (lib/race/execution-plan.ts —
  // LTHR+3 / goal+23 · keep in sync). Null-LTHR runners get pace rules
  // only · never an invented HR number.
  const contingencyRules = ((): Array<Record<string, unknown>> | null => {
    const rules: Array<Record<string, unknown>> = [];
    const passHr = lthr != null ? Math.round(lthr * 0.975) : null;
    const bailHr = lthr != null ? lthr + 5 : null;
    if (type === 'threshold' || type === 'tempo' || type === 'intervals' || type === 'race_week_tuneup') {
      if (passHr != null) {
        rules.push({ kind: 'pass', metric: 'hr', op: '<=', value: passHr, scope: 'work', action: null,
          label: `Pass: avgHr ≤ ${passHr} on the work` });
      }
      if (bailHr != null) {
        rules.push({ kind: 'bail', metric: 'hr', op: '>', value: bailHr, scope: 'work', action: 'drop_to_easy',
          label: `HR over ${bailHr} and climbing · finish easy, the stimulus is banked` });
      }
    } else if (type === 'long') {
      if (bailHr != null && extractFinishSegment(prescription)) {
        rules.push({ kind: 'bail', metric: 'hr', op: '>', value: bailHr, scope: 'finish', action: 'cut_finish_half',
          label: `HR over ${bailHr} mid-finish · cut the finish in half, jog home` });
      }
    } else if (type === 'race') {
      const abortHr = lthr != null ? lthr + 3 : (maxHr != null ? Math.round(maxHr * 0.91) : null);
      if (abortHr != null) {
        rules.push({ kind: 'abort', metric: 'hr', op: '>', value: abortHr, scope: 'mile-5', action: 'switch_to_b_goal',
          label: `Mile 5 check: avgHr over ${abortHr} · switch to the B plan` });
      }
      if (goalPaceSPerMi != null) {
        rules.push({ kind: 'abort', metric: 'pace', op: '>', value: goalPaceSPerMi + 23, scope: 'mile-5', action: 'switch_to_b_goal',
          label: `Mile 5 check: pace slower than goal +23s · switch to the B plan` });
      }
    }
    return rules.length > 0 ? rules : null;
  })();
  const withRules = contingencyRules ? { rules: contingencyRules } : {};
  // Research/01 §VDOT-50 table: E = T+104 to T+156. T+80 floor lands within 7s of
  // Daniels' E minimum, moving easy runs out of GA/steady-state territory.
  const easyLo = tPaceSec + 80, easyHi = tPaceSec + 120;
  const longLo = tPaceSec + 55, longHi = tPaceSec + 90;
  const tempo  = tPaceSec + 12;         // mid of T+5 to T+18
  // Daniels I = T−33 (95-100% VO2max, ~3K-5K pace). T−18 is a deliberate
  // conservative deviation: ~10-12K pace, yielding more sub-VO2max ceiling work
  // rather than true VO2max intervals. Appropriate for a 40-50 mpw runner who
  // cannot absorb full Daniels I volume without injury risk. Cite: Research/01 §Daniels-I.
  const interval = tPaceSec - 18;
  const recovery = tPaceSec + 100;      // very easy
  const mp = tPaceSec + 18;             // marathon pace

  switch (type) {
    case 'easy':
      return {
        spec: {
          kind: 'easy',
          pace_target_s_per_mi_lo: easyLo,
          pace_target_s_per_mi_hi: easyHi,
          hr_cap_bpm: hrCapEasy(lthr, maxHr),
          fuel_mi: [],
        },
        // Easy days don't have a single "headline" pace · the chip
        // shows a lo-hi range from the spec, not pace_target_s_per_mi.
        paceTargetSPerMi: null,
      };
    case 'recovery':
      return {
        spec: {
          kind: 'recovery',
          pace_target_s_per_mi_lo: recovery,
          pace_target_s_per_mi_hi: recovery + 30,
          hr_cap_bpm: hrCapEasy(lthr, maxHr),
        },
        paceTargetSPerMi: null,
      };
    case 'long': {
      // 2026-06-07 · Audit D / D1 · when the prescription describes an HM/M
      // finish segment ("LONG · 7mi @ HM"), encode it so the watch executes
      // easy-build + finish instead of one flat phase. HM finish = T+5,
      // M finish = T+18 (Daniels; mirrors `mp` + `tPaceFromGoal`). Absent →
      // plain flat long (backward-compatible). Cite: Research/22 §3.
      const finish = extractFinishSegment(prescription);
      const finishFields = finish
        ? {
            finish_mi: finish.mi,
            finish_pace_s_per_mi: finish.tag === 'HM' ? tPaceSec + 5 : tPaceSec + 18,
            finish_label: finish.tag,
          }
        : {};
      return {
        spec: {
          kind: 'long',
          pace_target_s_per_mi_lo: longLo,
          pace_target_s_per_mi_hi: longHi,
          hr_cap_bpm: hrCapLong(lthr, maxHr),
          fuel_mi: fuelMi(distance_mi),
          ...finishFields,
          ...withRules,
        },
        // Long-run "headline" pace is the easy long pace · take the
        // middle of the range.
        paceTargetSPerMi: Math.round((longLo + longHi) / 2),
      };
    }
    case 'tempo': {
      // 2026-06-02 · prefer parsed tempo shape (e.g. "2 mi WU · 4 mi @
      // T · 2 mi CD" → wu=2, tempo=4, cd=2). Falls back to historical
      // math when the prescription string is absent or unparseable.
      const parsedTempo = parseTempoShape(prescription);
      const tempoDist = parsedTempo?.tempoMi
        ?? Math.max(2, Math.min(7, (distance_mi ?? 8) - 3));
      const wu = parsedTempo?.warmupMi
        ?? ((distance_mi ?? 8) - tempoDist) / 2;
      const cd = parsedTempo?.cooldownMi ?? wu;
      return {
        spec: {
          kind: 'tempo',
          warmup_mi: Number(wu.toFixed(1)),
          tempo_distance_mi: Number(tempoDist.toFixed(1)),
          tempo_pace_s_per_mi: tempo,
          cooldown_mi: Number(cd.toFixed(1)),
          hr_target_bpm: lthr ? Math.round(lthr * 0.92) : null,
          ...withRules,
        },
        paceTargetSPerMi: tempo,
      };
    }
    case 'threshold': {
      // 2026-06-02 · prefer parsed prescription · falls back to
      // historical defaults when the rx string is absent / unparseable.
      const repCount = parsed?.reps ?? 4;
      const repMi = parsed?.repDistanceMi ?? 1.0;
      const restS = parsed?.restS ?? 60;
      const wu = ((distance_mi ?? 7) - repCount * repMi - 1) / 2;
      return {
        spec: {
          kind: 'threshold',
          warmup_mi: Number(Math.max(1.5, wu).toFixed(1)),
          rep_count: repCount,
          rep_distance_mi: repMi,
          rep_pace_s_per_mi: tPaceSec,
          rep_rest_s: restS,
          cooldown_mi: Number(Math.max(1.0, wu).toFixed(1)),
          lthr_bpm: hrLthrBpm(lthr),
          ...withRules,
        },
        paceTargetSPerMi: tPaceSec,
      };
    }
    case 'intervals':
    case 'vo2max': {
      // 2026-06-02 · prefer parsed prescription · falls back to
      // historical defaults when the rx string is absent / unparseable.
      const repCount = parsed?.reps ?? 5;
      const repMi = parsed?.repDistanceMi ?? 0.62;
      const restS = parsed?.restS ?? 90;
      const wu = ((distance_mi ?? 7) - repCount * repMi - 1) / 2;
      // True I-pace when the caller threaded a VDOT-derived one (goal builds);
      // else the legacy T−18 cruise-interval offset (marathon / maintenance).
      const repPace = iPaceSec ?? interval;
      return {
        spec: {
          kind: 'intervals',
          warmup_mi: Number(Math.max(1.5, wu).toFixed(1)),
          rep_count: repCount,
          rep_distance_mi: repMi,
          rep_pace_s_per_mi: repPace,
          rep_rest_s: restS,
          cooldown_mi: Number(Math.max(1.0, wu).toFixed(1)),
          lthr_bpm: hrLthrBpm(lthr),
          ...withRules,
        },
        paceTargetSPerMi: repPace,
      };
    }
    case 'race': {
      // 2026-06-09 state-audit fix · race day targets GOAL pace, not
      // T-pace. The old `paceTargetSPerMi: tPaceSec` handed the runner
      // a number 5 s/mi hot for an HM (1:30:00 goal → 6:52/mi goal
      // pace, but T = goal − 5 = 6:47/mi landed on the watch · a 66s
      // over-commitment at the gun · the canonical HM blow-up per
      // Research/08 §3.4 + §18.2). When the caller doesn't thread the
      // goal pace (legacy restore/adapt paths), invert tPaceFromGoal's
      // distance offsets to recover it from T.
      const dMi = distance_mi ?? 13.1;
      const inverseOffset = dMi >= 25 ? 18 : dMi >= 12 ? 5 : dMi >= 5 ? -8 : -15;
      const racePace = goalPaceSPerMi ?? (tPaceSec + inverseOffset);
      return {
        spec: {
          kind: 'long',  // no 'race' kind in WorkoutSpec union · stash as long
          // −5 (controlled push, back half) to +5. The first-mile
          // allowance is structural (watch settle phase + execution
          // plan), not baked into the band.
          pace_target_s_per_mi_lo: racePace - 5,
          pace_target_s_per_mi_hi: racePace + 5,
          // Race-effort HR ceiling per Research/08 §6.1: an HM races at
          // 96-100% of LTHR · the old 0.95× cap sat BELOW honest HM
          // effort and would alarm the entire race. Marathon+ → 92%.
          // Sub-HM races run above LTHR · a ceiling is wrong there.
          hr_cap_bpm: lthr
            ? (dMi >= 25 ? Math.round(lthr * 0.92) : dMi >= 12 ? lthr : null)
            : null,
          fuel_mi: fuelMi(distance_mi),
          ...withRules,
        },
        paceTargetSPerMi: racePace,
      };
    }
    case 'shakeout':
      return {
        spec: {
          kind: 'easy',
          pace_target_s_per_mi_lo: easyHi,
          pace_target_s_per_mi_hi: easyHi + 30,
          hr_cap_bpm: hrCapEasy(lthr, maxHr),
          fuel_mi: [],
        },
        paceTargetSPerMi: null,
      };
    case 'race_week_tuneup': {
      // 2026-06-09 state-audit Tier 2.2 · honor the prescription. The
      // generator now schedules the doctrinal HM/M tune-up ("4×1km @
      // race pace · 90s jog" · Research/08 §9.3) at T-5; this branch
      // was hardcoded to 2×0.5mi @ T−5 and would have silently built
      // a different workout than the label promised. Reps/rest come
      // from parsePrescription when present; pace anchors to RACE pace
      // when the label says so (goal pace when threaded, else the
      // inverse-offset derivation from T — same mapping as the race
      // branch), else stays at the T−5 primer.
      const repCount = parsed?.reps ?? 2;
      const repMi = parsed?.repDistanceMi ?? 0.5;
      const restS = parsed?.restS ?? 60;
      const wantsRacePace = /race\s*pace|@\s*(?:HM|M)P?\b/i.test(String(prescription ?? ''));
      // NOTE: distance_mi here is the WORKOUT's distance (~5mi), not the
      // race's, so the race branch's inverse-offset trick is unavailable.
      // Race pace comes from the threaded goal pace; the no-goal fallback
      // is plain T — an honest race-week primer for any distance, never
      // hotter than the runner's threshold.
      const repPace = wantsRacePace
        ? (goalPaceSPerMi ?? tPaceSec)
        : tPaceSec - 5;
      return {
        spec: {
          kind: 'threshold',
          warmup_mi: 1.5,
          rep_count: repCount,
          rep_distance_mi: repMi,
          rep_pace_s_per_mi: repPace,
          rep_rest_s: restS,
          cooldown_mi: 1.0,
          lthr_bpm: hrLthrBpm(lthr),
          ...withRules,
        },
        paceTargetSPerMi: repPace,
      };
    }
    case 'rest':
    case 'cross':
    case 'strength':
      return { spec: null, paceTargetSPerMi: null };
    default:
      return { spec: null, paceTargetSPerMi: null };
  }
}

/**
 * 2026-06-02 · derive the TOTAL miles a workout actually covers from
 * its spec · used to populate plan_workouts.distance_mi so the chip
 * the runner reads matches the title.
 *
 * Was: distance_mi stored only the CORE workout (e.g. "4×1 mi @ T" →
 * 4.0 mi), but the title also listed WU + CD. Runner saw "2 mi WU ·
 * 4 mi @ T · 2 mi CD · 4.0 mi" which doesn't math (8 mi of running,
 * card said 4 mi). David called this out 2026-06-02.
 *
 * Now: distance_mi = WU + core + floats + CD. Matches what the watch
 * will record + the runner's actual mileage.
 *
 * Float distance · for threshold/intervals the rest is a jog (not
 * standing still) so it counts toward total. Approximated at a 9:00/mi
 * jog pace (540 s/mi) · float_mi = (rep_rest_s × (reps-1)) / 540.
 * The actual float pace varies by runner but the approximation is
 * within 5-10% of reality and beats the old "core-only" lie.
 *
 * Returns the fallback when:
 *   · spec is null (rest / cross / strength / unrecognized type)
 *   · spec.kind is a single-segment shape (easy / long / recovery /
 *     shakeout / race) · those carry their full distance already
 */
export function totalDistanceMiFromSpec(
  spec: WorkoutSpec,
  fallbackDistanceMi: number,
): number {
  if (!spec || typeof spec !== 'object') return fallbackDistanceMi;
  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  const wu = Number(s.warmup_mi ?? 0) || 0;
  const cd = Number(s.cooldown_mi ?? 0) || 0;
  switch (kind) {
    case 'tempo': {
      const core = Number(s.tempo_distance_mi ?? 0) || 0;
      return Number((wu + core + cd).toFixed(1));
    }
    case 'threshold':
    case 'intervals': {
      const reps = Number(s.rep_count ?? 0) || 0;
      // 2026-06-02 · schema has two historical key variants:
      //   · rep_distance_mi (newer, miles · what spec-builder emits today)
      //   · rep_distance_m  (older, metres · legacy plan rows)
      // Prefer miles when present; fall back to metres / 1609.34.
      const repMi = Number(s.rep_distance_mi ?? 0) || 0;
      const repM = Number(s.rep_distance_m ?? 0) || 0;
      const effRepMi = repMi > 0 ? repMi : repM / 1609.34;
      const restS = Number(s.rep_rest_s ?? 0) || 0;
      const repTotal = reps * effRepMi;
      const floatTotal = Math.max(0, reps - 1) * (restS / 540);
      return Number((wu + repTotal + floatTotal + cd).toFixed(1));
    }
    case 'long':
    case 'easy':
    case 'recovery':
      // Single-segment workouts · distance_mi as-passed IS the total.
      return fallbackDistanceMi;
    default:
      return fallbackDistanceMi;
  }
}

/**
 * Derive T-pace (s/mi) from the runner's goal race + distance.
 * Same formula as lib/training/prescriptions.ts § tPaceSecPerMi.
 *
 * Returns null when the runner has no goal · callers should fall back
 * to a default (e.g. 480s/mi = 8:00/mi) and leave specs null until
 * goal lands.
 */
export function tPaceFromGoal(
  goalSeconds: number | null | undefined,
  goalDistanceMi: number | null | undefined,
): number | null {
  if (!goalSeconds || !goalDistanceMi) return null;
  const goalSPerMi = Math.round(goalSeconds / goalDistanceMi);
  if (goalDistanceMi >= 25) return goalSPerMi - 18;   // marathon
  if (goalDistanceMi >= 12) return goalSPerMi - 5;    // half
  if (goalDistanceMi >= 5)  return goalSPerMi + 8;    // 10K
  return goalSPerMi + 15;                              // 5K
}

/**
 * Cold-start VDOT floor: when no measured fitness signal exists, estimate
 * conservatively from weekly mileage rather than defaulting to the goal.
 * A 28-min 5K runner entering sub-20 at 15 mpw is assumed VDOT 32
 * (~10:45 easy), not VDOT 50 (~8:12 easy). Deliberate underestimate.
 * Cite: Daniels Running Formula §"VDOT and Training" — mileage-band heuristic.
 *
 * 2026-06-10 · lifted to module scope from generate.ts (where it was
 * nested in the composer) so the maintenance seeder can anchor its
 * workout_spec paces on the same cited heuristic. One source.
 */
export function conservativeVdotFromMileage(weeklyMi: number): number {
  if (weeklyMi >= 45) return 47;
  if (weeklyMi >= 40) return 45;
  if (weeklyMi >= 35) return 43;
  if (weeklyMi >= 30) return 40;
  if (weeklyMi >= 25) return 38;
  if (weeklyMi >= 20) return 35;
  if (weeklyMi >= 15) return 32;
  return 30; // Daniels VDOT floor; sub-30 is indistinguishable from no-data
}
