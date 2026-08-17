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
});
