/**
 * prescriptions.ts — turn a workout type + the runner's profile into a
 * fully-broken-out prescription: warmup, main set with reps + paces +
 * HR targets, recovery, cooldown, the WHY. No coach abbreviations
 * unless the abbrev is glossed alongside.
 *
 * ── SECOND-OWNER-1 (2026-09-02) · THE GOAL-DERIVED PACE LADDER IS DELETED ───
 *
 * This file used to answer "what is this runner's threshold pace" ITSELF, and
 * it answered it from the runner's TYPED GOAL:
 *
 *     const t = tPaceFromGoal(p.goal_seconds, p.goal_distance_mi);
 *     easySecLo: t + 80, thresholdSec: t, intervalSec: t - 18,
 *     repSec: t - 61, marathonSec: t + 18, …
 *
 * Constitution §7 names that shape verbatim as the anti-pattern
 * (`if userHasGoal: trainingPace = goalPaceAdjusted`), BRIEF 03's hard rule is
 * `goal ≠ current training capacity`, and
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` requires goal data to
 * be PHYSICALLY excluded from a capacity resolver's inputs rather than kept
 * apart by convention. Measured on the owner's own production account,
 * 2026-09-02, against the canonical anchors for the SAME runner on the SAME
 * day — his 3:00:00 CIM goal against `resolvePrescribedPaceAnchors`:
 *
 *     threshold   394 s/mi   vs   430   ·  36 s/mi too fast
 *     interval    376        vs   401   ·  25 s/mi too fast
 *     repetition  333        vs   365   ·  32 s/mi too fast
 *     marathon    412        vs   472   ·  60 s/mi too fast
 *     easy band   474-514    vs   ceiling 502 · opened 28 s/mi too fast
 *
 * A minute per mile at the marathon, in the dangerous direction, live on the
 * iPhone Today card and on the wrist. `derivePaces` and `tPaceSecPerMi` are
 * GONE — deleted, not deprecated, per the standing rule against leaving a
 * migrated path behind as a comment somebody will call anyway.
 *
 * WHAT ANSWERS THE QUESTION NOW: `resolvePrescribedPaceAnchors`
 * (`lib/training/load-prescription-anchors.ts` → `composePaceAnchors`), whose
 * six anchors are composed from the four canonical capacity resolvers and are
 * compile-time sealed against goal data. This file is now an ADAPTER over that
 * set: it re-labels and formats, and it derives NOTHING. Threshold, interval,
 * repetition and marathon are taken DIRECTLY off the anchors rather than
 * re-derived by offset, because an offset applied here would be a third answer.
 *
 * WHAT IS REFUSED, AND WHY THAT IS THE RIGHT ANSWER (Rule 11): there is no easy
 * BAND and no long BAND any more. Doctrine gives easy and long ONE number and
 * it is a CEILING — `easyCeilingSecPerMi` is the fast edge a prescription must
 * not cross, not the midpoint of a two-sided window. Inventing a width around
 * it would be a new second answer with no owner, so a surface that needs a band
 * gets `null` and falls back to effort cues. A refusal is a correct answer; a
 * confident band measured off nothing is not.
 *
 * HR targets still come from the runner's own LTHR (Friel zones) and are
 * untouched by this change: LTHR is a measurement, not a goal.
 *
 * Doctrine:
 *   Research/01-pace-zones-vdot.md (Daniels pace bands)
 *   Research/03-heart-rate-zones.md §6 (Friel LTHR zones)
 *   Research/04-workout-vocabulary.md (warmup/cooldown defaults)
 */

import { computeZones, type ZoneTable } from './zones';
import type { SessionType } from './workout-type';
import type { PrescribedPaceAnchors } from './prescription-resolver';
import { composeQualityDay } from '@/lib/plan/quality-day';
import { atPaceSessionCapMi } from '@/lib/prescription/levers';

/* ── LOWVOL-4 (2026-08-19) · THIS FILE DID NOT SCALE WITH WEEKLY VOLUME ──────
 *
 * Every quality prescription below carried a fixed `wuMi = 1.5, cdMi = 1` and a
 * rep count off a three-rung mileage ladder that bottomed out at "everyone
 * else". On an 8 mi/wk week that produced a 4.8-mile threshold day — 60% of the
 * week — and a 6.0-mile intervals day, 75%. The card is a fallback (an
 * authored `workout_spec` wins wherever one exists) but it is the one a
 * spec-less row renders on the wrist, and a small runner is exactly the runner
 * whose rows predate the spec.
 *
 * The repair is to stop having a second opinion. `atPaceSessionCapMi` is
 * Daniels' weekly share (T ≤10%, I ≤8%) crossed with `Research/04` §5.1/§6.1's
 * session band, and `composeQualityDay` is the warm-up and cool-down §5.3
 * states, scaled when the runner cannot afford the whole dose and floored where
 * `spec-builder` would re-impose its own. Both are already bound by the
 * doctrine registry. The rep count can only ever come DOWN from the ladder that
 * was here, so a runner whose dose already funded the old count is unchanged.
 */

/** `Research/00a` §"Volume progression rules" · "Long-run cap | ≤25-30% of
 *  weekly volume". The engine takes the ceiling of the stated band. */
const LONG_RUN_SHARE_CAP = 0.30;

/** Reps the week's own at-pace allowance funds, never more than `ladder`. */
function affordableReps(weeklyMi: number, family: 'threshold' | 'interval', repMi: number, ladder: number): number {
  const cap = atPaceSessionCapMi(Math.max(0, weeklyMi), family);
  return Math.max(1, Math.min(ladder, Math.floor(cap / repMi)));
}

/** Split the slack between warm-up and cool-down when the plan's target for the
 *  day is LONGER than the dosed session — the card and the breakdown have to
 *  agree on the same total. 60/40, as before. */
function padToTarget(
  targetMi: number | undefined, dayMi: number, workMi: number, wuMi: number, cdMi: number,
): { wuMi: number; cdMi: number } {
  if (targetMi == null || !(targetMi > dayMi)) return { wuMi, cdMi };
  const need = Math.max(0, targetMi - workMi);
  return { wuMi: Math.round(need * 0.6 * 10) / 10, cdMi: Math.round(need * 0.4 * 10) / 10 };
}

/**
 * CONVERGED 2026-08-18 · this was a nine-member union that omitted `fartlek`,
 * `progression`, `recovery` and `race_week_tuneup`, all of which the generator
 * emits and `lib/coach/run-purpose.ts` already accepted. The two unions asked
 * the same question and disagreed on the answer, so `derivePurpose` could be
 * asked about a day `prescriptionFor` could not. Both now name the same type.
 *
 * Widening is safe here: `prescriptionFor`'s switch has a `default` arm, so a
 * newly-admissible type returns the generic "No workout scheduled" card rather
 * than failing to compile. That is the same behaviour those types already got
 * at run time via the `wo.type as WorkoutType` cast in
 * `lib/watch/build-workout.ts` — the difference is that the cast is no longer
 * lying about it.
 */
export type WorkoutType = SessionType;

/**
 * The plan's raw `type` column, narrowed to a type `prescriptionFor`'s switch
 * actually implements.
 *
 * Lifted here 2026-08-24 from `app/api/v5/today/route.ts` (byte-identical) for
 * the reason the union's own comment above states and then leaves standing:
 * four of the types the generator emits — `race_week_tuneup`, `fartlek`,
 * `progression`, `recovery` — reach the `default` arm and come back as
 * `total_mi: 0`, "No workout scheduled". The phone narrows them away before
 * asking. `lib/watch/build-workout.ts` casts and asks anyway, so on the watch
 * a race-week tune-up whose `workout_spec` is missing has nothing to fall back
 * on. One definition, so a third caller cannot fork it again.
 */
export function narrowToPrescriptionType(plannedType: string | null): WorkoutType {
  return strictPrescriptionType(plannedType) ?? 'easy';
}

/**
 * PRERUN-1 · the same narrowing, WITHOUT the closing guess.
 *
 * `narrowToPrescriptionType`'s `default: return 'easy'` is the exact move
 * `canonicalSessionType`'s own doc comment forbids two files away — "silently
 * returning `easy` for an unknown string is how a rep session becomes a jog"
 * — and the pre-run card was built on it. Measured against production
 * 2026-08-24: `strength` is a live `plan_workouts.type` with 44 rows, 8 of
 * them on active future-dated plans, and every one of them reached the phone
 * as an EASY RUN. Because a strength row carries `distance_mi = 0`, the easy
 * card came back with no steps and a headline of "Easy aerobic", and the
 * panel's dose slot — the largest text on the screen — printed the words
 * "Easy aerobic" where a distance belongs.
 *
 * RULE THREE. A caller that cannot name the day must say so, not run the
 * nearest card it happens to implement. Null here; the caller refuses.
 *
 * `narrowToPrescriptionType` keeps the fallback because the WATCH still
 * depends on it (`lib/watch/build-workout.ts` has no refusal path and a wrist
 * that shows nothing is worse than a wrist that shows an easy run), and
 * because changing it would silently alter every caller at once. One
 * definition, two contracts, and the difference is stated rather than
 * implied.
 */
export function strictPrescriptionType(plannedType: string | null): WorkoutType | null {
  const t = (plannedType ?? '').trim().toLowerCase();
  switch (t) {
    case 'easy': case 'long': case 'tempo': case 'threshold': case 'intervals':
    case 'race': case 'shakeout': case 'rest': case 'unplanned':
      return t as WorkoutType;
    case 'race_week_tuneup': return 'threshold';
    case 'recovery': return 'easy';
    case 'fartlek': case 'progression': return 'tempo';
    case 'vo2max': case 'vo2': case 'interval': case 'track': return 'intervals';
    default: return null;
  }
}

export interface PrescriptionStep {
  label: string;          // "Warmup", "Reps", "Recovery", "Cooldown"
  distance_mi?: number;   // e.g. 1.5
  reps?: number;          // e.g. 3 for 3 × 1mi
  rep_distance_mi?: number;
  duration?: string;      // "2:00" for recoveries
  pace_target?: string;   // "6:48 /mi" or "9:00-9:15 /mi"
  hr_target?: string;     // "156-162 bpm (Z4)"
  note: string;           // execution instruction

  // When this step is a REPEAT block (intervals/threshold reps), the work
  // segment + recovery are folded into one card. The top-level pace/hr/
  // distance describe the WORK rep; recovery describes the rest.
  recovery?: {
    duration: string;       // "2:00"
    pace_target?: string;   // "easy jog"
    note: string;
  };

  /**
   * PRERUN-1 · what the rep IS, in the plural, when this step is a rep block.
   * "hills", "reps", "strides", "surges".
   *
   * `expandSpecToPhases` names each work phase for what it is — "Hill 3 of 11
   * · 10s" — and `cardFromSpec` was collapsing eleven of those into the single
   * label "Repeat 11×". The screen then rendered "11 × 10s", which is a
   * different session from "11 × 10s hills" and cannot be run off the page:
   * ten seconds on the flat and ten seconds up a hill are not the same
   * prescription. Read off the phase label, never inferred from the type.
   *
   * Server-internal. Not a wire field — `lib/faff/v5-today.ts` folds it into
   * the step's own text before the payload is built.
   */
  rep_noun?: string;

  /**
   * PRERUN-1 · what the plan asked for when it asked for no NUMBER.
   *
   * A rep under 30 seconds gets no heart-rate band (`Research/03` §13 — see
   * `HR_TARGET_MIN_REP_SEC`) and a `by_effort` rep carries no pace, so the
   * target column had nothing in it at all. An empty target column on a
   * screen full of targets reads as a value that failed to load, not as a
   * plan that declined to name one. This says which.
   *
   * Server-internal, like `rep_noun`.
   */
  effort_target?: string;
}

export interface Prescription {
  type: WorkoutType;
  headline: string;       // "Threshold reps · engine's ceiling"
  why: string;            // one-sentence rationale
  steps: PrescriptionStep[];
  total_mi: number;
  citation: string;
  zones?: ZoneTable | null;
  /**
   * Fueling plan for this workout. Computed from total_mi + workout
   * type + temperature + the runner's product preferences
   * (users.fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr).
   *
   * shortLine drops in directly to the briefing voice — "2 Maurten
   * 100s at 30 + 60 min" when products are set; "2 gels" otherwise.
   *
   * Cite: Research/18-fueling-products.md §1 + §13.
   */
  fueling?: {
    needed: boolean;
    gels: number;
    atMins: number[];
    carbsTotalG: number;
    shortLine: string;
    why: string;
    citation: string;       // Research/18 §1 + §13 · surfaced in the "why" affordance
  } | null;
}

export interface ProfileInputs {
  /** The runner's own LTHR, for the Friel HR zones. A measurement. */
  lthr?: number | null;
  /**
   * SECOND-OWNER-1 · THE canonical six anchors, from
   * `resolvePrescribedPaceAnchors`. Every pace this file prints comes off this
   * object and nothing else.
   *
   * `null` means the anchor set was REFUSED or was never resolved — the caller
   * has no capacity read for this runner. It is not "no goal" and it is not
   * zero: every pace becomes `null` and every surface degrades to an effort
   * cue, which is the only honest thing to print (Rule 11).
   *
   * The two goal fields this interface used to carry — `goal_seconds` and
   * `goal_distance_mi` — are DELETED. They are the physical exclusion
   * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` asks for: a caller
   * can no longer hand this file a goal, so it can no longer price a training
   * pace from one, and that is a compile error rather than a review finding.
   */
  anchors?: PrescribedPaceAnchors | null;
  /**
   * A race's DISTANCE in miles — used ONLY as the `race` arm's `total_mi`.
   * A distance is not a pace: this never reaches the ladder above, and the
   * race arm prescribes no pace at all (see `case 'race'`).
   */
  raceDistanceMi?: number | null;
}

// ── Pace formatting ─────────────────────────────────────────────────────

function fmtPace(sPerMi: number | null): string | null {
  if (sPerMi == null || sPerMi <= 0 || !isFinite(sPerMi)) return null;
  const m = Math.floor(sPerMi / 60);
  return `${m}:${String(Math.round(sPerMi % 60)).padStart(2, '0')}`;
}

/**
 * A CEILING rendered as a ceiling. `easyCeilingSecPerMi` is the fast edge of
 * every easy, long and general-aerobic prescription — "do not run faster than
 * this" — and printing it as a bare pace would read as a target to hit. There
 * is no canonical easy BAND to print instead, and inventing a width around the
 * ceiling would be a second answer with no owner (SECOND-OWNER-1).
 */
function fmtCeiling(sPerMi: number | null): string | null {
  const p = fmtPace(sPerMi);
  return p ? `no faster than ${p} /mi` : null;
}

/**
 * REP-DEDUP-1 (2026-08-29) · used to carry its own copy of every T-offset,
 * kept "in sync" with the pace ladder by a comment instead of by the compiler.
 *
 * SECOND-OWNER-1 (2026-09-02) · there is no T-offset table here any more, in
 * either copy. Every number below is read straight off the canonical anchors,
 * so the two cannot drift apart because there is only one of them.
 */
function paces(p: ProfileInputs) {
  const d = cardPaceTargets(p);
  return {
    // Easy and long are ONE ceiling in doctrine ("long is easy effort with more
    // volume" — `PrescribedPaceAnchors.easyCeilingSecPerMi`'s own contract), so
    // they print the same string rather than two bands that were never
    // separately resolved.
    easy:      fmtCeiling(d.easyCeilingSec),
    long:      fmtCeiling(d.easyCeilingSec),
    shakeout:  fmtCeiling(d.shakeoutCeilingSec),
    marathon:  fmtPace(d.marathonSec),
    // PACE.tempo-is-threshold · a continuous tempo is run AT T.
    tempo:     fmtPace(d.tempoSec),
    threshold: fmtPace(d.thresholdSec),
    interval:  fmtPace(d.intervalSec),
    rep:       fmtPace(d.repSec),
  };
}

/**
 * SPECFIRST-1 · exported so `lib/training/spec-card.ts` quotes the SAME zone
 * band strings this file does. A zone is the runner's own physiology (LTHR →
 * Friel bands), not a session structure, so it is safe to share across both
 * card sources — and sharing it is what stops the two rendering "Z4" two
 * different ways.
 *
 * HR-SEMANTICS-1 (2026-09-01) · this is the EXPECTED-RESPONSE / INFORMATIONAL
 * mechanism named in `docs/reports/hr-semantics-2026-09-01.md`. It is
 * display-only — nothing parses this string back into a number, nothing
 * gates or grades against it — and it must never be presented as something
 * the runner is meant to hit or hold. Two other, structurally different HR
 * mechanisms exist in this codebase and must not be confused with this one
 * (Rule 16 — one quantity, one name):
 *
 *   - the PASS/BAIL CONTINGENCY pair (`thresholdPassHrBpm` in `zones.ts`,
 *     `lthr + 5`) — `lib/plan/spec-builder.ts`'s `contingencyRules`, an
 *     offered mid-run escape hatch, never enforced, evaluated against
 *     average work-segment HR;
 *   - the quality-phase "expected" reference the watch/phone live-run
 *     screen reads off `workout_spec.lthr_bpm` / `hr_target_bpm`
 *     (`lib/watch/build-workout.ts`'s `workHrTargetBpm`) — see
 *     `LiveRunOutdoorV5.heartReference` for how that surface now keeps it
 *     visually distinct from a genuine ceiling.
 *
 * The leading "~" is the app's existing mark for a modelled/informational
 * number (see CLAUDE.md's design-brief section) — carried here so a zone
 * band never reads as a literal instruction beside a `pace_target` that IS
 * one.
 */
export function hrTargets(p: ProfileInputs) {
  const z = p.lthr ? computeZones({ lthr: p.lthr }) : null;
  if (!z) return null;
  const get = (idx: number) => {
    const zz = z.zones.find((x) => x.idx === idx);
    if (!zz) return null;
    // Z1 has no meaningful lower bound (no one runs at 0 bpm) — show "< upper"
    // Z5 has no meaningful upper bound (no one's max is hardcoded here) — show "> lower"
    // Everything else: lower-upper range
    if (zz.idx === 1) return `~< ${zz.upper} bpm (${zz.shortLabel} ${zz.label})`;
    if (zz.idx === 5) return `~> ${zz.lower} bpm (${zz.shortLabel} ${zz.label})`;
    return `~${zz.lower}–${zz.upper} bpm (${zz.shortLabel} ${zz.label})`;
  };
  return {
    z1: get(1), z2: get(2), z3: get(3), z4: get(4), z5: get(5),
    table: z,
  };
}

// ── Canonical pace targets, adapted for the card surfaces ────────────────

/**
 * The card surfaces' view of the canonical anchor set. An ADAPTER, not a
 * derivation: every field is either read straight off `PrescribedPaceAnchors`
 * or is `null`. Nothing here applies an offset, a blend or a widening — the
 * moment it did, this file would be a second answer again.
 */
export interface CardPaceTargets {
  /** T · `anchors.thresholdSecPerMi`. */
  thresholdSec: number | null;
  /** A continuous tempo IS threshold work · `PACE.tempo-is-threshold`. */
  tempoSec: number | null;
  /** I · `anchors.intervalSecPerMi`. */
  intervalSec: number | null;
  /** R · `anchors.repetitionSecPerMi`. Null when the high-intensity ladder
   *  cannot price a mile-column pace at all — the anchor set says so itself,
   *  and a caller must branch rather than read a substituted I-pace. */
  repSec: number | null;
  /** M · `anchors.marathonSecPerMi`, through the runner's own endurance
   *  exponent. */
  marathonSec: number | null;
  /** The honest span around `marathonSec` when the anchor set carries one. */
  marathonRangeSec: readonly [number, number] | null;
  /**
   * The FAST EDGE of every easy, long and general-aerobic prescription — a
   * CEILING, not the middle of a band. There is deliberately no `easySecLo` /
   * `easySecHi` pair here and no `longSecLo` / `longSecHi` pair: doctrine
   * resolves ONE number for easy and long, and the two-sided window this file
   * used to print was `T + 80 … T + 120` off a GOAL-derived T. A surface that
   * needs a band gets nothing and says "by feel" (Rule 11 — refusing is the
   * answer; inventing a width would be a new second owner).
   */
  easyCeilingSec: number | null;
  /** The fast edge of a shakeout or recovery day. Also a ceiling. */
  shakeoutCeilingSec: number | null;
  /** Aerobic HR ceiling (Z2 upper from LTHR), bpm. null w/o LTHR. */
  aerobicCapBpm: number | null;
  zoneTable: ZoneTable | null;
}

/**
 * Adapt the canonical anchors (+ the runner's LTHR zones) into the shape the
 * Today card, the Poster fallback and the watch template read.
 *
 * SECOND-OWNER-1 (2026-09-02) · this replaces `derivePaces`, which built the
 * whole ladder as offsets from `tPaceFromGoal(goal_seconds, goal_distance_mi)`.
 * See this file's header for the measured cost on the owner's own account.
 *
 * Every number returned came out of the four canonical capacity resolvers, via
 * `composePaceAnchors`. `p.anchors == null` — never resolved, or REFUSED by the
 * coherence gate — yields nulls throughout and callers fall back to effort
 * cues. It never falls back to a goal, a population pace, or a constant.
 */
export function cardPaceTargets(p: ProfileInputs): CardPaceTargets {
  const a = p.anchors ?? null;
  const z = p.lthr ? computeZones({ lthr: p.lthr }) : null;
  const z2 = z?.zones.find((x) => x.idx === 2) ?? null;
  return {
    thresholdSec: a?.thresholdSecPerMi ?? null,
    // PACE.tempo-is-threshold · Research/04 §5.1's "Continuous tempo" row
    // prices the workout at T, flat, with no offset. Read off the SAME field
    // as `thresholdSec` rather than copied through an offset, so the two
    // cannot drift apart the way the old `tempoSecLo/Hi` pair did.
    tempoSec: a?.thresholdSecPerMi ?? null,
    intervalSec: a?.intervalSecPerMi ?? null,
    repSec: a?.repetitionSecPerMi ?? null,
    marathonSec: a?.marathonSecPerMi ?? null,
    marathonRangeSec: a?.marathonRangeSecPerMi ?? null,
    easyCeilingSec: a?.easyCeilingSecPerMi ?? null,
    shakeoutCeilingSec: a?.shakeoutCeilingSecPerMi ?? null,
    aerobicCapBpm: z2?.upper ?? null,
    zoneTable: z,
  };
}

// ── Per-workout builders ────────────────────────────────────────────────

/**
 * SPECFIRST-1 (2026-08-24) · the prose half of a prescription, split out from
 * the numbers.
 *
 * `prescriptionFor` computes two different kinds of thing in one pass: WHY a
 * session type exists (a fixed sentence per type, true of every threshold day
 * ever written) and WHAT this particular session is (counts, rep distances,
 * paces — sized off a template). Only the second half can disagree with an
 * authored `workout_spec`, and only the second half did.
 *
 * `lib/training/spec-card.ts` composes the card's structure from the spec and
 * needs the first half unchanged. Exporting it here keeps ONE copy of the
 * sentence rather than a second that drifts — the same reason
 * `subLabelFromSpec` lives beside `expandSpecToPhases` instead of in the
 * generator.
 *
 * The headline deliberately carries no count. "Threshold · 3 × 1 mile reps"
 * was the fabrication in the headline itself; the day's real structure comes
 * from the spec, and its authored name from `subLabelFromSpec`.
 */
export function sessionRationale(type: WorkoutType): { headline: string; why: string; citation: string } {
  switch (type) {
    case 'easy': return {
      headline: 'Easy aerobic',
      why: 'Build the aerobic engine without taxing the legs. The discipline is keeping it easy.',
      citation: 'Research/00a-distance-running-training.md §easy-volume' };
    case 'long': return {
      headline: 'Long run',
      why: 'The single most important workout of the week. Time on feet builds everything else.',
      citation: 'Research/00a §long-run' };
    case 'threshold': return {
      headline: 'Threshold reps',
      why: 'Lift the lactate threshold · the engine\'s ceiling. The pace you could hold for an hour.',
      citation: 'Research/04 §intervals-and-threshold' };
    case 'tempo': return {
      headline: 'Tempo',
      why: 'Sub-threshold steady · teach the body to clear lactate, not bury it. Marathon pace territory.',
      citation: 'Research/04 §tempo' };
    case 'intervals': return {
      headline: 'Intervals',
      why: 'VO2 max · the engine\'s peak output. Short reps at race-finish effort.',
      citation: 'Research/04 §intervals' };
    case 'shakeout': return {
      headline: 'Pre-race shakeout',
      why: 'Fire the neuromuscular system without taxing it. Loosen the legs.',
      citation: 'Research/08-pacing-and-race-week.md §day-before' };
    case 'race': return {
      headline: 'Race day',
      why: 'All training points here. Execute the plan.',
      citation: 'Research/08 §race-execution' };
    case 'rest': return {
      headline: 'Rest day',
      why: 'Rest is the work. Glycogen restocks, micro-tears repair, the nervous system resets.',
      citation: 'Research/00b-recovery-protocols.md §rest-physiology' };
    default: return {
      headline: 'No workout scheduled',
      why: 'When a plan is active, the workout for this day will appear here.',
      citation: '' };
  }
}

export function prescriptionFor(
  type: WorkoutType,
  weeklyMi: number,
  p: ProfileInputs,
  /** Optional: the plan's target distance for THIS day. When provided,
   *  the prescription scales its steps to match — so a planned 12.1mi
   *  long run produces steps that add to 12.1, not the weekly default. */
  targetMi?: number,
): Prescription {
  const pc = paces(p);
  const hr = hrTargets(p);
  // SPECFIRST-1 · one copy of the type-level prose, shared with spec-card.ts.
  const rationale = sessionRationale(type);

  switch (type) {
    case 'easy': {
      // Prefer the plan's target distance for this day; fall back to a
      // weekly-volume-derived estimate when no target is passed.
      // LOWVOL-4 · `|| 5` handed a five-mile easy run to a runner whose weekly
      // volume we do not know. An unknown week yields no number.
      const total = targetMi != null && targetMi > 0
        ? Math.round(targetMi * 10) / 10
        : weeklyMi > 0 ? Math.round(weeklyMi * 0.18) : 0;
      return {
        type, total_mi: total,
        headline: 'Easy aerobic',
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [{
          label: 'Run',
          distance_mi: total,
          pace_target: pc.easy ?? 'conversational pace',
          hr_target:   hr?.z2  ?? 'Z2 · conversational',
          note: 'Should be able to talk in full sentences. Cap effort, hold form. If HR drifts up late, slow down rather than push.',
        }],
      };
    }

    case 'long': {
      // Use the plan's target distance when present; the day card and the
      // step breakdown must agree.
      // LOWVOL-4 · the fallback was `weeklyMi * 0.32 || 12`: above doctrine's
      // own long-run cap at every volume (32 miles on a 100 mi/wk week, with
      // nothing consulted), and a fabricated twelve-mile long run for a runner
      // whose weekly volume is unknown. Now it is doctrine's ceiling, and an
      // unknown week yields no number rather than an invented one.
      const total = targetMi != null && targetMi > 0
        ? Math.round(targetMi * 10) / 10
        : weeklyMi > 0 ? Math.round(weeklyMi * LONG_RUN_SHARE_CAP * 10) / 10 : 0;
      const mpMi  = Math.round(total * 0.35 * 10) / 10;
      const easyMi = Math.round((total - mpMi) * 10) / 10;
      const hasMpSegment = weeklyMi >= 35 && pc.marathon;
      const steps: PrescriptionStep[] = hasMpSegment
        ? [
            { label: 'Easy build', distance_mi: easyMi, pace_target: pc.long ?? 'easy', hr_target: hr?.z2 ?? 'Z2',
              note: 'Steady aerobic. Build the engine.' },
            { label: 'Marathon-pace finish', distance_mi: mpMi, pace_target: pc.marathon!, hr_target: hr?.z3 ?? 'Z3',
              note: 'The point of the workout. Find race rhythm. Steady, even effort.' },
          ]
        : [{ label: 'Run', distance_mi: total, pace_target: pc.long ?? 'easy', hr_target: hr?.z2 ?? 'Z2',
              note: 'Time on feet > pace. Fuel ~45 min in and every 30 after.' }];
      return {
        type, total_mi: total,
        headline: hasMpSegment ? 'Long run · marathon-pace finish' : 'Long run · aerobic',
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps,
      };
    }

    case 'threshold': {
      const repMi = 1;
      // LOWVOL-4 · the old ladder is now a CEILING on the dosed count, never a
      // floor under it.
      const reps = affordableReps(weeklyMi, 'threshold', repMi, weeklyMi >= 45 ? 4 : weeklyMi >= 35 ? 3 : 2);
      const recoveryMi = (reps - 1) * 0.3;
      const repsBlockMi = reps * repMi + recoveryMi;
      const day = composeQualityDay({
        family: 'threshold', atPaceMi: reps * repMi, floatMi: recoveryMi,
        ceilingMi: targetMi != null && targetMi > 0 ? targetMi : null,
      });
      const padded = padToTarget(
        targetMi != null && targetMi > 0 ? targetMi : undefined,
        day.dayMi, repsBlockMi, day.warmupMi, day.cooldownMi,
      );
      const wuMi = padded.wuMi, cdMi = padded.cdMi;
      const total = wuMi + repsBlockMi + cdMi;
      return {
        type, total_mi: Math.round(total * 10) / 10,
        headline: `Threshold · ${reps} × 1 mile reps`,
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [
          { label: 'Warmup', distance_mi: wuMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Start easy, build into rep pace in the last 0.25 mi.' },
          { label: `Repeat ${reps}×`, reps, rep_distance_mi: repMi,
            pace_target: pc.threshold ?? 'comfortably hard',
            hr_target: hr?.z4 ?? 'Z4 · just below threshold',
            note: 'Each mile at the same pace · rep 1 must match rep ' + reps + '. If you can\'t hold pace on the last rep, the pace was too aggressive (drop 3-5s/mi next time).',
            recovery: { duration: '2:00', pace_target: 'easy jog',
              note: 'Honest jog between reps, not standing. HR drops 15-20 bpm but doesn\'t fully recover. Skip the recovery after the final rep · straight into cooldown.' },
          },
          { label: 'Cooldown', distance_mi: cdMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Loosen the legs. Don\'t skip · it shortens recovery for tomorrow.' },
        ],
      };
    }

    case 'tempo': {
      // LOWVOL-4 · a continuous tempo is threshold work and spends the same
      // weekly allowance a cruise set does. The ladder is the ceiling.
      const tempoMi = Math.max(
        0.5,
        Math.min(
          weeklyMi >= 45 ? 5 : weeklyMi >= 35 ? 4 : 3,
          Math.round(atPaceSessionCapMi(Math.max(0, weeklyMi), 'threshold') * 2) / 2,
        ),
      );
      const day = composeQualityDay({
        family: 'threshold', atPaceMi: tempoMi, floatMi: 0,
        ceilingMi: targetMi != null && targetMi > 0 ? targetMi : null,
      });
      const padded = padToTarget(
        targetMi != null && targetMi > 0 ? targetMi : undefined,
        day.dayMi, tempoMi, day.warmupMi, day.cooldownMi,
      );
      const wuMi = padded.wuMi, cdMi = padded.cdMi;
      const total = wuMi + tempoMi + cdMi;
      return {
        type, total_mi: total,
        headline: `Tempo · ${tempoMi} continuous miles`,
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [
          { label: 'Warmup', distance_mi: wuMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Build gradually · the last 0.5mi should approach tempo pace.' },
          { label: 'Tempo', distance_mi: tempoMi, pace_target: pc.tempo ?? 'comfortably hard', hr_target: hr?.z3 ?? 'Z3',
            note: 'Continuous, controlled, even pace. If breathing turns ragged, you\'re too hot · back off 5-10s/mi.' },
          { label: 'Cooldown', distance_mi: cdMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Easy jog to flush the legs.' },
        ],
      };
    }

    case 'intervals': {
      const repMi = 0.5; // 800m ≈ 0.5mi
      // LOWVOL-4 · 5×800m was the floor for EVERYONE. It is now the ceiling,
      // and Daniels' 8% decides what the week can actually pay for.
      const reps = affordableReps(weeklyMi, 'interval', repMi, weeklyMi >= 45 ? 6 : 5);
      const recoveryMi = (reps - 1) * 0.25;
      const repsBlockMi = reps * repMi + recoveryMi;
      const day = composeQualityDay({
        family: 'interval', atPaceMi: reps * repMi, floatMi: recoveryMi,
        ceilingMi: targetMi != null && targetMi > 0 ? targetMi : null,
      });
      const padded = padToTarget(
        targetMi != null && targetMi > 0 ? targetMi : undefined,
        day.dayMi, repsBlockMi, day.warmupMi, day.cooldownMi,
      );
      const wuMi = padded.wuMi, cdMi = padded.cdMi;
      const total = wuMi + repsBlockMi + cdMi;
      return {
        type, total_mi: Math.round(total * 10) / 10,
        headline: `Intervals · ${reps} × 800m`,
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [
          { label: 'Warmup', distance_mi: wuMi, pace_target: pc.easy ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Easy + 4 × 20s strides at the end to fire the system.' },
          { label: `Repeat ${reps}×`, reps, rep_distance_mi: repMi,
            pace_target: pc.interval ?? 'hard, controlled',
            hr_target: hr?.z5 ?? 'Z5 · at or above threshold',
            note: 'Even splits from rep 1 to rep ' + reps + '. Hit the target on rep 1 · don\'t go out faster expecting to fade. If you can\'t hold pace on the last rep, drop 2-3 sec/rep next time.',
            recovery: { duration: '1:30', pace_target: 'easy jog',
              note: 'Short recovery is the point · incomplete rest is what drives the adaptation. Skip after the final rep · go straight into cooldown.' },
          },
          { label: 'Cooldown', distance_mi: cdMi, pace_target: pc.easy ?? 'easy',
            note: 'Walk first if needed, then jog easy.' },
        ],
      };
    }

    case 'shakeout': {
      return {
        type, total_mi: 2,
        headline: 'Pre-race shakeout',
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [
          { label: 'Run', distance_mi: 2, pace_target: pc.shakeout ?? 'easy', hr_target: hr?.z1 ?? 'Z1',
            note: 'Easy. Keep it under 25 minutes total.' },
          { label: 'Strides', reps: 4, duration: '20 sec',
            note: '4 × 20-second strides at near-race pace with full recovery between. NOT a workout · neuromuscular activation only.' },
        ],
      };
    }

    case 'race': {
      /* SECOND-OWNER-1 (2026-09-02) · A RACE-DAY TARGET IS NOT THIS FILE'S TO
       * NAME, AND THE DISTANCE IS NO LONGER FABRICATED.
       *
       * `total` was `p.goal_distance_mi ?? 13.1` — a half marathon asserted for
       * any runner whose goal distance could not be read. An unknown distance
       * is now zero, the same posture every other arm in this switch takes
       * (LOWVOL-4), and the caller renders no number rather than the wrong one.
       *
       * The PACE was `pc.marathon`, which until today was `tPaceFromGoal(...)
       * + 18` — the runner's typed goal, wearing a training-pace label, on the
       * one screen where the difference is a DNF. Constitution §J gives "what
       * should this runner run this race at" to Race Prediction
       * (`achievableRaceTarget` → `race-outlook.execution`), and this module
       * does not call it and must not guess at it. The canonical MARATHON
       * TRAINING anchor is not that answer either: it is an M-pace for a
       * training block, not a race-day target, and printing it here would be a
       * different second owner rather than none.
       *
       * So the arm refuses and prescribes by effort (Rule 11). A race row on a
       * real plan carries an authored `workout_spec`, and every surface prefers
       * that; this template is the spec-less fallback, and a fallback that
       * invents a race target is worse than one that declines to. */
      const total = p.raceDistanceMi != null && p.raceDistanceMi > 0 ? p.raceDistanceMi : 0;
      return {
        type, total_mi: total,
        headline: 'Race day',
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [
          { label: 'Race', distance_mi: total,
            pace_target: 'race pace',
            hr_target: hr?.z3 ?? 'Z3-Z4',
            note: 'Hold the plan in the first 5K. Pacing decisions made in mile 1 cost you in mile 12. Negative split if possible · go out controlled, finish strong.' },
        ],
      };
    }

    case 'rest': {
      return {
        type, total_mi: 0,
        headline: 'Rest day',
        why: rationale.why,
        citation: rationale.citation,
        zones: null,
        steps: [{
          label: 'Today',
          note: 'No running. Sleep, mobility, fuel. A week with two hard days plus rest produces more fitness than a week of seven moderate days.',
        }],
      };
    }

    default:
      return {
        type, total_mi: 0,
        headline: 'No workout scheduled',
        why: rationale.why,
        citation: rationale.citation,
        zones: hr?.table,
        steps: [],
      };
  }
}
