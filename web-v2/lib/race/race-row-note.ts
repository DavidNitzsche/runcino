/**
 * lib/race/race-row-note.ts · THE TARGET SENTENCE ON A RACE ROW, AND ITS ONE
 * OWNER.
 *
 * ROW-CONTRACT-1 (2026-09-02). `plan_workouts.notes` is prose, and it is the
 * only place a race row states its purpose in words. It reaches the runner as
 * the Today card's `why` line. `embedMidBlockRaces` writes it at authoring and
 * appends the target pace to it; `race-row-refresh` then moves
 * `pace_target_s_per_mi`, the execution band, `race_execution.target_sec` and
 * the pace abort with the evidence, and never touched the sentence.
 *
 * Measured on the owner's live plan 2026-09-02: the Santa Monica row read
 * "Coach target 7:24/mi" over a row prescribing 6:56/mi. Twenty-eight seconds
 * a mile, 2:54 across a 10K, on one row, in the one field he actually reads on
 * the morning of the race.
 *
 * That is Rule 16 (one quantity, one name) and Rule 10 (a persisted derived
 * value carries its anchor, or it is recomputed) in the same sentence. The
 * value is recomputed, here, by whichever writer moves the number.
 *
 * TWO FUNCTIONS AND A DELIBERATE OMISSION. `raceTargetSentence` composes it,
 * `repriceRaceNote` replaces the one that is there. Neither INVENTS a sentence
 * on a note that has none: the block's own race-day row reads "Execute the
 * plan. Pacing in race-week briefing." on purpose, and adding a pace to it
 * would be a product change wearing a coherence fix's clothes. The invariant
 * this file exists to hold is narrower and checkable: IF the prose names a
 * pace, that pace is the one on the row.
 */
import { fmtPaceSlash } from '@/lib/format/run';

/**
 * Whose number is this. The canonical answer is the outlook's own
 * `execution.source`: a target that IS the runner's stated goal is theirs, and
 * anything the runway bounded or the projection set is the coach's. Authoring
 * asks the same question through `race.goalPaceIsCoachSet` and reaches the
 * same answer, which is why both call this file rather than each writing a
 * sentence of their own.
 */
export type RaceTargetVoice = 'runner' | 'coach';

/** The two shapes, and there are only two. Kept as one expression so a change
 *  to either lands on the authoring path and the refresh path together. */
export function raceTargetSentence(
  paceSecPerMi: number | null | undefined,
  voice: RaceTargetVoice,
): string | null {
  const paceStr = fmtPaceSlash(paceSecPerMi);
  if (paceStr == null) return null;
  return voice === 'coach'
    ? `Coach target ${paceStr}, set from your current fitness. Yours to change.`
    : `Target ${paceStr}.`;
}

/**
 * The sentence, wherever it sits in the note, in either voice.
 *
 * Anchored on the words rather than on position, because the sentence BEFORE
 * it is the race's purpose and that sentence is not this file's to own — a
 * separate change is making role and priority shape it. Matching on shape
 * means the target clause keeps repricing correctly no matter how the purpose
 * text moves.
 */
const TARGET_SENTENCE_SOURCE =
  '\\s*(?:Coach target \\d+:\\d{2}\\/mi, set from your current fitness\\. Yours to change\\.|Target \\d+:\\d{2}\\/mi\\.)';

/** A fresh regex per call. A module-scoped /g regex carries `lastIndex`
 *  between calls, which is how a shared matcher starts skipping every second
 *  row it is asked about. */
const targetSentenceRe = () => new RegExp(TARGET_SENTENCE_SOURCE, 'g');

/** True when the note already states a target pace. */
export function hasRaceTargetSentence(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return targetSentenceRe().test(notes);
}

/** Remove it. Idempotent, and a no-op on a note that never had one. */
export function stripRaceTargetSentence(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes.replace(targetSentenceRe(), '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Reprice the note to a new pace.
 *
 * Returns null when there is nothing to do — no note, no target sentence in
 * it, or the sentence already says this pace — so a caller can tell "left
 * alone" from "rewritten" and the refresh can report `unchanged` honestly
 * (Rule 11).
 */
export function repriceRaceNote(
  notes: string | null | undefined,
  paceSecPerMi: number | null | undefined,
  voice: RaceTargetVoice,
): string | null {
  if (!notes || !hasRaceTargetSentence(notes)) return null;
  const sentence = raceTargetSentence(paceSecPerMi, voice);
  // Rule 11 · a target we cannot state is not a reason to leave a stale one
  // standing. Drop the sentence rather than keep a number the brain has
  // abandoned; the row's own pace column is refused in the same breath.
  const next = sentence == null
    ? stripRaceTargetSentence(notes)
    : `${stripRaceTargetSentence(notes)} ${sentence}`.trim();
  return next === notes.trim() ? null : next;
}

/**
 * Every pace this prose states, in s/mi. The coherence gate's eyes: a note
 * that names a pace the row does not carry is the defect, whatever sentence it
 * arrived in.
 */
export function paceTokensSecPerMi(text: string | null | undefined): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const m of text.matchAll(/(\d+):(\d{2})\s*\/\s*mi/g)) {
    out.push(Number(m[1]) * 60 + Number(m[2]));
  }
  return out;
}
