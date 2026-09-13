/**
 * lib/race/_race_row_note_format_migration.test.ts · NATURAL-COACHING-2.
 *
 * `race-row-note.ts`'s `TARGET_SENTENCE_SOURCE` regex is what
 * `hasRaceTargetSentence` / `stripRaceTargetSentence` / `repriceRaceNote` all
 * key on. NATURAL-COACHING-1 (2026-09-11) changed the sentence the composer
 * WRITES (dropped the false "Yours to change." claim) but did not widen what
 * the regex RECOGNISES — so a `plan_workouts.notes` row authored before that
 * change, still carrying the literal old sentence, silently stopped being
 * repriceable: `hasRaceTargetSentence` returns false against it, and
 * `repriceRaceNote` no-ops (`unchanged`) instead of ever stripping or
 * replacing the stale text.
 *
 * Found against the owner's own live Santa Monica 10K row, authored under
 * the old format, one day before that race.
 *
 * ── THE FALSIFICATION ────────────────────────────────────────────────────
 *
 * A note carrying the OLD literal sentence ("Coach target 6:55/mi, set from
 * your current fitness. Yours to change.") must still be recognised and
 * correctly repriced to the NEW sentence shape at a new pace. Against the
 * unfixed regex, `hasRaceTargetSentence` on this note returns false and
 * `repriceRaceNote` returns null ("nothing to do") — this test fails on that
 * code, which is how it was confirmed to actually test something.
 *
 * Run: ./node_modules/.bin/vitest run lib/race/_race_row_note_format_migration.test.ts
 */
import { describe, it, expect } from 'vitest';
import { hasRaceTargetSentence, repriceRaceNote, stripRaceTargetSentence } from './race-row-note';

const OLD_NOTE =
  'Santa Monica 10k. B race · race effort. Recovery days follow before quality resumes. '
  + 'Coach target 6:55/mi, set from your current fitness. Yours to change.';

const NEW_NOTE =
  'Santa Monica 10k. Run it at full effort. Recovery comes first, then training continues. '
  + 'Coach target 6:55/mi, based on your current fitness.';

describe('NATURAL-COACHING-2 · a stale, old-format note is still recognised', () => {
  it('hasRaceTargetSentence recognises the OLD "Yours to change." phrasing', () => {
    expect(hasRaceTargetSentence(OLD_NOTE)).toBe(true);
  });

  it('hasRaceTargetSentence still recognises the NEW phrasing (no regression)', () => {
    expect(hasRaceTargetSentence(NEW_NOTE)).toBe(true);
  });

  it('stripRaceTargetSentence removes the OLD sentence cleanly', () => {
    const stripped = stripRaceTargetSentence(OLD_NOTE);
    expect(stripped).not.toMatch(/Coach target|Yours to change/);
    expect(stripped).toMatch(/^Santa Monica 10k\./);
  });

  it('repriceRaceNote replaces an OLD-format sentence with the CURRENT sentence shape at a new pace', () => {
    const next = repriceRaceNote(OLD_NOTE, 415, 'coach'); // 6:55/mi = 415s
    expect(next).not.toBeNull();
    expect(next).not.toMatch(/Yours to change/);
    expect(next).toMatch(/Coach target 6:55\/mi, based on your current fitness\./);
  });

  it('repriceRaceNote on an OLD-format note at the SAME pace still rewrites it to the current format (format drift alone is a material change)', () => {
    // Rule 16: the row's own sentence text is stale even when the number
    // hasn't moved. `repriceRaceNote` must not report `unchanged` just
    // because the pace matches — the ONLY correct current sentence for this
    // pace is the new format, and leaving the old one standing is exactly
    // the bug this file exists to close.
    const next = repriceRaceNote(OLD_NOTE, 415, 'coach');
    expect(next).not.toBeNull();
  });
});
