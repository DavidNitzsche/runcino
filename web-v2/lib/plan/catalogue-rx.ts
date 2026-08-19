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
  Tier,
} from '@/lib/workout-catalogue/types';
import type { WorkoutFamily } from './workout-library';

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
 * pacing it by inference, and that gate is the reason this map is SHORT. The
 * composer carries two numbers per week — the threshold pace and the rep pace,
 * the same two `buildWorkoutSpec` will pace the session at — and two doctrine
 * relations extend them:
 *
 *   · HM ← T. `Research/01` §"Pace conversion from a race time" defines T as
 *     "~half-marathon pace to 15K pace", so the half's race pace and T are one
 *     LT-anchored class. `dosePaceOf` already reads an @HM long-run finish as a
 *     T dose on the same sentence.
 *   · 5K ← I. `Research/01` §Daniels-I puts I at "~3K to 5K race pace";
 *     `spec-builder.ts` cites the same row when it paces a rep session.
 *
 * EVERY OTHER ZONE IS LEFT UNANCHORED ON PURPOSE, and the consequence is
 * visible: the three 10K race-pace sessions in §14.2 whose only zone is `10K`
 * are declined with `no-anchor`, as are §5.4's sub-threshold intervals (ST is
 * "~10-15 s/mi slower than T" and the composer has no ST number), §7's R-pace
 * work and every MP-only session. Anchoring them off T or I would put a pace on
 * the label that `buildWorkoutSpec` would not build — it paces a `threshold`
 * slot at T and an `intervals` slot at I regardless of what the prescription
 * declares — and a label promising a pace the watch does not run is the drift
 * this module exists to avoid. Widening the vocabulary further is a
 * spec-builder change, not a catalogue one.
 */
export function anchorsFor(args: {
  tPaceSec: number | null;
  iPaceSec: number | null;
}): Partial<Record<PaceZone, number>> {
  const out: Partial<Record<PaceZone, number>> = {};
  if (args.tPaceSec != null && args.tPaceSec > 0) {
    out.T = args.tPaceSec;
    out.HM = args.tPaceSec;
  }
  if (args.iPaceSec != null && args.iPaceSec > 0) {
    out.I = args.iPaceSec;
    out['5K'] = args.iPaceSec;
  }
  return out;
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

/** Every step of a sequence has the same length and unit. */
function uniformSequence(
  s: Structure,
): { reps: number; value: number; unit: string; recoverySec: number } | null {
  if (s.kind !== 'sequence' || s.steps.length < 2) return null;
  const first = s.steps[0];
  for (const step of s.steps) {
    if (step.value !== first.value || step.unit !== first.unit) return null;
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
    if (!u) return null;
    const size = repToken(u.value, u.unit);
    if (!size) return null;
    const word = entry.family === 'hills' ? ' hills' : '';
    const r = restToken(u.recoverySec);
    return `${u.reps}×${size}${word}${zones}${r ? ` · ${r} jog` : ''}`;
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

/** The engine's quality slot types, as `SLOT_FAMILIES` names them. */
export type ComposerSlot = Extract<Slot, 'threshold' | 'intervals' | 'tempo'>;

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
  /** Slugs this week has already spent, so a week never repeats a session. */
  usedThisWeek: ReadonlySet<string>;
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
  const phases = doctrinePhasesFor(req.enginePhase);
  if (phases.length === 0) {
    return { ok: false, reason: 'phase', detail: `no doctrine phase maps to ${req.enginePhase}` };
  }
  const anchors = anchorsFor({ tPaceSec: req.tPaceSec, iPaceSec: req.iPaceSec });
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
