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
 * ── Wiring · NOT DONE HERE ─────────────────────────────────────────────────
 *
 * Nothing in `lib/plan/` imports this yet, deliberately. The call sites in
 * `lib/plan/generate.ts` that should consume it, and what each hardcodes today:
 *
 *   · `inlineFamilyPrescriptions(cat)` — one fixed string per (family,
 *     distance): `'6×90s hills @ 5K-10K effort · 2:30 jog down'` for every
 *     hills slot at every distance, in every week, forever. This is the
 *     catalogue's job: `selectWorkout` returns an entry plus a sized dose.
 *   · `inlinePrescriptions(cat)` — the `intervals` / `threshold` / `tempo`
 *     triple, likewise one string each per distance.
 *   · `qualityFamilyFor(cat, phase, weekIdx, weeksToPhaseEnd, slotType)` —
 *     picks a FAMILY and then hands off to those strings, with variety supplied
 *     by `Math.floor(weekIdx / 2) % 2` alternating hills and fartlek. That is
 *     the rotation this module generalises across the whole vocabulary.
 *   · the `qt === 'race_week_tuneup'` ladder — five hardcoded tune-up strings
 *     selected on `raceDistanceMi` thresholds.
 *   · `sizeFromPrescription` / `sizeTempoDay` — already apply the share caps,
 *     but to a string that has already been chosen; they can shrink a session
 *     and cannot decline one.
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
  threshold: ['threshold', 'cutdown', 'race_specific', 'marathon_specific', 'ladder'],
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
): { ok: true; dose: Omit<Dose, 'structure'> } | { ok: false; detail: string } {
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
      return dose(structure.reps.max, 0, structure.reps.max * perRep, structure.recoverySec?.min ?? 0);
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
      const minutes = Math.min(block.max, availableMinutes);
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
    const mi = Math.min(maxMi, allowanceMi);
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
    let reps = structure.reps.max;
    while (reps > structure.reps.min && reps * one > allowanceMi) reps--;
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
    while (cycles > structure.cycles.min && cycles * pair > allowanceMi) cycles--;
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
    inTaperWindow = false, cycleCounts = {},
  } = input;

  const rejected: Rejection[] = [];
  const push = (slug: string, reason: RejectReason, detail: string) => {
    rejected.push({ slug, reason, detail });
  };

  const families = SLOT_FAMILIES[slot];
  const candidates: Array<{ entry: CatalogueEntry; dose: Dose }> = [];
  let sawPlacement = false;

  for (const entry of WORKOUT_CATALOGUE) {
    if (!families.includes(entry.family)) continue;

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
      const f = fits(structure, allowanceMi, pace, entry.effortOnly, scalesBelowFloor);
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
