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
import { bestRecentVdot, predictRaceTime, vdotFromRace, type VdotCandidate } from './vdot';

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

// ── 2026-08-17 · fresh-race precedence over faded anchors ───────────────────
//
// The AFC Half (Aug 16, 1:41:53 → VDOT ≈ 44.1) is a FRESH A-race result.
// Doctrine (Research/01-pace-zones-vdot.md §"Freshness window"): 0-4 weeks
// is a fresh signal; 12+ weeks is expired — "Use field test or recent race
// instead." A 6.5-month-old faded Disney (47.8) must NOT outrank it.

const AFC = { slug: 'afc-half-2026', name: 'AFC Half', date: '2026-08-16', priority: 'A' as const, distance_mi: 13.109, finish_seconds: 6113 };

describe('bestRecentVdot — fresh race beats faded anchor (precedence)', () => {
  it('day after the A-race: fresh AFC result supersedes faded Disney despite lower magnitude', () => {
    const { best, considered } = bestRecentVdot([...RACES, AFC], '2026-08-17');
    // Disney (age 197, effective 47.8) is demoted, not dropped — still visible
    // in considered for display/debugging, just never the headline.
    expect(considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(true);
    expect(slugOf(best)).not.toBe('disney-half-2026');
    expect(slugOf(best)).not.toBe('rose-bowl-half-2026');
    // The winner is an in-window race at the fresh-evidence fitness level
    // (AFC and LA Marathon both read ≈ 44.1 — either is honest; Disney's
    // 47.8 is not).
    expect(best!.age_days).toBeLessThanOrEqual(180);
    expect(best!.vdot).toBeGreaterThanOrEqual(43.6);
    expect(best!.vdot).toBeLessThanOrEqual(44.6);
  });

  it('faded candidates rank below EVERY in-window candidate when a fresh race exists', () => {
    const { considered } = bestRecentVdot([...RACES, AFC], '2026-08-17');
    const firstFadedIdx = considered.findIndex((c) => c.age_days > 180);
    const lastFreshIdx = considered.reduce((acc, c, i) => (c.age_days <= 180 ? i : acc), -1);
    expect(firstFadedIdx).toBeGreaterThan(lastFreshIdx);
  });

  it('without a fresh race the fade still governs — faded Disney stays the anchor', () => {
    // Same day, AFC not (yet) logged: no fresh evidence, so the glide is the
    // honest read and Disney holds at 47.8. This is scenario (a) of the
    // Aug-17 prod state.
    const { best } = bestRecentVdot(RACES, '2026-08-17');
    expect(slugOf(best)).toBe('disney-half-2026');
    expect(best?.vdot).toBe(47.8);
  });
});

// ── 2026-08-17 · run-evidence cancellation fix (soft cap vs sort penalty) ───
//
// Runs are soft-capped at bestRaceRaw + 1.0 (AUDIT #8) AND used to be
// penalized exactly 1.0 in the sort — the permitted +1 lead cancelled to
// zero, so training evidence could never move the headline off a race
// anchor, by construction. Now cap-bounded runs sort at their capped face
// value: a capped run genuinely leads by up to the doctrinal +1, and a race
// still wins exact ties (stable sort, races first).

const LA_ONLY = [
  { slug: 'la-marathon-2026', name: 'LA Marathon', date: '2026-03-08', priority: 'A' as const, distance_mi: 26.219, finish_seconds: 12700 },
];

// Strong quality effort: 10K time-trial-grade run, reads well above the
// ceiling → clamped to race + 1.0.
const HOT_RUN = {
  id: 'run-aug9', date: '2026-08-09', workout_type: 'race',
  distance_mi: 6.2137, finish_seconds: 2560,
  avg_hr: null, max_hr: null, zone: null,
};

describe('bestRecentVdot — capped training run leads the race anchor by +1', () => {
  it('a run clamped to the soft cap wins the headline at race + 1.0 (not a tie)', () => {
    const raceVdot = vdotFromRace(12700, 26.219)!;           // LA ≈ 44.1
    const ceiling = Math.round((raceVdot + 1.0) * 10) / 10;  // ≈ 45.1
    const { best } = bestRecentVdot(LA_ONLY, '2026-08-17', 180, [HOT_RUN]);
    expect(best?.source).toBe('run');
    expect(best?.vdot).toBe(ceiling);
    // The cap is intact — the raw 10K read (≈48.5) never leaks through.
    expect(vdotFromRace(2560, 6.2137)!).toBeGreaterThan(ceiling);
  });

  it('race wins EXACT ties against a run reading identical fitness', () => {
    // Run with byte-identical distance/time to the Disney race → same
    // vdotFromRace read → exact tie → the race is the headline (stable
    // sort, races precede runs).
    const disney = [{ slug: 'disney-half-2026', name: 'Disney Half Marathon', date: '2026-02-01', priority: 'A' as const, distance_mi: 13.109, finish_seconds: 5694 }];
    const twinRun = { id: 'twin', date: '2026-03-01', workout_type: 'race', distance_mi: 13.109, finish_seconds: 5694, avg_hr: null, max_hr: null, zone: null };
    const { best } = bestRecentVdot(disney, '2026-03-05', 180, [twinRun]);
    expect(best?.source).toBe('race');
  });

  it('David Aug 17, AFC logged: capped run leads the FRESH anchor, not the faded one', () => {
    // Scenario (b) of the Aug-17 prod state: AFC (fresh, 44.1) demotes faded
    // Disney/Rose Bowl, the ceiling re-anchors to the fresh proof (44.1 + 1),
    // and the Aug 9 quality run — clamped to that ceiling — leads it by the
    // doctrinal +1. Headline ≈ 45.1, NOT 47.8 (expired Disney) and NOT a
    // silent tie-loss back to 44.1.
    const freshRaceVdot = Math.max(vdotFromRace(12700, 26.219)!, vdotFromRace(6113, 13.109)!);
    const ceiling = Math.round((freshRaceVdot + 1.0) * 10) / 10;
    const { best, considered } = bestRecentVdot([...RACES, AFC], '2026-08-17', 180, [HOT_RUN]);
    expect(best?.source).toBe('run');
    expect(best?.vdot).toBe(ceiling);
    expect(ceiling).toBeGreaterThanOrEqual(44.6);
    expect(ceiling).toBeLessThanOrEqual(45.6);
    // Faded Disney did not set the ceiling (44.1 + 1, not 47.9 + 1)...
    expect(ceiling).toBeLessThan(46.5);
    // ...and is still visible, demoted.
    expect(considered.some((c) => slugOf(c) === 'disney-half-2026')).toBe(true);
  });
});
