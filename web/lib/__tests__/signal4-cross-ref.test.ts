/**
 * V7 · Signal 4 → VDOT explainer cross-reference relevance check.
 *
 * Locks the earned-not-decorative discipline for Signal-4-to-VDOT-
 * explainer:
 *   · Soft-positive Signal 4 (corroborates but didn't drive the bump)
 *     does NOT fire a cross-ref — the bump math didn't actually use it.
 *   · Strong Signal 4 (firesUp + ≥1 PR) DOES fire a cross-ref to the
 *     MOST RECENT PR.  Picks one, per the frequency-cap rule.
 *   · Cross-ref uses the 'contributing to' relation — grammatically
 *     subject-position because the PR caused the bump.
 */
import { describe, expect, it } from 'vitest';
import { buildSignal4CrossRef } from '../adaptive-vdot-verdict';
import type { Signal4Result, Signal4PR } from '../adaptive-vdot-signal4';

function pr(date: string, label: string): Signal4PR {
  return {
    date,
    distanceMi: label === 'Half' ? 13.10 : label === '10K' ? 6.21 : 3.10,
    canonicalLabel: label,
    finishS: 3600,
    name: `Test ${label} ${date}`,
  };
}

function s4(
  prsInWindow: Signal4PR[],
  firesUp: boolean,
  softPositive = firesUp || prsInWindow.length >= 2,
): Signal4Result {
  return {
    prsInWindow,
    distinctDistances: new Set(prsInWindow.map((p) => p.canonicalLabel)).size,
    firesUp,
    softPositive,
    lookbackDays: 56,
    suspended: false,
  };
}

describe('buildSignal4CrossRef · earned-not-decorative discipline', () => {
  it('s4FiresUp=false → undefined regardless of PR count', () => {
    // Even if there are PRs in the window, if firesUp is false the
    // bump math didn't actually use Signal 4 to set the proposed VDOT.
    // No cross-ref — would be decoration, not earned.
    expect(buildSignal4CrossRef(false, s4([pr('2026-04-01', '10K')], false))).toBeUndefined();
    expect(buildSignal4CrossRef(false, s4([pr('2026-04-01', '10K'), pr('2026-04-15', 'Half')], false, true))).toBeUndefined();
  });

  it('s4FiresUp=true + empty PR list → undefined (no anchor)', () => {
    // Defensive: firesUp implies prsInWindow.length >= STRONG_THRESHOLD,
    // but if the data is somehow inconsistent, fail safe rather than
    // build a cross-ref with no PR name.
    expect(buildSignal4CrossRef(true, s4([], true))).toBeUndefined();
  });

  it('s4FiresUp=true + 3 PRs → cross-ref to MOST RECENT PR', () => {
    // computeSignal4 produces ASCENDING by date.  Most recent is last.
    const prs = [
      pr('2026-03-01', '5K'),
      pr('2026-03-20', '10K'),
      pr('2026-04-15', 'Half'),
    ];
    const out = buildSignal4CrossRef(true, s4(prs, true));
    expect(out).toBeDefined();
    expect(out!.text).toBe('the Half PR on /races is contributing to this');
    expect(out!.href).toBe('/races#personal-records');
  });

  it('uses "contributing to" relation — subject inversion (PR is causal)', () => {
    // "Contributing to" puts the related finding as subject — the PR
    // is the CAUSE of the bump.  The reverse ("contributing to the X")
    // would imply the bump causes the PR, which is backwards.
    const out = buildSignal4CrossRef(true, s4([pr('2026-04-15', 'Half')], true));
    expect(out!.text.startsWith('the ')).toBe(true);
    expect(out!.text.includes(' is contributing to this')).toBe(true);
    expect(out!.text.startsWith('contributing to the')).toBe(false);
  });

  it('href deep-links to #personal-records anchor on /races', () => {
    // Anchor is the new id added to the Personal Records card.  Web:
    // scroll target.  iPhone: deep-link path with fragment.
    const out = buildSignal4CrossRef(true, s4([pr('2026-04-15', 'Half')], true));
    expect(out!.href).toBe('/races#personal-records');
  });

  it('honors single-name discipline — only most-recent PR named, even with 5 PRs', () => {
    // Frequency cap: one cross-ref per surface per render.  We do NOT
    // list multiple PRs in the cross-ref — the verdict reason already
    // lists them in prose; the cross-ref points the runner at /races.
    const prs = [
      pr('2026-02-10', '5K'),
      pr('2026-02-25', '10K'),
      pr('2026-03-15', '5K'),
      pr('2026-04-01', 'Half'),
      pr('2026-04-20', 'Marathon'),
    ];
    const out = buildSignal4CrossRef(true, s4(prs, true));
    expect(out!.text).toBe('the Marathon PR on /races is contributing to this');
    // Only one canonical label in the text — not a list.
    expect(out!.text.match(/PR/g)?.length).toBe(1);
  });
});
