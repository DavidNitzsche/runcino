/**
 * lib/training/spec-card.ts · SPECFIRST-1 (2026-08-24)
 *
 * The runner's card, composed from `plan_workouts.workout_spec` — the same
 * authored truth `lib/watch/build-workout.ts` expands and the watch executes.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `lib/training/expand-spec.ts` has said since 2026-06-02 that the spec is the
 * source of truth, and the watch was migrated to it. `/api/v5/today` was not.
 * It built its card from `prescriptionFor()`, whose rep distance is a literal
 * (`const repMi = 1` for threshold, `0.5` for intervals) and whose rep COUNT is
 * dosed off weekly mileage rather than read off the day. So the phone and the
 * wrist described different workouts on every quality day.
 *
 * Measured against production on 2026-08-24 (faff_readonly, all non-archived
 * plans): 41 quality days, 40 of which disagreed with their own spec. Live
 * (future-dated) subset: 34 of 35. The failure was not marginal —
 *
 *   plan spec "5×400 m @ T pace · 2 min jog"  →  card said "2 × 1 mile reps"
 *   plan spec "3×7 min @ I · 60s jog"         →  card said "5 × 800m"
 *   plan spec "11×10s hills · by effort"      →  card said "3 × 800m"
 *   plan spec's own pace 11:03/mi             →  card said 9:36/mi (87 s/mi out)
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 *
 * One expander, two renderers. `expandSpecToPhases` produces the phase list;
 * the watch turns it into `WatchPhase[]`, this file turns the SAME list into
 * `PrescriptionStep[]`. Neither re-derives structure. If the two surfaces ever
 * disagree again it will be because they were handed different phases, which
 * `_spec_card.test.ts` asserts they are not.
 *
 * Nothing here invents a number. A rep distance, a rep count, a rest interval
 * and a pace target all come off the spec or are absent. Where the spec carries
 * no pace, the step goes out BY FEEL — the same P1-47 rule the expander already
 * obeys one layer down.
 *
 * Cite: designs/briefs/iphone-workout-spec-single-source-2026-06-02.md
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md
 */

import { expandSpecToPhases, subLabelFromSpec, type ExpandedPhase } from './expand-spec';
import { classifySession, sessionToleranceSec } from './execution-semantics';
import { fmtPace as fmtPaceNoUnit, roundTo } from '@/lib/format/run';
import { sessionRationale, type PrescriptionStep, type WorkoutType } from './prescriptions';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';
import { readSelectionRationale } from '@/lib/plan/progression-spec';

export interface SpecCard {
  type: WorkoutType;
  headline: string;
  why: string;
  citation: string;
  /**
   * RATIONALE-PERSIST-1 (2026-09-01) · the catalogue selector's own REAL
   * reason this session beat the alternatives it considered this week, read
   * straight off `workout_spec.selection_rationale` — never re-derived,
   * never templated. `why` above answers "what is this kind of session
   * for", byte-identical for every runner on every threshold day
   * (`sessionRationale(type)`); this answers "why THIS one, this week, for
   * THIS runner" — the question `docs/reports/workout-provenance-
   * trace-2026-09-01.md` §1 and §11 found computed and then thrown away.
   *
   * `null` on a row authored before this field existed, and on any day a
   * generic trajectory (not the §15 catalogue) filled — both real, honest
   * absences, not failures.
   *
   * Written in the engine's own working voice (candidate counts, doctrine
   * section numbers), not yet passed through a coach-voice rewrite — kept
   * as a distinct field rather than folded into `why` for exactly that
   * reason. A caller putting this in front of the runner as a primary
   * sentence should scrub it first; today's one wired consumer
   * (`GET /api/v5/today`) carries it as a secondary field for that reason.
   */
  selectionRationale: string | null;
  steps: PrescriptionStep[];
  total_mi: number;
  /**
   * PRERUN-1 · the WORK's own pace target and tolerance, in s/mi, straight off
   * the phase the runner is being asked to hold. Null when the work goes out
   * by feel.
   *
   * Exists so the panel's "Pace band" stat can be read off THIS session
   * instead of re-derived. It used to come from `derivePaces()`, whose whole
   * tree hangs off the runner's typed goal time, so the largest number on the
   * panel and the steps three lines below it were two different answers to one
   * question. Same defect the card's structure had before SPECFIRST-1, one
   * register up.
   */
  workPaceSPerMi: number | null;
  workToleranceSPerMi: number | null;
  /**
   * PRERUN-1 · how long the session takes, summed over the SAME phases the
   * watch sums for its own `totalEstimatedMinutes`. Null when there are no
   * phases to sum (a row-basis card).
   *
   * The panel's "about 54 min" kicker used to be `total_mi × one pace`. On an
   * easy day that is fine; on a rep day it is not, because the one pace it
   * picked was the REP pace and the warm-up, the cool-down and every jog
   * recovery are run minutes slower. A 4.3 mi tune-up came out at 31 minutes
   * against a real 37. Phase durations already exist, already account for the
   * heat easing applied above, and are what the wrist is told.
   */
  totalDurationSec: number | null;
  /**
   * PRERUN-1 · this session ends at race pace.
   *
   * True only for a long run carrying an HM/M finish segment. The watch has
   * suppressed its aerobic HR ceiling on exactly these days since 2026-06-07
   * (Audit D/D1): a workout-level Z2 cap would red-alert through the entire
   * finish and coach against the prescription. The phone printed the ceiling
   * anyway, so this says the same thing to the same gate.
   */
  hasRacePaceFinish: boolean;
  /**
   * Where the card's STRUCTURE came from. `'spec'` means every count, distance
   * and pace below was read off `workout_spec`, so the phone and the watch are
   * describing one workout. `'row'` means the plan row carries no spec and the
   * card shows only what the row itself holds — no rep set, because there is no
   * rep set stored to show.
   *
   * RULE ONE. The distinction lives in data and reaches VoiceOver through the
   * copy, not through a symbol.
   */
  basis: 'spec' | 'row';
}

/** "1:30" · "45s" · "7:00". Recovery and time-based reps are read as a clock. */
function fmtDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "7:10 /mi" — the same shape `prescriptions.ts` writes, so the two card
 *  sources render identically on the client. Null in, null out: an absent pace
 *  target is BY FEEL and must not acquire a number here. */
export function fmtPace(sPerMi: number | null | undefined): string | null {
  // Rounds the TOTAL, then splits it. The version this replaces rounded the
  // REMAINDER — `Math.round(sPerMi % 60)` — which carries to 60 without the
  // minute hearing about it, so a target of 419.6 s/mi printed `6:60 /mi` on
  // the card telling the runner what to run. Nineteen formatters shared that
  // bug; `lib/format/run.ts` is the one that does not.
  //
  // The unit is spaced (`7:10 /mi`) where `fmtPaceSlash` writes `7:10/mi`,
  // because `prescriptions.ts` writes it spaced and the two card sources have
  // to render identically. Presentation differs; the arithmetic does not.
  const p = fmtPaceNoUnit(sPerMi);
  return p == null ? null : `${p} /mi`;
}

/**
 * WU/CD-CEIL-1 (2026-09-01) · "≤ 8:22 /mi" — a ceiling, not a target to
 * land on. `docs/PRODUCT_DECISIONS.md` 2026-08-31 settled this for easy
 * running generally; warm-up and cool-down are easy running, so they read
 * the same way. Null in, null out, same contract as `fmtPace`.
 */
export function fmtPaceCeiling(sPerMi: number | null | undefined): string | null {
  const p = fmtPaceNoUnit(sPerMi);
  return p == null ? null : `≤ ${p} /mi`;
}

/**
 * QUALITY-BAND-1 (2026-09-01) · "7:02-7:18 /mi" when a tolerance rides along
 * with the target, else the same bare point `fmtPace` would print.
 *
 * `docs/reports/workout-provenance-trace-2026-09-01.md` §13: a threshold
 * pace resolved from direct evidence still carries confidence (0.727 on the
 * workout that trace named), not certainty, and Brief 03 is explicit that
 * "precision should match the workout" licenses a NARROWER band, not a bare
 * point with no represented uncertainty at all. This layer has no access to
 * that confidence number — it only sees the phase's own
 * `tolerancePaceSPerMi`.
 *
 * CORRECTED 2026-09-01. This docblock used to assert that "`cardTolerance` in
 * `/api/v5/today` (± 8 s/mi) is the same width the watch grades execution
 * against." That was TRUE for threshold and interval days and FALSE for tempo
 * days, where the phone said ±20 and the wrist graded ±8 — and nothing checked
 * it, which is Rule 20 exactly. The claim is now structural rather than
 * asserted: both surfaces call `sessionToleranceSec` in
 * `lib/training/execution-semantics.ts` with the same classifier, and
 * `_execution_semantics_owner.test.ts` fails if either stops.
 *
 * A zero or missing tolerance falls back to a bare point, so a work phase
 * with no band in force (an effort-only rep, or a type this fix does not
 * touch) is unaffected.
 */
export function fmtPaceBand(sPerMi: number | null | undefined, toleranceSec: number | null | undefined): string | null {
  if (sPerMi == null) return null;
  if (toleranceSec == null || !(toleranceSec > 0)) return fmtPace(sPerMi);
  const lo = fmtPaceNoUnit(sPerMi - toleranceSec);
  const hi = fmtPaceNoUnit(sPerMi + toleranceSec);
  if (lo == null || hi == null) return fmtPace(sPerMi);
  if (lo === hi) return `${lo} /mi`;
  return `${lo}-${hi} /mi`;
}

/**
 * Notes are written per PHASE ROLE, never per distance.
 *
 * `prescriptionFor`'s threshold note opened "Each mile at the same pace" — true
 * of the 1-mile rep it had hardcoded, false of the 400 m rep the spec actually
 * carried. A note that names a distance is a second place for the card to
 * contradict the plan, so none of these name one.
 */
const NOTE = {
  warmup: 'Start easy. Build into the work over the last quarter mile.',
  // 2026-08-31 · "it shortens tomorrow" asserted a physiological fact — that a
  // cool-down measurably shortens next-day recovery — that no document in
  // `Research/` states, and Rule 7 is explicit that a claim about physiology
  // carries a citation or is not made. It also argued with the number beside
  // it: the step is priced at the same easy pace as the warm-up, so the runner
  // reads a recovery promise over an ordinary easy mile. Says what the segment
  // IS instead, which is the part that is true and the part that stops it being
  // treated as optional padding on the end of the day.
  cooldown: 'Easy jog. Part of the workout, not extra mileage.',
  recovery: 'Honest jog, not standing.',
  repThreshold: 'Same pace on every rep. If the last one slips, the target was too fast.',
  repInterval: 'Even splits from the first rep. Do not go out fast expecting to fade.',
  repGeneric: 'Same effort on every rep, first to last.',
  stride: 'Relaxed and fast. Not a workout, so walk back fully between.',
  tempo: 'Continuous and controlled. If the breathing turns ragged, ease off 5 to 10 sec/mi.',
  easy: 'Conversational. Cap the effort and hold form.',
  long: 'Time on feet beats pace. Fuel around 45 min in, then every 30.',
  race: 'Hold the plan through the first 5K. Mile 1 decisions are paid for at mile 12.',
  finish: 'The point of the session. Find race rhythm and hold it home.',
  /* A rep the plan sized in effort, not in pace. `Research/03` §14 puts hill
   * repeats under RPE and calls pace meaningless on them, so telling this
   * runner to hold even splits is advice against a number the screen has just
   * refused to state — the footer would be arguing with the "By effort" on the
   * row above it. */
  repByEffort: 'Effort is the target here, not a pace. The last one should cost what the first one cost.',
} as const;

/**
 * What the rep IS, in the plural, read off the phase's own label.
 *
 * `expandReps` writes "Hill 3 of 11 · 10s" when the spec's label mentions a
 * hill and "Rep 3 of 11 · 10s" when it does not; `appendStrides` writes
 * "Stride 3 of 6". That first word is the only place the distinction survives
 * the expansion, and the card was throwing it away — eleven ten-second hill
 * reps rendered on the phone as "11 × 10s", which is a flat-ground session.
 *
 * Returns null for anything unrecognised rather than guessing a noun.
 */
function repNoun(p: ExpandedPhase): string | null {
  if (p.isStrideSegment === true) return 'strides';
  const first = String(p.label ?? '').trim().split(/[\s·]/)[0].toLowerCase();
  switch (first) {
    case 'hill': return 'hills';
    case 'stride': return 'strides';
    case 'surge': return 'surges';
    // `Rep` and `Interval` are what the expander calls a rep it has nothing
    // more specific to say about. Neither adds anything a runner did not
    // already read in the count: "5 × 400 m intervals" and "5 × 400 m reps"
    // are both longer ways of writing "5 × 400 m". Only a noun that CHANGES
    // the session — a hill, a stride, a surge — earns the words.
    case 'rep': case 'interval': return null;
    default: return null;
  }
}

/**
 * PRERUN-1 · below this, a heart-rate band is not a target a runner can hold.
 *
 * `Research/03-heart-rate-zones.md` §13, "Implications by Rep Duration", top
 * row: a rep under 30 seconds gets `Useless — HR lags`, and the anchor it
 * names instead is `Pace, RPE`. §2 gives the kinetics behind it — HR rises
 * with a half-time of about 30 s and plateaus at 90-180 s — so on a
 * ten-second hill the number has not begun to arrive by the time the rep is
 * over. §14's table says the same thing a second way: `Hill repeats | RPE |
 * HR | Pace meaningless`.
 *
 * The card was stating one anyway. "11 × 10s hills · 172-185" was live on two
 * active plans: a band nobody can reach inside the rep, printed in the one
 * column that tells the runner what to aim at, on a rep the plan had marked
 * `by_effort` precisely because it declined to name a target.
 *
 * Watched by `PRERUN.hr-short-rep-floor` in lib/doctrine/registry.ts, which
 * reads the boundary out of that table rather than restating it here.
 */
export const HR_TARGET_MIN_REP_SEC = 30;

function repNote(type: WorkoutType, isStride: boolean, byEffort = false): string {
  if (isStride) return NOTE.stride;
  if (byEffort) return NOTE.repByEffort;
  if (type === 'threshold' || type === 'tempo') return NOTE.repThreshold;
  if (type === 'intervals') return NOTE.repInterval;
  return NOTE.repGeneric;
}

function workNote(type: WorkoutType, phase: ExpandedPhase): string {
  if (phase.isFinishSegment) return NOTE.finish;
  switch (type) {
    case 'tempo': return NOTE.tempo;
    case 'long': return NOTE.long;
    case 'race': return NOTE.race;
    case 'threshold':
    case 'intervals': return repNote(type, false);
    default: return NOTE.easy;
  }
}

/** Two work phases belong to the same rep block only when they are the same
 *  rep. Distance, duration, pace and role all have to match — a ladder
 *  ("2×90s then 4×60s") must come out as two blocks, not one wrong one. */
function workSig(p: ExpandedPhase): string {
  return [p.distanceMi ?? '-', p.durationSec ?? '-', p.targetPaceSPerMi ?? '-',
    p.isStrideSegment ? 's' : '', p.isFinishSegment ? 'f' : ''].join('|');
}
function recSig(p: ExpandedPhase | null): string {
  if (!p) return 'none';
  return [p.durationSec ?? '-', p.distanceMi ?? '-', p.targetPaceSPerMi ?? '-'].join('|');
}

type Token =
  | { kind: 'edge'; phase: ExpandedPhase }
  | { kind: 'unit'; work: ExpandedPhase; rec: ExpandedPhase | null };

/** Pair each work phase with the recovery that follows it, keeping warm-up and
 *  cool-down where they sit. The last rep has no recovery, which is doctrine
 *  (`Research/04` §5.1 — straight into the cool-down) and not a missing field. */
function tokenize(phases: ExpandedPhase[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.type === 'warmup' || p.type === 'cooldown') { out.push({ kind: 'edge', phase: p }); continue; }
    if (p.type === 'work') {
      const next = phases[i + 1];
      if (next && next.type === 'recovery') { out.push({ kind: 'unit', work: p, rec: next }); i++; }
      else out.push({ kind: 'unit', work: p, rec: null });
      continue;
    }
    // A recovery with no work before it (nothing emits this today). Carried
    // through rather than dropped, so a future spec shape cannot lose a phase
    // silently between the wrist and the card.
    out.push({ kind: 'edge', phase: p });
  }
  return out;
}

/**
 * Compose the card from an authored spec. Returns null when the spec is absent
 * or of a kind `expandSpecToPhases` does not know — the caller must then fall
 * back to `cardWithoutSpec`, never to a template.
 */
export function cardFromSpec(input: {
  spec: WorkoutSpec | null;
  /** The plan row's own `type` column, narrowed by the caller. */
  type: WorkoutType;
  /** The plan row's `sub_label` — the authored name of the day, when stored. */
  subLabel?: string | null;
  /** The plan row's `distance_mi`. The card's total is the plan's total. */
  distanceMi: number;
  /** The runner's own easy-pace anchor, s/mi. Null → by-feel edges (P1-47). */
  easyPaceSec: number | null;
  /**
   * WU/CD-CEIL-1 (2026-09-01) · the FAST edge of the runner's easy band —
   * what a warm-up or cool-down must not run faster than
   * (`docs/PRODUCT_DECISIONS.md` 2026-08-31 "easy pace is a ceiling, not a
   * band"). Distinct from `easyPaceSec` above on purpose — see the field doc
   * on `ExpandSpecInput.easyCeilingSec`. Null → falls back to `easyPaceSec`.
   */
  easyCeilingSec?: number | null;
  /** HR band strings by zone, from `hrTargets(profile)`. Null when no LTHR. */
  hr?: { z1: string | null; z2: string | null; z3: string | null; z4: string | null; z5: string | null } | null;
  toleranceSec?: number;
}): SpecCard | null {
  const { spec, type, distanceMi, easyPaceSec, hr } = input;
  if (!spec) return null;

  const phases = expandSpecToPhases({
    spec,
    totalMi: distanceMi,
    easyPaceSec,
    easyCeilingSec: input.easyCeilingSec ?? easyPaceSec,
    // RECOVERY-BYFEEL-1 (2026-09-01) · this used to be the same easy anchor
    // as `easyPaceSec`, which is exactly HOW warm-up, every jog recovery and
    // cool-down ended up printing one identical number "by construction"
    // (provenance trace §5, finding #1). `expandReps`/`expandSteps` no
    // longer consume this for the rep-to-rep jog — it now only feeds
    // `appendStrides`' walk-back, a genuinely different (full-recovery)
    // pause. Kept non-null here rather than deleting the line, so a future
    // caller of strides on this path keeps its walk-back target.
    recoveryPaceSec: easyPaceSec,
    /* THE tolerance, from THE owner — never a literal.
     *
     * This defaulted to a bare `8`, which happened to agree with the phone
     * route's ternary for threshold and interval days and disagreed with it
     * for every other type the caller could pass. Two copies of one number is
     * how the five-way spread in `execution-semantics.ts`' header began. */
    toleranceSec: input.toleranceSec ?? sessionToleranceSec(
      classifySession(type, spec as unknown as Record<string, unknown>),
    ),
    workPhaseLabel: type === 'race' ? 'Race effort' : type === 'shakeout' ? 'Shakeout' : undefined,
  });
  if (!phases || phases.length === 0) return null;

  const rationale = sessionRationale(type);
  const steps: PrescriptionStep[] = [];
  const tokens = tokenize(phases);

  /* Is a lone work phase a SET OF ONE, or a continuous block?
   *
   * "1×1 km @ T pace · 1:30 jog" is a rep set that happens to contain one rep,
   * and the card should say so — the plan's own label does. A 2.5-mile tempo
   * block is not, and "1 × 2.5 mi" would be wrong about it.
   *
   * The spec's `kind` is the discriminator because it is what routed the
   * expansion in the first place: `threshold` and `intervals` go through
   * `expandReps`, everything else does not. Reading the phase LABEL instead
   * would be guessing at a string three functions upstream. */
  const specKind = String((spec as Record<string, unknown>).kind ?? '');
  const repSetKind = specKind === 'threshold' || specKind === 'intervals';

  // The work zone the card quotes. Same gating the watch uses: a quality HR
  // target belongs to threshold/interval work, never to an easy or long block.
  const workHr =
    type === 'intervals' ? hr?.z5 ?? null
    : type === 'threshold' ? hr?.z4 ?? null
    : type === 'tempo' ? hr?.z3 ?? null
    : type === 'long' || type === 'race' ? hr?.z3 ?? null
    : hr?.z2 ?? null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'edge') {
      const p = t.phase;
      const isWu = p.type === 'warmup';
      const isCd = p.type === 'cooldown';
      /* WARMUP-CONTRADICTION-1 (2026-09-01) · provenance trace §14. The card
       * used to print a FLAT pace target on this step ("9:03 /mi") beside a
       * note reading "build into the work" and, on quality days, an HR cap
       * of z1 — three statements, two of them fighting the third. A flat
       * target says "hold this"; "build" says the opposite; the HR cap was
       * the only one of the three that was ever the real constraint.
       *
       * Showing the number as a CEILING resolves it without dropping any of
       * the three: "≤ 8:22 /mi, ≤ 139 bpm, build into the work" all point the
       * same direction — start under both ceilings, let the effort rise
       * toward the work that follows. Recovery edges (unused today — see
       * `tokenize`) show no pace at all, same reasoning as the between-rep
       * jog below: a recovery is not paced. */
      const paceLabel = (isWu || isCd) ? fmtPaceCeiling(p.targetPaceSPerMi) : null;
      steps.push({
        label: isWu ? 'Warmup' : isCd ? 'Cooldown' : p.label,
        ...(p.distanceMi != null ? { distance_mi: p.distanceMi } : {}),
        ...(p.distanceMi == null && fmtDuration(p.durationSec) ? { duration: fmtDuration(p.durationSec)! } : {}),
        ...(paceLabel ? { pace_target: paceLabel } : {}),
        ...(hr?.z1 ? { hr_target: hr.z1 } : {}),
        note: isWu ? NOTE.warmup : isCd ? NOTE.cooldown : NOTE.recovery,
      });
      continue;
    }

    // Gather the run of identical rep units starting here.
    let n = 1;
    while (i + n < tokens.length) {
      const nx = tokens[i + n];
      if (nx.kind !== 'unit') break;
      if (workSig(nx.work) !== workSig(t.work)) break;
      if (recSig(nx.rec) === recSig(t.rec)) { n++; continue; }
      // The final rep of a set carries no recovery — `Research/04` §5.1, the
      // last rep runs straight into the cool-down, and `expandReps` emits it
      // that way on purpose. It is still a rep of this set, so it joins the
      // block, and nothing can follow it inside the block. Without this the
      // card split "5×400 m" into "4 × 400 m" and a stray fifth.
      if (nx.rec === null) n++;
      break;
    }
    const w = t.work;
    const isStride = w.isStrideSegment === true;
    /* QUALITY-BAND-1 · a band for genuine quality work (threshold, intervals,
     * tempo), a bare point everywhere else. Easy/long/race/shakeout work
     * stays a point on purpose — the 2026-08-31 "easy pace is a ceiling, not
     * a band" decision is the opposite instruction for those, and this file
     * does not re-open that here. */
    const isQualityWork = type === 'threshold' || type === 'intervals' || type === 'tempo';
    const paceStr = isQualityWork
      ? fmtPaceBand(w.targetPaceSPerMi, w.tolerancePaceSPerMi)
      : fmtPace(w.targetPaceSPerMi);
    const recDur = fmtDuration(t.rec?.durationSec);
    // RECOVERY-BYFEEL-1 · `t.rec?.targetPaceSPerMi` is null for a between-rep
    // jog now (see `expand-spec.ts`), so this naturally comes back null and
    // the recovery sub-object below carries no `pace_target` — no separate
    // change needed here to drop it.
    const recPace = fmtPace(t.rec?.targetPaceSPerMi);
    /* A rep too short for a heart rate to arrive gets no heart rate.
     * `Research/03` §13 — see `HR_TARGET_MIN_REP_SEC`. A stride was already
     * excluded by name; this is the same physiology stated as a duration, so
     * a ten-second hill is covered whether or not anyone flagged it. */
    const tooShortForHr =
      w.distanceMi == null
      && typeof w.durationSec === 'number'
      && w.durationSec > 0
      && w.durationSec < HR_TARGET_MIN_REP_SEC;
    const hrForStep = isStride || tooShortForHr ? null : workHr;
    /* …and then the row is not left blank. The plan said BY EFFORT, which is
     * the anchor `Research/03` §13 names for exactly this rep length ("Pace,
     * RPE"), so the card says it in words rather than leaving the target
     * column empty and reading as a number that failed to load. RULE THREE:
     * a refusal states its reason. */
    const effortOnly = paceStr == null && hrForStep == null && !isStride;

    if (n > 1) {
      steps.push({
        label: isStride ? 'Strides' : `Repeat ${n}×`,
        reps: n,
        ...(repNoun(w) ? { rep_noun: repNoun(w)! } : {}),
        ...(w.distanceMi != null ? { rep_distance_mi: w.distanceMi } : {}),
        // Time-based reps (hills, fartlek surges, Mona) carry no distance. The
        // duration IS the instruction — "90 s hard", Research/04 §9.2 — so it
        // goes in `duration` and the client renders "6 × 1:30".
        ...(w.distanceMi == null && fmtDuration(w.durationSec) ? { duration: fmtDuration(w.durationSec)! } : {}),
        ...(paceStr ? { pace_target: paceStr } : {}),
        ...(hrForStep ? { hr_target: hrForStep } : {}),
        ...(effortOnly ? { effort_target: 'By effort' } : {}),
        note: repNote(type, isStride, effortOnly),
        ...(recDur ? {
          recovery: {
            duration: recDur,
            ...(recPace ? { pace_target: recPace } : {}),
            note: isStride ? 'Walk back. Full recovery before the next one.' : NOTE.recovery,
          },
        } : {}),
      });
    } else if (repSetKind && !isStride) {
      // A set of one. Same shape as a set of many so the client renders it the
      // same way ("1 × 1 km"), which is how the plan's own label reads.
      steps.push({
        label: w.label,
        reps: 1,
        ...(repNoun(w) ? { rep_noun: repNoun(w)! } : {}),
        ...(w.distanceMi != null ? { rep_distance_mi: w.distanceMi } : {}),
        ...(w.distanceMi == null && fmtDuration(w.durationSec) ? { duration: fmtDuration(w.durationSec)! } : {}),
        ...(paceStr ? { pace_target: paceStr } : {}),
        ...(hrForStep ? { hr_target: hrForStep } : {}),
        ...(effortOnly ? { effort_target: 'By effort' } : {}),
        note: repNote(type, false, effortOnly),
        ...(recDur ? {
          recovery: {
            duration: recDur,
            ...(recPace ? { pace_target: recPace } : {}),
            note: NOTE.recovery,
          },
        } : {}),
      });
    } else {
      steps.push({
        label: w.label,
        ...(w.distanceMi != null ? { distance_mi: w.distanceMi } : {}),
        ...(w.distanceMi == null && fmtDuration(w.durationSec) ? { duration: fmtDuration(w.durationSec)! } : {}),
        ...(paceStr ? { pace_target: paceStr } : {}),
        ...(hrForStep ? { hr_target: hrForStep } : {}),
        ...(effortOnly ? { effort_target: 'By effort' } : {}),
        note: isStride ? NOTE.stride : effortOnly ? NOTE.repByEffort : workNote(type, w),
        ...(recDur ? {
          recovery: {
            duration: recDur,
            ...(recPace ? { pace_target: recPace } : {}),
            note: NOTE.recovery,
          },
        } : {}),
      });
    }
    i += n - 1;
  }

  // The day's total is the plan's own figure, not a re-summed one. The two can
  // differ by a rounding step inside the expander, and when they do it is the
  // plan row that the week's mileage, the fuel plan and the watch all count.
  const total = Number.isFinite(distanceMi) && distanceMi > 0 ? roundTo(distanceMi, 1) : 0;

  // The authored name of the day beats a generic one, and `subLabelFromSpec`
  // is the SAME function that wrote `sub_label` at generation time — so the
  // headline cannot drift from the structure below it even on a row whose
  // stored label is stale.
  const stored = (input.subLabel ?? '').trim();
  const derived = (subLabelFromSpec(spec) ?? '').trim();
  const name = derived || stored;
  const headline = name && name.toUpperCase() !== name ? name : rationale.headline;

  /* The pace the WORK asks for, off the phases themselves.
   *
   * The work phase is the one the session is named after — a rep, a tempo
   * block, the long run itself — never the warm-up. On a long run with an
   * HM/M finish there are two work phases at two paces; the FINISH is the
   * point of the session (`NOTE.finish` says so on the step right above), so
   * it wins. Null when the work goes out by feel, which the panel must then
   * render as no stat rather than as a number from somewhere else. */
  const workPhases = phases.filter((p) => p.type === 'work');
  const paceSource =
    workPhases.find((p) => p.isFinishSegment === true && p.targetPaceSPerMi != null)
    ?? workPhases.find((p) => p.isStrideSegment !== true && p.targetPaceSPerMi != null)
    ?? workPhases.find((p) => p.targetPaceSPerMi != null)
    ?? null;

  return {
    type,
    headline,
    why: rationale.why,
    citation: rationale.citation,
    selectionRationale: readSelectionRationale(spec),
    steps,
    total_mi: total,
    workPaceSPerMi: paceSource?.targetPaceSPerMi ?? null,
    workToleranceSPerMi: paceSource?.tolerancePaceSPerMi ?? null,
    hasRacePaceFinish: phases.some((p) => p.isFinishSegment === true),
    totalDurationSec: (() => {
      const sec = phases.reduce((a, p) => a + (Number(p.durationSec) || 0), 0);
      return sec > 0 ? Math.round(sec) : null;
    })(),
    basis: 'spec',
  };
}

/**
 * SPECSUMMARY-1 (2026-09-01) · THE SESSION'S FAMILY, READ OFF THE SPEC.
 *
 * The one phrase that names what KIND of session this is, for a surface that
 * carries the workout's own prescription elsewhere and needs a short true
 * description beside it. It states a family and, for a long run, whether the
 * day carries race-pace work. It NEVER states a rep count, a rep distance or
 * a block length — those live in the prescription itself, and a second place
 * to say them is a second place for them to be wrong.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * `lib/watch/build-workout.ts` composed the wire's `summary` as
 * `${miles} mi · ${prescriptionFor(...).headline}` — the GENERIC template,
 * whose rep distance is a literal and whose rep count is dosed off weekly
 * mileage rather than read off the day. It is the same generic-versus-authored
 * split SPECFIRST-1 closed for the phone's card on 2026-08-24 and did not
 * close here.
 *
 * Measured on the owner's live block, 2026-09-01, by composing the real
 * `buildWatchToday` against production read-only (payloads in this lane's
 * report):
 *
 *   row `10×60s hills @ 5K-10K effort · 2 min jog down` → "Intervals · 6 × 800m"
 *   row `9×1km @ ST pace · 60s jog`                     → "Threshold · 4 × 1 mile reps"
 *   row `2×90s + 4×60s + 4×30s + 4×15s` (Mona fartlek)  → "Intervals · 6 × 800m"
 *   row `LONG`, spec with NO finish segment             → "Long run · marathon-pace finish"
 *
 * Four of the owner's plain long runs claimed a marathon-pace finish they do
 * not have, and every rep session on the block was described with a rep count
 * and a rep distance belonging to a different workout.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * Not a headline, not a prescription. `WatchWorkout.name` already carries the
 * authored `sub_label` — the actual session — and Rule 17 says the runner
 * reads a sentence once, so this deliberately does NOT repeat it. It names
 * the family, which is true whatever the structure, and stops.
 *
 * STATED PLAINLY, because a reader will ask: no watch screen draws `summary`
 * today — `WatchWorkoutModels.swift` decodes it and no face renders it. This
 * is a correctness fix on the WIRE, not a rendered defect; it is a false
 * statement no runner has read yet. Worth fixing rather than deleting because
 * the field IS decoded, and the next face to draw it would draw the template.
 */
export function specFamilyPhrase(spec: WorkoutSpec, type: WorkoutType): string {
  const s = (spec ?? {}) as Record<string, unknown>;
  if (type === 'long') {
    const segs = Array.isArray(s.finish_segments) ? (s.finish_segments as unknown[]) : [];
    const hasFinish = (Number(s.finish_mi) || 0) > 0 || segs.length > 0;
    // The generic template's own two phrases, kept verbatim where they are
    // TRUE — what changes is that they are now conditioned on the spec that
    // decides which one applies.
    return hasFinish ? 'Long run · marathon-pace finish' : 'Long run · aerobic';
  }
  return sessionRationale(type).headline;
}

/**
 * The honest fallback · a plan row that genuinely carries no `workout_spec`.
 *
 * Every quality day on every active plan in production carries one (verified
 * 2026-08-24), so this path is for older rows: 627 of the 941 quality rows in
 * the table have no spec, all of them on archived plans, and a restored or
 * re-read plan can still reach here.
 *
 * It shows what the row holds — the type, the distance, the stored pace target
 * — and NOTHING ELSE. The card that used to render here said "Threshold · 3 ×
 * 1 mile reps" on a row that stored no rep count, no rep distance and no rest
 * interval. A card that says less is not a worse card; a card that makes up
 * the session is.
 *
 * RULE THREE. This is a refusal, not an empty state: it names what it has and
 * says plainly what it does not.
 *
 * NO DDL WAS TAKEN FOR THIS. The durable repair is a backfill of `workout_spec`
 * on the rows that lack one — `app/api/admin/backfill-workout-spec/route.ts`
 * already exists for exactly that and is the right instrument. It is a data
 * write, so it needs David's explicit go; until it runs, this refusal is the
 * correct behaviour rather than a stopgap.
 */
/**
 * PRERUN-1 · the day is stored under a type this screen cannot prescribe.
 *
 * The pre-run card is a RUNNING prescription. `plan_workouts.type` also holds
 * `strength` (44 rows, 14 on active plans) and could hold `cross`, and David
 * removed both as surfaces on 2026-08-17 — the run is the product. Until now
 * such a row reached `narrowToPrescriptionType`, came back `'easy'`, and drew
 * an easy run's card over a session with no run in it, headlined "Easy
 * aerobic" in the panel's dose slot because a zero-mile easy run has no
 * distance to put there.
 *
 * `lib/coach/glance-state.ts` already drops strength rows before the day is
 * chosen (STRENGTH-3) and `lib/plan/week-loader.ts` ranks them below every
 * running type, so this path is a BACKSTOP rather than a live rendering —
 * verified against production 2026-08-24: every active-plan strength date also
 * carries a running row, which wins. It is not dead code, though: a strength
 * row landing on a day whose only sibling is `rest` outranks that rest row
 * (`TYPE_PRIORITY.strength = 1` vs `rest = 0`) and would reach the card.
 *
 * RULE THREE. It says what the day is stored as and that no run is prescribed.
 * It does not invent a session and it does not scold.
 */
export function cardForUnprescribableType(input: {
  /** The raw `plan_workouts.type`, unnarrowed — this is what we cannot name. */
  rawType: string | null;
  subLabel?: string | null;
}): SpecCard {
  const raw = (input.rawType ?? '').trim().toLowerCase();
  const named = raw ? raw.replace(/_/g, ' ') : null;
  return {
    type: 'rest',
    headline: 'No run today',
    why: named
      ? `The plan has this day down as ${named}. There is no run prescribed for it.`
      : 'The plan has no run down for this day.',
    citation: '',
    selectionRationale: null,
    steps: [{
      label: 'Today',
      note: 'Nothing to run. The week counts it as a day off the road.',
    }],
    total_mi: 0,
    workPaceSPerMi: null,
    workToleranceSPerMi: null,
    totalDurationSec: null,
    hasRacePaceFinish: false,
    basis: 'row',
  };
}

export function cardWithoutSpec(input: {
  type: WorkoutType;
  subLabel?: string | null;
  distanceMi: number;
  /** `plan_workouts.pace_target_s_per_mi` — a real stored number when present. */
  paceTargetSPerMi?: number | null;
  hr?: { z1: string | null; z2: string | null; z3: string | null; z4: string | null; z5: string | null } | null;
}): SpecCard {
  const { type, distanceMi, paceTargetSPerMi, hr } = input;
  const rationale = sessionRationale(type);
  const total = Number.isFinite(distanceMi) && distanceMi > 0 ? roundTo(distanceMi, 1) : 0;

  if (type === 'rest') {
    return {
      type, headline: rationale.headline, why: rationale.why, citation: rationale.citation,
      selectionRationale: null,
      total_mi: 0, workPaceSPerMi: null, workToleranceSPerMi: null, totalDurationSec: null,
      hasRacePaceFinish: false, basis: 'row',
      steps: [{ label: 'Today', note: 'No running. Sleep, mobility, fuel.' }],
    };
  }

  const paceStr = fmtPace(paceTargetSPerMi);
  const zone =
    type === 'intervals' ? hr?.z5 ?? null
    : type === 'threshold' ? hr?.z4 ?? null
    : type === 'tempo' || type === 'long' || type === 'race' ? hr?.z3 ?? null
    : hr?.z2 ?? null;

  const isQuality = type === 'threshold' || type === 'intervals' || type === 'tempo';
  const steps: PrescriptionStep[] = total > 0
    ? [{
        label: 'Run',
        distance_mi: total,
        ...(paceStr ? { pace_target: paceStr } : {}),
        ...(zone ? { hr_target: zone } : {}),
        note: isQuality
          // Coach voice: says what is missing, does not apologise for it and
          // does not scold the runner for a gap in our own data.
          ? 'This day has no stored breakdown, so there is no rep set to show. Run the distance at the effort above.'
          : paceStr
            ? 'Steady at the target above.'
            : 'By feel. No pace stored for this day.',
      }]
    : [];

  const stored = (input.subLabel ?? '').trim();
  const headline = stored && stored.toUpperCase() !== stored ? stored : rationale.headline;

  return {
    type, headline, why: rationale.why, citation: rationale.citation,
    selectionRationale: null,
    steps, total_mi: total, workPaceSPerMi: paceTargetSPerMi ?? null, workToleranceSPerMi: null,
    totalDurationSec: null, hasRacePaceFinish: false, basis: 'row',
  };
}
