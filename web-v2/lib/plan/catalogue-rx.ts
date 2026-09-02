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
  capFamilyOf,
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
import type { WorkoutFamily } from './workout-library-static';
import { resolveZoneAnchors } from './zone-anchors';
// THESIS-PLAN-1 · the catalogue is DATA, and the block needs to ask it which of
// its entries can actually produce a paced read. `WORKOUT_CATALOGUE` is a pure
// array of cited rows — no pool, no clock — so this import adds nothing to the
// composer's runtime graph.
import { WORKOUT_CATALOGUE } from '@/lib/workout-catalogue/catalogue';

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
  /**
   * ROTATION-ATTEMPT-1 (2026-08-25) · sessions the rotation OFFERED and the
   * engine could not express, with the week it happened in.
   *
   * `selectSlotWorkout`'s retry loop drops a shape it cannot render into the
   * prescription grammar and asks the selector again, which is correct. What
   * was missing is that the attempt left no trace. The rotation is LEAST
   * RECENTLY USED and an entry that is never authored is never recorded in
   * `runs`, so an unrenderable entry stays permanently "never run", wins the
   * staleness tie EVERY week, and is dropped again — burning the top of the
   * rotation every week for the length of the block.
   *
   * Measured on the owner's CIM block: §8.5's Lydiard hill circuit is a lap of
   * four unequal segments ("800m of springing/bounding uphill, 800m flat jog,
   * 700m fast relaxed striding downhill, 800m wind sprints") with no rep-set
   * rendering, and it was the first pick in EVERY week of his hill block. Each
   * time the slot fell through to the second choice, which is how weeks 1 and 3
   * both ran §8.4's long hill repeats while §8.3's medium hill repeats and
   * §9.2's Mona fartlek went unused. The block read as narrower than the
   * catalogue it was drawing from, and the cause was a session that never
   * appeared in it.
   *
   * An ATTEMPT, deliberately, and not a ban. Renderability depends on the slot
   * (§5.2's continuous tempo renders as a phrase on the tempo slot and not as a
   * rep set on the threshold slot) and on the dose (`renderPrescription`
   * declines a set that has been sized down to one repetition), so a verdict
   * recorded once and applied forever would delete sessions that would render
   * perfectly well in another week. Feeding it to the rotation instead makes it
   * self-correcting: the entry simply stops being the stalest, and comes round
   * again in its turn.
   *
   * Kept out of `runs` and out of `cycleCounts` for the same reason. A session
   * the runner was never handed did not happen, and it must not count against
   * a `perCycleMax` ("1× per training cycle") that describes sessions run.
   */
  attempts: Array<{ slug: string; weekIdx: number }>;
}

export function newCatalogueHistory(): CatalogueHistory {
  return { runs: [], cycleCounts: {}, attempts: [] };
}

export function recordCatalogueChoice(
  history: CatalogueHistory,
  slug: string,
  weekIdx: number,
): void {
  history.runs.push({ slug, weekIdx });
  history.cycleCounts[slug] = (history.cycleCounts[slug] ?? 0) + 1;
}

/* ─────────────────────────────────────────────────────── coaching thesis ── */

/**
 * THESIS-PLAN-1 (2026-09-02) · WHAT THE COACHING THESIS ASKS OF A SLOT.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * The Coaching Thesis has reached plan authoring since PHASE-ANSWERS-1, and
 * `generate.ts:14630` said what it did there in as many words: "the thesis is
 * quoted into prose and PRICES NOTHING". `thesisPlanDirective` — the projection
 * of the thesis into the shape a composer consumes — had zero non-test callers.
 *
 * The plan-generation brief §3.2.I is the finding: "The Thesis identified
 * high-intensity evidence as the limiter while the early block used unpaced
 * hills that could not produce the specific evidence the Thesis said was
 * needed; the first paced interval arrived weeks later. Hills may still be
 * correct training, but the plan must explain whether it is developing
 * economy/strength or resolving high-intensity uncertainty. Coincidental
 * agreement is not strategy."
 *
 * Verified on the owner's live CIM block, 2026-09-02: weeks 1, 2 and 4 of
 * QUALITY all carried `by_effort: true`, `rep_pace_s_per_mi: null` hill
 * sessions (§8.3/§8.4). The first PACED rep set was week 6's `7×800 m @ I`.
 *
 * ── What this does, and deliberately no more ────────────────────────────────
 *
 * It does NOT re-rank the catalogue, override §15's placement, or add a session
 * doctrine did not put on the slot. It asks ONE question, at the point where a
 * slot is being filled: if the thesis says a capacity is the limiter, and the
 * block has not yet authored a single session in that family that can produce a
 * PACED read of it, then an effort-cued member of that family is not the right
 * first pick — take the next session doctrine places on the same slot that can.
 *
 * `CatalogueEntry.effortOnly` is the catalogue's own field for exactly this
 * ("True where the doc prescribes EFFORT and never a clock pace — every hill
 * session, and the sprints"), so the question is answerable from cited data
 * rather than from a judgment this module would have to invent (Constitution
 * §F: the composer never ranks a capacity itself).
 *
 * If nothing paced is offerable — the week cannot afford it, §15 places none on
 * this slot, the pace anchor is missing — the effort-cued session is taken and
 * the rationale SAYS SO. A refusal to prescribe is not on the table here; the
 * runner still gets doctrine's session for the slot.
 */
export interface ThesisSlotContext {
  /** The limiter, from the Coaching Thesis. `UNKNOWN` is a fact, not a gap. */
  limiter: 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY' | 'UNKNOWN';
  /**
   * Catalogue families a paced read of the limiter can come from, or null when
   * the limiter needs no paced session (durability's evidence is the long run's
   * DURATION, and the long slot is chosen by `selectLongRunVariant`, not here).
   */
  pacedEvidenceFamilies: readonly WorkoutFamily[] | null;
  /**
   * THESIS-PLAN-2 · Constitution §F's `not_priority` — "what is deliberately not
   * being emphasised" — as the catalogue families it names.
   *
   * This is a REPORTING obligation, not a ban, and the distinction is the whole
   * point. `thesisPlanDirective`'s own words are "the family that must not be
   * ADDED without explanation", and Constitution §15 says a coaching-strategy
   * contradiction is "REPORTED, loudly, in the structured object" rather than
   * silently resolved. Doctrine's own placement table (`Research/04` §15) puts
   * hill and rep work in a marathon build's QUALITY phase; a thesis that says
   * high-intensity is not the priority does not delete that phase, it means the
   * plan owes the runner a sentence saying why the session is there anyway.
   *
   * Measured on the owner's live block, 2026-09-02: his thesis resolves
   * DURABILITY / `increase_long_run_demand` with `doNotAdd: 'intervals'`, and
   * weeks 1, 2 and 4 of QUALITY each carry a hill session on the intervals
   * slot. Before this the plan said nothing about the tension; now the
   * session's own rationale does.
   */
  doNotAddFamilies?: readonly WorkoutFamily[] | null;
  /**
   * The composer slots on which a paced read of the limiter could be placed.
   *
   * The preference has to be expressed against the SLOT, not against the
   * evidence families, and the first cut of this got that wrong: excluding only
   * entries whose own family can evidence the limiter never excludes anything,
   * because an effort-cued session is by definition not in that set. `hills` is
   * exactly the case — §8's sessions compete for the intervals and speed slots
   * against §6's paced rep sets, and it was the hills that kept winning.
   *
   * (Found by falsifying the gate, not by review. Rule 18.)
   */
  evidenceSlots?: readonly ComposerSlot[] | null;
}

/** Whether the block has already authored a session that can produce a paced
 *  read in one of `families`. Reads the catalogue's own `effortOnly` field. */
export function blockHasPacedEvidence(
  history: CatalogueHistory,
  families: readonly WorkoutFamily[],
): boolean {
  const want = new Set(families);
  for (const r of history.runs) {
    const e = WORKOUT_CATALOGUE.find((x) => x.slug === r.slug);
    if (!e) continue;
    if (!e.effortOnly && want.has(e.family)) return true;
  }
  return false;
}

/** The selector's `recent` view of the history, in whole weeks back. */
function recentFrom(history: CatalogueHistory, weekIdx: number): RecentSession[] {
  const out: RecentSession[] = [];
  for (const r of history.runs) {
    const weeksAgo = weekIdx - r.weekIdx;
    if (weeksAgo >= 0) out.push({ slug: r.slug, weeksAgo });
  }
  // ROTATION-ATTEMPT-1 · offers the engine could not express, fed to the
  // rotation so they stop winning the staleness tie forever. See
  // `CatalogueHistory.attempts`.
  //
  // `selectWorkout` reads `recent` in two places and this reaches both:
  // `rankCandidates`, which is the staleness this exists for, and the CADENCE
  // check, which asks how many weeks since the session was run. So an attempt
  // also holds the entry off for its own `cadence.minDays` window, which is
  // stricter than doctrine states — an attempt is not a run. Accepted rather
  // than plumbed around: the effect is bounded by the entry's own cadence, it
  // errs toward offering a DIFFERENT session (which is the direction this
  // whole change is going), and splitting the two readings would mean widening
  // `RecentSession` across the selector's public surface to carry a flag that
  // one call site consults. Revisit if an entry with a long stated cadence
  // ever turns out to be unrenderable.
  for (const a of history.attempts ?? []) {
    const weeksAgo = weekIdx - a.weekIdx;
    if (weeksAgo >= 0) out.push({ slug: a.slug, weeksAgo });
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
/**
 * A cited row that states the session DESCENDS across its reps.
 *
 * LADDER-TARGET-1 (2026-09-02) · exported so the gate that checks a ladder is
 * not shipped with one flat scalar target reads the SAME predicate the label
 * is rendered from, rather than a second list of slugs that would drift
 * (Rule 16). `_ladder_targets.test.ts` is the caller.
 */
export const PROGRESSION_CITE = /descend|each rep[^|]*faster|each mile[^|]*faster|progressively faster/i;

/** True when the entry's own cited rows say its reps descend. */
export function entryDeclaresProgression(entry: CatalogueEntry): boolean {
  return entry.zones.length >= 2 && entry.cites.some((c) => PROGRESSION_CITE.test(c));
}

/* ──────────────────────────────────────────── LADDER-TARGET-2 · the ladder */

/**
 * THE PACE LADDER A CUTDOWN WALKS, slowest first.
 *
 * `Research/04` §12.2 states one directly — "Pace example | 6 reps: MP+10, MP,
 * MP-10, HM, T, 10K" — and §13.1's descending ladder states its own tail,
 * "1600-1200-800-400" at 10K, 5K, 3K, mile. This is those two, in order, and
 * nothing else: `E`, `M`, `ST`, `I` and `R` are Daniels TRAINING zones or
 * duplicates of a race-pace anchor, and no cutdown row in §12 or §13 names one.
 *
 * The ORDER is doctrine, not convention, and it is checked at run time rather
 * than trusted: `LADDER.descent-order-is-the-doc-s-own` reads the `% VO2max`
 * column of §"Pace zone shorthand" and asserts this sequence is monotone
 * non-decreasing through it. That is the same discipline every other
 * doctrine-bound table here is held to (Rule 18: read the numbers out of the
 * source, do not hardcode both sides).
 */
export const DESCENT_LADDER: readonly PaceZone[] = ['MP', 'HM', 'T', '10K', '5K', '3K', 'mile'];

/** Seconds per mile in a kilometre's worth of the same pace difference. */
const MI_PER_KM = 1.609344;

/**
 * The per-rep pace step this entry's OWN cited rows state, in s/mi.
 *
 * §12.2 "Each rep 5–15 s/mi faster" → 10. §12.3 "Each rep 5 s/mi faster" → 5.
 * §11.2 "Each rep 2.5–5 s/km faster than the previous" → 3.75 s/km → 6 s/mi.
 * Null when no cited row states one, and a null DECLINES the ladder rather
 * than inventing a step — the brief's own alternative ("select a workout it
 * can honestly prescribe") is better than a number nothing supports.
 */
export function perRepPaceStepSPerMi(entry: CatalogueEntry): number | null {
  for (const c of entry.cites) {
    const m = c.match(/(\d+(?:\.\d+)?)\s*(?:[–—-]\s*(\d+(?:\.\d+)?)\s*)?s\s*\/\s*(mi|km)\b/i);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    const mid = (lo + hi) / 2;
    return Math.round(m[3].toLowerCase() === 'km' ? mid * MI_PER_KM : mid);
  }
  return null;
}

/**
 * THE RUNGS OF A CUTDOWN, one per rep, as zone tokens the segment grammar reads.
 *
 * ── The defect this closes (brief §3.2.E) ───────────────────────────────────
 *
 * The catalogue already declared the ladder — `1k-cutdowns` carries zones
 * `MP → 5K` and cites "Start at MP, finish at 5K" — and the prescription still
 * shipped as `5×1km · MP → 5K`, which `buildWorkoutSpec` priced at the slot's
 * ONE anchor and `subLabelFromSpec` then re-derived as `@ I`. One quantity,
 * three answers (Rule 16). Measured over the archetype matrix by
 * `_ladder_targets.test.ts`: 2,581 of 2,898 ladder sessions shipped one flat
 * scalar.
 *
 * ── The construction ────────────────────────────────────────────────────────
 *
 * Walk `DESCENT_LADDER` from the entry's first declared zone to its last. That
 * is exactly what §12.2's example does (MP → HM → T → 10K) and it is why the
 * entry declares an ORDERED zone list at all.
 *
 *   reps === walk.length   the walk, one zone per rep.
 *   reps  <  walk.length   an evenly spaced subset that keeps BOTH endpoints —
 *                          "Start at MP, finish at 5K" is the sentence, and a
 *                          subset that drops either end says something else.
 *   reps  >  walk.length   open SLOWER than the first zone, which is the
 *                          doc's own instruction: §12.2 Structure reads "Start
 *                          slower than MP", and its example opens at MP+10.
 *                          Each extra rung is one `perRepPaceStepSPerMi` above
 *                          the one after it, so the whole set descends by the
 *                          step the entry itself states.
 *
 * Returns null — decline, and let the caller keep the arrow label — when the
 * entry's endpoints are not on the ladder, when the walk does not descend, or
 * when the entry states no per-rep step and one is needed. Declining is the
 * brief's stated alternative and is honest; guessing a middle rung is not.
 */
export function descentRungs(entry: CatalogueEntry, reps: number): string[] | null {
  if (!Number.isInteger(reps) || reps < 2) return null;
  if (entry.effortOnly) return null;
  // THE ENTRY'S OWN CITED ROWS DECIDE, not its zone list. Caught by
  // `_catalogue_wiring`'s doctrine check on the first run: §5.4's long tempo
  // declares `HM` and `T` — the BAND its block sits in, not a walk — and
  // without this it was rendered as a two-rung descent nothing in the doc
  // states. `zoneClause` already draws exactly this line for the label
  // (`PROGRESSION_CITE`); the prescription draws it from the same predicate so
  // the two cannot disagree (Rule 16).
  if (!entryDeclaresProgression(entry)) return null;
  const zones = entry.zones;
  if (zones.length < 2) return null;
  const i0 = DESCENT_LADDER.indexOf(zones[0]);
  const i1 = DESCENT_LADDER.indexOf(zones[zones.length - 1]);
  if (i0 < 0 || i1 < 0 || i1 <= i0) return null;
  const walk = DESCENT_LADDER.slice(i0, i1 + 1).map((z) => ZONE_LABEL[z]);

  if (reps === walk.length) return walk;
  if (reps < walk.length) {
    return Array.from({ length: reps }, (_, i) =>
      walk[Math.round((i * (walk.length - 1)) / (reps - 1))]);
  }
  const extra = reps - walk.length;
  const step = perRepPaceStepSPerMi(entry);
  if (step == null || !(step > 0)) return null;
  // A three-digit offset is not a pace zone any more, it is a different run.
  // `splitZoneOffset` reads at most three digits; refuse before we emit one.
  const lead: string[] = [];
  for (let k = extra; k >= 1; k--) {
    const off = step * k;
    if (off > 999) return null;
    lead.push(`${walk[0]}+${off}`);
  }
  return [...lead, ...walk];
}

/**
 * A descent rendered as an EXPLICIT SEQUENCE in the grammar `parseSegments`
 * reads, so `segmentSpec` prices every rung separately.
 *
 * `5×1km · MP → 5K · 60s jog`  becomes
 * `1km @ MP · 60s jog + 1km @ HM · 60s jog + 1km @ T · 60s jog +
 *  1km @ 10K · 60s jog + 1km @ 5K`
 *
 * Same notation `renderSequenceSegments` already emits for §9.2's Mona fartlek
 * and §10.2's combos, so nothing downstream is new: `parseSegments` expands it,
 * `segmentSpec` builds `steps[]`, `expandSpecToPhases` flattens those into the
 * phase list the watch has always received. No wire change.
 *
 * The last rung carries no recovery — a session's final rep has nothing to jog
 * into, which `parseSegments` enforces anyway.
 */
function renderDescentReps(
  entry: CatalogueEntry,
  reps: number,
  value: number,
  unit: string,
  recoverySec: number,
): string | null {
  const rungs = descentRungs(entry, reps);
  if (!rungs) return null;
  const size = repToken(value, unit);
  if (!size) return null;
  const rest = restToken(recoverySec);
  const restClause = rest ? ` · ${rest} jog` : '';
  return rungs
    .map((z, i) => `${size} @ ${z}${i === rungs.length - 1 ? '' : restClause}`)
    .join(' + ');
}
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
    // LADDER-TARGET-2 (2026-09-02) · A CUTDOWN IS PRESCRIBED AS ITS RUNGS.
    //
    // An entry whose own cited rows say the reps descend renders as an
    // explicit sequence, so every rung carries its own pace instead of the
    // whole set collapsing to the slot's single anchor. See `descentRungs` for
    // the construction and for when it declines.
    //
    // The structure's OWN recovery rule can veto it: §11.2 carries a "5 × 2K
    // all at MP, no descent" variation beside its cutdown ones, and the entry
    // declares the descent at entry level. The variation says so in words and
    // is read rather than guessed at.
    const structureForbidsDescent = /no descent/i.test(s.recoveryRule ?? '');
    if (!structureForbidsDescent) {
      const ladder = renderDescentReps(entry, dose.reps, s.rep.min, s.rep.unit, dose.recoverySec);
      if (ladder) return ladder;
    }
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
    // EFFORT-CUED SEQUENCE · REACH-3 (2026-08-30). §8.5's Lydiard hill circuit
    // is the only entry of this shape: four legs that differ by ACTION rather
    // than by pace — 800 m of bounding uphill, 800 m flat jog, 700 m striding
    // downhill, 800 m wind sprints — where the second leg is recovery and none
    // of the four has a pace, because §8.1's pace column is effort and could
    // not be otherwise on a gradient. The ordinary per-step grammar below
    // (GRAMMAR-SEQ-1) reads each step's ZONE, and this session states none;
    // rendered through it the circuit came out "800m + 800m @ E + 700m +
    // 800m", a paced four-rep set with an easy rep in the middle of it, which
    // is why REACH-2 declined it outright.
    //
    // Each step's own `leg` name — set on the catalogue entry for exactly this
    // ("the leg name is the prescription here, in the same way a pace target
    // is on a rep set", see `SequenceStep.leg`) — replaces the zone: `<size>
    // <leg>`, joined the same way GRAMMAR-SEQ-1 joins its runs. `zones` (the
    // whole-session clause computed above) is appended once at the end rather
    // than per step, and for this entry — `effortOnly`, no declared zones — it
    // is `zoneClause`'s bare "· by effort".
    //
    // REACH-2's OWN ATTEMPT rendered the segments and was reverted: 2208
    // enforced dosing breaches, because a rendered label of distance segments
    // was dose-visible to `dosePaceOf`, which charged an intervals-slot day at
    // I regardless of what the label said. That is now DOSE-EFFORT-1 in
    // `dosing.ts`: `dosePaceOf` reads this same "by effort" token before it
    // ever reaches a type-keyed default, so this render being dose-visible
    // text is no longer dose-visible ACCOUNTING — the two are allowed to
    // disagree in one direction only (a marker present means untaxed; absent
    // never falsely means untaxed, because nothing but this function and the
    // reps branch above ever writes it).
    if (entry.effortOnly) {
      const parts = s.steps.map((st) => {
        const size = repToken(st.value, st.unit);
        return size && st.leg ? `${size} ${st.leg}` : null;
      });
      if (parts.length < 2 || parts.some((p) => p == null)) return null;
      return `${parts.join(' + ')}${zones}`;
    }
    // GRAMMAR-SEQ-1 · unequal steps · §13's ladders, §9.2's Mona, §10.2's
    // combos, §12.4's progression. Each step carries its own zone and its own
    // recovery, which is the thing a uniform rep set cannot say.
    if (s.steps.some((st) => st.zone === 'E')) return null;
    return renderSequenceSegments(s);
  }

  if (s.kind === 'alternation') {
    // GRAMMAR-SEQ-1 · §10.1. `dose.reps` is the cycle count `fits` settled on
    // inside the doc's own band.
    return renderAlternationSegments(s, dose.reps);
  }

  if (s.kind === 'continuous') {
    /* REACH-1 (2026-08-29) · A TIME-STATED, EFFORT-CUED CONTINUOUS SESSION
     * RENDERS HERE; a paced one still belongs to the tempo slot.
     *
     * This arm returned null unconditionally, on the reasoning that "a
     * continuous block is the TEMPO slot's shape". True for §5.2's tempo,
     * where `layoutWeek` writes the leading mileage and `parseTempoLeadMi`
     * reads it back — and false for the sessions doctrine states as a DURATION
     * at an effort, which carry their own size and never take a mileage
     * prefix. Those are not tempo-slot sessions and cannot reach the tempo
     * slot: `SLOT_FAMILIES.tempo` admits only `threshold` and `combo`.
     *
     * The cost of the gap, measured by a reachability sweep over every
     * (slot × phase × distance × tier × volume) the composer uses: §8.6's hill
     * fartlek and §9.4's Lydiard fartlek were UNREACHABLE. Both are base-phase
     * entries, both are named in §15's own base row ("occasional fartlek/light
     * hills"), and `SLOT_FAMILIES_IN_PHASE` already admits their families to
     * the base speed slot precisely so they could be placed — the placement
     * was fixed by DOCTRINE-BASE-2 and the rendering was not, so the entries
     * were admitted and then refused for having no prescription.
     *
     * Rendered as its own duration and shape, because that is what the doc
     * states: "| Hill fartlek | 30-60 min | Variable | Mixed |".
     */
    if (entry.effortOnly && s.block.unit === 'min') {
      const mins = dose.atPaceMinutes > 0
        ? Math.round(dose.atPaceMinutes)
        : s.block.min;
      const shape = s.shape ? ` · ${s.shape}` : '';
      // DOSE-EFFORT-1 (2026-08-30) · a literal "by effort", not `zones`
      // (`zoneClause(entry)`). §8.6's hill fartlek (`zones: []`) always read as
      // effort-cued anyway — its name contains "hill", which is the marker
      // `dosePaceOf` reads for a rep set — which is exactly how this stayed
      // hidden: §9.4's Lydiard fartlek declares a zone (`E`), so `zoneClause`
      // renders it "@ E effort" instead of "· by effort", and NEITHER of
      // `dosePaceOf`'s markers matched — `prescriptionIsEffortCued` reads the
      // literal phrase, not the bare word, because generate.ts's beginner
      // surge days hand-author a genuinely PACED "…@ T effort" and must not be
      // caught by a looser match (see that function's own comment). So this
      // session's whole ~20 min of surging was billed against the I cap on
      // every week it was selected. The static marker below is what §7.3's
      // hill sprints and every other zoneless `effortOnly` entry already gets
      // for free from `zoneClause`; `E` here means only "easy bulk between
      // surges", which the `shape` text already states in words, so dropping
      // it from the label loses nothing a runner reads.
      return `${mins} min ${entry.name.toLowerCase()}${shape} · by effort`;
    }
    // A paced continuous block is the TEMPO slot's shape and the composer
    // writes its own leading mileage in front of it (`parseTempoLeadMi` reads
    // that number back). So this returns a PHRASE, never a sized string — see
    // `renderContinuousPhrase`, which the tempo path calls directly.
    return null;
  }

  return null;
}

/**
 * The tempo slot's phrase: what the block IS, with no size in front of it.
 *
 * `layoutWeek` composes `"<N>mi <phrase>"` and `parseTempoLeadMi` reads the N
 * back out, so the phrase must not lead with a number. It must also never
 * IMPLY an `@ MP` dose: this function's own output never spells one out (it
 * writes only `entry.name`, nothing zone-shaped), but a session whose doctrine
 * price is genuinely marathon pace — `capFamilyOf(entry) === null`, doctrine's
 * "n/a" weekly cell for M — must not be handed a phrase that reads as an
 * ordinary threshold block and gets `dosePaceOf`'d as one at zero cost to the
 * uncapped M budget.
 *
 * REACH-4 (2026-08-30) · narrowed from "refuse anything touching MP or M" to
 * "refuse only what `capFamilyOf` prices as M". §12.5's continuous mile
 * cutdown declares `zones: ['MP', 'HM']` — it STARTS near marathon pace and
 * finishes near half-marathon pace ("Start MP+15, drop to slightly faster
 * than HM by final mile") — and the blanket guard read the `MP` alone and
 * refused it, though `capFamilyOf` already prices the whole session at
 * `threshold` (HM is the tighter of the two zones) and `SLOT_FAMILIES.tempo`
 * admitting `cutdown` routes it through exactly this function. Refusing an
 * entry `capFamilyOf` prices as `threshold` was never what "must not carry an
 * `@ MP` token" was protecting against; a PURE-M entry (`capFamilyOf` null)
 * still declines, unchanged.
 */
export function renderContinuousPhrase(entry: CatalogueEntry, dose: Dose): string | null {
  if (dose.structure.kind !== 'continuous') return null;
  if (capFamilyOf(entry) == null) return null;
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
 *
 * VARIETY-LONG-1 (2026-08-28) · `long` joins them, through its own door.
 * `SLOT_FAMILIES.long` has declared the five §4 long-run entries since the
 * catalogue was built and no composer path ever passed the slot, so
 * `base-long-run`, `progression-long-run`, `marathon-pace-long-run`,
 * `fast-finish-long-run` and `dress-rehearsal-long-run` were doctrine-cited
 * and unreachable. The long slot does NOT go through `selectSlotWorkout`:
 * that function's renderability gate asks "can the prescription grammar
 * express this shape", and a long run's shape is not a prescription string —
 * it is the composer's own `LONG · …` sub_label, whose segments `layoutWeek`
 * sizes off the volume curve and the week's dose budgets. `selectLongRunVariant`
 * below answers only the IDENTITY question (which §4 row this week's intensity
 * long is), and the composer keeps every number.
 */
export type ComposerSlot = Extract<Slot, 'threshold' | 'intervals' | 'tempo' | 'speed' | 'long'>;

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
   * DOWNHILL-3 (2026-08-29) · slugs this CALLER rules out, for reasons the
   * catalogue cannot see.
   *
   * The catalogue knows what doctrine places in a phase for a distance; it
   * does not know what the runner's race COURSE looks like, and one family
   * turns on exactly that. Research/11's downhill work is training for a
   * descent — prescribing it to a runner racing a flat course is not variety,
   * it is a session with no stimulus behind it, and it costs the slot a
   * session that did have one. `selectLongRunVariant` already took this
   * argument for the downhill simulation; the quality slots had no way to say
   * it, so the repeats went to everybody.
   */
  exclude?: ReadonlySet<string>;
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
  /**
   * THESIS-PLAN-1 · what the Coaching Thesis asks of this slot, or null when
   * the caller has no thesis (every pure/synthetic caller, and a runner whose
   * thesis read failed — Rule 11 keeps those two apart upstream and both
   * arrive here as null, because neither is a limiter).
   */
  thesis?: ThesisSlotContext | null;
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
  for (const slug of req.exclude ?? []) exclude.add(slug);
  let lastRefusal: { reason: string; detail: string } = {
    reason: 'no-quality-fits',
    detail: 'nothing was offered',
  };
  // THESIS-PLAN-1 · sessions this slot passed over because they could not
  // evidence the limiter, and whether the search ran out of paced options and
  // had to take one anyway. Both reach the runner-facing rationale.
  const thesisSkipped: string[] = [];
  let thesisFellBack = false;

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
    if (!best) {
      // THESIS-PLAN-1 · nothing paced was offerable on this slot. Re-run the
      // search once with the thesis preference OFF rather than leaving the slot
      // empty: doctrine's session for the slot is still the right training, and
      // a plan that drops a quality day to hold a preference is worse than one
      // that states the compromise. Rule 11 — this is a THIRD state, and the
      // rationale distinguishes it from both "the thesis chose this" and "the
      // thesis was never consulted".
      if (thesisSkipped.length > 0 && !thesisFellBack) {
        thesisFellBack = true;
        for (const name of thesisSkipped) {
          const e = WORKOUT_CATALOGUE.find((x) => x.name === name);
          if (e) exclude.delete(e.slug);
        }
        continue;
      }
      return { ok: false, ...lastRefusal };
    }

    const { entry, dose, rationale } = best;

    // THESIS-PLAN-1 · the limiter's first session must be one that can EVIDENCE
    // it. See `ThesisSlotContext` for the finding and the boundary.
    const wantPaced = req.thesis?.pacedEvidenceFamilies ?? null;
    const evidenceSlots = req.thesis?.evidenceSlots ?? null;
    if (
      wantPaced != null
      && evidenceSlots != null
      && evidenceSlots.includes(req.slot)
      && entry.effortOnly
      && !blockHasPacedEvidence(req.history, wantPaced)
      && !thesisFellBack
    ) {
      exclude.add(entry.slug);
      // Recorded as an ATTEMPT for the same reason a non-renderable shape is:
      // the rotation is least-recently-used, and an entry that keeps being
      // passed over without a trace stays permanently the stalest and burns the
      // top of the rotation every week (see `CatalogueHistory.attempts`).
      if (req.history.attempts && !req.history.attempts.some(
        (a) => a.slug === entry.slug && a.weekIdx === req.weekIdx,
      )) {
        req.history.attempts.push({ slug: entry.slug, weekIdx: req.weekIdx });
      }
      thesisSkipped.push(entry.name);
      lastRefusal = {
        reason: 'thesis-needs-paced-evidence',
        detail: `${entry.name} (${entry.section}) is prescribed by effort and cannot evidence `
          + `${req.thesis!.limiter}, which the Coaching Thesis names as the limiter`,
      };
      continue;
    }

    const prescription = req.slot === 'tempo' ? null : renderPrescription(entry, dose);
    const phrase = req.slot === 'tempo' ? renderContinuousPhrase(entry, dose) : null;
    if (prescription == null && phrase == null) {
      exclude.add(entry.slug);
      // ROTATION-ATTEMPT-1 · the rotation offered it and the engine could not
      // express it. Record the ATTEMPT so a later week's rotation sees it as
      // recently offered rather than as never used. Without this the same
      // entry is the first pick every single week and every week's slot falls
      // through to its second choice.
      if (req.history.attempts && !req.history.attempts.some(
        (a) => a.slug === entry.slug && a.weekIdx === req.weekIdx,
      )) {
        req.history.attempts.push({ slug: entry.slug, weekIdx: req.weekIdx });
      }
      lastRefusal = {
        reason: 'not-renderable',
        detail: `${entry.name} (${entry.section}) has no ${req.slot}-slot rendering in the engine's prescription grammar`,
      };
      continue;
    }
    // THESIS-PLAN-1 · say what the thesis did, in the line the runner reads.
    // Rule 20: a coaching decision nothing records is a decision nobody can
    // check, and `selection_rationale` is where "why this session?" lives.
    // THESIS-PLAN-2 · the `not_priority` family, placed anyway because doctrine
    // places it. State the tension rather than let the two disagree in silence.
    const notPriority = req.thesis?.doNotAddFamilies ?? null;
    const notPriorityClause = notPriority && notPriority.includes(entry.family)
      ? ` Thesis holds ${req.thesis!.limiter} as the limiter and does not prioritise this family; `
        + `it is here because Research/04 §15 places it on this slot in ${req.enginePhase}.`
      : '';
    const thesisClause = thesisSkipped.length === 0
      ? ''
      : thesisFellBack
        ? ` Thesis names ${req.thesis!.limiter} as the limiter and this week had no paced `
          + `session available to evidence it; ${thesisSkipped[0]} stands as the slot's session.`
        : ` Chosen over ${thesisSkipped[0]} because the Thesis names ${req.thesis!.limiter} as `
          + `the limiter and an effort-cued session cannot evidence it.`;
    return {
      ok: true,
      entry,
      dose,
      prescription,
      phrase,
      family: entry.family,
      note: catalogueNote(entry, dose),
      rationale: rationale + thesisClause + notPriorityClause,
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

/* ─────────────────────────────────────────── VARIETY-LONG-1 · the long slot ── */

/**
 * Slugs the long-run rotation never offers, and why each is out:
 *
 *   · `dress-rehearsal-long-run` · §4.6 is placed by DAYS BEFORE THE RACE
 *     ("3 weeks pre-marathon"), not by a weekly cadence, and
 *     `authorDressRehearsal` already authors it at exactly that slot with its
 *     own dose and its own `perCycleMax`. Offering it here as well is how the
 *     session double-fires — once by the calendar, once by the rotation.
 *   · `base-long-run` · §4.2 is what every OFF-cadence week already runs, and
 *     the composer authors a plain easy long without consulting the catalogue.
 *     Left in the rotation it would win the never-run staleness tie on the
 *     block's first cadence week and hand the one long doctrine reserves for
 *     intensity back to an easy run.
 *
 * §4.5's fast finish is NOT on this list, and deliberately not: on a half it
 * is the race-pace long, the only row that tags the finish `@ HM`. The
 * marathon is the case where it duplicates the default, and the caller
 * excludes it there — see `MARATHON_ROTATION_EXCLUDED` below, which is
 * conditional on the distance and so cannot live in this unconditional set.
 */
const LONG_ROTATION_EXCLUDED: ReadonlySet<string> = new Set([
  'dress-rehearsal-long-run',
  'base-long-run',
]);

/**
 * ROTATION-REFUSE-1 (2026-08-29) · what a MARATHON block additionally keeps
 * out of the long rotation.
 *
 * §4.5's fast finish is the shape the composer authors anyway when the
 * rotation declines — the default finish is `finishSeg.kind`, which is the
 * fast finish — so on a marathon a rotation slot spent on it delivers exactly
 * the session the week would have had with no rotation at all. Same argument
 * as `base-long-run` one rung up: not "hands the slot back to an easy run" but
 * "hands the slot back to the default".
 *
 * It matters because the count is small. `rotatesLongVariant` fires only
 * outside BASE and only where §4.4's race-specific MP long has not already
 * claimed the week, which comes to exactly TWO rotated long runs per marathon
 * block at every length from 12 to 20 weeks. Three candidates competing for
 * two slots meant §4.3's progression — the one row whose tail is threshold
 * rather than more marathon pace — fell out of nearly every block, while a
 * slot went to the session the week already had. Excluded, the two slots go to
 * §4.3 and §11.1, and §4.5 still arrives on any week both of those refuse, by
 * the default path.
 *
 * ONLY the marathon. A half's race-specific weeks rotate (the reservation in
 * `rotatesLongVariant` is `racePaceTag === 'MP'`, so it does not fire there),
 * which means §4.5 is not a duplicate of anything on a half — it is the row
 * that carries the `@ HM` race-pace finish, and nothing else in the family
 * does. Excluding it unconditionally took the race-pace long off both David
 * personas' half blocks.
 */
export const MARATHON_ROTATION_EXCLUDED: ReadonlySet<string> = new Set([
  'fast-finish-long-run',
]);

/**
 * DOWNHILL-3 (2026-08-29) · sessions that only make sense on a net-downhill
 * course, named once so every slot that can offer them gates the same way.
 *
 * `Research/11-course-specific-training.md` §"Eccentric Loading Protocol for
 * Downhill-Heavy Races" is explicit about who it is for. The simulation long
 * has been gated on the course since it was added; the repeats reached the
 * intervals slot ungated and were therefore offered to every marathon and half
 * runner in the app, flat course or not. That is not a variety win — the
 * session's stimulus is quadriceps eccentric loading for a descent the runner
 * is not going to run — and it cost the slot a session that did have a
 * stimulus: §12.2's mile cutdown, which went from landing in every half
 * archetype swept to landing in none.
 *
 * The list, not the individual slug, because the two entries are one protocol
 * and a third would otherwise be added to one call site and not the other.
 */
export const DOWNHILL_ONLY_SLUGS: ReadonlySet<string> = new Set([
  'downhill-repeats',
  'downhill-simulation-long-run',
]);

export interface LongVariantRequest {
  history: CatalogueHistory;
  /** The engine's block phase · QUALITY / RACE-SPECIFIC. */
  enginePhase: string;
  distance: DistCategory;
  tier: Tier;
  weekIdx: number;
  weeklyMi: number;
  /** The long run's day, 0-6, for §16's spacing rules. */
  dayOffset: number;
  inTaperWindow: boolean;
  tPaceSec: number | null;
  iPaceSec: number | null;
  mpPaceSec?: number | null;
  /** SLOT-ROTATE-5 · same split `selectSlotWorkout` takes for QUALITY. */
  inHillBlock?: boolean | null;
  /** Slugs the caller has ruled out beyond the standing exclusions. */
  exclude?: ReadonlySet<string>;
}

/**
 * WHICH of `Research/04` §4's intensity long runs this cadence week carries.
 *
 * `Research/00a` §"Long-Run Variations" is the doctrine this serves: "Long
 * runs are not monolithic. Variants apply across distances", and the
 * progression row's own Caution column — "Don't make every long run a
 * progression — rotate." The composer's cadence machinery
 * (`racePaceLongThisWeek`) decides WHETHER this week's long carries intensity;
 * this decides WHICH §4 row it is, rotated least-recently-used through the
 * same `CatalogueHistory` the quality slots rotate through, filtered by the
 * entries' own phase/distance/tier declarations.
 *
 * Identity only. The returned entry's dose is the selector's internal sizing
 * artifact and the caller must NOT author from it: the long run's distance is
 * the volume curve's, and its segment sizes are `layoutWeek`'s, bounded by the
 * week's own dose budgets. Null means nothing in the family is offerable
 * (no anchor, phase places nothing here, everything excluded) and the caller
 * keeps its default row.
 */
export function selectLongRunVariant(req: LongVariantRequest): {
  entry: CatalogueEntry;
  rationale: string;
} | null {
  const phases = doctrinePhasesForWeek(req.enginePhase, req.inHillBlock ?? null);
  if (phases.length === 0) return null;
  const anchors = anchorsFor({
    tPaceSec: req.tPaceSec,
    iPaceSec: req.iPaceSec,
    mpPaceSec: req.mpPaceSec ?? null,
  });
  const recent = recentFrom(req.history, req.weekIdx);
  const exclude = new Set<string>(LONG_ROTATION_EXCLUDED);
  for (const s of req.exclude ?? []) exclude.add(s);

  for (const phase of phases) {
    const res = selectWorkout({
      phase,
      distance: req.distance,
      tier: req.tier,
      weekIndex: req.weekIdx,
      weeklyMi: req.weeklyMi,
      slot: 'long',
      anchors,
      // The long run is the day being filled, so the week's other sessions are
      // not yet placed when this runs; §16's long-run rules are enforced the
      // other way round — the quality slots see the long via `placedThisWeek`.
      placedThisWeek: [],
      dayOffset: req.dayOffset,
      recent,
      inTaperWindow: req.inTaperWindow,
      cycleCounts: req.history.cycleCounts,
      exclude,
    });
    if (res.ok) return { entry: res.entry, rationale: res.rationale };
  }
  return null;
}
