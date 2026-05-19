/**
 * V6 · coach-voice helper tests
 *
 * Locks the canonical shape of falsifier + revision strings so future
 * agents can't quietly drift away from the unified voice.
 *
 * Each test name describes what voice rule it enforces.
 */
import { describe, expect, it } from 'vitest';
import {
  FALSIFIER_PREFIX,
  COLLECTING_EVIDENCE,
  SIGNALS_CONFLICTED,
  INJURY_SUSPENDED,
  WOULD_REVISE,
  WOULD_WEAKEN,
  formatFalsifier,
  formatRevisionThreshold,
  formatReversal,
  formatDiagnosis,
  formatCrossReference,
} from '../coach-voice';

describe('canonical constants — locked phrasing', () => {
  it('FALSIFIER_PREFIX is the exact lead-in three banners already use', () => {
    // AdaptiveVdotBanner.tsx, CoachReadsCard.tsx, MaxHrValidationBanner.tsx
    // all render this string verbatim. If this string ever changes, the
    // banners need a coordinated update — that's the point.
    expect(FALSIFIER_PREFIX).toBe('What would change our mind:');
  });

  it('COLLECTING_EVIDENCE names the "not enough data yet" state', () => {
    // Different state from SIGNALS_CONFLICTED — path forward is more
    // data, not resolution. Conflating them flattens diagnostic info.
    expect(COLLECTING_EVIDENCE).toBe('Collecting evidence');
  });

  it('SIGNALS_CONFLICTED names the "data sufficient but signals disagree" state', () => {
    // Different state from COLLECTING_EVIDENCE — path forward is
    // resolution (third corroborating signal), not more of the same.
    expect(SIGNALS_CONFLICTED).toBe('Signals are mixed');
  });

  it('INJURY_SUSPENDED unifies the suspend-state message across surfaces', () => {
    expect(INJURY_SUSPENDED).toContain('suspended');
    expect(INJURY_SUSPENDED).toContain('injury');
    expect(INJURY_SUSPENDED).toContain('resumes');
  });

  it('verb constants collapse 7 drifted verbs to 2', () => {
    // Audit found: revise / weaken / lift / drop / switch / reconsider / raise
    // Canonical: ONLY revise (category flips) + weaken (evidence-strength drops)
    expect(WOULD_REVISE).toBe("we'd revise");
    expect(WOULD_WEAKEN).toBe('would weaken this read');
  });
});

describe('formatFalsifier — single observation', () => {
  it('wraps a single observation with the canonical prefix + trailing period', () => {
    const out = formatFalsifier(['A reversal in any firing signal in the next 2 weeks']);
    expect(out).toBe(
      'What would change our mind: a reversal in any firing signal in the next 2 weeks.',
    );
  });

  it('lower-cases the first letter so the prefix flows naturally', () => {
    // The prefix ends in a colon; downstream observation should NOT
    // start a new sentence with a capital letter. "What would change
    // our mind: A reversal..." reads worse than ": a reversal...".
    const out = formatFalsifier(['A second corroborating signal would lift this']);
    expect(out.startsWith('What would change our mind: a second')).toBe(true);
  });

  it('strips any trailing period from the observation before re-adding', () => {
    const out = formatFalsifier(['A reversal would weaken this.']);
    expect(out.endsWith('weaken this.')).toBe(true);
    expect(out.endsWith('weaken this..')).toBe(false);
  });
});

describe('formatFalsifier — multiple observations', () => {
  it('joins multiple observations with " OR " (caps) so the disjunction reads as real', () => {
    const out = formatFalsifier([
      'A single faster threshold in the next 2 weeks',
      '5+ s/mi Z2 improvement',
      'A faster interval session',
    ]);
    expect(out).toBe(
      'What would change our mind: a single faster threshold in the next 2 weeks OR 5+ s/mi Z2 improvement OR A faster interval session.',
    );
  });

  it('only the first observation gets lower-cased — later ones keep author casing', () => {
    // Author may capitalize for proper nouns (race names, brand-of-effort
    // labels) in later observations; we don't second-guess them.
    const out = formatFalsifier(['Z2 share drops below 30%', 'PR-based Signal 4 reverses']);
    expect(out).toContain('z2 share drops below 30%');
    expect(out).toContain('OR PR-based Signal 4 reverses.');
  });

  it('throws on empty input — empty falsifier violates Rule 2', () => {
    expect(() => formatFalsifier([])).toThrow(/at least one/);
  });
});

describe('formatRevisionThreshold — verdict-flip frame', () => {
  it('builds the canonical "we\'d revise to X if Y pushes Z to W" shape', () => {
    const out = formatRevisionThreshold({
      trigger: 'a race in the next 4 weeks',
      pushes: 'VDOT',
      to: '+2',
      newCategory: 'aggressive',
    });
    expect(out).toBe(
      "we'd revise to 'aggressive' if a race in the next 4 weeks pushes VDOT +2",
    );
  });

  it('composes with formatFalsifier to produce a full canonical line', () => {
    const observation = formatRevisionThreshold({
      trigger: 'a race in the next 4 weeks',
      pushes: 'VDOT',
      to: '+2 points',
      newCategory: 'aggressive',
    });
    const out = formatFalsifier([observation]);
    expect(out).toBe(
      "What would change our mind: we'd revise to 'aggressive' if a race in the next 4 weeks pushes VDOT +2 points.",
    );
  });
});

describe('formatReversal — evidence-strength frame', () => {
  it('appends the canonical "would weaken this read" suffix', () => {
    const out = formatReversal('A single slow threshold workout');
    expect(out).toBe('A single slow threshold workout would weaken this read');
  });

  it('strips trailing period from caller input so the suffix attaches cleanly', () => {
    const out = formatReversal('A single slow threshold workout.');
    expect(out).toBe('A single slow threshold workout would weaken this read');
  });
});

describe('formatCrossReference — V7-ready cross-surface acknowledgment', () => {
  it('builds the canonical "consistent with the X on Y" clause by default', () => {
    const out = formatCrossReference({
      relatedLabel: 'Z2 stimulus check',
      surface: '/overview',
    });
    expect(out).toBe('consistent with the Z2 stimulus check on /overview');
  });

  it('respects the explicit relation when caller wants something stronger', () => {
    const tied = formatCrossReference({
      relatedLabel: 'suspect-ceiling banner',
      surface: '/profile',
      relation: 'tied to',
    });
    expect(tied).toBe('tied to the suspect-ceiling banner on /profile');

    const contributing = formatCrossReference({
      relatedLabel: 'Signal 4 PR trajectory',
      surface: '/profile Coach Reads',
      relation: 'contributing to',
    });
    expect(contributing).toBe(
      'contributing to the Signal 4 PR trajectory on /profile Coach Reads',
    );
  });

  it('produces lower-case output so the clause embeds mid-sentence', () => {
    // V7's whole point: don't restate the related finding, just
    // acknowledge it. The output is a clause, not a sentence —
    // capitalization would force a sentence break.
    const out = formatCrossReference({
      relatedLabel: 'gap surface',
      surface: '/overview',
      relation: 'see also',
    });
    expect(out.charAt(0)).toBe(out.charAt(0).toLowerCase());
  });
});

describe('formatDiagnosis — observation + evidence pair', () => {
  it('joins observation and evidence with sentence-cap discipline', () => {
    const out = formatDiagnosis({
      observation: 'Your easy runs are too hard',
      evidence: '<40% of easy mileage landed in Z2 across the last 4 weeks',
    });
    expect(out).toBe(
      'Your easy runs are too hard. <40% of easy mileage landed in Z2 across the last 4 weeks.',
    );
  });

  it('idempotent on trailing periods — caller can be sloppy', () => {
    const out = formatDiagnosis({
      observation: 'Your easy runs are too hard.',
      evidence: '<40% Z2 over 4 weeks.',
    });
    expect(out).toBe('Your easy runs are too hard. <40% Z2 over 4 weeks.');
  });
});
