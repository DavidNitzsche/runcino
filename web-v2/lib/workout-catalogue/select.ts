/**
 * lib/workout-catalogue/select.ts · which workout, this week, for this runner.
 *
 * `Research/04-workout-vocabulary.md` §15 "Training-cycle placement summary" is
 * a five-row table saying which workouts belong in which phase, and §16
 * "Combinations to avoid" is a five-row table of pairings that must not share a
 * week. Together they are a selection algorithm that has been specified in the
 * doc since it was written and never built: the engine picked sessions by
 * looking up a hardcoded string per (family, distance).
 *
 * This module is that algorithm.
 *
 * ── The three things it does ────────────────────────────────────────────────
 *
 * 1 · ELIGIBILITY. §15's phase row, plus each workout's own "When in cycle",
 *     distance list and contraindication tier.
 *
 * 2 · AFFORDABILITY, AND REFUSAL WHEN NOTHING FITS. Daniels' at-pace share caps
 *     bound what a week can carry: T ≤10%, I ≤8%, R ≤5% of weekly mileage. A
 *     workout's own structure states its MINIMUM dose. When the minimum does
 *     not fit inside the share, the workout is not available — and when no
 *     workout is available, the selector says so instead of shrinking one until
 *     it stops being the workout.
 *
 *     That refusal is the point, not a safety net. Two clamps used to collide
 *     at low volume: the share cap said a 15 mi/wk runner could spend 1.5 miles
 *     at threshold, and the tempo floor said a tempo is at least three miles,
 *     and the runner got a one-mile "tempo" — a nine-minute block against
 *     §5.2's "20 min minimum for stimulus". `CONTINUOUS_TEMPO_MINUTES.min` was
 *     in the codebase the whole time with NO READER ANYWHERE; only `.max` was
 *     ever consulted. `fits()` below is its consumer.
 *
 *     A refusal is not a failure. At 15 mi/wk the honest answer is that the
 *     week carries easy running, strides and hill sprints — which §15's base
 *     row prescribes and which carry no at-pace share — and no threshold
 *     session. Handing the runner a degenerate one is the failure.
 *
 * 3 · VARIETY, DETERMINISTICALLY. A plan may not prescribe the same threshold
 *     session for twelve weeks, and it also may not use `Math.random()`: there
 *     is no model in the runner-facing path and a plan must regenerate
 *     byte-identically. Nothing here reaches for a random number or the
 *     clock; rotation is a pure function of training state. See `rankCandidates`.
 *
 * ── Wiring · DONE, 2026-08-18 (VOCAB-CATALOGUE-1) ──────────────────────────
 *
 * `lib/plan/catalogue-rx.ts` is the composer's door onto this module, and
 * `lib/plan/generate.ts` calls it once per quality slot. What that replaced:
 *
 *   · `inlineFamilyPrescriptions(cat)` — one fixed string per (family,
 *     distance): `'6×90s hills @ 5K-10K effort · 2:30 jog down'` for every
 *     hills slot at every distance, in every week, forever. DELETED; the slot
 *     now takes whichever hill session §15 places there and this module has not
 *     recently used.
 *   · `qualityFamilyFor(...)` — picked a FAMILY and handed off to those
 *     strings, with variety supplied by `Math.floor(weekIdx / 2) % 2`
 *     alternating hills and fartlek. It still states §15's placement RULING
 *     (which the doctrine gate checks), but the alternation is gone and
 *     `rankCandidates` below is the rotation.
 *   · the `qt === 'race_week_tuneup'` ladder — five hardcoded strings selected
 *     on raw `raceDistanceMi` thresholds. Now keyed on the canonical
 *     categorizer. The STRINGS stay: they are Research/08 §9.3's race-week
 *     primers, and this catalogue is Research/04's training vocabulary, which
 *     carries no race-week template.
 *   · `inlinePrescriptions(cat)` — the `intervals` / `threshold` / `tempo`
 *     triple. Still there, and still the fallback on the slots the overload
 *     trajectory owns and on the weeks this module REFUSES.
 *   · `sizeFromPrescription` / `sizeTempoDay` — unchanged and still applied on
 *     top. They can shrink a session and cannot decline one; this module can
 *     decline one, and that is the half that was missing.
 *
 * The one thing the composer cannot yet take is a shape with no rendering in
 * `prescription-parser.ts`'s grammar — the unequal-step sequences (§9.2's Mona
 * fartlek, §13.1's ladders, §12.4's 5K progression, §10.2's combos), §10.1's
 * alternations and §11.1's two-session days. `catalogue-rx.ts` declines those
 * and asks again rather than shipping a label the spec builder would not build.
 */
import {
  AT_PACE_WEEKLY_SHARE_CAP,
  CONTINUOUS_TEMPO_MINUTES,
} from '@/lib/prescription/levers';
import { WORKOUT_CATALOGUE } from './catalogue';
import type {
  CatalogueEntry,
  DistCategory,
  DoctrinePhase,
  MeasureUnit,
  PaceZone,
  RepBand,
  Structure,
  Tier,
} from './types';

/* ─────────────────────────────────────────────────────── zones and caps ── */

/** Daniels' three capped zones · the keys of `AT_PACE_WEEKLY_SHARE_CAP`. */
export type CapFamily = keyof typeof AT_PACE_WEEKLY_SHARE_CAP;

/**
 * Which share cap a pace zone spends against.
 *
 * The three caps are stated in the doc for T (§5.3 "cap T-pace at 10% of weekly
 * mileage"), I (§6 "total at-pace volume ≤ 8% of weekly mileage") and R (§7
 * "cap R pace at 5% of weekly mileage"). The RACE-PACE anchors are mapped onto
 * them using the doc's own "Pace zone shorthand" table, which states each
 * anchor's physiological position: HM "Slightly below T", 10K "Just above T",
 * 5K "At/near VO2max", 3K "Above VO2max", mile ≈ R ("~mile to 800m race pace").
 *
 * `null` means the doc states no share cap for that zone. E, M and MP are the
 * cases: Daniels' marathon-pace cap (the lesser of 18 mi or 20%) is real but is
 * NOT in Research/04, and is not enforced anywhere in this engine — so this
 * module does not invent it. An MP session is bounded by its own stated dose
 * band instead, which every MP entry in the catalogue carries.
 */
export const ZONE_CAP_FAMILY: Record<PaceZone, CapFamily | null> = {
  E: null,
  M: null,
  MP: null,
  T: 'threshold',
  ST: 'threshold',
  HM: 'threshold',
  '10K': 'interval',
  I: 'interval',
  '5K': 'interval',
  '3K': 'interval',
  R: 'repetition',
  mile: 'repetition',
};

/**
 * §4.2's long-run share of the week · "cap at ~25–30% of weekly mileage".
 *
 * The doc states this for the BASE long run. Applying it to the other long-run
 * variants is an extension of one row to its own family, and it is the only
 * long-run weekly share the doc gives.
 */
export const LONG_RUN_WEEKLY_SHARE_CAP = 0.30;

/**
 * The cap a whole workout spends against: the most restrictive of its zones.
 *
 * A session that touches both T and I (§10.2's combos, §12.2's cutdowns) is
 * charged at the tighter of the two, because the tighter cap is the one whose
 * doctrine would otherwise be breached.
 */
export function capFamilyOf(entry: CatalogueEntry): CapFamily | null {
  const order: CapFamily[] = ['threshold', 'interval', 'repetition'];
  let worst: CapFamily | null = null;
  for (const z of entry.zones) {
    const f = ZONE_CAP_FAMILY[z];
    if (!f) continue;
    if (worst == null || order.indexOf(f) > order.indexOf(worst)) worst = f;
  }
  return worst;
}

/**
 * The miles of work one session of `entry` may carry on a `weeklyMi` week.
 *
 * Two regimes:
 *
 *   · a Daniels-capped zone (T / I / R) · the share cap, §5.3 / §6 / §7.
 *   · everything else · §4.2's "cap at ~25–30% of weekly mileage".
 *
 * The second needs its reasoning stated, because it is an EXTENSION of one row
 * rather than a row of its own. Research/04 states no share cap for E, M or MP
 * work — Daniels' marathon-pace cap is real but lives outside this doc and is
 * enforced nowhere in this engine, so this module does not invent it. What the
 * doc DOES state, once, is how much of a week a single session may be: §4.2's
 * long-run cap. And the uncapped zones are precisely the zones long runs are
 * run at, so a session built out of E, M and MP work is a long run under
 * another name and the long-run share is the right bound for it.
 *
 * The first attempt here was weaker — "a session cannot be longer than the week
 * that contains it", offered as arithmetic rather than physiology. It let a 20
 * mi/wk runner be handed §11.4's pre-fatigue MP work, "8 mi easy + immediate 8
 * mi MP": sixteen miles, eighty percent of the runner's week, and inside the
 * bound. `_select.test.ts` caught it. A bound that permits that is not a bound.
 */
export function sessionAllowanceMi(entry: CatalogueEntry, weeklyMi: number): number {
  const cap = capFamilyOf(entry);
  if (cap) return weeklyMi * AT_PACE_WEEKLY_SHARE_CAP[cap];
  return weeklyMi * LONG_RUN_WEEKLY_SHARE_CAP;
}

/* ──────────────────────────────────────────────────── engine phase map ── */

/**
 * The engine's four block phases onto §15's five doctrine phases.
 *
 * QUALITY spans two doctrine rows — §15's optional "Hill / strength" block and
 * its "Specific support" block — because this engine has one phase where the
 * doc has two. That merge is a CONVENTION of this module, not a doctrine
 * statement, and it is the same one `qualityFamilyFor` already makes when it
 * opens QUALITY with hills and fartlek and closes it with reps.
 */
export const PHASE_FROM_ENGINE: Record<string, DoctrinePhase[]> = {
  BASE: ['base'],
  QUALITY: ['hill_strength', 'specific_support'],
  'RACE-SPECIFIC': ['race_specific'],
  TAPER: ['taper'],
};

/* ───────────────────────────────────────────────────────────── the slot ── */

/**
 * The shape of the day the composer is filling. Each slot admits the families
 * whose sessions have that shape, so a family is only ever offered to a day
 * whose type already matches it — the property `qualityFamilyFor` holds today
 * and which keeps placement and spacing invariant.
 */
export type Slot = 'threshold' | 'intervals' | 'tempo' | 'long' | 'medium_long' | 'speed';

const SLOT_FAMILIES: Record<Slot, CatalogueEntry['family'][]> = {
  // GRAMMAR-SEQ-1 · `combo` sits on the threshold slot as well as the tempo
  // slot. §10 holds two shapes, not one: §10.3's wave tempo is a continuous
  // block and belongs on the tempo slot, while §10.1's MP/10K alternations and
  // §10.2's threshold/VO2 combos are STRUCTURED sessions with unequal steps and
  // have no continuous phrase to render. They were reachable only through the
  // tempo slot, where `renderContinuousPhrase` refused them every time.
  threshold: ['threshold', 'cutdown', 'race_specific', 'marathon_specific', 'ladder', 'combo'],
  intervals: ['vo2max', 'hills', 'fartlek', 'race_specific', 'ladder'],
  tempo: ['threshold', 'combo'],
  // The week's long run and the mid-week medium-long are different DAYS with
  // different recovery costs — §3 is explicit that a medium-long "should not
  // compete with the long run for recovery" — so they are different slots. One
  // slot holding both let a 55 mi/wk marathoner's long-run day be filled by
  // §3's medium-long while the actual long run went unplaced.
  long: ['long'],
  medium_long: ['medium_long'],
  speed: ['speed'],
};

/**
 * ZONE-R-1 · families a slot admits only in a particular doctrine phase.
 *
 * §15's rows are not interchangeable and one of them names something no other
 * row does. The taper row reads "Reduced-volume versions of recent workouts;
 * strides; short race-pace work | 2 lighter quality/wk" — strides and short
 * race-pace work, by name, as the phase's own primary workouts. §7's speed
 * family is exactly that, and §7.4's own "When in cycle" row agrees ("Base,
 * late specific, taper week").
 *
 * So it is admitted THERE and nowhere else. That restraint is the whole point
 * of a phase table: admitting §7 to the rep slot in every phase was tried, and
 * it cost a marathon build its second hill session and a 5K build its §12.2
 * cutdown — four broadly-placed entries thinned the rotation everywhere so a
 * twelve-second hill-sprint set could be a runner's week of VO2 work.
 *
 * ── DOCTRINE-BASE-2 (2026-08-19) · the base row is a row, not a footnote ────
 *
 * This comment used to end: "The base row lists strides and hill sprints too,
 * but the engine places no structured quality session in BASE at all, so that
 * row is describing what an easy week already carries." That reading is wrong,
 * and it is the whole of the defect. §15's base row is
 *
 *   | Base (8–12+ wks) | E, GA, medium-long, long, strides, hill sprints,
 *                        occasional fartlek/light hills | 2 quality sessions/wk max |
 *
 * — a Primary-workouts column naming three kinds of work the engine did not
 * place, and a Frequency column stating a CEILING OF TWO, which is not a
 * statement you make about a phase that carries none. A runner who has been
 * doing speed and is handed three weeks with every surge removed loses the one
 * adaptation that decays fastest, and loses it in the phase §7.2's own row says
 * never to stop ("All phases — never stop doing strides").
 *
 * So the SPEED slot — the base row's own vocabulary — admits §8's light hills
 * and §9's fartleks in the base phase, alongside §7. What it deliberately does
 * NOT admit is `threshold` or `vo2max`: `Research/00b`'s reverse taper spells
 * out what a rebuilding week's first structured work is and what it is not —
 * week 3 is "Strides + light fartlek (4–6× 1 min @ 10K effort) | First
 * structured surges. No threshold or VO2max." The base row agrees by omission;
 * this admits exactly what both name.
 */
const SLOT_FAMILIES_IN_PHASE: Partial<
  Record<Slot, Partial<Record<DoctrinePhase, CatalogueEntry['family'][]>>>
> = {
  intervals: { taper: ['speed'] },
  speed: { base: ['hills', 'fartlek'] },
};

/** The families this slot admits in this phase. */
function familiesFor(slot: Slot, phase: DoctrinePhase): CatalogueEntry['family'][] {
  const extra = SLOT_FAMILIES_IN_PHASE[slot]?.[phase];
  return extra ? [...SLOT_FAMILIES[slot], ...extra] : SLOT_FAMILIES[slot];
}

/** Fixed per-slot offset so two slots in one week never land on one index. */
const SLOT_ROTATION_OFFSET: Record<Slot, number> = {
  threshold: 0,
  intervals: 1,
  tempo: 2,
  long: 3,
  medium_long: 4,
  speed: 5,
};

/* ───────────────────────────────────────────────────────────── the input ── */

export interface PlacedSession {
  slug: string;
  /** Day of the week this session sits on, 0-6. Used by the §16 rules. */
  dayOffset: number;
}

export interface RecentSession {
  slug: string;
  /** Whole weeks back. 1 = last week. Used for cadence and rotation. */
  weeksAgo: number;
}

export interface SelectorInput {
  phase: DoctrinePhase;
  distance: DistCategory;
  tier: Tier;
  /** 0-based index of this week inside the plan. Drives rotation. */
  weekIndex: number;
  weeklyMi: number;
  slot: Slot;
  /**
   * Known pace anchors, seconds per mile. A workout whose zones are not all
   * anchored is declined rather than paced by inference — except where the doc
   * itself prescribes effort (`effortOnly`), which needs no anchor at all.
   */
  anchors: Partial<Record<PaceZone, number>>;
  /** Sessions already placed in THIS week, for §16. */
  placedThisWeek?: PlacedSession[];
  /** The day this slot would sit on, 0-6. Required for the §16 spacing rules. */
  dayOffset?: number;
  /** What the runner has already run, for cadence and `perCycleMax`. */
  recent?: RecentSession[];
  /**
   * True when this week sits inside the taper for the goal race. §16's "Fast
   * finish long run before goal race" rule needs it. Supplied by the caller
   * because the taper's LENGTH is doctrine that lives in Research/08 and in the
   * engine's own block planner, not in Research/04.
   */
  inTaperWindow?: boolean;
  /**
   * Sessions of this slug already run in this training cycle, for entries that
   * carry a `perCycleMax`.
   */
  cycleCounts?: Record<string, number>;
  /**
   * Slugs the CALLER has already ruled out, for a reason this module cannot
   * see. Two callers need it and neither is a doctrine question:
   *
   *   · a week that has already placed a session may not place it twice, and
   *     the §16 predicates speak to pace-family clashes rather than to identity.
   *   · `lib/plan/catalogue-rx.ts` declines a shape it cannot render into the
   *     engine's prescription grammar and asks again, so the slot lands on the
   *     next session doctrine places there rather than on nothing.
   *
   * An excluded entry is simply not offered; it produces no `Rejection`,
   * because the reason for it is not doctrine's.
   */
  exclude?: ReadonlySet<string>;
  /**
   * SLOT-ROTATE-2 (2026-08-19) · THE BLOCK'S EARNED DOSE, IN AT-PACE MINUTES.
   *
   * The week's at-pace budget (`sessionAllowanceMi`) says what the runner MAY
   * spend at this pace. It does not say what the block has WORKED UP TO, and
   * before this field the selector spent the whole share every week: the
   * cheapest legal dose of the chosen session was the largest one that fitted,
   * so week one of a block and week six of it prescribed the same number of
   * at-pace minutes. Handing the selector more slots therefore traded a rising
   * ladder for a flat line at the cap — which is what a plan is not.
   *
   * `lib/prescription/trajectory.ts` already walks that ladder for the generic
   * slots (`Design/adaptive-progression-engine.md` §3, "the plan carries a
   * default overload trajectory"), and its currency is minutes of work at
   * pace — the same currency `Dose.atPaceMinutes` is in. So the composer steps
   * the trajectory whether or not this module ends up filling the slot, and
   * passes the minutes it earned here.
   *
   * It is a CEILING ON SIZING and never a gate. A session is eligible on the
   * week's true allowance, exactly as before; the target only decides where
   * inside the structure's own band the dose lands, and it can never push a
   * session below the shape that makes it that session (`fits`'s floor is
   * still `structure.reps.min` / `block.min`). A block therefore opens at the
   * dose doctrine seeds it with, climbs on the trajectory's schedule, and
   * changes WHICH session carries that dose week to week.
   *
   * Null leaves the old behaviour untouched: spend what the week allows.
   */
  targetAtPaceMinutes?: number | null;
  /**
   * EFFORT-RAMP-1 (2026-08-19) · HOW FAR THROUGH THE BLOCK THIS WEEK SITS, 0…1.
   *
   * 0 on the block's first week, 1 on its last. The one input the effort-cued
   * rep ramp needs, and the reason it is a fraction rather than a week count:
   * doctrine states the ramp as a shape ("start 4–6, build to 8–12") and not as
   * a schedule, so a twelve-week block and an eighteen-week one both walk the
   * same band end to end rather than one of them stalling short of it.
   *
   * WHY IT IS NOT A PER-SESSION COUNTER. `rankCandidates` rotates identities
   * least-recently-used, so a runner may see §8.2's short hills on weeks 5, 8
   * and 12 and not at all in between. A counter that incremented on each
   * appearance would make the reps a function of how often the rotation
   * happened to land here, which is not a training state. The block's position
   * is, and it is the same number whether or not this session shows up.
   *
   * WHY NOT THE OVERLOAD TRAJECTORY. `lib/prescription/trajectory.ts` walks a
   * dose in MINUTES AT PACE. An effort-cued session has no pace and spends no
   * at-pace share — that is the property that lets it survive the dosing
   * refusal on a low-volume week, and it is why `targetAtPaceMinutes` above is
   * deliberately never converted for one (`workPace` returns null, so
   * `targetMi` is null). There is nothing in the trajectory's currency to
   * meter, so the ramp lives in the catalogue's own sizing, next to the band it
   * is walking.
   *
   * Absent or null means the caller cannot say where the block is, and the
   * doctrinal answer to that is the doc's own first word: START. It is never
   * read for a structure with no `repBuild`.
   */
  blockPosition?: number | null;
}

/* ──────────────────────────────────────────────────────────── the output ── */

export type RejectReason =
  | 'phase'
  | 'distance'
  | 'tier'
  | 'slot'
  | 'no-anchor'
  | 'does-not-fit-the-week'
  | 'cadence'
  | 'per-cycle-cap'
  | 'combination';

export interface Rejection {
  slug: string;
  reason: RejectReason;
  detail: string;
}

/** The dose the selector settled on inside the doctrine band. */
export interface Dose {
  structure: Structure;
  /** Reps chosen inside the structure's band. 1 for a continuous effort. */
  reps: number;
  /** Minutes of work at pace, the currency both share caps are checked in. */
  atPaceMinutes: number;
  /** The same work in miles at the session's own work pace. */
  atPaceMi: number;
  /** Seconds of jog recovery between reps. 0 for continuous work. */
  recoverySec: number;
}

export type SelectorResult =
  | {
      ok: true;
      entry: CatalogueEntry;
      dose: Dose;
      /** Why this one, in one line. */
      rationale: string;
      rejected: Rejection[];
    }
  | {
      ok: false;
      reason: 'no-quality-fits' | 'nothing-placed-here' | 'no-anchor';
      detail: string;
      rejected: Rejection[];
    };

/* ────────────────────────────────────────────────────── unit conversion ── */

const M_PER_MI = 1609.344;

/**
 * EFFORT-RAMP-1 · where inside a stated BUILD this week's rep count sits.
 *
 * `Research/04-workout-vocabulary.md` §7.3 writes "Start 4–6, build to 8–12"
 * and §8.2 writes "8–16 (start 8, build to 16)". Both name a floor to open at
 * and a ceiling to arrive at, and neither names a weekly increment — so the
 * engine walks the band the doc gives it, from end to end, across the block.
 *
 * Linear and rounded to the nearest whole rep, which is the only shape that
 * honours both stated ends without inventing a curve between them. Pure in
 * `(band, position)`: no clock, no counter, no random number, so a plan
 * regenerates byte-identically.
 *
 * A single-week block, or a caller that cannot say where the block is, gets
 * position 0 — the doc's own "start".
 */
export function rampedReps(reps: RepBand, blockPosition: number | null): number {
  const p = blockPosition == null || !Number.isFinite(blockPosition)
    ? 0
    : Math.min(1, Math.max(0, blockPosition));
  return reps.min + Math.round(p * (reps.max - reps.min));
}

/** A rep's length in miles, given the work pace for time-based reps. */
function repMi(value: number, unit: MeasureUnit, paceSPerMi: number | null): number | null {
  switch (unit) {
    case 'mi': return value;
    case 'km': return (value * 1000) / M_PER_MI;
    case 'm': return value / M_PER_MI;
    case 'min': return paceSPerMi ? (value * 60) / paceSPerMi : null;
    case 's': return paceSPerMi ? value / paceSPerMi : null;
    default: return null;
  }
}

/** The work pace for an entry: its first anchored zone. */
function workPace(entry: CatalogueEntry, anchors: SelectorInput['anchors']): number | null {
  for (const z of entry.zones) {
    const p = anchors[z];
    if (p != null && p > 0) return p;
  }
  return null;
}

/**
 * The smallest dose of `structure` that is still the workout doctrine names,
 * and whether the week can afford it.
 *
 * The floor is the STRUCTURE's own minimum — "3–6 × 1 mi" floors at three reps,
 * "20–40 min" floors at twenty minutes — and never the `atPace` band's minimum.
 * That distinction is load-bearing and `levers.ts` states it in the same words:
 * doctrine's lower at-pace bound "describes the runner who can afford the whole
 * dose", so flooring a small runner at it "would be the share cap read
 * backwards". A small week buys a small session; it does not buy a session
 * below the shape that makes it that session.
 */
function fits(
  structure: Structure,
  allowanceMi: number,
  paceSPerMi: number | null,
  effortOnly: boolean,
  /**
   * True for the weekly long run · see `scalesBelowFloor` at the call site.
   * The long run SHRINKS to what the week can hold rather than being refused;
   * every other session refuses below its own minimum shape.
   */
  scalesBelowFloor = false,
  /**
   * SLOT-ROTATE-2 · the dose the block has earned, in miles at this pace.
   *
   * A SIZING ceiling, never an eligibility one. Every refusal below is still
   * tested against `allowanceMi` — what the week may spend — so a session that
   * doctrine can afford stays available whatever the trajectory has reached;
   * this only decides where inside the structure's own band the dose sits, and
   * the band's own floor (`reps.min`, `block.min`, `cycles.min`) still wins.
   * `null` spends the whole allowance, which is what happened before it existed.
   */
  targetMi: number | null = null,
  /**
   * EFFORT-RAMP-1 · how far through the block this week sits, 0…1.
   *
   * Read by exactly one branch — the effort-cued rep set whose doc row states a
   * BUILD — because it is the only sizing question the week's at-pace allowance
   * cannot answer. Everything else in this function is metered in miles at
   * pace, and an effort-cued session has none. See `SelectorInput.blockPosition`.
   */
  blockPosition: number | null = null,
): { ok: true; dose: Omit<Dose, 'structure'> } | { ok: false; detail: string } {
  /** The bound the dose is SIZED to · the tighter of allowance and target. */
  const sizeToMi = targetMi != null && targetMi > 0
    ? Math.min(allowanceMi, targetMi)
    : allowanceMi;
  const dose = (reps: number, mi: number, minutes: number, recoverySec: number) => ({
    ok: true as const,
    dose: { reps, atPaceMi: mi, atPaceMinutes: minutes, recoverySec },
  });
  const minutesOf = (mi: number) => (paceSPerMi ? (mi * paceSPerMi) / 60 : 0);

  // An effort-prescribed session spends NO at-pace miles, because it has no
  // pace: §8.1's column is "5K–10K effort" precisely so that a runner climbing
  // a 6% grade correctly is not in breach of their own workout. It is bounded
  // by its own stated duration and by nothing else — and it is what a low-volume
  // week can still carry once every paced session has been refused.
  if (effortOnly) {
    if (structure.kind === 'continuous') {
      const mins = structure.block.unit === 'min' ? structure.block.min : 0;
      return dose(1, 0, mins, 0);
    }
    if (structure.kind === 'reps') {
      const perRep = structure.rep.unit === 's' ? structure.rep.min / 60
        : structure.rep.unit === 'min' ? structure.rep.min
        : 0;
      // EFFORT-RAMP-1 (2026-08-19) · the band is walked, not spent.
      //
      // This returned `reps.max` unconditionally, so a runner's first hill
      // session of a block was their hardest and never got harder — it had
      // opened at the ceiling. §7.3 and §8.2 both state the rep count as a
      // build ("Start 4–6, build to 8–12"; "8–16 (start 8, build to 16)"), and
      // where the doc states one the dose now opens at `reps.min` and arrives
      // at `reps.max` across the block.
      //
      // Where it does NOT — §8.3's flat "6–10", §8.4's flat "4–8" — the count
      // stays at the top of the band, because the doc gives a band and a ramp
      // it does not state is a ramp this module invented.
      const reps = structure.repBuild
        ? rampedReps(structure.reps, blockPosition)
        : structure.reps.max;
      return dose(reps, 0, reps * perRep, structure.recoverySec?.min ?? 0);
    }
    if (structure.kind === 'sequence') {
      const rest = structure.steps.find((s) => s.recoverySec != null)?.recoverySec ?? 0;
      return dose(structure.steps.length, 0, 0, rest);
    }
    return { ok: false, detail: 'no effort-cued form of this structure' };
  }

  if (structure.kind === 'continuous') {
    const { block } = structure;
    if (block.unit === 'min') {
      if (!paceSPerMi) return { ok: false, detail: 'no work pace to convert the block into miles' };
      const availableMinutes = (allowanceMi * paceSPerMi) / 60;
      if (availableMinutes + 1e-9 < block.min && !scalesBelowFloor) {
        return {
          ok: false,
          detail:
            `the week affords ${availableMinutes.toFixed(1)} min at this effort and the ` +
            `shortest form of this session is ${block.min} min`,
        };
      }
      // SLOT-ROTATE-2 · size to the earned dose, floored at the block's own
      // stated minimum. §5.2's "20 min minimum for stimulus" is what makes a
      // tempo a tempo, so the trajectory may hold a block at twenty minutes
      // and may not shave it to twelve.
      const sizeMinutes = (sizeToMi * paceSPerMi) / 60;
      const upper = Math.min(block.max, availableMinutes);
      const minutes = Math.min(upper, Math.max(sizeMinutes, Math.min(block.min, upper)));
      return dose(1, (minutes * 60) / paceSPerMi, minutes, 0);
    }
    const minMi = repMi(block.min, block.unit, paceSPerMi);
    if (minMi == null) return { ok: false, detail: 'block length is not convertible without a work pace' };
    if (allowanceMi + 1e-9 < minMi && !scalesBelowFloor) {
      return {
        ok: false,
        detail: `the week affords ${allowanceMi.toFixed(2)} mi and the shortest form of this session is ${minMi.toFixed(2)} mi`,
      };
    }
    const maxMi = repMi(block.max, block.unit, paceSPerMi) ?? minMi;
    const upperMi = Math.min(maxMi, allowanceMi);
    const mi = Math.min(upperMi, Math.max(sizeToMi, Math.min(minMi, upperMi)));
    return dose(1, mi, minutesOf(mi), 0);
  }

  if (structure.kind === 'reps') {
    const one = repMi(structure.rep.min, structure.rep.unit, paceSPerMi);
    if (one == null) return { ok: false, detail: 'rep length is not convertible without a work pace' };
    const minMi = one * structure.reps.min;
    if (allowanceMi + 1e-9 < minMi) {
      return {
        ok: false,
        detail:
          `the week affords ${allowanceMi.toFixed(2)} mi at this effort and the shortest ` +
          `form of this session is ${structure.reps.min}×${structure.rep.min}${structure.rep.unit} = ${minMi.toFixed(2)} mi`,
      };
    }
    // SLOT-ROTATE-2 · `sizeToMi`, not `allowanceMi`. The refusal above is still
    // the week's true allowance — eligibility is doctrine's question — and this
    // is where inside `reps.min…reps.max` the block's earned dose lands. The
    // loop's own floor is the structure's minimum rep count, so a low target
    // buys the shortest legal form of the session and never a shorter one.
    let reps = structure.reps.max;
    while (reps > structure.reps.min && reps * one > sizeToMi) reps--;
    const mi = reps * one;
    return dose(reps, mi, minutesOf(mi), structure.recoverySec ? structure.recoverySec.min : 0);
  }

  if (structure.kind === 'sequence') {
    let mi = 0;
    for (const s of structure.steps) {
      const m = repMi(s.value, s.unit, paceSPerMi);
      if (m == null) return { ok: false, detail: 'a sequence step is not convertible without a work pace' };
      mi += m;
    }
    if (allowanceMi + 1e-9 < mi) {
      return {
        ok: false,
        detail: `the week affords ${allowanceMi.toFixed(2)} mi and this session is a fixed ${mi.toFixed(2)} mi`,
      };
    }
    const rest = structure.steps.find((s) => s.recoverySec != null)?.recoverySec ?? 0;
    return dose(structure.steps.length, mi, minutesOf(mi), rest);
  }

  if (structure.kind === 'alternation') {
    const fast = repMi(structure.fast.value, structure.fast.unit, paceSPerMi);
    const steady = repMi(structure.steady.value, structure.steady.unit, paceSPerMi);
    if (fast == null || steady == null) return { ok: false, detail: 'alternation segments are not convertible without a work pace' };
    const pair = fast + steady;
    if (allowanceMi + 1e-9 < pair * structure.cycles.min) {
      return {
        ok: false,
        detail: `the week affords ${allowanceMi.toFixed(2)} mi and the shortest form of this session is ${(pair * structure.cycles.min).toFixed(2)} mi`,
      };
    }
    let cycles = structure.cycles.max;
    while (cycles > structure.cycles.min && cycles * pair > sizeToMi) cycles--;
    const mi = cycles * pair;
    return dose(cycles, mi, minutesOf(mi), 0);
  }

  // `double` · two sessions in one calendar day. The catalogue records the
  // doctrine, but this module does not size a double-day session: it is a whole
  // day's plan, not a slot's, and the composer has no two-session-per-day shape
  // to put it in. Declining is the honest answer until it does.
  return { ok: false, detail: 'a two-session day has no slot to sit in' };
}


/* ────────────────────────────────────────────────────────────── §16 rules ── */

/** Zones that make a session a THRESHOLD session for §16's purposes. */
const THRESHOLD_ZONES: PaceZone[] = ['T', 'ST', 'HM'];

/**
 * `Research/04` §16 "Combinations to avoid", as five predicates.
 *
 * Each returns the doc's own "Why" text when it fires, so a rejection is
 * traceable to the row that caused it.
 */
export function combinationViolation(
  candidate: CatalogueEntry,
  ctx: {
    dayOffset: number;
    placedThisWeek: PlacedSession[];
    inTaperWindow: boolean;
  },
): string | null {
  const placed = ctx.placedThisWeek
    .map((p) => ({ ...p, entry: WORKOUT_CATALOGUE.find((e) => e.slug === p.slug) ?? null }))
    .filter((p): p is PlacedSession & { entry: CatalogueEntry } => p.entry != null);
  const gap = (p: PlacedSession) => Math.abs(p.dayOffset - ctx.dayOffset);

  const isThreshold = (e: CatalogueEntry) => e.zones.some((z) => THRESHOLD_ZONES.includes(z));
  const isMpLong = (e: CatalogueEntry) => e.family === 'long' && e.zones.includes('MP');
  const isContinuousThreshold = (e: CatalogueEntry) =>
    isThreshold(e) && e.structures.some((s) => s.kind === 'continuous');

  // "VO2max + long run within 48 hrs | Both deplete glycogen; doubles injury risk"
  for (const p of placed) {
    const vo2Pair =
      (candidate.family === 'vo2max' && p.entry.family === 'long') ||
      (candidate.family === 'long' && p.entry.family === 'vo2max');
    if (vo2Pair && gap(p) <= 2) {
      return `§16 · VO2max + long run within 48 hrs (${p.entry.name}): both deplete glycogen; doubles injury risk`;
    }
  }

  // "MP long run + hard tempo within 5 days | Same energy system, same impact
  //  pattern, no recovery between"
  for (const p of placed) {
    const mpTempoPair =
      (isMpLong(candidate) && isContinuousThreshold(p.entry)) ||
      (isContinuousThreshold(candidate) && isMpLong(p.entry));
    if (mpTempoPair && gap(p) <= 5) {
      return `§16 · MP long run + hard tempo within 5 days (${p.entry.name}): same energy system, same impact pattern, no recovery between`;
    }
  }

  // "Two threshold sessions back-to-back | Only the Norwegian double-day model
  //  handles this, and only with sub-threshold pacing"
  for (const p of placed) {
    if (!isThreshold(candidate) || !isThreshold(p.entry)) continue;
    if (gap(p) !== 1) continue;
    const bothSubThreshold =
      candidate.zones.includes('ST') && p.entry.zones.includes('ST');
    if (bothSubThreshold) continue; // the doc's named exception
    return `§16 · two threshold sessions back-to-back (${p.entry.name}): only the Norwegian double-day model handles this, and only with sub-threshold pacing`;
  }

  // "Fast finish long run before goal race | Adds depletion in taper window"
  if (candidate.slug === 'fast-finish-long-run' && ctx.inTaperWindow) {
    return '§16 · fast finish long run before goal race: adds depletion in taper window';
  }

  // "400m R-pace day before threshold | Soft-tissue load incompatible with
  //  quality threshold next day"
  const isRPace = (e: CatalogueEntry) => e.zones.some((z) => ZONE_CAP_FAMILY[z] === 'repetition');
  for (const p of placed) {
    const rBeforeT =
      (isRPace(p.entry) && isThreshold(candidate) && ctx.dayOffset - p.dayOffset === 1) ||
      (isRPace(candidate) && isThreshold(p.entry) && p.dayOffset - ctx.dayOffset === 1);
    if (rBeforeT) {
      return `§16 · R-pace day before threshold (${p.entry.name}): soft-tissue load incompatible with quality threshold next day`;
    }
  }

  return null;
}

/* ───────────────────────────────────────────────────────────── rotation ── */

/**
 * A stable rotating index over `count` candidates.
 *
 * The slot's fixed offset stops two slots in the same week landing on the same
 * entry. Used to break ties in `rankCandidates`, never on its own — see there
 * for why a bare modulo is not enough.
 */
export function chooseIndex(weekIndex: number, slot: Slot, count: number): number {
  if (count <= 0) return -1;
  const k = weekIndex + SLOT_ROTATION_OFFSET[slot];
  return ((k % count) + count) % count;
}

/**
 * Which of the eligible workouts this week gets.
 *
 * DETERMINISM IS A HARD REQUIREMENT: this runs in the runner-facing plan path,
 * where there is no model and a plan must regenerate byte-identically. So the
 * choice is a pure function of `(weekIndex, slot, candidates, history)` and
 * nothing else — no clock, no random number, no module-level counter.
 *
 * The rule is LEAST RECENTLY USED, with a rotating index breaking ties among
 * equals. A bare `weekIndex % candidates.length` was the first attempt and it
 * is wrong in a way worth recording: the candidate SET changes size from week
 * to week as cadence rows and §16 take entries out of it, so consecutive weeks
 * index into different-length lists and can land on the same session twice
 * running. The twelve-week walk in `_select.test.ts` caught it repeating
 * `8x1k-at-hm` on weeks 5 and 6.
 *
 * LRU has neither problem: the session just run is by construction the most
 * recent, so it sorts last and cannot come back while anything else is
 * eligible. Never-run sessions rank ahead of everything, so a block opens by
 * working through the vocabulary before it repeats any of it.
 */
export function rankCandidates<T extends { entry: { slug: string } }>(
  candidates: T[],
  recent: RecentSession[],
  weekIndex: number,
  slot: Slot,
): T | null {
  if (candidates.length === 0) return null;
  const lastRun = (slug: string): number => {
    let best = Infinity;
    for (const s of recent) if (s.slug === slug && s.weeksAgo < best) best = s.weeksAgo;
    return best;
  };
  let staleest = -Infinity;
  for (const c of candidates) {
    const l = lastRun(c.entry.slug);
    if (l > staleest) staleest = l;
  }
  const tied = candidates.filter((c) => lastRun(c.entry.slug) === staleest);
  return tied[chooseIndex(weekIndex, slot, tied.length)] ?? null;
}

/* ─────────────────────────────────────────────────────────── the selector ── */

/**
 * The doctrinally appropriate session for this slot, or a refusal.
 *
 * Order of the gates matters only for the quality of the `rejected` trail — a
 * caller reading it should see the cheapest disqualification first — but the
 * outcome is order-independent.
 */
export function selectWorkout(input: SelectorInput): SelectorResult {
  const {
    phase, distance, tier, weekIndex, weeklyMi, slot, anchors,
    placedThisWeek = [], dayOffset = 0, recent = [],
    inTaperWindow = false, cycleCounts = {}, exclude,
    targetAtPaceMinutes = null, blockPosition = null,
  } = input;

  const rejected: Rejection[] = [];
  const push = (slug: string, reason: RejectReason, detail: string) => {
    rejected.push({ slug, reason, detail });
  };

  const families = familiesFor(slot, phase);
  const candidates: Array<{ entry: CatalogueEntry; dose: Dose }> = [];
  let sawPlacement = false;

  for (const entry of WORKOUT_CATALOGUE) {
    if (!families.includes(entry.family)) continue;
    // Caller-supplied exclusion · see `SelectorInput.exclude`. Silent by
    // design: the reason is the caller's, not doctrine's, so it does not belong
    // in the rejection trail alongside §15's and §16's rulings.
    if (exclude?.has(entry.slug)) continue;

    if (!entry.phases.includes(phase)) {
      push(entry.slug, 'phase', `§15 does not place it in the ${phase} phase`);
      continue;
    }
    if (!entry.distances.includes(distance)) {
      push(entry.slug, 'distance', `doctrine names it for ${entry.distances.join('/')}, not ${distance}`);
      continue;
    }
    if (!entry.tiers.includes(tier)) {
      push(entry.slug, 'tier', `its contraindications rule out a ${tier} runner`);
      continue;
    }
    sawPlacement = true;

    // Per-cycle caps: "1× per training cycle", "2–3× per marathon cycle".
    if (entry.perCycleMax != null && (cycleCounts[entry.slug] ?? 0) >= entry.perCycleMax) {
      push(entry.slug, 'per-cycle-cap', `already run ${cycleCounts[entry.slug]}× this cycle, doctrine caps it at ${entry.perCycleMax}`);
      continue;
    }

    // Cadence: the doc's own Frequency row, in whole weeks.
    if (entry.cadence) {
      const last = recent
        .filter((s) => s.slug === entry.slug)
        .reduce<number | null>((min, s) => (min == null || s.weeksAgo < min ? s.weeksAgo : min), null);
      if (last != null) {
        const minWeeks = Math.floor(entry.cadence.minDays / 7);
        if (last < minWeeks) {
          push(entry.slug, 'cadence', `run ${last} week(s) ago; ${entry.cadence.source}`);
          continue;
        }
      }
    }

    // Pace anchors. Effort-prescribed sessions need none — §8.1's pace column
    // is "5K–10K effort" precisely because a flat pace is unreachable on a
    // 4-6% grade, and prescribing one puts the runner in breach of their own
    // workout for climbing it correctly.
    const pace = workPace(entry, anchors);
    if (!entry.effortOnly && entry.zones.length > 0 && pace == null) {
      push(entry.slug, 'no-anchor', `no pace anchor for ${entry.zones.join('/')}`);
      continue;
    }

    // Affordability, and the refusal path.
    const allowanceMi = sessionAllowanceMi(entry, weeklyMi);
    // SLOT-ROTATE-2 · the block's earned dose in this session's own currency.
    // An effort-prescribed session spends no at-pace miles at all (§8.1's pace
    // column is "5K–10K effort"), so there is nothing for the trajectory to
    // meter and the target does not reach it.
    const targetMi = (targetAtPaceMinutes != null && targetAtPaceMinutes > 0 && pace != null && pace > 0)
      ? (targetAtPaceMinutes * 60) / pace
      : null;
    let picked: Dose | null = null;
    let lastDetail = 'no structure fits';
    for (const structure of entry.structures) {
      // §4.2 states two bounds on the long run that genuinely conflict below
      // roughly 35 mi/wk: "90 min minimum for endurance benefit" and "cap at
      // ~25–30% of weekly mileage". A 30 mi/wk marathoner's 25-30% share is
      // nine miles, and ninety minutes at their easy pace is ten — so a
      // literal reading refuses them a long run entirely, which is the one
      // session §4 calls "the cornerstone weekly session in distance
      // training".
      //
      // CONVENTION, not doctrine: the CAP wins and the duration yields. Two
      // reasons. The doc words the cap as a cap ("cap at") and the duration as
      // a benefit threshold ("minimum for endurance benefit"), and — unlike
      // every other entry — there is no shorter long-run entry to fall back to,
      // because the long run is simply the week's longest run whatever its
      // length, which is why §4.2's own Distance row spans 8 to 22+ miles for
      // different runners. §5.5's long tempo is the contrast: its 8-12 mi floor
      // IS its identity, and §5.2's continuous tempo already exists as the
      // shorter session, so it refuses rather than scaling into one.
      const scalesBelowFloor = entry.family === 'long';
      const f = fits(structure, allowanceMi, pace, entry.effortOnly, scalesBelowFloor, targetMi, blockPosition);
      if (f.ok) {
        picked = { structure, ...f.dose };
        break;
      }
      lastDetail = f.detail;
    }
    if (!picked) {
      push(entry.slug, 'does-not-fit-the-week', lastDetail);
      continue;
    }

    // §16.
    const clash = combinationViolation(entry, { dayOffset, placedThisWeek, inTaperWindow });
    if (clash) {
      push(entry.slug, 'combination', clash);
      continue;
    }

    candidates.push({ entry, dose: picked });
  }

  if (candidates.length === 0) {
    if (!sawPlacement) {
      return {
        ok: false,
        reason: 'nothing-placed-here',
        detail:
          `Research/04 §15 places no ${slot} session in the ${phase} phase for a ${distance} ` +
          `runner at ${tier} level.`,
        rejected,
      };
    }
    const anchorOnly =
      rejected.some((r) => r.reason === 'no-anchor') &&
      !rejected.some((r) => r.reason === 'does-not-fit-the-week');
    if (anchorOnly) {
      return {
        ok: false,
        reason: 'no-anchor',
        detail: 'every session doctrine places here needs a pace anchor this runner does not have yet.',
        rejected,
      };
    }
    return {
      ok: false,
      reason: 'no-quality-fits',
      detail:
        `No ${slot} session fits a ${weeklyMi} mi/wk week. Daniels' share caps leave too ` +
        `little at-pace volume for the shortest form of anything doctrine places here — ` +
        `a continuous tempo alone needs ${CONTINUOUS_TEMPO_MINUTES.min} minutes. The week ` +
        `carries easy running, strides and hill sprints instead, which is what §15's base ` +
        `row prescribes and what carries no at-pace share.`,
      rejected,
    };
  }

  const chosen = rankCandidates(candidates, recent, weekIndex, slot)!;
  return {
    ok: true,
    entry: chosen.entry,
    dose: chosen.dose,
    rationale:
      `${chosen.entry.name} (${chosen.entry.section}) · ${chosen.entry.family} on the ${slot} ` +
      `slot in ${phase}; ${candidates.length} session(s) eligible, least recently used wins.`,
    rejected,
  };
}
