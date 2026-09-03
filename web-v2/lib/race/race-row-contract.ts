/**
 * lib/race/race-row-contract.ts · A REFRESH UPDATES THE COMPLETE WORKOUT
 * CONTRACT, OR IT UPDATES NOTHING.
 *
 * ROW-CONTRACT-1 (2026-09-02), and it is a CLASS, not four bugs. The owner's
 * words: *"A refresh must update the complete workout contract atomically, not
 * one number inside an incompatible structure."*
 *
 * `race-row-refresh` moved `pace_target_s_per_mi` with the evidence and left
 * every other field describing the pace it replaced. Four instances, all
 * measured on his live plan on 2026-09-02:
 *
 *   · Santa Monica read "Coach target 7:24/mi" in prose over a row at 6:56/mi.
 *   · Run Malibu, freshly rebuilt, read "Target 6:52/mi" over a row at 7:02.
 *   · The 12-01 race-week tune-up was repriced to 7:23/mi, the marathon's
 *     execution pace, while its reps stayed at 6:41 and its label still said
 *     "5×400m @ 5K pace".
 *   · The same pass put a race's mid-race abort — "Mile 2 check: pace slower
 *     than 7:45/mi · switch to the B plan" — onto that 4.5-mile interval
 *     session, priced off a target that was not even the session's pace.
 *
 * Each was individually explicable. Together they are one shape: a row is a
 * CONTRACT between a number, a structure and a sentence, and a writer that
 * updates one part of it has not made the row current, it has made the row
 * incoherent. An incoherent row is worse than a stale one, because a stale row
 * is at least a plan somebody could run.
 *
 * ── WHAT THIS FILE IS ────────────────────────────────────────────────────
 *
 * The checker, and nothing else. `raceRowContractViolations` takes a row as it
 * would stand AFTER a write and names every disagreement inside it. It has no
 * database, no clock and no opinion about what the pace should be: it only
 * asks whether every field on the row is describing the SAME pace, the SAME
 * distance and the SAME kind of session.
 *
 * That is deliberate, and it is what makes it survive the next change. A gate
 * that pinned today's numbers — 443 for CIM, 435 for the Dodgers — would fail
 * the moment the race-pace brain learns to price a C race differently from an
 * A race, which is a change already in flight. A gate that asserts *the prose
 * names the number the row carries* does not care what the number becomes.
 *
 * ── WHERE IT RUNS ────────────────────────────────────────────────────────
 *
 *   · `race-row-refresh` runs it on the contract it has just built, BEFORE the
 *     UPDATE. Violations refuse that row by name (Rule 11) rather than writing
 *     a row that contradicts itself. This is the atomicity the rule asks for:
 *     the whole contract lands or none of it does.
 *   · `_race_row_coherence_gate.test.ts` runs it over the production path.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * It cannot fail because a pace is WRONG. It has no answer key and it never
 * will: whether 7:23/mi is the right marathon target is the race-pace brain's
 * question, and this file would happily pass a row that was coherently
 * nonsense. It cannot see a field it does not know about, so a new spec key
 * that restates a pace needs a check adding here. And it cannot see prose that
 * states a pace in words rather than digits ("run it at threshold"), because
 * `paceTokensSecPerMi` reads digits.
 */
import { raceCheckpointMi, racePaceAbortRule } from '@/lib/race/distance-doctrine';
import { RACE_EXECUTION_BAND_S_PER_MI } from '@/lib/race/race-outlook';
import { paceTokensSecPerMi } from '@/lib/race/race-row-note';
import { fmtPaceSlash } from '@/lib/format/run';

/** The row as a checker sees it. Column names, not camel case, because this is
 *  what `plan_workouts` holds and a translation layer is a place to lose a
 *  field. */
export interface RaceRowContractView {
  /** `plan_workouts.type`. Only 'race' may carry race-day execution fields. */
  type: string;
  /** The ROW's own distance, not the race's. They differ on a tune-up, and
   *  that difference is the whole of violation 6. */
  distanceMi: number | null;
  paceTargetSecPerMi: number | null;
  spec: Record<string, unknown> | null;
  notes: string | null;
  subLabel: string | null;
}

export interface ContractViolation {
  code:
    | 'PROSE_NAMES_ANOTHER_PACE'
    | 'LABEL_NAMES_ANOTHER_PACE'
    | 'HEADLINE_DISAGREES_WITH_REPS'
    | 'BAND_NOT_CENTRED_ON_TARGET'
    | 'ABORT_PRICED_OFF_ANOTHER_TARGET'
    | 'RACE_ONLY_FIELD_ON_A_NON_RACE_ROW'
    | 'EXECUTION_BLOCK_DISAGREES_WITH_COLUMN'
    | 'HR_GUIDANCE_FOR_ANOTHER_DISTANCE';
  detail: string;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** One pace formatter for the whole app, so a violation message and the screen
 *  it is about read the same string (lib/format/run.ts). */
const fmt = (s: number | null): string => fmtPaceSlash(s) ?? 'none';

/** Fields only a race day may carry. A tune-up that holds them is describing
 *  a different session on a different day at a different distance.
 *
 *  Deliberately the two that were MEASURED wrong and no more. `fuel_mi` is
 *  arguably in the same family and is left out: nothing has been observed
 *  putting a race's gel ladder on a tune-up, and a list written from suspicion
 *  rather than evidence is how an allowlist starts growing. */
const RACE_ONLY_SPEC_KEYS = ['race_execution', 'race_hr'] as const;

/**
 * Every disagreement inside one row. Empty means coherent, which is a
 * different and weaker claim than "correct" — see the header.
 */
export function raceRowContractViolations(row: RaceRowContractView): ContractViolation[] {
  const v: ContractViolation[] = [];
  const spec = row.spec ?? {};
  const target = row.paceTargetSecPerMi;
  const isRace = row.type === 'race';

  // 1 · THE PROSE NAMES THE NUMBER THE ROW CARRIES.
  //     The Santa Monica defect, and the one the runner actually reads.
  for (const p of paceTokensSecPerMi(row.notes)) {
    if (target == null || p !== target) {
      v.push({
        code: 'PROSE_NAMES_ANOTHER_PACE',
        detail: `notes state ${fmt(p)}; the row prescribes ${fmt(target)}`,
      });
    }
  }

  // 2 · SO DOES THE LABEL. A sub-label may name a ZONE ("@ 5K pace") — that is
  //     a name, not a number, and it stays a name. A DIGIT in the label is a
  //     second statement of the target and must agree with it.
  for (const text of [row.subLabel, typeof spec.label === 'string' ? spec.label : null]) {
    for (const p of paceTokensSecPerMi(text)) {
      if (target == null || p !== target) {
        v.push({
          code: 'LABEL_NAMES_ANOTHER_PACE',
          detail: `label states ${fmt(p)}; the row prescribes ${fmt(target)}`,
        });
      }
    }
  }

  // 3 · THE HEADLINE IS THE STRUCTURE'S OWN PACE.
  //     `buildWorkoutSpec` returns `paceTargetSPerMi: repPace` for every
  //     rep-shaped session, so an untouched row satisfies this by
  //     construction. The 12-01 tune-up failed it because the refresh moved
  //     one side. Either both move or neither does.
  const repPace = num(spec.rep_pace_s_per_mi);
  if (repPace != null && target != null && repPace !== target) {
    v.push({
      code: 'HEADLINE_DISAGREES_WITH_REPS',
      detail: `reps run at ${fmt(repPace)}; the row's headline pace is ${fmt(target)}`,
    });
  }

  // 4 · THE EXECUTION BAND IS CENTRED ON THE TARGET.
  const lo = num(spec.pace_target_s_per_mi_lo);
  const hi = num(spec.pace_target_s_per_mi_hi);
  if ((lo != null || hi != null) && target != null) {
    if (lo !== target - RACE_EXECUTION_BAND_S_PER_MI || hi !== target + RACE_EXECUTION_BAND_S_PER_MI) {
      v.push({
        code: 'BAND_NOT_CENTRED_ON_TARGET',
        detail: `band ${fmt(lo)}-${fmt(hi)} is not ${RACE_EXECUTION_BAND_S_PER_MI}s either side of ${fmt(target)}`,
      });
    }
  }

  // 5 · EVERY PACE ABORT IS PRICED OFF THIS ROW'S TARGET AND THIS ROW'S
  //     DISTANCE. `racePaceAbortRule` is the owner of both halves, so the
  //     check re-derives through it rather than restating 1.05 or the
  //     checkpoint table (Rule 18: a check that hardcodes both sides only
  //     proves it agrees with itself).
  const rules = Array.isArray(spec.rules) ? (spec.rules as Array<Record<string, unknown>>) : [];
  const expectedAbort = racePaceAbortRule({ distanceMi: row.distanceMi, targetPaceSecPerMi: target });
  for (const r of rules) {
    if (r?.kind !== 'abort' || r?.metric !== 'pace') continue;
    if (!isRace) {
      v.push({
        code: 'RACE_ONLY_FIELD_ON_A_NON_RACE_ROW',
        detail: `a mid-race pace abort ("${String(r.label ?? '')}") stands on a ${row.type} row`,
      });
      continue;
    }
    if (expectedAbort == null || num(r.value) !== expectedAbort.value || r.scope !== expectedAbort.scope) {
      v.push({
        code: 'ABORT_PRICED_OFF_ANOTHER_TARGET',
        detail: `abort "${String(r.label ?? '')}" (${String(r.scope)} @ ${fmt(num(r.value))}) is not `
          + `${expectedAbort ? `${expectedAbort.scope} @ ${fmt(expectedAbort.value)}` : 'derivable'} `
          + `for ${row.distanceMi ?? '?'} mi at ${fmt(target)}`,
      });
    }
  }

  // 6 · RACE-DAY FIELDS ONLY ON A RACE DAY.
  //     `race_hr` on the 12-01 tune-up carried the MARATHON's band — 148-160
  //     bpm, ceiling through mile 10 — on a 4.5-mile session of 400s. Not one
  //     of those numbers was about the session it was attached to.
  if (!isRace) {
    for (const k of RACE_ONLY_SPEC_KEYS) {
      if (spec[k] != null) {
        v.push({
          code: 'RACE_ONLY_FIELD_ON_A_NON_RACE_ROW',
          detail: `${k} stands on a ${row.type} row`,
        });
      }
    }
  }

  // 7 · THE EXECUTION BLOCK AND THE COLUMN ARE ONE QUANTITY.
  const exec = (spec.race_execution ?? null) as Record<string, unknown> | null;
  if (exec != null) {
    const execPace = num(exec.target_pace_s_per_mi);
    if (execPace !== target) {
      v.push({
        code: 'EXECUTION_BLOCK_DISAGREES_WITH_COLUMN',
        detail: `race_execution.target_pace_s_per_mi ${fmt(execPace)} against column ${fmt(target)}`,
      });
    }
  }

  // 8 · THE HR GUIDANCE IS FOR THIS ROW'S DISTANCE.
  const hr = (spec.race_hr ?? null) as Record<string, unknown> | null;
  if (hr != null && row.distanceMi != null && row.distanceMi > 0) {
    const expectedCheckpoint = raceCheckpointMi(row.distanceMi);
    if (num(hr.checkpoint_mi) !== expectedCheckpoint) {
      v.push({
        code: 'HR_GUIDANCE_FOR_ANOTHER_DISTANCE',
        detail: `race_hr.checkpoint_mi ${String(hr.checkpoint_mi)} against mile `
          + `${expectedCheckpoint} for a ${row.distanceMi} mi row`,
      });
    }
  }

  return v;
}

/** One line, for a log or a refusal reason. */
export function describeViolations(v: readonly ContractViolation[]): string {
  return v.map((x) => `${x.code}: ${x.detail}`).join(' · ');
}
