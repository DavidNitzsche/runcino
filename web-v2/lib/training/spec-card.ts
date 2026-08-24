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
import { sessionRationale, type PrescriptionStep, type WorkoutType } from './prescriptions';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

export interface SpecCard {
  type: WorkoutType;
  headline: string;
  why: string;
  citation: string;
  steps: PrescriptionStep[];
  total_mi: number;
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
function fmtPace(sPerMi: number | null | undefined): string | null {
  if (sPerMi == null || !Number.isFinite(sPerMi) || sPerMi <= 0) return null;
  const m = Math.floor(sPerMi / 60);
  return `${m}:${String(Math.round(sPerMi % 60)).padStart(2, '0')} /mi`;
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
  cooldown: 'Easy jog. Do not skip it, it shortens tomorrow.',
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
} as const;

function repNote(type: WorkoutType, isStride: boolean): string {
  if (isStride) return NOTE.stride;
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
    // Jog recoveries are easy jogging (Research/04 §1). Same anchor the watch
    // passes, so the two surfaces read the same recovery target.
    recoveryPaceSec: easyPaceSec,
    toleranceSec: input.toleranceSec ?? 8,
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
      steps.push({
        label: isWu ? 'Warmup' : p.type === 'cooldown' ? 'Cooldown' : p.label,
        ...(p.distanceMi != null ? { distance_mi: p.distanceMi } : {}),
        ...(p.distanceMi == null && fmtDuration(p.durationSec) ? { duration: fmtDuration(p.durationSec)! } : {}),
        ...(fmtPace(p.targetPaceSPerMi) ? { pace_target: fmtPace(p.targetPaceSPerMi)! } : {}),
        ...(hr?.z1 ? { hr_target: hr.z1 } : {}),
        note: isWu ? NOTE.warmup : p.type === 'cooldown' ? NOTE.cooldown : NOTE.recovery,
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
    const paceStr = fmtPace(w.targetPaceSPerMi);
    const recDur = fmtDuration(t.rec?.durationSec);
    const recPace = fmtPace(t.rec?.targetPaceSPerMi);
    const hrForStep = isStride ? null : workHr;

    if (n > 1) {
      steps.push({
        label: isStride ? 'Strides' : `Repeat ${n}×`,
        reps: n,
        ...(w.distanceMi != null ? { rep_distance_mi: w.distanceMi } : {}),
        // Time-based reps (hills, fartlek surges, Mona) carry no distance. The
        // duration IS the instruction — "90 s hard", Research/04 §9.2 — so it
        // goes in `duration` and the client renders "6 × 1:30".
        ...(w.distanceMi == null && fmtDuration(w.durationSec) ? { duration: fmtDuration(w.durationSec)! } : {}),
        ...(paceStr ? { pace_target: paceStr } : {}),
        ...(hrForStep ? { hr_target: hrForStep } : {}),
        note: repNote(type, isStride),
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
        ...(w.distanceMi != null ? { rep_distance_mi: w.distanceMi } : {}),
        ...(w.distanceMi == null && fmtDuration(w.durationSec) ? { duration: fmtDuration(w.durationSec)! } : {}),
        ...(paceStr ? { pace_target: paceStr } : {}),
        ...(hrForStep ? { hr_target: hrForStep } : {}),
        note: repNote(type, false),
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
        note: isStride ? NOTE.stride : workNote(type, w),
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
  const total = Number.isFinite(distanceMi) && distanceMi > 0 ? Math.round(distanceMi * 10) / 10 : 0;

  // The authored name of the day beats a generic one, and `subLabelFromSpec`
  // is the SAME function that wrote `sub_label` at generation time — so the
  // headline cannot drift from the structure below it even on a row whose
  // stored label is stale.
  const stored = (input.subLabel ?? '').trim();
  const derived = (subLabelFromSpec(spec) ?? '').trim();
  const name = derived || stored;
  const headline = name && name.toUpperCase() !== name ? name : rationale.headline;

  return {
    type,
    headline,
    why: rationale.why,
    citation: rationale.citation,
    steps,
    total_mi: total,
    basis: 'spec',
  };
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
  const total = Number.isFinite(distanceMi) && distanceMi > 0 ? Math.round(distanceMi * 10) / 10 : 0;

  if (type === 'rest') {
    return {
      type, headline: rationale.headline, why: rationale.why, citation: rationale.citation,
      total_mi: 0, basis: 'row',
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
    steps, total_mi: total, basis: 'row',
  };
}
