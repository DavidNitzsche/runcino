/**
 * Tests for lib/plan/strip-citations.ts · the runner-facing citation
 * scrub applied at the adapter's write sites (applyAdaptations,
 * writeWorkoutProposals) and defensively at read sites
 * (adaptation-info, coach-log, seed loadPlanAdapts) for rows written
 * before the scrub landed.
 *
 * Fixtures are the REAL why strings adapt.ts writes today — if the
 * adapter's copy changes shape, these lock the scrub's behavior on the
 * new shape too.
 */
import { describe, it, expect } from 'vitest';
import { stripResearchCitations } from './strip-citations';

describe('stripResearchCitations', () => {
  it('is a no-op on citation-free text', () => {
    const s = 'Volume 52mi exceeded 41mi scheduled. Shave next 7 days 17%.';
    expect(stripResearchCitations(s)).toBe(s);
  });

  it('strips a trailing "per Research/22 §14" clause, keeping the sentence', () => {
    expect(stripResearchCitations('12 days without running. Comeback protocol per Research/22 §14.'))
      .toBe('12 days without running. Comeback protocol.');
  });

  it('drops a citation-led doctrine-recital sentence entirely', () => {
    expect(stripResearchCitations(
      '9 days off. First run back is easy, not quality. Research/22 §14: 1-7 days, resume plan, one easy day instead of first quality.',
    )).toBe('9 days off. First run back is easy, not quality.');
  });

  it('drops a bare trailing citation sentence', () => {
    expect(stripResearchCitations('Drop intensity for the first week back. Research/22 §14.'))
      .toBe('Drop intensity for the first week back.');
    expect(stripResearchCitations('Week 2 back at 85% volume. Research/22 §14.'))
      .toBe('Week 2 back at 85% volume.');
  });

  it('drops a citation-led sentence with a parenthetical tail', () => {
    expect(stripResearchCitations(
      '21 days off. Plan rebuild recommended with a 3-5 point VDOT haircut before resuming. Research/01 recalibration table (layoff ≥2 weeks).',
    )).toBe('21 days off. Plan rebuild recommended with a 3-5 point VDOT haircut before resuming.');
  });

  it('strips the re-ramp trailing citation while keeping the numeric guts', () => {
    const input = 'Comeback re-ramp after 10 days off: week of 2026-08-24 rescaled from 30mi toward 21mi (resume at 70% of the pre-absence 4-week average 30mi, then ≤10%/week). Research/22 §14.';
    expect(stripResearchCitations(input))
      .toBe('Comeback re-ramp after 10 days off: week of 2026-08-24 rescaled from 30mi toward 21mi (resume at 70% of the pre-absence 4-week average 30mi, then ≤10%/week).');
  });

  it('strips parenthetical citations mid-sentence', () => {
    expect(stripResearchCitations('Paces re-anchor to the result (Research/01:316-320).'))
      .toBe('Paces re-anchor to the result.');
  });

  it('strips line-numbered refs like Research/01:319-320', () => {
    expect(stripResearchCitations('VDOT haircut applies per Research/01:319-320.'))
      .toBe('VDOT haircut applies.');
  });

  it('never returns empty for a non-empty input', () => {
    const out = stripResearchCitations('Research/22 §14.');
    expect(typeof out).toBe('string');
    // A pure-citation string scrubs to its non-citation residue ·
    // must not throw and must not fabricate content.
    expect(out.includes('Research/')).toBe(false);
  });

  it('is idempotent', () => {
    const once = stripResearchCitations('12 days without running. Comeback protocol per Research/22 §14.');
    expect(stripResearchCitations(once)).toBe(once);
  });

  it('handles empty/nullish-ish input', () => {
    expect(stripResearchCitations('')).toBe('');
  });

  /* ── §section shapes ────────────────────────────────────────────────────
   * The scrub's failure mode is not "the citation survives" — it is "the
   * citation is half-removed and its tail is promoted into the coach's own
   * sentence", which reads as a typo rather than as engine debris. That is
   * strictly worse than leaving the reference alone, and the original test
   * for this file could not catch it: it only asserted "Research/" was absent
   * from the output, which ".3." and "-Threshold" both satisfy.
   *
   * So these assert the WHOLE output string, one case per section shape the
   * engine actually writes. Fixtures are real: the first two come from
   * generate.ts's `applyCourseGuidance`, which appends them to every long run
   * of a net-downhill build; the hyphenated ones are the section names
   * generate.ts's own file header cites.
   */
  it('strips a multi-word named §section (CITESCRUB-1)', () => {
    expect(stripResearchCitations(
      'Course drops 304 ft. Run at least 60% of this on downhill-similar terrain · Research/11 §net-downhill adjustments.',
    )).toBe('Course drops 304 ft. Run at least 60% of this on downhill-similar terrain.');

    expect(stripResearchCitations(
      'Course drops 304 ft. Downhill running stays short and easy from here · Research/11 §late-taper trap.',
    )).toBe('Course drops 304 ft. Downhill running stays short and easy from here.');
  });

  it('strips a numbered §section without eating the sentence period (CITESCRUB-1)', () => {
    expect(stripResearchCitations('Cruise intervals · Research/04 §5.3.'))
      .toBe('Cruise intervals.');
    expect(stripResearchCitations('Short hill repeats · Research/04 §8.2. Run them by feel.'))
      .toBe('Short hill repeats. Run them by feel.');
  });

  it('strips a quoted §section (CITESCRUB-1)', () => {
    expect(stripResearchCitations('Cutback week per Research/00b §"Depth of Cutback by Mileage Tier".'))
      .toBe('Cutback week.');
  });

  it('strips a number-led hyphenated §section (CITESCRUB-2)', () => {
    // §5-Threshold fell between the numbered branch (stopped at the hyphen)
    // and the named branch (needed a leading letter), stranding "-Threshold".
    expect(stripResearchCitations('Threshold work today, see Research/04 §5-Threshold for why.'))
      .toBe('Threshold work today.');
    expect(stripResearchCitations('VO2max reps today per Research/04 §6-VO2max.'))
      .toBe('VO2max reps today.');
  });

  it('leaves prose after a mid-sentence citation alone', () => {
    expect(stripResearchCitations('Taper starts now per Research/08 §taper. Trust it.'))
      .toBe('Taper starts now. Trust it.');
  });

  it('is idempotent across every §section shape', () => {
    for (const input of [
      'Course drops 304 ft. Run at least 60% of this on downhill-similar terrain · Research/11 §net-downhill adjustments.',
      'Cruise intervals · Research/04 §5.3.',
      'Threshold work today, see Research/04 §5-Threshold for why.',
      'Cutback week per Research/00b §"Depth of Cutback by Mileage Tier".',
    ]) {
      const once = stripResearchCitations(input);
      expect(stripResearchCitations(once)).toBe(once);
      expect(once).not.toContain('Research/');
    }
  });
});
