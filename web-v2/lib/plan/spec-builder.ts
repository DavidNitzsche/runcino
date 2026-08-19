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

import {
  parsePrescription,
  parseTempoShape,
  parseTempoLeadMi,
  parseStrides,
  parseTimeReps,
  parseSegments,
  primaryZone,
  segmentMi,
  type ParsedSegment,
} from './prescription-parser';
// ZONE-R-1 · what a pace zone is worth, resolved in ONE place that
// `lib/plan/catalogue-rx.ts#anchorsFor` also reads — so the zones the catalogue
// is allowed to anchor and the zones this file can pace cannot diverge.
import { resolveZoneAnchors, zonePaceSec } from './zone-anchors';
import type { PaceZone } from '@/lib/workout-catalogue/types';
// 2026-08-17 · the stored race abort CALLS doctrine now instead of mirroring
// its numbers. See the contingency-rules block for what "keep in sync" cost.
import {
  raceAbortHrBpm,
  raceCheckpointMi,
  RACE_PACE_ABORT_FRACTION,
} from '@/lib/race/distance-doctrine';

export type WorkoutSpec = Record<string, unknown> | null;

// ── Strides ──────────────────────────────────────────────────────────────

/**
 * DOCTRINE-STRIDES-1 (2026-08-17) · `Research/04-workout-vocabulary.md` §7.2.
 *
 *   | Distance | 50–100 m or 15–30 s each |
 *   | Reps     | 4–8 |
 *   | Recovery | Full walk-back or 60–90 s jog — no fatigue between strides |
 *   | Pace     | Accelerate to mile-to-5K race pace; ~85–95% max effort, relaxed |
 *
 * Defaults sit mid-band so a prescription that names only the rep count
 * ("6×ST") still lands inside doctrine. Bound by `STRIDES.doctrine-bands` in
 * lib/doctrine/registry.ts, which reads all four rows out of the table.
 */
export const STRIDE_DURATION_S = 20;
export const STRIDE_RECOVERY_S = 60;
export const STRIDE_DEFAULT_REPS = 6;
/**
 * Easy days per week that carry strides. §7.2 gives "| Frequency | 2–4×/week |";
 * `Research/00a` §"Practical base-building rules" gives "| Strides preserved |
 * 4–8×100 m strides 1–2×/wk |". Two is the only value inside both bands.
 */
export const STRIDE_DAYS_PER_WEEK = 2;

/** Convert a metre-expressed stride ("6×80m") into the seconds the watch counts
 *  down. §7.2 gives both units for the same thing — 100 m and 20 s are the same
 *  stride — so either form of the prescription lands in the same spec. */
function strideSecondsFor(distanceM: number, stridePaceSPerMi: number): number {
  const miles = distanceM / 1609.34;
  return Math.max(8, Math.round(miles * stridePaceSPerMi));
}

/**
 * Derive the optional strides fields for a spec from its prescription.
 *
 * Returns `{}` when the prescription carries no strides, so callers spread it
 * unconditionally and specs without strides are byte-identical to before. This
 * mirrors how the long-run finish segment was added (`finish_mi` et al are
 * optional fields on the existing `long` kind, not a new kind) — old clients
 * ignore fields they do not know, and the phase list the watch actually
 * receives stays wire-compatible either way.
 */
function strideFields(
  prescription: string | null | undefined,
  stridePaceSPerMi: number,
): Record<string, unknown> {
  const parsed = parseStrides(prescription);
  if (!parsed) return {};
  const durationS = parsed.durationS
    ?? (parsed.distanceM != null ? strideSecondsFor(parsed.distanceM, stridePaceSPerMi) : STRIDE_DURATION_S);
  return {
    strides_reps: parsed.reps,
    strides_duration_s: Math.round(durationS),
    strides_pace_s_per_mi: stridePaceSPerMi,
    strides_recovery_s: STRIDE_RECOVERY_S,
  };
}

/**
 * DOCTRINE-TAPERMP-1 · THE marathon-pace expression, as a function.
 *
 * It was already "in one place" inside `buildWorkoutSpec` so the long-run
 * M-finish and the taper's MP block could not disagree. ZONE-R-1 adds a third
 * reader — `catalogue-rx.ts#anchorsFor`, which has to know what an MP session
 * would be paced at BEFORE deciding whether to offer one — and a third copy of
 * a rule is how the first two stopped agreeing in every previous instance of
 * this in the codebase. So it moves out here and all three call it.
 *
 * The rule is unchanged: goal MP "exactly" (`Research/04` §4.4 "Pace | MP
 * exactly — not faster") ONLY when goal MP genuinely sits in the marathon zone
 * — slower than threshold, faster than the long-run bulk — else the moderate
 * T+18 default, which is always in-zone. `Research/01`:130-134 zone order.
 */
export function marathonPaceSPerMi(args: {
  tPaceSec: number;
  /** The current-fitness T anchor (PACE-E-1). Defaults to `tPaceSec`. */
  easyAnchorTSec?: number | null;
  goalPaceSPerMi?: number | null;
}): number {
  const { tPaceSec } = args;
  const easyAnchorT = args.easyAnchorTSec ?? tPaceSec;
  const longLo = easyAnchorT + 55;
  const goal = args.goalPaceSPerMi ?? null;
  return (goal != null && goal > tPaceSec && goal < longLo)
    ? goal
    : Math.min(tPaceSec, easyAnchorT) + 18;
}

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
export function extractFinishSegment(
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

// ── Time-based rep sets ──────────────────────────────────────────────────

/**
 * Does the prescription itself say this session is run by effort?
 *
 * It said so one way until now — the word "hills", which
 * `catalogue-rx.ts:renderPrescription` writes in front of every §8 session for
 * exactly this reason ("the family word keeps §8's effort-cued sets
 * recognisable to `buildWorkoutSpec`"). But §8 is not the only effort-cued
 * section. `zoneClause` renders "· by effort" for any catalogue entry whose doc
 * row states NO pace at all, and DOCTRINE-BASE-2 makes the first of those
 * reachable outside §8: `Research/04` §7.3 hill sprints, family `speed`, "Pace
 * | Max effort, all-out" on an 8-15% grade. Matching only on the family word
 * would have paced a fifteen-second maximal hill sprint at I pace — a label the
 * watch does not run, which is the drift this file has twice paid for.
 *
 * So the gate reads the token the renderer actually emits. "· by effort" is
 * written by one function in the codebase and by no hand-authored prescription,
 * so nothing that was paced before becomes effort-cued now.
 */
function prescriptionIsEffortCued(prescription: string | null | undefined): boolean {
  const p = String(prescription ?? '');
  return /hill/i.test(p) || /by effort/i.test(p);
}

/**
 * DOCTRINE-VOCAB-1 (2026-08-17) · a rep set measured in seconds, not metres.
 *
 * `Research/04-workout-vocabulary.md` §8.1 sizes every hill repeat by duration
 * and §9.1 does the same for fartlek, for the same reason: the distance a rep
 * covers depends on the gradient and on how hard the runner is going, so the
 * only stable instruction is how long to run. `rep_duration_s` is an OPTIONAL
 * field alongside the existing `rep_distance_mi` — the same wire-compatible
 * move `finish_mi` made on the long-run kind — so a spec that has always been
 * distance-based is untouched and a consumer that has never seen a duration rep
 * still finds a well-formed `threshold`/`intervals` spec.
 *
 * Hills go out BY EFFORT. §8.1's pace column reads "Strong, controlled (~95%
 * effort)" and "5K–10K effort", never a pace, and it could not be otherwise: a
 * flat-ground pace target is unreachable on a 6% grade, so prescribing one
 * would put the runner in breach of their own workout for climbing the hill
 * correctly. `by_effort` tells the expander to emit no pace target at all
 * rather than a number nobody can hit.
 */
function timeRepSpec(
  kind: 'threshold' | 'intervals',
  reps: { reps: number; durationS: number; restS: number | null },
  budgetMi: number,
  repPaceSec: number,
  lthr: number | null,
  prescription: string | null | undefined,
  withRules: Record<string, unknown>,
  /** COLD-4 · the calibration intro forces the same by-effort treatment onto a
   *  session that would otherwise be paced, for the opposite reason: hills have
   *  no reachable pace, a cold start has no honest one. */
  effortCued = false,
): SpecBuildResult {
  const byEffort = effortCued || prescriptionIsEffortCued(prescription);
  // WU/CD use the same floors as the distance-based branches.
  const wuFloor = Math.max(0.5, Math.min(1.5, budgetMi * 0.3));
  const cdFloor = Math.max(0.5, Math.min(1.0, budgetMi * 0.25));
  // PROGRESSION-1 (2026-08-17) · reserve the reps' own mileage and split the
  // REMAINDER into warm-up and cool-down, the way both distance-based branches
  // already do.
  //
  // `totalDistanceMiFromSpec` reports a time-based day at its headline
  // distance, so the day's number was always right; what was wrong was the
  // breakdown underneath it. The expanded phases a watch runs are warm-up +
  // reps + jogs + cool-down, and with WU/CD pinned at their 1.5/1.0 ceilings a
  // nine-mile threshold day expanded to about seven and a half. That was
  // invisible while only hills and fartlek were time-based; it is not once the
  // overload trajectory writes every generic threshold and rep session this
  // way.
  //
  // A by-effort set (hills · Research/04 §8.1 prescribes them at effort with no
  // pace) has no pace to convert its seconds into miles, so it keeps the
  // floors — byte-identical to what it built before.
  const paced = !byEffort && repPaceSec > 0;
  const restMi = (reps.restS ?? 90) / 540;
  // And cap the rep count to what the day can hold, exactly as both
  // distance-based branches do. A prescription is a request, not an
  // instruction: a six-rep set on a four-mile quality day does not fit once
  // warm-up, floats and cool-down are paid for, and before this the time-based
  // branch simply let it overflow — a four-mile day whose spec expanded to five
  // and a half. Unreachable for a by-effort set (no pace, no mileage to sum),
  // so hills build byte-identically.
  let repCount = reps.reps;
  if (paced) {
    while (
      repCount > 1 &&
      wuFloor + (repCount * reps.durationS) / repPaceSec + (repCount - 1) * restMi + cdFloor > budgetMi
    ) repCount--;
  }
  const workMi = paced ? (repCount * reps.durationS) / repPaceSec : 0;
  const floatMi = Math.max(0, repCount - 1) * restMi;
  const slack = Math.max(0, budgetMi - workMi - floatMi);
  // Round the warm-up once and derive the cool-down as the exact remainder,
  // mirroring the intervals branch — two independent roundings let wu + cd
  // overshoot the slack by up to a tenth of a mile each.
  const wu = Number((workMi > 0 ? Math.max(wuFloor, slack / 2) : wuFloor).toFixed(1));
  const cd = workMi > 0 ? Math.max(cdFloor, slack - wu) : cdFloor;
  return {
    spec: {
      kind,
      warmup_mi: wu,
      rep_count: repCount,
      rep_duration_s: Math.round(reps.durationS),
      rep_pace_s_per_mi: byEffort ? null : repPaceSec,
      rep_rest_s: reps.restS ?? 90,
      cooldown_mi: Number(cd.toFixed(1)),
      lthr_bpm: hrLthrBpm(lthr),
      by_effort: byEffort ? true : undefined,
      // The authored prescription is the only place the workout's IDENTITY
      // lives ("hills", "Mona"). subLabelFromSpec would otherwise re-derive a
      // generic rep label and the family name would vanish between compose and
      // persist — the sub_label/spec drift this codebase has fixed twice.
      label: prescription ?? undefined,
      ...withRules,
    },
    paceTargetSPerMi: byEffort ? null : repPaceSec,
  };
}

// ── Unequal-step sessions ────────────────────────────────────────────────

/**
 * GRAMMAR-SEQ-1 (2026-08-19) · one step of a session whose steps differ.
 *
 * OPTIONAL on the spec, exactly as `rep_duration_s` and `finish_mi` are — the
 * same wire-compatible move, for the same reason. A spec that has always been a
 * uniform rep set is byte-identical to before, and the uniform fields
 * (`rep_count`, `rep_distance_mi`, `rep_pace_s_per_mi`, `rep_rest_s`) are still
 * populated on a stepped spec with the session's own totals, so a consumer that
 * has never heard of `steps` still finds a well-formed, runnable rep session
 * carrying the right total work, the right total recovery and the right dose.
 *
 * See `expandSpecToPhases`, which walks `steps` when they are there: the WATCH
 * never sees this field at all — it receives the flat phase list it has always
 * received, with one work phase per step. There is no wire change.
 */
export interface SpecStep {
  /** Miles of work in this step. Null only when the step is by-effort and its
   *  seconds cannot be converted (see `duration_s`). */
  distance_mi: number | null;
  /** Seconds of work, for a step doctrine states in time (§9.2's Mona reps). */
  duration_s: number | null;
  /** This step's own pace target. Null on a by-effort session. */
  pace_s_per_mi: number | null;
  /** Jog recovery AFTER this step. 0 where doctrine says the work is
   *  continuous — §10.1's alternations, §12.4's progression. */
  rest_s: number;
  /** The zone label the prescription declared for this step, for the phase
   *  label the runner reads. Null where the step declared none. */
  zone: string | null;
}

/**
 * A session built from an unequal-step prescription · §13's ladders, §9.2's
 * Mona fartlek, §10.1's alternations, §10.2's combos, §12.4's progression.
 *
 * Every number here comes out of the prescription string, which the catalogue
 * rendered from the entry's own cited rows. Nothing is chosen here: the steps,
 * their zones and their recoveries are read, each zone is priced through the
 * one zone resolver, and the warm-up and cool-down take the same treatment the
 * uniform branches give them.
 *
 * The shape is NOT trimmed to the day. A ladder with a rung removed is a
 * different workout, and the selector has already refused this session on any
 * week that cannot afford it (`sessionAllowanceMi` prices the whole sequence
 * against Daniels' share before it is ever offered). `capSpecToDistance` is the
 * last-resort trim, and it says there what it does.
 */
function segmentSpec(
  kind: 'threshold' | 'intervals',
  segs: ParsedSegment[],
  budgetMi: number,
  defaultPaceSec: number,
  anchors: Partial<Record<PaceZone, number>>,
  lthr: number | null,
  prescription: string | null | undefined,
  withRules: Record<string, unknown>,
  effortCued: boolean,
): SpecBuildResult {
  const byEffort = effortCued || prescriptionIsEffortCued(prescription);
  const steps: SpecStep[] = [];
  let workMi = 0;
  let restTotalS = 0;
  let paceWeighted = 0;

  for (const seg of segs) {
    const zonePace = zonePaceSec(seg.zone as PaceZone | null, anchors);
    // A step whose zone this runner cannot price falls back to the session's
    // own default rather than to a neighbouring zone's number — the selector
    // does not offer a session with an unanchored zone, so in a composed plan
    // this arm is only reachable from a restore/adapt path.
    const pace = byEffort ? null : (zonePace ?? defaultPaceSec);
    const mi = segmentMi(seg, pace ?? defaultPaceSec);
    const durationS = seg.unit === 's' ? seg.value : seg.unit === 'min' ? seg.value * 60 : null;
    steps.push({
      // Four decimals, not the three `parsePrescription` keeps for a uniform
      // rep. A 400 m rung is 0.2485 mi and rounds to 0.249 at three — 400.7 m,
      // which is not what §13.2 wrote. There is no compatibility cost: this
      // field is new, and the uniform summary below still rounds the way the
      // old fields always did.
      distance_mi: mi != null ? Number(mi.toFixed(4)) : null,
      duration_s: durationS != null ? Math.round(durationS) : null,
      pace_s_per_mi: pace,
      rest_s: Math.round(seg.restS),
      zone: seg.zone ?? null,
    });
    if (mi != null) {
      workMi += mi;
      if (pace != null) paceWeighted += mi * pace;
    }
    restTotalS += seg.restS;
  }

  const floatMi = restTotalS / 540;
  const wuFloor = Math.max(0.5, Math.min(1.5, budgetMi * 0.3));
  const cdFloor = Math.max(0.5, Math.min(1.0, budgetMi * 0.25));
  const slack = Math.max(0, budgetMi - workMi - floatMi);
  const wu = Number(Math.max(wuFloor, slack / 2).toFixed(1));
  const cd = Number(Math.max(cdFloor, slack - wu).toFixed(1));

  // The uniform summary a consumer that does not read `steps` sees. Deliberately
  // the session's own TOTALS spread evenly rather than a first-step-wins guess:
  // total work, total recovery and total dose all come out right, which is what
  // `totalDistanceMiFromSpec`, `splitDay` and the dosing gate ask of it.
  const n = steps.length;
  const meanRepMi = n > 0 && workMi > 0 ? Number((workMi / n).toFixed(3)) : 0;
  const meanRestS = n > 1 ? Math.round(restTotalS / (n - 1)) : 0;
  const headlinePace = byEffort || workMi <= 0 ? null : Math.round(paceWeighted / workMi);

  return {
    spec: {
      kind,
      warmup_mi: wu,
      steps,
      rep_count: n,
      rep_distance_mi: meanRepMi,
      rep_pace_s_per_mi: headlinePace,
      rep_rest_s: meanRestS,
      cooldown_mi: cd,
      lthr_bpm: hrLthrBpm(lthr),
      ...(byEffort ? { by_effort: true } : {}),
      // The authored prescription is where this workout's IDENTITY lives —
      // "400-800-1200-1600", "Mona". `subLabelFromSpec` would otherwise re-derive
      // a generic rep label and the shape would vanish between compose and
      // persist, which is the drift this file exists to stop.
      label: prescription ?? undefined,
      ...withRules,
    },
    paceTargetSPerMi: headlinePace,
  };
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
  // 2026-06-23 · PACE-E-1 · current-fitness T anchor for the EASY/long/recovery bands (effort runs ·
  // must track current fitness, not the goal-blended tPaceSec). null → uses tPaceSec (byte-identical).
  // Quality (threshold/tempo/intervals/race) stays on tPaceSec.
  easyAnchorTSec: number | null = null,
  /**
   * COLD-4 (2026-08-17) · THE CALIBRATION INTRO · run this quality session by
   * EFFORT, with no pace target at all.
   *
   * Set by the composer for the opening `CALIBRATION_INTRO_WEEKS` of a plan
   * whose fitness anchor is `provisional_mileage` — i.e. a VDOT
   * `conservativeVdotFromMileage` invented out of a self-reported weekly
   * mileage bucket. The DISTANCE of the session is the runner's own claim and
   * doctrine-bounded; the PACE is ours, and a fabricated number presented as a
   * target is the thing being removed. `Design/adaptive-progression-engine.md`
   * §A names that function as a non-evidence leak by construction.
   *
   * The representation is the one `Research/04` §8.1 hill repeats already use
   * (`by_effort: true`, null rep pace) — chosen rather than invented so the
   * expander, the watch payload, the phone breakdown and the recap all handle
   * it on paths that already exist.
   *
   * false (the default) → every branch below is byte-identical to before.
   */
  effortCued = false,
): SpecBuildResult {
  // 2026-06-02 · parse the prescription up front (e.g. "6×800m @ I
  // pace · 90s jog" → {reps:6, repDistanceMi:0.497, restS:90}). When
  // parseable, threshold + intervals branches use these instead of
  // the hardcoded defaults so the spec matches the prescription text.
  // Null when prescription is absent or doesn't carry a rep pattern
  // (e.g. "continuous tempo") · branches fall back to historical
  // defaults.
  const parsed = parsePrescription(prescription);
  // DOCTRINE-VOCAB-1 · time-based rep sets (hills, fartlek). Only consulted
  // when the prescription carries no distance-based reps, so every existing
  // prescription builds byte-identically.
  const timeReps = parsed ? null : parseTimeReps(prescription);
  // 2026-06-09 Phase 2 (3.2) · contingency rules per type. The watch
  // OFFERS the bail on breach (CONTINUE / TAKE THE BAIL · never
  // enforces); pass rules are post-run confirmation criteria (the same
  // numbers the WATCHING test reads). Null-LTHR runners get pace rules
  // only · never an invented HR number.
  //
  // 2026-08-17 · the race abort now CALLS the doctrine rather than
  // mirroring it. It used to hardcode LTHR+3 / goal+23 / mile-5, with a
  // comment reading "keep in sync" — and it had not been. Doctrine moved to
  // a per-distance %LTHR ceiling, a 5% pace fraction, and a checkpoint at
  // 38% of the race; those three functions had exactly one caller
  // (execution-plan.ts) while the STORED rule, the one that reaches the
  // wrist, kept the old numbers.
  //
  // The gap was not cosmetic. For a marathoner at LTHR 162 the stored rule
  // aborts at 165 bpm — 102% of LTHR, against a doctrine marathon ceiling of
  // 88-95%. It can essentially never fire, so race day had no working abort.
  // And mile-5 is the wrong checkpoint for anything but a marathon: a 5K's
  // check happened at a mile it never reaches.
  //
  // "Keep in sync" is not a mechanism. Calling the same function is.
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
      const raceMi = distance_mi ?? 0;
      const checkpointMi = raceMi > 0 ? raceCheckpointMi(raceMi) : null;
      const scope = checkpointMi != null ? `mile-${checkpointMi}` : 'mile-5';
      const at = checkpointMi != null ? `Mile ${checkpointMi}` : 'Mile 5';
      const abortHr = raceMi > 0 ? raceAbortHrBpm({ distanceMi: raceMi, lthr, maxHr }) : null;
      if (abortHr != null) {
        rules.push({ kind: 'abort', metric: 'hr', op: '>', value: abortHr, scope, action: 'switch_to_b_goal',
          label: `${at} check: avgHr over ${abortHr} · switch to the B plan` });
      }
      if (goalPaceSPerMi != null) {
        const abortPace = Math.round(goalPaceSPerMi * (1 + RACE_PACE_ABORT_FRACTION));
        rules.push({ kind: 'abort', metric: 'pace', op: '>', value: abortPace, scope, action: 'switch_to_b_goal',
          label: `${at} check: pace slower than ${Math.floor(abortPace / 60)}:${String(abortPace % 60).padStart(2, '0')}/mi · switch to the B plan` });
      }
    }
    return rules.length > 0 ? rules : null;
  })();
  const withRules = contingencyRules ? { rules: contingencyRules } : {};
  // PACE-E-2 (2026-08-17) · Research/01:142 §Pace conversion: E = MP + 60..90 s/mi.
  // The engine's M is T+18, so that rule is E = T+78..T+108, and T+80/T+120
  // reproduces it (floor +2, ceiling +12 · conservative-slow at the top).
  //
  // The SAME document contradicts itself: its §Numerical equivalencies VDOT-50
  // row gives E = T+104..T+156, 20-40 s/mi slower, which falsifies line 138's
  // claim of "within +/-2 sec/mi" accuracy. Settling it needs Daniels 3rd ed.
  // Table 2, which is not in the repo. The prior comment here cited that table
  // row while quoting a "within 7s" figure computed off the MP+60 rule instead
  // (see doctrine registry PACE.easy-band-off-threshold).
  //
  // Executed-data check 2026-08-17: both candidate bands sit inside Daniels'
  // 65-78 %HRmax easy window, so neither is a safety violation. The runner's
  // own easy days average 81 %HRmax, faster than either band. HR is the
  // governor here, not pace.
  // PACE-E-1 · easy/long/recovery anchor to CURRENT fitness (easyAnchorTSec), not the goal-blended
  // tPaceSec — otherwise a sub-fitness goal ramps "easy" faster every week (cold-start: easy can pass
  // current MP, a physiological impossibility). Defaults to tPaceSec when unthreaded (byte-identical).
  const easyAnchorT = easyAnchorTSec ?? tPaceSec;
  const easyLo = easyAnchorT + 80, easyHi = easyAnchorT + 120;
  const longLo = easyAnchorT + 55, longHi = easyAnchorT + 90;
  // PACE-T-1 (2026-06-23, David approved) · a "continuous tempo" is run AT threshold (Research/04:159,
  // 164,169 · "Continuous tempo | T"). The old +12 was the SEPARATE sub-threshold band (Research/04:14,
  // 161) shipped under a threshold label + family — the runner saw a threshold-effort label over a
  // pace ~12 s/mi easy. Now the headline tempo pace == T.
  const tempo  = tPaceSec;
  // Daniels I = T−33 (95-100% VO2max, ~3K-5K pace). T−18 is a deliberate
  // conservative deviation: ~10-12K pace, yielding more sub-VO2max ceiling work
  // rather than true VO2max intervals. Appropriate for a 40-50 mpw runner who
  // cannot absorb full Daniels I volume without injury risk. Cite: Research/01 §Daniels-I.
  const interval = tPaceSec - 18;
  const recovery = easyAnchorT + 100;   // very easy · PACE-E-1 · current-fitness anchor
  const mp = tPaceSec + 18;             // marathon pace
  /**
   * DOCTRINE-TAPERMP-1 (2026-08-17) · THE marathon-pace expression, in one
   * place. The long-run M-finish and the taper's MP session are the same
   * physiological target and must never be able to disagree — a helper copied
   * into a second branch and then corrected in only one is the exact fork class
   * this codebase has already paid for twice (the cadence-target fork, the
   * `hrCapEasy` backfill fork). The rule is unchanged from the long-run branch:
   * goal MP "exactly" (Research/04 §4.4 "Pace | MP exactly — not faster") ONLY
   * when goal MP genuinely sits in the marathon zone — slower than threshold,
   * faster than the long-run bulk — else the moderate T+18 default, which is
   * always in-zone. Research/01:130-134 zone order.
   */
  const marathonPace = marathonPaceSPerMi({ tPaceSec, easyAnchorTSec: easyAnchorT, goalPaceSPerMi });
  // DOCTRINE-STRIDES-1 · Research/04 §7.2 "Accelerate to mile-to-5K race pace".
  // True I-pace when the caller threaded one; else Daniels' I = T−33 (the same
  // relation the intervals branch documents below). 5K pace is the SLOW end of
  // doctrine's band, so this never over-prescribes.
  const stridePace = iPaceSec ?? (tPaceSec - 33);
  const strides = strideFields(prescription, stridePace);

  /* ── ZONE-R-1 (2026-08-19) · pace the session by the zone it DECLARES ──────
   *
   * Until now this file paced a `threshold` slot at T and a rep slot at I
   * whatever the prescription said. That is why `catalogue-rx.ts` anchored two
   * zones and declined every session naming a third: §7's R work, §5.4's
   * sub-threshold intervals, §11.3's marathon-pace sessions and §14.2's
   * 10K-specific sessions were all in the catalogue, cited, and unreachable.
   *
   * `resolveZoneAnchors` is the ONE answer to "what is this zone worth", and
   * `anchorsFor` in catalogue-rx reads the same function — so "does the spec
   * builder pace everything the catalogue is allowed to anchor" stops being
   * something to remember and becomes something that cannot be false.
   *
   * BYTE-IDENTICAL FOR EVERY EXISTING PRESCRIPTION, by construction. The
   * resolver maps T and HM to `tPaceSec` and I and 5K to the same rep pace this
   * file already used, so `@ T pace` still resolves to T, `@ I-T transition`
   * still resolves to the rep pace (its first token is I), `@ 5K-10K effort`
   * still resolves to the rep pace, and `· MP → T ·` still resolves to T (an
   * arrow clause is paced at its target). A prescription that declares no zone
   * at all resolves to null and the branch default stands.
   */
  const zoneAnchors = resolveZoneAnchors({
    tPaceSec,
    // The rep pace this file has always used: the true Daniels I when the
    // caller threaded one, else the legacy cruise-interval offset the intervals
    // branch documents below.
    iPaceSec: iPaceSec ?? interval,
    marathonPaceSec: marathonPace,
  });
  const declaredZone = primaryZone(prescription);
  const declaredPace = zonePaceSec(declaredZone as PaceZone | null, zoneAnchors);
  // GRAMMAR-SEQ-1 · an unequal-step session, read BEFORE `parsed` is consulted:
  // "2mi @ T · 2:30 jog + 4×800m @ I · 90s jog" carries a `4×800m` that
  // `parsePrescription` would read on its own, building the rep block and
  // dropping the threshold block in front of it.
  const segments = parseSegments(prescription);

  switch (type) {
    case 'easy':
      return {
        spec: {
          kind: 'easy',
          pace_target_s_per_mi_lo: easyLo,
          pace_target_s_per_mi_hi: easyHi,
          hr_cap_bpm: hrCapEasy(lthr, maxHr),
          fuel_mi: [],
          ...strides,
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
            // BRK-1 · the long FINISH (MP/HMP) must never be slower than easy. easyAnchorT is the
            // current-fitness anchor (PACE-E-1); min() keeps the finish ≤ the easy band even when weekT
            // is a soft goal. Unthreaded callers (easyAnchorT==tPaceSec) → byte-identical. Research/04:85-87.
            // PACE-M1/MFIN-T1/LONGFIN-1 (2026-06-23) · the M-finish is goal MP "exactly" (Research/04:121)
            // ONLY when MP genuinely sits in the marathon zone: SLOWER than the week's threshold (tPaceSec —
            // else T<M inverts during the early-build ramp, where weekT can exceed goal MP for a fit runner)
            // AND FASTER than the long-run bulk's fast edge (longLo — else it lands in the easy/long band, a
            // soft-goal inversion). Outside that window, the moderate default (≈ tPaceSec+18, always in-zone:
            // T < default < long). HM tag rides tPaceSec (correct, never inverts). Research/01:130-134 order.
            // DOCTRINE-TAPERMP-1 · the M arm now reads the shared `marathonPace`
            // expression above (byte-identical to the inline one it replaces) so
            // the taper's MP session cannot drift from the long-run M-finish.
            finish_pace_s_per_mi: finish.tag === 'HM'
              ? Math.min(tPaceSec, easyAnchorT) + 5
              : marathonPace,
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
      // DOCTRINE-FARTLEK-SPEC (2026-08-18) · a TIME-BASED rep set is a rep set,
      // whatever the day's type says.
      //
      // The `threshold` branch below has consulted `timeReps` since
      // PROGRESSION-1; this one never did, and the beginner's light fartlek is
      // typed `tempo`. So "5mi E w/ 5×1 min surges @ T effort" — five MINUTES
      // of work, which `Research/22` §Beginner prescribes as an easy run with a
      // few pickups — was built as a 2.5-mile CONTINUOUS block at threshold,
      // with `parseTempoLeadMi` reading the "5mi" that describes the whole run
      // as if it declared the block. The runner read one workout and the watch
      // ran another, and it was the single largest source of measured dosing
      // breach in the archetype corpus: 2.5 mi at T on a 22 mi/wk beginner week
      // is 11.4%, and the actual session is five minutes.
      //
      // This is the same defect MAINT-FARTLEK-SPEC fixed for the maintenance
      // composer in 2026-06-23 ("fartlek is AEROBIC with surges, not sustained
      // threshold"), on the one fartlek path that ruling did not reach. The
      // shape comes back as a time-based rep set — the identical spec the
      // `threshold` branch builds for hills and fartlek — so `splitDay` counts
      // the reps' own minutes and nothing downstream needs a new kind.
      if (!parsedTempo && timeReps) {
        return timeRepSpec('threshold', timeReps, distance_mi ?? 5, tempo, lthr, prescription, withRules, effortCued);
      }
      const budget = distance_mi ?? 8;
      // TEMPO-WU-1 (2026-06-23) · reserve WU/CD floors BEFORE sizing the core, mirroring
      // threshold (lines 367-368). Without this, a tiny 2mi budget produced wu=0/cd=0:
      // tempoDist=max(2,budget-3)=2, wu=(2-2)/2=0. 174 small-base archetypes shipped a cold
      // 2mi block at T-pace with no warmup or cooldown (contra Research/04 §5.2 "2-3mi E each
      // side"). Established runners (budget>=8) unaffected — floors never bind.
      const wuFloor = Math.max(0.5, Math.min(1.5, budget * 0.3));
      const cdFloor = Math.max(0.5, Math.min(1.0, budget * 0.25));
      // DAY-SIZE-1 (2026-08-17) · when the composer declared the block size in
      // the prescription ("5mi continuous wave tempo · ±10 s/mi around T"),
      // that is the block. The default below is for prescriptions that state no
      // size at all; running it over a prescription that DOES state one is the
      // label and the spec deciding the workout independently, which is the
      // drift this file exists to stop. Still bounded by the day: a declared
      // block that will not fit inside the budget with its warm-up and
      // cool-down is trimmed to what will, exactly as the default is.
      const declaredTempoMi = parsedTempo ? null : parseTempoLeadMi(prescription);
      let tempoDist = parsedTempo?.tempoMi
        ?? (declaredTempoMi != null
          ? Math.min(declaredTempoMi, Math.max(0.5, budget - wuFloor - cdFloor))
          : Math.min(Math.max(0.5, budget - wuFloor - cdFloor), Math.max(2, Math.min(7, budget - 3))));
      let wu = parsedTempo?.warmupMi
        ?? Math.max(wuFloor, (budget - tempoDist) / 2);
      let cd = parsedTempo?.cooldownMi ?? Math.max(cdFloor, budget - tempoDist - wu);
      // 2026-06-21 · budget-scale to distance_mi (the week's clamped quality
      // allocation), mirroring threshold/intervals. The parsed library shape is
      // a FIXED 8mi (2·WU + 4·T + 2·CD); on a short-race plan whose long the
      // post-compose sweep clamped to ~6mi, persisting the unscaled spec total
      // shipped a "tempo" LONGER than the long run — because the persisted
      // distance is totalDistanceMiFromSpec(spec), not the clamped headline
      // (round-2 CRITICAL · partial regression of the quality≤long fix). Scale
      // proportionally to budget; tempoDist absorbs rounding so wu+core+cd ==
      // budget exactly. Established runners' budget ≥ shape → no scale (byte-
      // for-byte unchanged).
      const rawTotal = wu + tempoDist + cd;
      if (rawTotal > budget && rawTotal > 0) {
        const k = budget / rawTotal;
        wu = Number((wu * k).toFixed(1));
        cd = Number((cd * k).toFixed(1));
        tempoDist = Number(Math.max(0.5, budget - wu - cd).toFixed(1));
      }
      // DOCTRINE-TAPERMP-1 (2026-08-17) · a continuous block the prescription
      // declares "@ MP" is run at MARATHON pace, not threshold.
      //
      // `Research/08-pacing-and-race-week.md` §9.2 gives the marathon taper two
      // MP-specific sessions — "14-16 mi w/ 10-12 mi at MP" at three weeks out
      // and "6-8 mi at MP" at two — and §9.1 states why they survive the taper
      // at all: "The largest cut is to easy mileage; intensity is preserved
      // through the taper." Pacing that block at T would be ~18 s/mi too fast
      // and would turn a specificity rehearsal into a threshold session in the
      // window where doctrine adds no novel stress.
      //
      // HR carries no target here on purpose. `Research/03-heart-rate-zones.md`
      // §"What to anchor on" lists the marathon-pace run as "M-pace anchored to
      // goal" — pace is the governor, and inventing an MP heart rate would be
      // asserting physiology no doctrine in this repo states. The tempo
      // contingency rules still ride along, and an HR over LTHR+5 during an MP
      // block is exactly the bail worth offering.
      const atMarathonPace = /@\s*MP\b/i.test(prescription ?? '');
      // COLD-4 · the calibration intro drops the block's pace target. An MP
      // block is priced off the runner's GOAL rather than off the provisional
      // fitness anchor, so it carries no fabrication and keeps its target —
      // the same reasoning that exempts race day and the race-week tune-up.
      const blockByEffort = effortCued && !atMarathonPace;
      const blockPace = atMarathonPace ? marathonPace : tempo;
      return {
        spec: {
          kind: 'tempo',
          warmup_mi: Number(wu.toFixed(1)),
          tempo_distance_mi: Number(tempoDist.toFixed(1)),
          tempo_pace_s_per_mi: blockByEffort ? null : blockPace,
          ...(blockByEffort ? { by_effort: true } : {}),
          cooldown_mi: Number(cd.toFixed(1)),
          hr_target_bpm: atMarathonPace ? null : (lthr ? Math.round(lthr * 0.92) : null),
          // The authored prescription carries the block's IDENTITY, exactly as
          // it does for time-based rep sets above: `subLabelFromSpec` re-derives
          // a tempo label as "@ T", so without this an MP block would come back
          // from a spec rebuild relabelled as threshold work. Only set when the
          // label would otherwise be wrong, so every existing tempo spec is
          // byte-identical.
          ...(atMarathonPace && prescription ? { label: prescription } : {}),
          ...withRules,
        },
        paceTargetSPerMi: blockByEffort ? null : blockPace,
      };
    }
    case 'threshold': {
      if (segments) {
        return segmentSpec('threshold', segments, distance_mi ?? 7, declaredPace ?? tPaceSec,
          zoneAnchors, lthr, prescription, withRules, effortCued);
      }
      if (timeReps) return timeRepSpec('threshold', timeReps, distance_mi ?? 7, declaredPace ?? tPaceSec, lthr, prescription, withRules, effortCued);
      // 2026-06-02 · prefer parsed prescription · falls back to
      // historical defaults when the rx string is absent / unparseable.
      const repCount = parsed?.reps ?? 4;
      const repMi = parsed?.repDistanceMi ?? 1.0;
      const restS = parsed?.restS ?? 60;
      // 2026-06-20 · scale the session to the budget (distance_mi = the week's
      // quality-day allocation). Established runners have a large budget so the
      // floors stay 1.5/1.0 and the rep count is unchanged (byte-for-byte). A
      // low-volume beginner's small budget shrinks the warmup/cooldown and caps
      // the rep count, so a quality session can't balloon to 3× their weekly
      // volume / longer than their long run.
      const budget = distance_mi ?? 7;
      const wuFloor = Math.max(0.5, Math.min(1.5, budget * 0.3));
      const cdFloor = Math.max(0.5, Math.min(1.0, budget * 0.25));
      const reps = Math.min(repCount, Math.max(2, Math.floor((budget - wuFloor - cdFloor) / repMi)));
      // PERSIST-THRESH-UNDERFILL (2026-06-23) · derive WU/CD from the REAL float-jog total, not a hardcoded
      // 1mi reserve — a 3-rep/120s session's float is only 0.44mi, so ~0.56mi went unallocated and the day
      // realized ~0.6mi under the composer's budget every threshold week. slack splits WU/CD so the spec sums
      // to budget exactly (mirrors the intervals branch's remainder-derivation).
      const floatTotalT = Math.max(0, reps - 1) * (restS / 540);
      const wu = Math.max(wuFloor, (budget - reps * repMi - floatTotalT) / 2);
      const cd = Math.max(cdFloor, budget - reps * repMi - floatTotalT - wu);
      return {
        spec: {
          kind: 'threshold',
          warmup_mi: Number(wu.toFixed(1)),
          rep_count: reps,
          rep_distance_mi: repMi,
          // COLD-4 · the calibration intro emits the rep with no pace. Distance,
          // count and rest are unchanged — those come from the prescription
          // library and the runner's own volume, not from the invented VDOT.
          // ZONE-R-1 · and the pace is the zone the label DECLARES, which for
          // every prescription written before this resolves to `tPaceSec`.
          rep_pace_s_per_mi: effortCued ? null : (declaredPace ?? tPaceSec),
          ...(effortCued ? { by_effort: true } : {}),
          rep_rest_s: restS,
          cooldown_mi: Number(cd.toFixed(1)),
          lthr_bpm: hrLthrBpm(lthr),
          ...withRules,
        },
        paceTargetSPerMi: effortCued ? null : (declaredPace ?? tPaceSec),
      };
    }
    case 'intervals':
    case 'vo2max': {
      if (segments) {
        return segmentSpec('intervals', segments, distance_mi ?? 7, declaredPace ?? iPaceSec ?? interval,
          zoneAnchors, lthr, prescription, withRules, effortCued);
      }
      if (timeReps) return timeRepSpec('intervals', timeReps, distance_mi ?? 7, declaredPace ?? iPaceSec ?? interval, lthr, prescription, withRules, effortCued);
      // 2026-06-02 · prefer parsed prescription · falls back to
      // historical defaults when the rx string is absent / unparseable.
      const repCount = parsed?.reps ?? 5;
      const repMi = parsed?.repDistanceMi ?? 0.62;
      const restS = parsed?.restS ?? 90;
      // 2026-06-20 · scale to the budget (see threshold branch). Large budget →
      // floors stay 1.5/1.0, rep count unchanged (established runners identical);
      // small beginner budget → shrink warmup/cooldown + cap reps so the
      // interval session doesn't dwarf the runner's long run / weekly volume.
      const budget = distance_mi ?? 7;
      const wuFloor = Math.max(0.5, Math.min(1.5, budget * 0.3));
      const cdFloor = Math.max(0.5, Math.min(1.0, budget * 0.25));
      // 2026-06-21 · rep-count cap must account for float-jog cost so that
      // reps*repMi + (reps-1)*floatPer + wuFloor + cdFloor <= budget exactly.
      // Rearranged: reps <= (budget - wuFloor - cdFloor + floatPer) / (repMi + floatPer).
      const floatPer = restS / 540;
      const reps = Math.min(
        repCount,
        Math.max(2, Math.floor((budget - wuFloor - cdFloor + floatPer) / (repMi + floatPer))),
      );
      // Round wu once, derive cd as the exact remainder — no independent rounding
      // that lets wu + cd overshoot the available slack after reps + float jogs.
      const floatJogTotal = Math.max(0, reps - 1) * floatPer;
      const wuRaw = Math.max(wuFloor, (budget - reps * repMi - floatJogTotal) / 2);
      const wuVal = Number(wuRaw.toFixed(1));
      const cdVal = Number(Math.max(cdFloor, budget - reps * repMi - floatJogTotal - wuVal).toFixed(1));
      // True I-pace when the caller threaded a VDOT-derived one (goal builds);
      // else the legacy T−18 cruise-interval offset (marathon / maintenance).
      // ZONE-R-1 · unless the label declares a zone of its own — §7's R work,
      // §14.2's 10K sessions. `@ I` and `@ 5K` both resolve to this same number,
      // so every prescription written before this builds byte-identically.
      const repPace = declaredPace ?? iPaceSec ?? interval;
      return {
        spec: {
          kind: 'intervals',
          warmup_mi: wuVal,
          rep_count: reps,
          rep_distance_mi: repMi,
          // COLD-4 · see the threshold branch. An I-pace derived from a mileage
          // bucket is the same fabrication one zone harder.
          rep_pace_s_per_mi: effortCued ? null : repPace,
          ...(effortCued ? { by_effort: true } : {}),
          rep_rest_s: restS,
          cooldown_mi: cdVal,
          lthr_bpm: hrLthrBpm(lthr),
          ...withRules,
        },
        paceTargetSPerMi: effortCued ? null : repPace,
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
      const inverseOffset = dMi >= 31 ? 40 : dMi >= 25 ? 18 : dMi >= 12 ? 5 : dMi >= 5 ? -8 : -15; // PACE-5 · ultra races well below T
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
          // Research/08's race-week templates and Research/04 §17.3's pre-race
          // warmup table both put strides on the day before a race. The
          // generator has always WRITTEN "2 mi + 4×20s strides" into the
          // shakeout's notes; now the spec carries them, so the watch can run
          // what the row has been promising since the day it was authored.
          ...strides,
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
      // PINV-1 (2026-06-23) · for a SOFT goal (race pace slower than the slowest easy, easyLo) a tune-up at
      // goalPace inverts — the 'race pace' sharpener runs SLOWER than easy (no stimulus, Research/01:130-134
      // + /08:590-593 "race pace OR FASTER"). Same class as BRK-1. When the goal pace would invert, prime at
      // current threshold (tPaceSec — a real sharpener) instead. Byte-safe: only soft goals trip the guard;
      // at-goal/hard/by-feel (goalPace <= easyLo, or null) are unchanged.
      // TAPER-SHARP-1 (2026-06-23) · "@ 5K pace" tune-ups (marathon/ultra sharpener, §9.3) run at I-pace —
      // a neuromuscular primer faster than race pace. Threaded iPaceSec carries it; falls back to
      // cruise-interval pace (T-18) when iPaceSec is unavailable — still a meaningful sharpener
      // (Research/01:130-134: "race pace OR FASTER"), not the T-5 primer. HM "@ race pace" still
      // reads HMP via the goal-pace branch below. In prod, iPaceSec is always threaded for
      // race_week_tuneup (persistPlan computes it unconditionally), so the fallback is defensive.
      const wants5kPace = /5\s*k\s*pace|@\s*I\b/i.test(String(prescription ?? ''));
      // TUNEUP-T-1 (2026-08-19) · the THIRD pace token this branch can be
      // handed, and the one it silently ignored. `generate.ts` writes the ultra
      // race-week primer as "5×400m @ T pace · 90s jog" (ULTRA-TUNE-1 · both
      // sites: the race-week day builder and `inlinePrescriptions`), which
      // matches neither matcher above and fell through to the `tPaceSec - 5`
      // default — so the watch ran the reps 5 s/mi FASTER than the label said,
      // and 5 s/mi above T is no longer T. That is the same label-versus-spec
      // drift class the codebase has already paid for twice (the HM tune-up
      // hardcoded to 2×0.5mi, and the beginner "5×1 min surges" built as a
      // 2.5-mile continuous threshold block): the row promises one workout and
      // the spec builds another, with nothing in between to notice.
      //
      // The prescriptions that legitimately want the primer carry NO pace token
      // at all ("Two sharp half-mile reps just above T-pace" is the default's
      // own description, not a prescription) — so naming T explicitly is what
      // separates "the label says T" from "the label says nothing".
      // Cite: Research/01-pace-zones-vdot.md §"Daniels' 5 training zones" — T is
      // a pace defined by VDOT, not a band; a rep written @ T runs at T.
      //
      // Deliberately the NARROW token `@ T`, matching the shape of the two
      // matchers above, and not a bare "T-pace" anywhere in the string: the
      // default primer describes ITSELF as "just above T-pace", and widening
      // the match would re-point that one at T and change a workout nobody
      // asked to change.
      const wantsTPace = /@\s*T\b/i.test(String(prescription ?? ''));
      const repPace = wants5kPace
        ? (iPaceSec ?? (tPaceSec - 18))
        : wantsTPace
        ? tPaceSec
        : wantsRacePace
        // PINV-1-BOUNDARY (2026-06-23) · >= not > so that goal pace exactly AT the easy floor
        // (borderline soft-goal) routes to tPaceSec, not to the easy-pace goal.
        ? (goalPaceSPerMi != null && goalPaceSPerMi >= easyLo ? tPaceSec : (goalPaceSPerMi ?? tPaceSec))
        : tPaceSec - 5;
      // 2026-06-21 · budget-scale WU/CD so the spec sums to distance_mi exactly.
      // Hardcoded 1.5/1.0 overshot when the day is short (e.g. 5mi tune-up with
      // 4×1km = 4×0.621 + float + 1.5 + 1.0 → 5.5mi, a 0.5mi overshoot that
      // forced capSpecToDistance to trim it back). Mirror the pattern used in the
      // threshold and intervals branches: round wu once, derive cd as remainder.
      const rwBudget = distance_mi ?? 5;
      const rwWuFloor = 0.5, rwCdFloor = 0.5;
      const rwFloatTotal = Math.max(0, repCount - 1) * (restS / 540);
      const rwRepTotal = repCount * repMi;
      const rwWuRaw = Math.max(rwWuFloor, Math.min(1.5, (rwBudget - rwRepTotal - rwFloatTotal) / 2));
      const rwWu = Number(rwWuRaw.toFixed(1));
      const rwCd = Number(Math.max(rwCdFloor, Math.min(1.0, rwBudget - rwRepTotal - rwFloatTotal - rwWu)).toFixed(1));
      return {
        spec: {
          kind: 'threshold',
          warmup_mi: rwWu,
          rep_count: repCount,
          rep_distance_mi: repMi,
          rep_pace_s_per_mi: repPace,
          rep_rest_s: restS,
          cooldown_mi: rwCd,
          lthr_bpm: hrLthrBpm(lthr),
          ...withRules,
        },
        paceTargetSPerMi: repPace,
      };
    }
    case 'strides': {
      // DOCTRINE-STRIDES-1 · a standalone strides session (workout_library
      // `strides-standalone`, "2 mi E + 6×80m strides"). Research/04 §7.2
      // §Placement: "End of an easy run, mid-warmup before a workout, or
      // standalone day" — this is the third of those. The easy jog carries the
      // distance; the strides ride on top, exactly as on an easy day.
      const parsed = parseStrides(prescription);
      return {
        spec: {
          kind: 'strides',
          pace_target_s_per_mi_lo: easyLo,
          pace_target_s_per_mi_hi: easyHi,
          hr_cap_bpm: hrCapEasy(lthr, maxHr),
          strides_reps: parsed?.reps ?? STRIDE_DEFAULT_REPS,
          strides_duration_s: parsed?.durationS
            ?? (parsed?.distanceM != null ? strideSecondsFor(parsed.distanceM, stridePace) : STRIDE_DURATION_S),
          strides_pace_s_per_mi: stridePace,
          strides_recovery_s: STRIDE_RECOVERY_S,
        },
        // Like easy: the run itself has a band, not a headline pace. The
        // strides' own target lives in strides_pace_s_per_mi.
        paceTargetSPerMi: null,
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
      // GRAMMAR-SEQ-1 · an unequal-step session sums its own steps. The uniform
      // fields below carry the same totals by construction, so this branch and
      // that one agree; it is here because the steps are the truth and reading
      // the summary of a thing you are holding is how the two drift.
      const steps = Array.isArray(s.steps) ? (s.steps as SpecStep[]) : null;
      if (steps && steps.length > 0) {
        let work = 0;
        let restS = 0;
        let unpriced = false;
        for (const st of steps) {
          const mi = Number(st?.distance_mi ?? 0) || 0;
          if (!(mi > 0)) unpriced = true;
          work += mi;
          restS += Number(st?.rest_s ?? 0) || 0;
        }
        // A step with no mileage is a by-effort step whose seconds could not be
        // converted. The day's headline distance is then the honest total, the
        // same answer a time-based rep set gets two lines down.
        if (unpriced) return fallbackDistanceMi;
        return Number((wu + work + restS / 540 + cd).toFixed(1));
      }
      // DOCTRINE-VOCAB-1 · a time-based rep set has no rep distance to sum.
      // What the runner covers in the prescribed seconds IS the day's mileage,
      // so the headline distance stands. Without this the old sum would have
      // returned warm-up + floats + cool-down and shrunk a 7-mile hill session
      // to about 3.
      if ((Number(s.rep_duration_s ?? 0) || 0) > 0 && !(Number(s.rep_distance_mi ?? 0) > 0)) {
        return fallbackDistanceMi;
      }
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
    case 'strides':
      // Single-segment workouts · distance_mi as-passed IS the total.
      // Strides included: Research/04:349 "Not a workout" — 4-8 × 20 s with
      // full walk-back recovery is neuromuscular work inside the easy run's
      // own mileage, not mileage added on top of it.
      return fallbackDistanceMi;
    default:
      return fallbackDistanceMi;
  }
}

/**
 * 2026-06-21 · cap a quality spec's REALIZED distance at maxMi.
 *
 * The persisted plan_workouts.distance_mi is totalDistanceMiFromSpec(spec) — the
 * sum of the spec's segments — NOT the DayPlan.distanceMi the post-compose
 * easy/quality≤long sweep clamps. So a structured session whose WU/reps/float-
 * jog/CD sum past the (clamped) headline ships a quality run LONGER than the
 * week's long run on short-race plans (round-2 CRITICAL). Call this at persist
 * with maxMi = the clamped day distance: it scales the spec's segments down to
 * fit so the persisted total honours the clamp. A no-op when the spec already
 * fits (every budget-scaled spec for established runners → byte-for-byte same).
 */
export function capSpecToDistance(spec: WorkoutSpec, maxMi: number): WorkoutSpec {
  if (!spec || typeof spec !== 'object' || !(maxMi > 0)) return spec;
  const realized = totalDistanceMiFromSpec(spec, maxMi);
  if (realized <= maxMi + 0.05) return spec;
  const s: Record<string, unknown> = { ...(spec as Record<string, unknown>) };
  const kind = String(s.kind ?? '');
  if (kind === 'tempo') {
    // TEMPO-WU-1 belt-and-suspenders: apply the same 0.5mi floor here in case a parsed
    // prescription with large WU/CD gets proportionally scaled down to 0. Established runners
    // (wu/cd already large) see no change — the floor never binds.
    const k = maxMi / realized;
    const wu = Math.max(0.5, Number((Number(s.warmup_mi ?? 0) * k).toFixed(1)));
    const cd = Math.max(0.5, Number((Number(s.cooldown_mi ?? 0) * k).toFixed(1)));
    s.warmup_mi = wu;
    s.cooldown_mi = cd;
    s.tempo_distance_mi = Number(Math.max(0.5, maxMi - wu - cd).toFixed(1));
  } else if (kind === 'threshold' || kind === 'intervals') {
    // GRAMMAR-SEQ-1 · an unequal-step session is a FIXED shape doctrine states
    // by name, and a ladder with a rung removed is a different workout. So the
    // easy legs give way first and completely, and only if the work itself
    // still will not fit does a step come off the END — the ascending ladder
    // loses its 1600 rather than its 400, which §13.1 says is the rung that
    // "tests stamina", because losing the opening rung would leave a session
    // that never warms into its own progression.
    //
    // Reaching the second half means the week could not afford this session,
    // and the selector has already refused it on those weeks
    // (`sessionAllowanceMi` prices the whole sequence against Daniels' share
    // before it is offered). This is the last-resort guard for the adapt and
    // restore paths, which do not run the selector.
    const stepList = Array.isArray(s.steps) ? [...(s.steps as SpecStep[])] : null;
    if (stepList && stepList.length > 0) {
      const wuMin = 0.5, cdMin = 0.5;
      const sumOf = (list: SpecStep[]) => {
        let work = 0, restS = 0;
        for (const st of list) {
          work += Number(st?.distance_mi ?? 0) || 0;
          restS += Number(st?.rest_s ?? 0) || 0;
        }
        return work + restS / 540;
      };
      while (stepList.length > 2 && sumOf(stepList) + wuMin + cdMin > maxMi) stepList.pop();
      // Nothing recovers into the end of the session.
      stepList[stepList.length - 1] = { ...stepList[stepList.length - 1], rest_s: 0 };
      const body = sumOf(stepList);
      const slack = Math.max(0, maxMi - body);
      const wu = Number(Math.max(wuMin, slack / 2).toFixed(1));
      s.steps = stepList;
      s.rep_count = stepList.length;
      s.warmup_mi = wu;
      s.cooldown_mi = Number(Math.max(cdMin, slack - wu).toFixed(1));
      return s as WorkoutSpec;
    }
    // DOCTRINE-VOCAB-1 · nothing to scale on a time-based rep set: its work is
    // denominated in seconds, and totalDistanceMiFromSpec already reports the
    // day's headline distance, so `realized` can never exceed maxMi and this
    // branch is unreachable for it. Guarded explicitly so a future change to
    // the sum can't start dividing by a rep distance of zero.
    if ((Number(s.rep_duration_s ?? 0) || 0) > 0 && !(Number(s.rep_distance_mi ?? 0) > 0)) return spec;
    let repMi = (Number(s.rep_distance_mi ?? 0) || 0) > 0
      ? Number(s.rep_distance_mi)
      : (Number(s.rep_distance_m ?? 0) || 0) / 1609.34 || 1;
    const floatPer = (Number(s.rep_rest_s ?? 0) || 0) / 540;
    let reps = Number(s.rep_count ?? 0) || 0;
    const wuMin = 0.5, cdMin = 0.5;
    // PP-1 (2026-06-23) · drop to 1 rep (was floored at 2 — a no-op at reps=2 that let a clamped
    // quality day realize ~3.1mi over a 3mi long, violating long-primacy in the PERSISTED plan).
    while (reps > 1 && (reps * repMi + Math.max(0, reps - 1) * floatPer + wuMin + cdMin) > maxMi) reps--;
    const floatTotal = Math.max(0, reps - 1) * floatPer;
    // PP-1 · if even the minimum rep set + WU/CD floor still overshoots a tiny budget, SHRINK the rep
    // distance (mirrors tempo's continuous scaling) so the day fits under the long. Byte-safe — only
    // engages when realized still exceeds maxMi at a tiny budget (established runners untouched).
    if (reps * repMi + floatTotal + wuMin + cdMin > maxMi) {
      repMi = Math.max(0.1, (maxMi - wuMin - cdMin - floatTotal) / Math.max(1, reps));
      s.rep_distance_mi = Number(repMi.toFixed(2));
      if (s.rep_distance_m != null) s.rep_distance_m = Math.round(repMi * 1609.34);
    }
    // SPEC-CAP-1 (2026-06-23) · the prior max(wuMin+cdMin, ...) ensured floors in normal paths
    // but became harmful after the repMi shrink above: when repMi hits the 0.1 floor and
    // reps*repMi+float already consumes most of maxMi, the remaining slack may be < wuMin+cdMin,
    // and the max() overallocates WU+CD (e.g. 0.5+0.1+0+0.5 = 1.1mi > 1.0mi budget). The wu/cd
    // floors on lines 674-675 already enforce the minimum — the max() here is redundant and wrong.
    const slack = maxMi - reps * repMi - floatTotal;
    s.rep_count = reps;
    // 2026-06-21 · round wu once, derive cd as the exact remainder so
    // wu + cd == slack exactly (no independent-rounding overshoot).
    const wu = Number(Math.max(wuMin, slack / 2).toFixed(1));
    const cdRaw = Math.max(cdMin, slack - wu);
    s.warmup_mi = wu;
    s.cooldown_mi = Number(cdRaw.toFixed(1));
  }
  return s as WorkoutSpec;
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
  // PACE-5 · ultra (50K+) T-pace is NOT goalPace−18 — an ultra finish pace is an arbitrary
  // slow target far below threshold. Return null so the caller anchors T to VDOT instead
  // (Research/22:289/297/316 · ultra runs at "race-paced effort", not MP; Research/00a:311-312
  // · ultra threshold ≈ fitness-anchored steady tempo, never finish-pace-derived).
  if (goalDistanceMi >= 31) return null;
  if (goalDistanceMi >= 25) return goalSPerMi - 18;   // marathon
  if (goalDistanceMi >= 12) return goalSPerMi - 5;    // half
  if (goalDistanceMi >= 5)  return goalSPerMi + 8;    // 10K
  return goalSPerMi + 15;                              // 5K
}

/**
 * Cold-start pace floor: when no measured fitness signal exists, anchor
 * conservatively on weekly mileage rather than on the runner's goal. A 28-min
 * 5K runner entering sub-20 at 15 mpw is assumed VDOT 32 (~10:45 easy), not
 * VDOT 50 (~8:12 easy). Deliberate underestimate.
 *
 * ── THESE NUMBERS ARE A CONVENTION, NOT A RESEARCH FINDING ─────────────────
 *
 * 2026-08-17 · this carried the citation `Daniels Running Formula §"VDOT and
 * Training" — mileage-band heuristic` for two months. **There is no such
 * table.** Daniels derives VDOT from race performance; he publishes no
 * mileage-to-VDOT mapping, and the cited section does not resolve to anything
 * in `Research/`. The citation was laundering a product convention into a
 * research finding, on the single most consequential number for every new user.
 *
 * What IS cited is the SHAPE of the idea, not the values: `Research/00a`
 * §"Volume table" maps weekly mileage to a competitive tier per distance
 * (beginner / recreational competitive / sub-elite / elite), and its closing
 * line — "the first 30 mi/wk produces the largest improvements" — is why the
 * bands below are dense at the bottom and flatten out.
 *
 * The specific VDOTs are ours. They are chosen to sit low, because the cost of
 * the two errors is not symmetric: an over-estimate prescribes a beginner work
 * they cannot absorb, and an under-estimate prescribes work that is merely too
 * easy for a few weeks until real evidence arrives.
 *
 * The guarantee this function owes, and which `CONVENTION.cold-start-mileage-
 * anchor` in the doctrine registry enforces, is that it is monotonic, bounded,
 * and conservative — never that it is measured. Its output is marked
 * `provisional_mileage` all the way through `pace_blend`, and three readers
 * refuse to inherit it (`anchor-provenance.ts`).
 *
 * 2026-06-10 · lifted to module scope from generate.ts (where it was nested in
 * the composer) so the maintenance seeder anchors on the same convention.
 */
export function conservativeVdotFromMileage(weeklyMi: number): number {
  // ── HIGHVOL-1 (2026-08-19) · the ladder used to END at 45 mi/wk ────────────
  //
  // `if (weeklyMi >= 45) return 47` was the top rung, so a runner at 45 mi/wk
  // and a runner at 120 mi/wk were handed the same anchor — and 47 happens to
  // be the owner's own VDOT, which is how it got there. `Research/00a`
  // §"Volume table" describes training volumes to 200 mi/wk across four
  // competitive tiers; a ladder that flattens at the bottom of that range is
  // asserting the runner's volume stops mattering exactly where doctrine says
  // three more tiers begin.
  //
  // The rungs added here keep every property this function owes: monotonic,
  // conservative, and CAPPED — `CONVENTION.cold-start-mileage-anchor` holds the
  // top band at 50 on purpose, because this is a guess from a self-report and a
  // guess must never reach a value the Daniels tables treat as a competitive
  // performance. So a 100 mi/wk cold start is still anchored well below what
  // they almost certainly run. That is deliberate and it is not the mechanism
  // meant to close the gap: the anchor is marked `provisional_mileage` through
  // `pace_blend`, the calibration intro runs the opening quality sessions by
  // EFFORT rather than at this pace, and `reanchorActivePlan` replaces it the
  // day a measured read lands — which for a runner at this volume is days.
  // The rungs start at 70 rather than at 55 deliberately: 45-70 mi/wk is where
  // the app's existing runners sit and their authored plans stay byte-for-byte
  // what they were. The gap this closes is above them, where doctrine's table
  // still had two tiers to go and the ladder had none.
  if (weeklyMi >= 100) return 50;
  if (weeklyMi >= 85) return 49;
  if (weeklyMi >= 70) return 48;
  if (weeklyMi >= 45) return 47;
  if (weeklyMi >= 40) return 45;
  if (weeklyMi >= 35) return 43;
  if (weeklyMi >= 30) return 40;
  if (weeklyMi >= 25) return 38;
  if (weeklyMi >= 20) return 35;
  if (weeklyMi >= 15) return 32;
  // 30 is the bottom of Daniels' published VDOT table — the one genuinely
  // cited number here. Below it the tables do not go, and a runner under it is
  // indistinguishable from no data at all.
  return 30;
}
