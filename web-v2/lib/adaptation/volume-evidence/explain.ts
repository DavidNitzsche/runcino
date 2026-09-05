/**
 * lib/adaptation/volume-evidence/explain.ts · STEP 8 · THE RUNNER'S LANGUAGE.
 *
 * The owner gave three example sentences and they are the specification:
 *
 *   "You handled more volume, so upcoming mileage increases."
 *   "The extra mileage counts as evidence, but next week remains a cutback."
 *   "You ran more, but recovery evidence does not support progressing yet."
 *
 * Note what all three have in common: they say what was OBSERVED, then what
 * FOLLOWS, and they never judge. That is the whole brief.
 *
 * ── RULE 17 · THE RUNNER READS A SENTENCE ONCE ────────────────────────────
 *
 * One composer, one sentence, called once from `respond.ts`. The alternative
 * that was written first had each preservation branch author its own line and
 * the caller join them, which produced "next week remains a cutback" up to
 * eleven times in one block, on a plan with eleven cutback weeks. That is the
 * exact defect Rule 17 was locked for: if a surface repeats a sentence per
 * row, the sentence belongs to the block, not the row.
 *
 * ── COACH VOICE ───────────────────────────────────────────────────────────
 *
 * No exclamation marks, no emoji, no em dashes, no hype, no scolding. This
 * directory is outside `check-coach-voice.sh`'s scan (its scope is the
 * surfaces a runner reads today, and nothing renders this yet), so the
 * constraint is held here by `_mileage_responsive.test.ts`, which applies the
 * same character checks to every sentence this file can produce. Rule 20: a
 * rule with no gate is a hypothesis, and "outside the gate's scope" is where
 * 1,804 em dashes came from last time.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ────────────────────────
 *
 * It cannot grade tone. The test checks characters and phrase lists, which is
 * what is mechanical about voice; whether a sentence reads as a coach or as
 * software is a reviewer's judgement and stays one.
 */
import type { PhaseIntent } from './respond';
import type { PreservationReason, SurplusAdmission } from './contract';

export interface ExplainInput {
  readonly admission: SurplusAdmission;
  readonly addedMi: number;
  readonly weeksRaised: number;
  readonly firstRaisedWeekISO: string | null;
  /** What stopped it, when nothing was raised. */
  readonly blockedBy: PreservationReason | null;
  readonly phase: PhaseIntent;
}

const mi = (n: number): string => `${Math.round(n * 10) / 10} miles`;

/**
 * One sentence, or two. Never a paragraph, and never a list of every week.
 */
export function explainVolumeResponse(input: ExplainInput): string {
  /* ── the surplus was not admitted ──────────────────────────────────────── */

  if (!input.admission.admitted) {
    if (input.admission.outcome === 'UNREADABLE') {
      return 'You ran more than the plan asked for. Some of that week could not be read, '
        + 'so it is not being counted as evidence either way yet.';
    }
    const blocking = new Set(input.admission.blocking);
    if (blocking.has('NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY')
      || blocking.has('SUBSEQUENT_TRAINING_SHOWS_ABSORPTION')) {
      return 'You ran more, but recovery evidence does not support progressing yet.';
    }
    if (blocking.has('NO_MATERIAL_DETERIORATION')) {
      return 'You ran more, and the sessions inside that week fell away towards the end. '
        + 'The volume stays where it is until they hold.';
    }
    if (blocking.has('EXECUTION_IDENTITY_TRUSTWORTHY')) {
      return 'You ran more than the plan asked for. Some of those runs could not be tied to '
        + 'a session, so they are not counted as evidence yet.';
    }
    return 'You ran more than the plan asked for. It is recorded, and it does not change '
      + 'the mileage ahead yet.';
  }

  /* ── admitted, and something moved ─────────────────────────────────────── */

  if (input.weeksRaised > 0) {
    const where = input.weeksRaised === 1
      ? 'the next week'
      : `the next ${input.weeksRaised} building weeks`;
    return `You handled more volume, so upcoming mileage increases. `
      + `${mi(input.addedMi)} across ${where}.`;
  }

  /* ── admitted, and nothing moved. Say which fact held it. ──────────────── */

  switch (input.blockedBy) {
    case 'CUTBACK_WEEK':
      return 'The extra mileage counts as evidence, but next week remains a cutback.';
    case 'TAPER_WEEK':
      return 'The extra mileage counts as evidence. The taper stays as written, because it is '
        + 'there to shed fatigue rather than build.';
    case 'RACE_WEEK':
      return 'The extra mileage counts as evidence. Race week stays as written.';
    case 'RECOVERY_BLOCK':
      return 'The extra mileage counts as evidence. This block is recovery, so the mileage '
        + 'stays where it is.';
    case 'SIMULTANEOUS_VOLUME_AND_INTENSITY':
      return 'The extra mileage counts as evidence. The weeks ahead already add a hard session, '
        + 'and mileage and intensity do not go up together. The increase is held for later.';
    case 'SEALED':
      return 'The extra mileage counts as evidence. The weeks ahead are already underway, so '
        + 'nothing changes in them.';
    case 'IN_THE_PAST':
      return 'The extra mileage counts as evidence. There are no future weeks left in this '
        + 'block to change.';
    case 'ALREADY_AT_OR_ABOVE_THE_ENVELOPE':
    default:
      return 'The extra mileage counts as evidence. The weeks ahead are already at what it '
        + 'supports, so they stay as written.';
  }
}

/** Every sentence this file can produce, for the voice gate to walk. */
export function allExplanations(): string[] {
  const admitted: SurplusAdmission = { admitted: true, mi: 4, conditions: [] };
  const phases: PhaseIntent[] = ['BUILD', 'PEAK', 'TAPER', 'RACE_WEEK', 'RECOVERY', 'UNKNOWN'];
  const reasons: (PreservationReason | null)[] = [
    'IN_THE_PAST', 'SEALED', 'CUTBACK_WEEK', 'TAPER_WEEK', 'RACE_WEEK', 'RECOVERY_BLOCK',
    'ALREADY_AT_OR_ABOVE_THE_ENVELOPE', 'SIMULTANEOUS_VOLUME_AND_INTENSITY', null,
  ];
  const out: string[] = [];
  for (const phase of phases) {
    for (const blockedBy of reasons) {
      out.push(explainVolumeResponse({
        admission: admitted, addedMi: 0, weeksRaised: 0, firstRaisedWeekISO: null, blockedBy, phase,
      }));
    }
    for (const weeksRaised of [1, 3]) {
      out.push(explainVolumeResponse({
        admission: admitted, addedMi: 2.4, weeksRaised, firstRaisedWeekISO: '2026-09-07',
        blockedBy: null, phase,
      }));
    }
    for (const outcome of ['NOT_SUPPORTED', 'UNREADABLE'] as const) {
      for (const blocking of [
        [], ['EXECUTION_IDENTITY_TRUSTWORTHY'], ['TELEMETRY_USABLE'],
        ['NO_MATERIAL_DETERIORATION'], ['NO_PAIN_INJURY_OR_UNPLANNED_RECOVERY'],
        ['SUBSEQUENT_TRAINING_SHOWS_ABSORPTION'],
      ] as const) {
        out.push(explainVolumeResponse({
          admission: { admitted: false, outcome, blocking: [...blocking], conditions: [] },
          addedMi: 0, weeksRaised: 0, firstRaisedWeekISO: null, blockedBy: null, phase,
        }));
      }
    }
  }
  return out;
}
