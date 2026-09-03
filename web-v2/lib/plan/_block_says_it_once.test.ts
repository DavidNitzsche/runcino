/**
 * THE CLASS · THE SAME SENTENCE PRINTED TWICE ON ONE SCREEN (Rule 17).
 *
 * Not one screen. The catalogue in CLAUDE.md is long: a 20-word downhill
 * instruction on every long run, eleven times in one block; the pace-ramp
 * legend twice on one screen; average heart rate three times on Today; six
 * duplicate coach-log cards for one week. The Block screen is the newest
 * instance and it has the cleanest shape, which is why it is the one worth
 * gating: ONE sentence writer, `composeCoachLine`, called twice with different
 * `addressedThisWeek` flags, so the second output is a SUPERSET of the first
 * by construction rather than by coincidence.
 *
 * Measured on production 2026-09-03 as `faff_readonly`, reference runner
 * `0645f40c-951d-4ccc-b86e-9979cd26c795`, active plan `pln_9a57561debb776e5`,
 * phase QUALITY, limiter DURABILITY on CURVE_SHAPE_EVIDENCE. `BlockV5.swift`
 * draws `model.coachLine` at :277 and `model.thesis.coachLine` at :302, inside
 * one "Where this goes" section, and they were:
 *
 *   "Your races fade with distance faster than your speed predicts, so
 *    durability is where the work goes. Your threshold holds."
 *   "Your races fade with distance faster than your speed predicts, so
 *    durability is where the work goes. Your threshold holds, and this week's
 *    long run is the session that builds it."
 *
 * Twenty-two words twice; eleven words of new information.
 *
 * ── WHY THE CHECK IS ON THE RENDERED TEXT ───────────────────────────────────
 *
 * Rule 17 is explicit: "it yields on the rendered text, not on a row id,
 * because that is what the runner actually sees." A flag saying "the thesis
 * already went out" would keep agreeing with itself while the two strings
 * drifted. The suppression compares normalised text, both directions, and so
 * does this gate.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · Two sentences that SAY the same thing in different words. Containment is
 *     a syntactic test. A composer that paraphrased itself would pass.
 *   · Any other pair of strings on the Block screen. This watches the coach
 *     line and the thesis line, which are the pair that share a writer.
 *   · Whether the phone actually draws them. This reaches the wire.
 *     `BlockV5.swift:302`'s `!isEmpty` guard is asserted by reading the Swift,
 *     not by rendering it — stated plainly rather than claimed as verified.
 *   · The reverse defect: a screen that now says NOTHING. The third block
 *     below is the half that catches it, and it is why `reviewTrigger` is
 *     asserted to survive.
 */
import { describe, it, expect } from 'vitest';
import { suppressThesisLineIfBlockAlreadySaidIt } from './v5-block';
import type { ThesisWire } from '@/lib/training/coaching-thesis';

/** Verbatim from `loadV5Block` against production, 2026-09-03. */
const BLOCK_LINE =
  'Your races fade with distance faster than your speed predicts, so durability '
  + 'is where the work goes. Your threshold holds.';

const THESIS_LINE =
  'Your races fade with distance faster than your speed predicts, so durability '
  + "is where the work goes. Your threshold holds, and this week's long run is "
  + 'the session that builds it.';

const REVIEW_TRIGGER =
  'This gets revisited when a new race result lands, or when a long race or a '
  + 'race-pace long run shows your pace holding with distance.';

const wire = (coachLine: string): ThesisWire => ({
  limiter: 'DURABILITY',
  priority: 'increase_long_run_demand',
  confidence: 0.513,
  coachLine,
  reviewTrigger: REVIEW_TRIGGER,
});

describe('the fixture still holds the defect (liveness · Rule 18.2)', () => {
  it('the thesis line really is a superset of the block line', () => {
    // If this stops being true the fixture has drifted from what the composer
    // emits and every assertion below is measuring nothing.
    expect(THESIS_LINE.length).toBeGreaterThan(BLOCK_LINE.length);
    expect(THESIS_LINE.startsWith(BLOCK_LINE.slice(0, -1))).toBe(true);
  });
});

describe('the block screen says the durability sentence once', () => {
  it('drops the thesis line when the block line already carried it', () => {
    const out = suppressThesisLineIfBlockAlreadySaidIt(wire(THESIS_LINE), BLOCK_LINE);
    expect(out?.coachLine).toBe('');
  });

  it('suppresses in the other direction too', () => {
    // Which of the two is longer is a property of `composeCoachLine`'s
    // branches, not an invariant this function may assume.
    const out = suppressThesisLineIfBlockAlreadySaidIt(wire(BLOCK_LINE), THESIS_LINE);
    expect(out?.coachLine).toBe('');
  });

  it('ignores punctuation and case, because the runner does', () => {
    const out = suppressThesisLineIfBlockAlreadySaidIt(
      wire(THESIS_LINE.toUpperCase().replace(/\./g, ' —')),
      BLOCK_LINE,
    );
    expect(out?.coachLine).toBe('');
  });
});

describe('it does NOT silence the screen (Rule 22 · the opposite verdict)', () => {
  it('keeps the review trigger, which lives on this screen and nowhere else', () => {
    const out = suppressThesisLineIfBlockAlreadySaidIt(wire(THESIS_LINE), BLOCK_LINE);
    expect(out?.reviewTrigger).toBe(REVIEW_TRIGGER);
    expect(out?.limiter).toBe('DURABILITY');
    expect(out?.confidence).toBe(0.513);
  });

  it('keeps a thesis line that says something the block line did not', () => {
    const different = 'Threshold is where the work goes. Your durability holds.';
    const out = suppressThesisLineIfBlockAlreadySaidIt(wire(different), BLOCK_LINE);
    expect(out?.coachLine).toBe(different);
  });

  it('keeps the thesis line when the block has no line at all', () => {
    // `blockCoachLine` returns null on a taper, a race week and an ended
    // block. Suppressing then would leave the section empty.
    const out = suppressThesisLineIfBlockAlreadySaidIt(wire(THESIS_LINE), null);
    expect(out?.coachLine).toBe(THESIS_LINE);
  });

  it('an empty thesis line is left alone rather than treated as contained', () => {
    // '' is a substring of everything. Without the guard this would report a
    // duplicate on every block that has no thesis sentence.
    const out = suppressThesisLineIfBlockAlreadySaidIt(wire(''), BLOCK_LINE);
    expect(out?.coachLine).toBe('');
    expect(out?.reviewTrigger).toBe(REVIEW_TRIGGER);
  });

  it('a null thesis stays null', () => {
    expect(suppressThesisLineIfBlockAlreadySaidIt(null, BLOCK_LINE)).toBeNull();
  });
});
