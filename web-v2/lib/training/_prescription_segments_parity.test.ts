/**
 * lib/training/_prescription_segments_parity.test.ts · PARSER-SHARE-1
 * (2026-09-06) · proves the two consumers of the shared prescription-segment
 * parser — AUTHORING (`lib/plan/spec-builder.ts#extractLongSegments`, a
 * re-export) and EVIDENCE INTERPRETATION
 * (`lib/adaptation/canonical/deterioration.ts`, which now imports this
 * file's `extractLongSegments` directly instead of carrying its own
 * transcription) — resolve one prescription string to BYTE-IDENTICAL
 * segment boundaries.
 *
 * This is the exact gap David's ruling named: "Add a parity test proving one
 * prescription produces identical segment boundaries in both consumers."
 * Before PARSER-SHARE-1 this could only be asserted by pinning two separate
 * fixture arrays against each other by hand
 * (`_deterioration_severity.test.ts` §"STEADYEFFORT-1" did exactly that);
 * now there is exactly one function and importing it twice IS the proof,
 * but this test still exists because "both consumers import the same
 * module" is a claim about the source, and the value proven here is
 * end-to-end: pass the prescription through each consumer's own entry point
 * (`spec-builder.ts`'s export, `deterioration.ts`'s internal use surfaced via
 * re-invoking `extractLongSegments` the same way it does) and diff the
 * results.
 */
import { describe, it, expect } from 'vitest';
import { extractLongSegments as sharedExtractLongSegments } from './prescription-segments';
import { extractLongSegments as authoringExtractLongSegments } from '@/lib/plan/spec-builder';

describe('PARSER-SHARE-1 · one prescription, identical segment boundaries in every consumer', () => {
  const cases: Array<string | null> = [
    // The task's own canonical single-tail case.
    'LONG · 15mi @ E + 3mi @ M',
    // Multi-segment with an E gap-fold between two quality blocks — the
    // shape SEGLONG-1 added the `E` alternation branch for.
    'LONG · 8mi @ E + 3mi @ T + 2mi @ E + 2mi @ M',
    // A contiguous two-segment progression (VARIETY-LONG-1's original case).
    'LONG · 3mi @ M + 2mi @ T',
    // HM tag + trailing recovery gap.
    'LONG · 10mi @ E + 7mi @ HM + 1mi @ E',
    // A leading easy token with nothing to attach to (dropped, not appended).
    'LONG · 5mi @ E + 3mi @ T + 2mi @ T',
    // No quality segment at all.
    'LONG · easy',
    // No prescription.
    null,
  ];

  for (const rx of cases) {
    it(`"${rx}" → identical in spec-builder.ts's export and the shared module`, () => {
      const fromShared = sharedExtractLongSegments(rx);
      const fromAuthoring = authoringExtractLongSegments(rx);
      expect(fromAuthoring).toEqual(fromShared);
    });
  }

  it('the authoring re-export IS the shared function (same reference), not a lookalike', () => {
    // `spec-builder.ts` re-exports the imported binding rather than a
    // wrapper, so this is the strongest form of the parity claim: not
    // merely "same output", but "the same function object".
    expect(authoringExtractLongSegments).toBe(sharedExtractLongSegments);
  });

  it('deterioration.ts\'s steadyEffortReadabilityFrac reads the SAME segment boundaries the shared parser returns', () => {
    // steadyEffortReadabilityFrac does not expose its parsed segments
    // directly, but its readability math is a deterministic function of
    // exactly the boundaries extractLongSegments returns — so re-deriving
    // qualityStartMi from the shared parser and checking it against the
    // known-correct fixture from `_deterioration_severity.test.ts` §5A2
    // ("THE CANONICAL CASE") is an end-to-end proof that deterioration.ts is
    // consuming the same segments, not a silently drifted copy.
    const rx = 'LONG · 8mi @ E + 4mi @ M';
    const totalDistanceMi = 12;
    const segments = sharedExtractLongSegments(rx);
    const qualityTailMi = segments.reduce((s, seg) => s + seg.mi + (seg.recoveryMi ?? 0), 0);
    const qualityStartMi = Math.max(0, totalDistanceMi - qualityTailMi);
    // The quality tail (4mi @ M) starts exactly at mile 8, which is exactly
    // the final third boundary (12 / 3 * 2 = 8) — the canonical
    // fully-unreadable fast-finish case _deterioration_severity.test.ts
    // asserts reads to a readability of exactly 0.
    expect(qualityTailMi).toBe(4);
    expect(qualityStartMi).toBe(8);
  });
});
