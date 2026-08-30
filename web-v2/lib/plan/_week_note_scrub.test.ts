/**
 * CITESCRUB-1 · the runner never reads a Research/ reference.
 *
 * `plan_workouts.notes` is authored with the engine's citation attached and,
 * since 2026-08-21, is read as `dayNote` on GET /api/v5/today. 626 rows in
 * prod carried one at the time this was written.
 *
 * Every INPUT string below is a verbatim `notes` value read out of the live
 * plan_workouts table on 2026-08-30 — not invented. A fixture that made up
 * its own citation shapes would prove only that the scrub handles the shapes
 * the test author imagined, and the defect this guards against is precisely
 * that the real strings were never checked.
 */
import { describe, it, expect } from 'vitest';
import { stripResearchCitations } from './strip-citations';

/** Mirrors week-loader's `dayNoteFor`. Kept in step by the last test here. */
function dayNoteFor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const scrubbed = stripResearchCitations(raw).trim();
  return scrubbed.length > 0 ? scrubbed : null;
}

/** Verbatim from prod, 2026-08-30. */
const REAL_NOTES: string[] = [
  'Dress rehearsal · Research/04 §4.6. Steady 8mi, then 3mi at marathon pace. Race kit, race breakfast, race fuelling. Controlled effort, not a fitness test.',
  'Sub-threshold / Norwegian intervals · Research/04 §5.4.',
  'Short hill repeats · Research/04 §8.2. Run the climb by effort, not pace. Jog down, full recovery, repeat.',
  'Continuous tempo · Research/04 §5.2. Single block, no recovery.',
  'Cruise intervals · Research/04 §5.3.',
  'Conversational throughout. Build the engine. Course drops 304 ft. Run at least 60% of this on downhill-similar terrain · Research/11 §net-downhill adjustments.',
  'Mona fartlek · Research/04 §9.2. Continuous run. Surge, float, surge. The float is a jog, not a stop.',
  'Lydiard hill circuit · Research/04 §8.5. Run the climb by effort, not pace. Jog down, full recovery, repeat.',
  '1K cutdowns · Research/04 §12.3. Start controlled. Each rep a little faster. The last one is the point.',
  // The two shapes that broke the original scrub, kept as regressions:
  // a NUMBERED section with a dot, and a mixed-case multi-word NAMED section.
  'Downhill repeats · Research/04 §Eccentric Loading Protocol for Downhill-Heavy Races. Run the climb by effort, not pace.',
  'Comeback protocol per Research/22 §14.',
];

describe('CITESCRUB-1 · plan day notes reach the runner without citations', () => {
  it('no real prod note keeps a Research/ reference', () => {
    for (const raw of REAL_NOTES) {
      const out = dayNoteFor(raw);
      expect(out ?? '', `citation survived in: ${raw}`).not.toMatch(/Research\//);
    }
  });

  it('leaves no wreckage behind — the original bug passed an absence-only check', () => {
    // The scrub that shipped before 2026-08-30 turned "Cruise intervals ·
    // Research/04 §5.3." into "Cruise intervals.3." — which contains no
    // "Research/" and so satisfied the test above while corrupting the
    // sentence. Assert the SHAPE of the result, not just what is missing.
    for (const raw of REAL_NOTES) {
      const out = dayNoteFor(raw) ?? '';
      expect(out, `stranded section number in: ${out}`).not.toMatch(/[a-z]\.[0-9]/);
      expect(out, `dangling separator in: ${out}`).not.toMatch(/·\s*[.!?]|·\s*$/);
      expect(out, `double space in: ${out}`).not.toMatch(/\s{2,}/);
      expect(out, `leading punctuation in: ${out}`).not.toMatch(/^[.,;:·]/);
      expect(out.length, `scrub emptied: ${raw}`).toBeGreaterThan(0);
    }
  });

  it('the coaching sentence survives the scrub — this is not a blanket delete', () => {
    // The whole point is losing the reference and KEEPING the instruction.
    expect(dayNoteFor(REAL_NOTES[0])).toContain('Race kit, race breakfast, race fuelling');
    expect(dayNoteFor(REAL_NOTES[2])).toContain('Run the climb by effort, not pace');
    expect(dayNoteFor(REAL_NOTES[5])).toContain('Course drops 304 ft');
    expect(dayNoteFor(REAL_NOTES[8])).toContain('The last one is the point');
  });

  it('an absent or blank note becomes null rather than an empty bubble', () => {
    expect(dayNoteFor('   ')).toBeNull();
    expect(dayNoteFor(null)).toBeNull();
    expect(dayNoteFor(undefined)).toBeNull();
  });

  it('a citation-led note keeps its prose rather than vanishing', () => {
    // stripResearchCitations deliberately never returns empty for non-empty
    // input: rule 1 drops a citation-led SENTENCE, and if that would empty the
    // string it falls back to a blunt reference-only removal. So the surviving
    // prose is kept even though the sentence opened with the reference.
    //
    // Verified against prod on 2026-08-30: ZERO plan_workouts notes begin with
    // "Research/", so this path is defensive rather than load-bearing. It is
    // asserted anyway to pin the behaviour, because the alternative — silently
    // returning null and blanking a day's note — is the worse failure.
    expect(dayNoteFor('Research/04 §5.4 is the source.')).toBe('is the source.');
  });

  it('is idempotent and byte-identical on a note that never had a citation', () => {
    const clean = 'Conversational. Z2 HR cap.';
    expect(dayNoteFor(clean)).toBe(clean);
    expect(dayNoteFor(dayNoteFor(clean))).toBe(clean);
    const once = dayNoteFor(REAL_NOTES[1]);
    expect(dayNoteFor(once)).toBe(once);
  });

  it('week-loader still routes notes through the scrub', async () => {
    // Guards the wiring, not the helper: a future edit that reverts line
    // `notes: dayNoteFor(...)` back to `notes: r?.notes ?? null` would leave
    // every test above passing while shipping citations again.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./week-loader.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/notes:\s*dayNoteFor\(/);
    expect(src).not.toMatch(/notes:\s*r\?\.notes\s*\?\?\s*null/);
  });
});
