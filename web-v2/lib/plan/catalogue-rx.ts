/**
 * lib/plan/catalogue-rx.ts · the composer's door onto the workout catalogue.
 *
 * `lib/workout-catalogue/` holds all 59 of `Research/04-workout-vocabulary.md`'s
 * named workouts as cited data, and `select.ts` holds §15's placement table and
 * §16's combinations-to-avoid as a selection algorithm. Until this module
 * existed nothing in `lib/plan/` imported either of them: the composer picked a
 * session by looking up ONE hardcoded string per (family, distance), so every
 * hills slot in every week of every plan read
 * `6×90s hills @ 5K-10K effort · 2:30 jog down` and the engine emitted four
 * session shapes against doctrine's fifty-nine.
 *
 * This module is the wiring. It does three things and deliberately no more:
 *
 *   1 · TRANSLATES the composer's state into a `SelectorInput` — the engine's
 *       four block phases onto §15's five, the week's pace anchors, what is
 *       already placed in the week, and what the runner has already run.
 *   2 · RENDERS the chosen entry and its dose into a prescription string in the
 *       grammar `prescription-parser.ts` already reads, so `buildWorkoutSpec`
 *       builds the session the label promises. A shape that cannot be rendered
 *       into that grammar is DECLINED rather than approximated — the label/spec
 *       drift this codebase has already paid for twice starts exactly there.
 *   3 · CARRIES the plan-scoped history the selector's rotation and per-cycle
 *       caps need, as an explicit object the composer threads week to week.
 *
 * ── What this module will not do ───────────────────────────────────────────
 *
 * It invents no session text. Every rep count, rep length, recovery and zone in
 * a rendered string comes out of the catalogue entry, which quotes the doc row
 * it was read from. Where a doctrine shape has no rendering in the engine's
 * grammar the honest answer is to decline it, and `renderPrescription` returns
 * null.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Nothing here reads the clock or a random number. Given the same
 * `CatalogueHistory` and the same week, the same session comes out — which is
 * what makes a plan regenerate byte-identically.
 */
import {
  selectWorkout,
  PHASE_FROM_ENGINE,
  type CapFamily,
  type Dose,
  type PlacedSession,
  type RecentSession,
  type SelectorInput,
  type Slot,
} from '@/lib/workout-catalogue/select';
import type {
  CatalogueEntry,
  DistCategory,
  DoctrinePhase,
  PaceZone,
  Structure,
  SequenceStructure,
  AlternationStructure,
  Tier,
} from '@/lib/workout-catalogue/types';
import type { WorkoutFamily } from './workout-library';
import { resolveZoneAnchors } from './zone-anchors';

/* ─────────────────────────────────────────────────────────────── history ── */

/**
 * What the selector needs to know about the rest of the plan.
 *
 * Stateful and ordered, exactly like `OverloadTrajectory`: `composePlan` walks
 * weeks in ascending order and each week's choices are recorded here for the
 * next one. The selector's rotation is LEAST RECENTLY USED, so without this a
 * block would open with the same session every week — the defect the rotation
 * exists to prevent.
 */
export interface CatalogueHistory {
  /** Every session the plan has authored, with the week index it landed in. */
  runs: Array<{ slug: string; weekIdx: number }>;
  /** Runnings per slug across the whole cycle, for entries with `perCycleMax`. */
  cycleCounts: Record<string, number>;
}

export function newCatalogueHistory(): CatalogueHistory {
  return { runs: [], cycleCounts: {} };
}

export function recordCatalogueChoice(
  history: CatalogueHistory,
  slug: string,
  weekIdx: number,
): void {
  history.runs.push({ slug, weekIdx });
  history.cycleCounts[slug] = (history.cycleCounts[slug] ?? 0) + 1;
}

/** The selector's `recent` view of the history, in whole weeks back. */
function recentFrom(history: CatalogueHistory, weekIdx: number): RecentSession[] {
  const out: RecentSession[] = [];
  for (const r of history.runs) {
    const weeksAgo = weekIdx - r.weekIdx;
    if (weeksAgo >= 0) out.push({ slug: r.slug, weeksAgo });
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────── anchors ── */

/**
 * The pace anchors the composer can honestly hand the selector.
 *
 * The selector declines a workout whose zones it has no anchor for rather than
 * pacing it by inference. That gate is the whole safety property here, and the
 * rule it enforces is: NEVER ANCHOR A ZONE THE SPEC BUILDER CANNOT PACE, or the
 * label promises a pace the watch does not run — the drift this codebase has
 * already paid for twice.
 *
 * ── This used to be two zones, and why it is now nine ──────────────────────
 *
 * Until ZONE-R-1 the map held T/HM and I/5K, because `buildWorkoutSpec` paced a
 * `threshold` slot at T and a rep slot at I *regardless of what the
 * prescription declared*. Anchoring anything else would have been a lie, so §7's
 * R work, §5.4's sub-threshold intervals, §14.2's three 10K-specific sessions
 * and every MP-only session were declined with `no-anchor` — sitting in the
 * catalogue, cited, and unreachable.
 *
 * The fix was not to relax the gate. `resolveZoneAnchors` is now the one answer
 * to "what is this zone worth", and `buildWorkoutSpec` prices its rep off the
 * SAME function via the zone the prescription declares. So this map and the
 * spec builder's reach are the same set by construction rather than by anyone
 * remembering, and `VOCAB.catalogue-anchors` checks exactly that.
 *
 * What is still unanchored, and why:
 *
 *   · E · easy is a BAND a day carries, never a work target. A catalogue entry
 *     zoned E is an easy run (§9.4's Lydiard fartlek), and every one of them is
 *     `effortOnly`, which needs no anchor at all.
 *   · M and MP when the caller supplies no marathon pace · every composer path
 *     supplies one, and a caller that does not gets a refusal rather than a
 *     guess.
 *   · R, mile, 3K and 10K when `vdotFromTpace` falls outside Daniels' published
 *     30-85 table · the honest answer for a runner the table does not cover.
 */
export function anchorsFor(args: {
  tPaceSec: number | null;
  iPaceSec: number | null;
  /** The runner's marathon pace, from `marathonPaceSPerMi` — the same
   *  expression `buildWorkoutSpec` will pace an MP block at. */
  mpPaceSec?: number | null;
}): Partial<Record<PaceZone, number>> {
  return resolveZoneAnchors({
    tPaceSec: args.tPaceSec,
    iPaceSec: args.iPaceSec,
    marathonPaceSec: args.mpPaceSec ?? null,
  });
}

/* ───────────────────────────────────────────────────────────── rendering ── */

/**
 * The doc's zone shorthand as the engine's prescription vocabulary writes it.
 *
 * These are LABELS, not paces. `buildWorkoutSpec` derives the number from the
 * slot; this names the zone the catalogue entry declares so the runner reads
 * what doctrine wrote.
 */
const ZONE_LABEL: Record<PaceZone, string> = {
  E: 'E',
  M: 'M',
  MP: 'MP',
  T: 'T',
  ST: 'ST',
  I: 'I',
  R: 'R',
  HM: 'HM',
  '10K': '10K',
  '5K': '5K',
  '3K': '3K',
  mile: 'mile',
};

/** "90s" / "2:30" / "2 min", in the shapes `parseRest` reads. */
function restToken(sec: number): string {
  if (sec <= 0) return '';
  if (sec < 120) return `${Math.round(sec)}s`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  const m = Math.floor(sec / 60);
  const s = String(Math.round(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * A rep's size as `parsePrescription` / `parseTimeReps` spell it.
 *
 * `m` stays lowercase because the parser reads a lowercase `m` as metres and
 * refuses to guess at an uppercase one — "400M" is plainly metres and "2M" is
 * plainly miles, and a parser that chooses between them is where the next drift
 * starts.
 */
function repToken(value: number, unit: string): string | null {
  const n = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  switch (unit) {
    case 'mi': return `${n}mi`;
    case 'km': return `${n}km`;
    case 'm':  return `${n}m`;
    case 's':  return `${n}s`;
    case 'min': return `${n} min`;
    default:   return null;
  }
}

/**
 * The zone clause: one zone, a band, or the progression the entry declares.
 *
 * The distinction between the last two is load-bearing, and the entry's own
 * CITED ROWS settle it rather than a list kept here. §12.2's cutdowns quote
 * "Each rep 5–15 s/mi faster" and §11.2's Canova repeats quote "descend across
 * reps", so their zone lists are ordered walks and rendering only the first
 * would describe a different workout. §14.1's two-by-four-hundred row quotes
 * "5K to 3K", which is a BAND — anywhere in there, not 5K and then 3K — and
 * rendering it as an arrow would put a structure on the label the doc does not
 * state. `PROGRESSION_CITE` asks the doc, so a future entry that states a
 * progression renders as one without anybody remembering to add it.
 */
const PROGRESSION_CITE = /descend|each rep[^|]*faster/i;
function zoneClause(entry: CatalogueEntry): string {
  if (entry.effortOnly) {
    // §8.1's pace column is "5K–10K effort", never a number, because a flat
    // pace is unreachable on a 4-6% grade. Entries whose doc row states no zone
    // at all (§8.2's hill sprints, §8.4's circuit) get the bare word, which
    // asserts nothing beyond the entry's own `effortOnly` flag.
    if (entry.zones.length === 0) return ' · by effort';
    return ` @ ${entry.zones.map((z) => ZONE_LABEL[z]).join('-')} effort`;
  }
  if (entry.zones.length === 0) return '';
  /** Race-pace anchors read as race pace; Daniels' letters read as paces. */
  const paceWord = (z: PaceZone) =>
    z === 'HM' || z === 'MP' || z === '10K' || z === '5K' || z === '3K' || z === 'mile'
      ? 'race pace'
      : 'pace';
  if (entry.zones.length === 1) {
    const z = entry.zones[0];
    return ` @ ${ZONE_LABEL[z]} ${paceWord(z)}`;
  }
  if (entry.cites.some((c) => PROGRESSION_CITE.test(c))) {
    return ` · ${entry.zones.map((z) => ZONE_LABEL[z]).join(' → ')}`;
  }
  const last = entry.zones[entry.zones.length - 1];
  return ` @ ${entry.zones.map((z) => ZONE_LABEL[z]).join('-')} ${paceWord(last)}`;
}

/**
 * GRAMMAR-SEQ-1 (2026-08-19) · one step, in the grammar `parseSegments` reads.
 *
 * `"400m @ mile · 90s jog"`. The zone token is the doc's own shorthand and the
 * rest is the doc's own number; nothing here decides anything.
 */
function stepToken(
  value: number,
  unit: string,
  zone: PaceZone | null,
  recoverySec: number | null,
): string | null {
  const size = repToken(value, unit);
  if (!size) return null;
  const z = zone ? ` @ ${ZONE_LABEL[zone]}` : '';
  const r = recoverySec != null && recoverySec > 0 ? ` · ${restToken(recoverySec)} jog` : '';
  return `${size}${z}${r}`;
}

/**
 * A heterogeneous sequence, run-length encoded — which is how the doc writes it.
 *
 * §9.2's structure row is "2 × 90 s hard / 90 s float, then 4 × 60 s / 60 s
 * float, then 4 × 30 s / 30 s float, then 4 × 15 s / 15 s float", and §10.2's
 * is "2 mi T + 4×800 I". Collapsing runs of identical steps reproduces exactly
 * that notation rather than fourteen and five separate segments, and
 * `parseSegments` expands it back to the same step list, so the label the
 * runner reads and the spec the watch runs are the same object twice.
 */
function renderSequenceSegments(s: SequenceStructure): string | null {
  // A step at E is not WORK. Every segment this grammar emits becomes a work
  // phase with a pace target on the watch, and §11.4's "8 mi easy + immediate
  // 8 mi MP" has an easy run in the middle of it — a long run with a
  // marathon-pace finish under another name, which the engine already authors
  // on the long-run day (`longFinishSegment`). Rendering it here would put a
  // threshold target on eight easy miles and double-count the session. Declining
  // is the same answer the `double` structure gets, for the same reason.
  if (s.steps.some((st) => st.zone === 'E')) return null;
  const parts: string[] = [];
  let i = 0;
  while (i < s.steps.length) {
    const step = s.steps[i];
    let run = 1;
    while (
      i + run < s.steps.length &&
      s.steps[i + run].value === step.value &&
      s.steps[i + run].unit === step.unit &&
      s.steps[i + run].zone === step.zone &&
      s.steps[i + run].recoverySec === step.recoverySec
    ) run++;
    const token = stepToken(step.value, step.unit, step.zone, step.recoverySec);
    if (!token) return null;
    parts.push(run > 1 ? `${run}×${token}` : token);
    i += run;
  }
  return parts.length >= 2 ? parts.join(' + ') : null;
}

/**
 * §10.1's alternation · `"6×(1mi @ MP + 1mi @ 10K)"`.
 *
 * The doc's own structure row is "1 mi at MP / 1 mi at 10K, repeated 5–8×", and
 * its recovery row is "None — continuous". No rest token is written, so
 * `parseSegments` reads every step's recovery as zero and `expandSpecToPhases`
 * emits the work phases back to back with no recovery phase between them —
 * which is what makes the session continuous rather than a rep set whose rest
 * happens to be nothing.
 */
function renderAlternationSegments(s: AlternationStructure, cycles: number): string | null {
  if (!(cycles >= 2)) return null;
  // Same rule as the sequence renderer: neither leg of an alternation is easy.
  // §10.1 says so in its own Pace row — "recovery segments at MP (NOT easy)".
  if (s.steady.zone === 'E' || s.fast.zone === 'E') return null;
  const steady = stepToken(s.steady.value, s.steady.unit, s.steady.zone, null);
  const fast = stepToken(s.fast.value, s.fast.unit, s.fast.zone, null);
  if (!steady || !fast) return null;
  return `${cycles}×(${steady} + ${fast})`;
}

/**
 * Every step of a sequence is the same STEP — same length, same unit, and the
 * same zone.
 *
 * The zone comparison is not tidiness. §11.4's second structure is "8 mi easy +
 * immediate 8 mi MP": two steps, both eight miles, at two different paces. On
 * length and unit alone it read as uniform and rendered "2×8mi @ E-MP race
 * pace" — a two-rep set at marathon pace, half of which doctrine states as an
 * easy run. It was unreachable while MP had no anchor and became reachable the
 * moment one existed, which is the shape of every drift bug in this file's
 * history: a latent misreading, waiting for the gate in front of it to open.
 */
function uniformSequence(
  s: Structure,
): { reps: number; value: number; unit: string; recoverySec: number } | null {
  if (s.kind !== 'sequence' || s.steps.length < 2) return null;
  const first = s.steps[0];
  for (const step of s.steps) {
    if (step.value !== first.value || step.unit !== first.unit) return null;
    if (step.zone !== first.zone) return null;
  }
  const rest = s.steps.find((x) => x.recoverySec != null)?.recoverySec ?? 0;
  return { reps: s.steps.length, value: first.value, unit: first.unit, recoverySec: rest };
}

/**
 * The prescription string for a chosen entry and dose, or null when the shape
 * has no rendering in the engine's grammar.
 *
 * Null is the honest answer, not a failure: `buildWorkoutSpec` builds the
 * session from this string, so a shape it cannot read would reach the runner as
 * a label over a spec that runs something else. The shapes with no rendering
 * today are the unequal-step sequences (§9.2's Mona fartlek, §13.1's ladders,
 * §12.4's 5K progression, §10.2's threshold/VO2 combos), §10.1's alternations
 * and §11.1's two-session days. Every one of them is in the catalogue and
 * waiting for a spec kind that can express it.
 */
export function renderPrescription(entry: CatalogueEntry, dose: Dose): string | null {
  const s = dose.structure;
  const zones = zoneClause(entry);
  const rest = restToken(dose.recoverySec);
  const restClause = rest ? ` · ${rest} jog${entry.family === 'hills' ? ' down' : ''}` : '';

  if (s.kind === 'reps') {
    const size = repToken(s.rep.min, s.rep.unit);
    if (!size) return null;
    // A one-rep set is not a rep set. `sizeFromPrescription` may still cut a
    // rendered set to one when the week cannot afford the named dose — that is
    // its documented collapse — but the catalogue never AUTHORS one.
    if (dose.reps < 2) return null;
    // The family word keeps §8's effort-cued sets recognisable to
    // `buildWorkoutSpec`, whose `by_effort` gate reads the word "hill" out of
    // the prescription. Without it a hill session reaches the watch paced.
    const word = entry.family === 'hills' ? ' hills' : '';
    return `${dose.reps}×${size}${word}${zones}${restClause}`;
  }

  if (s.kind === 'sequence') {
    const u = uniformSequence(s);
    if (u) {
      const size = repToken(u.value, u.unit);
      if (!size) return null;
      const word = entry.family === 'hills' ? ' hills' : '';
      const r = restToken(u.recoverySec);
      return `${u.reps}×${size}${word}${zones}${r ? ` · ${r} jog` : ''}`;
    }
    // GRAMMAR-SEQ-1 · unequal steps · §13's ladders, §9.2's Mona, §10.2's
    // combos, §12.4's progression. Each step carries its own zone and its own
    // recovery, which is the thing a uniform rep set cannot say.
    //
    // NOT for an effort-cued entry. §8.5's Lydiard hill circuit is the case
    // that proves it: its "sequence" is one LAP of a loop — 800 m of bounding
    // uphill, 800 m flat jog, 700 m striding downhill, 800 m wind sprints —
    // where the second leg is recovery and none of the four has a pace, because
    // §8.1's pace column is effort and could not be otherwise on a gradient.
    // Rendered as segments it came out "800m + 800m @ E + 700m + 800m": a paced
    // four-rep set, one rep of which is an easy jog. A grammar whose content is
    // per-step ZONES has nothing to say about a session doctrine states without
    // any, so it declines, exactly as it did before.
    if (entry.effortOnly) return null;
    return renderSequenceSegments(s);
  }

  if (s.kind === 'alternation') {
    // GRAMMAR-SEQ-1 · §10.1. `dose.reps` is the cycle count `fits` settled on
    // inside the doc's own band.
    return renderAlternationSegments(s, dose.reps);
  }

  if (s.kind === 'continuous') {
    // A continuous block is the TEMPO slot's shape and the composer writes its
    // own leading mileage in front of it (`parseTempoLeadMi` reads that number
    // back). So this returns a PHRASE, never a sized string — see
    // `renderContinuousPhrase`, which the tempo path calls directly.
    return null;
  }

  return null;
}

/**
 * The tempo slot's phrase: what the block IS, with no size in front of it.
 *
 * `layoutWeek` composes `"<N>mi <phrase>"` and `parseTempoLeadMi` reads the N
 * back out, so the phrase must not lead with a number. It must also not carry
 * an `@ MP` token: `dosePaceOf` reads that as a marathon-pace dose, and a
 * threshold block charged to the marathon budget is a cap breach waiting for
 * the week that cannot afford it.
 */
export function renderContinuousPhrase(entry: CatalogueEntry, dose: Dose): string | null {
  if (dose.structure.kind !== 'continuous') return null;
  if (entry.zones.includes('MP') || entry.zones.includes('M')) return null;
  const name = entry.name.toLowerCase();
  // §5.2's entry is already named "Continuous tempo"; prefixing it again gives
  // the runner "5mi continuous continuous tempo".
  return name.startsWith('continuous') ? name : `continuous ${name}`;
}

/* ──────────────────────────────────────────────────────────── the wiring ── */

/**
 * The engine's quality slot types, as `SLOT_FAMILIES` names them.
 *
 * DOCTRINE-BASE-2 (2026-08-19) · `speed` joins the three. It is the only slot
 * whose families are what §15's BASE row names — §7's strides and hill sprints,
 * plus the §8 light hills and §9 fartleks `SLOT_FAMILIES_IN_PHASE` admits there
 * — and it is deliberately NOT one of the DAY types: the base week's structured
 * day carries the engine's existing `intervals` type, so nothing new reaches
 * the database, the mutation boundary or the watch. What changes is which
 * doctrine row the session is drawn from, not what shape of row is written.
 */
export type ComposerSlot = Extract<Slot, 'threshold' | 'intervals' | 'tempo' | 'speed'>;

export interface SlotRequest {
  history: CatalogueHistory;
  /** The engine's block phase · BASE / QUALITY / RACE-SPECIFIC / TAPER. */
  enginePhase: string;
  distance: DistCategory;
  tier: Tier;
  weekIdx: number;
  weeklyMi: number;
  slot: ComposerSlot;
  /** The day this slot sits on, 0-6, for §16's spacing rules. */
  dayOffset: number;
  placedThisWeek: PlacedSession[];
  inTaperWindow: boolean;
  tPaceSec: number | null;
  iPaceSec: number | null;
  /** ZONE-R-1 · the runner's marathon pace, from `marathonPaceSPerMi` — the
   *  same expression `buildWorkoutSpec` paces an MP block at. Anchors M and MP,
   *  which is what makes §11.3's and §4.4's MP sessions offerable at all. */
  mpPaceSec?: number | null;
  /** Slugs this week has already spent, so a week never repeats a session. */
  usedThisWeek: ReadonlySet<string>;
  /**
   * SLOT-ROTATE-2 · the at-pace minutes the block's overload trajectory has
   * earned for this slot's track this week, or null to spend the week's whole
   * share (which is what happened before this existed).
   *
   * This is the join between the two halves of a plan. The trajectory owns the
   * DOSE and steps it week over week on its own doctrine ladder; the catalogue
   * owns the IDENTITY and rotates it least-recently-used. Passing the one into
   * the other is what lets a block run a different session every week and still
   * climb — see `SelectorInput.targetAtPaceMinutes` for what the selector does
   * with it, and SLOT-ROTATE-2 in `generate.ts` for where the number is from.
   */
  targetAtPaceMinutes?: number | null;
  /**
   * SLOT-ROTATE-5 · true in the opening part of QUALITY, which is §15's
   * "Hill / strength (3–4 wks, optional)" block; false once the block is behind
   * and the week is in "Specific support (4–6 wks)". Null leaves the merged
   * two-row list, which is what every caller got before this existed.
   */
  inHillBlock?: boolean | null;
  /**
   * EFFORT-RAMP-1 · how far through the training block this week sits, 0…1.
   *
   * The composer's number, because the composer is what knows how long the
   * block is; the catalogue only knows what the doc says the band is. Passed
   * straight through — see `SelectorInput.blockPosition` for what the selector
   * does with it and why it is not the overload trajectory's job.
   */
  blockPosition?: number | null;
  /**
   * ONE-PER-FAMILY-1 · what this WEEK has left in each of Daniels' three capped
   * families, after every other slot in it is accounted for.
   *
   * The composer's number, because only the composer knows how many slots the
   * week is filling and what the earlier ones already spent. Passed straight
   * through — `SelectorInput.capFamilyRemainingMi` carries the reasoning and
   * the defect it closes.
   */
  capFamilyRemainingMi?: Partial<Record<CapFamily, number>> | null;
}

export type SlotChoice =
  | {
      ok: true;
      entry: CatalogueEntry;
      dose: Dose;
      /** The rep-shaped string, for the threshold and intervals slots. */
      prescription: string | null;
      /** The un-sized phrase, for the tempo slot. */
      phrase: string | null;
      family: WorkoutFamily;
      /** The catalogue's own one-line note: what this session is for. */
      note: string;
      rationale: string;
    }
  | { ok: false; reason: string; detail: string };

/**
 * Which of §15's doctrine phases this engine phase admits.
 *
 * `PHASE_FROM_ENGINE` maps QUALITY onto two of them, so the caller asks for
 * both and takes the first that yields a session. That merge is the selector's
 * own documented convention and is repeated here rather than re-derived.
 */
function doctrinePhasesFor(enginePhase: string): DoctrinePhase[] {
  return PHASE_FROM_ENGINE[enginePhase] ?? [];
}

/**
 * SLOT-ROTATE-5 (2026-08-19) · §15's rows are a SEQUENCE, and QUALITY spans two
 * of them.
 *
 * `PHASE_FROM_ENGINE` maps QUALITY onto `['hill_strength', 'specific_support']`
 * and `selectSlotWorkout` walks that list taking the first phase that yields a
 * session. So whenever ANY hill session fitted — and one almost always does,
 * because §8's sessions are effort-prescribed and spend no at-pace share — the
 * walk stopped at the first entry and `specific_support` was never reached.
 * §6's rep sessions are placed in `specific_support` and nowhere else, so a
 * marathon build ran four hill sessions in five QUALITY weeks and could not
 * reach §6.1's 1200s and 800s at all, whatever `qualityFamilyFor` named.
 *
 * §15 does not describe two interchangeable pools. It describes a 3-4 week
 * "Hill / strength (3–4 wks, optional)" block FOLLOWED by a 4-6 week "Specific
 * support (4–6 wks)" block, and the engine already knows which of the two a
 * week is in: `qualityFamilyFor` splits QUALITY on `weeksToPhaseEnd > 2`,
 * opening with hills and closing with reps. This resolves the merge with that
 * same split rather than by list order.
 *
 * `specific_support` stays available in the hill block. §8.3's and §8.4's own
 * "When in cycle" rows read "Late base, early specific", so the two genuinely
 * overlap at that end, and a week whose hill sessions are all on cadence should
 * still find a threshold session rather than nothing. What is removed is the
 * reverse: once the hill block is behind, the specific-support row is the row.
 */
export function doctrinePhasesForWeek(
  enginePhase: string,
  /** True in the opening part of QUALITY — the §15 hill/strength block. Null
   *  when the caller does not split the phase, which keeps the merged list. */
  inHillBlock: boolean | null,
): DoctrinePhase[] {
  const all = doctrinePhasesFor(enginePhase);
  if (enginePhase !== 'QUALITY' || inHillBlock == null) return all;
  return inHillBlock ? all : all.filter((p) => p !== 'hill_strength');
}

/**
 * The session this slot gets, or the selector's refusal.
 *
 * The loop around `selectWorkout` is the renderability gate: the selector
 * answers "what does doctrine place here that this week can afford", and this
 * asks the second question the composer needs answered — "and can the engine
 * express it". An entry whose chosen shape has no rendering is excluded and the
 * selector asked again, so the slot lands on the next-best session doctrine
 * places there instead of on nothing.
 */
export function selectSlotWorkout(req: SlotRequest): SlotChoice {
  const phases = doctrinePhasesForWeek(req.enginePhase, req.inHillBlock ?? null);
  if (phases.length === 0) {
    return { ok: false, reason: 'phase', detail: `no doctrine phase maps to ${req.enginePhase}` };
  }
  const anchors = anchorsFor({
    tPaceSec: req.tPaceSec,
    iPaceSec: req.iPaceSec,
    mpPaceSec: req.mpPaceSec ?? null,
  });
  const recent = recentFrom(req.history, req.weekIdx);
  const exclude = new Set<string>(req.usedThisWeek);
  let lastRefusal: { reason: string; detail: string } = {
    reason: 'no-quality-fits',
    detail: 'nothing was offered',
  };

  // Bounded by the catalogue's own size: every pass either returns or removes
  // one entry from the running.
  for (let guard = 0; guard <= 64; guard++) {
    let best: { entry: CatalogueEntry; dose: Dose; rationale: string } | null = null;
    for (const phase of phases) {
      const input: SelectorInput = {
        phase,
        distance: req.distance,
        tier: req.tier,
        weekIndex: req.weekIdx,
        weeklyMi: req.weeklyMi,
        slot: req.slot,
        anchors,
        placedThisWeek: req.placedThisWeek,
        dayOffset: req.dayOffset,
        recent,
        inTaperWindow: req.inTaperWindow,
        cycleCounts: req.history.cycleCounts,
        exclude,
        targetAtPaceMinutes: req.targetAtPaceMinutes ?? null,
        blockPosition: req.blockPosition ?? null,
        capFamilyRemainingMi: req.capFamilyRemainingMi ?? undefined,
      };
      const res = selectWorkout(input);
      if (res.ok) {
        best = { entry: res.entry, dose: res.dose, rationale: res.rationale };
        break;
      }
      lastRefusal = { reason: res.reason, detail: res.detail };
    }
    if (!best) return { ok: false, ...lastRefusal };

    const { entry, dose, rationale } = best;
    const prescription = req.slot === 'tempo' ? null : renderPrescription(entry, dose);
    const phrase = req.slot === 'tempo' ? renderContinuousPhrase(entry, dose) : null;
    if (prescription == null && phrase == null) {
      exclude.add(entry.slug);
      lastRefusal = {
        reason: 'not-renderable',
        detail: `${entry.name} (${entry.section}) has no ${req.slot}-slot rendering in the engine's prescription grammar`,
      };
      continue;
    }
    return {
      ok: true,
      entry,
      dose,
      prescription,
      phrase,
      family: entry.family,
      note: catalogueNote(entry, dose),
      rationale,
    };
  }
  return { ok: false, ...lastRefusal };
}

/**
 * The coaching line for a chosen session: the workout's own name and section.
 *
 * Coach voice, and no adjective the catalogue does not carry. The engine's
 * `FAMILY_NOTES` says what a FAMILY is for; this says which member of it the
 * runner is being handed, which is the thing the catalogue added.
 */
export function catalogueNote(entry: CatalogueEntry, dose?: Dose): string {
  const name = `${entry.name} · Research/04 ${entry.section}.`;
  // A continuous block's label is a phrase and a size, so the SHAPE the doc
  // states for it — §10.3's "Alternate ±5-15 s/mi around T pace, 30 s to 2 min
  // per segment" — has nowhere else to go. It used to be flattened into the
  // prescription as a hand-written "±10 s/mi around T", a midpoint of the
  // doctrine band that the doc does not state. Here it is the doc's own row.
  const shape = dose?.structure.kind === 'continuous' ? dose.structure.shape : null;
  return shape ? `${name} ${shape}.` : name;
}
