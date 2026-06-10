/**
 * 2026-06-09 · race-killer F1 regression tests — the stale-anchor fade.
 *
 * Fixture = the runner's real A/B race history (what loadVdotInputs
 * delivers after its priority IN ('A','B') filter). The bug these lock
 * down: Disney HM (Feb 1, VDOT 47.9) exits a hard 180-day window on
 * Aug 1 → VDOT cliffs to 44.1 (LA Marathon) → HM projection lurches
 * 1:34:54 → 1:41:55 fifteen days before the A-race.
 */
import { describe, expect, it } from 'vitest';
import { bestRecentVdot, predictRaceTime, type VdotCandidate } from './vdot';

/** Narrow the race|run candidate union to a race slug (null for runs). */
const slugOf = (c: VdotCandidate | null | undefined): string | null =>
  c && c.source === 'race' ? c.slug : null;

const RACES = [
  { slug: 'rose-bowl-half-2026', name: 'Rose Bowl Half', date: '2026-01-18', priority: 'A' as const, distance_mi: 13.109, finish_seconds: 5918 },
  { slug: 'disney-half-2026', name: 'Disney Half Marathon', date: '2026-02-01', priority: 'A' as const, distance_mi: 13.109, finish_seconds: 5694 },
  { slug: 'la-marathon-2026', name: 'LA Marathon', date: '2026-03-08', priority: 'A' as const, distance_mi: 26.219, finish_seconds: 12700 },
];

describe('bestRecentVdot — stale-anchor fade (F1)', () => {
  it('today (Jun 9): Disney anchors at full value — display unchanged', () => {
    const { best } = bestRecentVdot(RACES, '2026-06-09');
    expect(slugOf(best)).toBe('disney-half-2026');
    expect(best?.vdot).toBe(47.9);
    expect(best?.vdot_raw).toBe(47.9);
    expect(best?.age_days).toBe(128);
  });

  it('Aug 1 (the old cliff day): no cliff — Disney fades, does not vanish', () => {
    const { best } = bestRecentVdot(RACES, '2026-08-01');
    expect(slugOf(best)).toBe('disney-half-2026');
    expect(best?.vdot).toBeGreaterThanOrEqual(47.8); // was 44.1 under the hard window
  });

  it('race morning (Aug 16): glide lands at 47.8 → projection ~1:35, not 1:41:55', () => {
    const { best } = bestRecentVdot(RACES, '2026-08-16');
    expect(slugOf(best)).toBe('disney-half-2026');
    expect(best?.vdot).toBe(47.8);     // 47.9 − (16d past window / 14) × 0.1
    expect(best?.age_days).toBe(196);
    const proj = predictRaceTime(best!.vdot, 13.1)!;
    expect(proj).toBeGreaterThanOrEqual(5694);  // never faster than the anchor said
    expect(proj).toBeLessThan(5694 + 75);       // within ~1min of 1:34:54 — not 6115 (1:41:55)
  });

  it('anchors still expire — fade tail ends, next anchor takes over', () => {
    // Disney age 300 on 2026-11-28 (inside tail) · 320 on 2026-12-18 (out).
    const inside = bestRecentVdot(RACES, '2026-11-28');
    expect(inside.considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(true);
    const outside = bestRecentVdot(RACES, '2026-12-18');
    expect(outside.considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(false);
    expect(slugOf(outside.best)).toBe('la-marathon-2026'); // faded but present (age 285)
  });

  it('fresh evidence beats a faded anchor the moment it scores higher', () => {
    // Hypothetical tune-up 10K on Jul 11 at 42:40 → raw VDOT ≈ 48.5.
    const withTuneUp = [
      ...RACES,
      { slug: 'tune-up-10k', name: 'Tune-up 10K', date: '2026-07-11', priority: 'B' as const, distance_mi: 6.2137, finish_seconds: 2560 },
    ];
    const { best } = bestRecentVdot(withTuneUp, '2026-08-16');
    expect(slugOf(best)).toBe('tune-up-10k');
    expect(best!.vdot).toBeGreaterThan(47.8);
  });

  it('fresh anchors are bit-identical to the pre-fade behavior', () => {
    // 30 days after Disney, everything is inside the window — effective ≡ raw.
    const { best, considered } = bestRecentVdot(RACES, '2026-03-01');
    expect(best?.vdot).toBe(47.9);
    for (const c of considered) expect(c.vdot).toBe(c.vdot_raw);
  });
});
