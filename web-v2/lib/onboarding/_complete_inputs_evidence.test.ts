/**
 * lib/onboarding/_complete_inputs_evidence.test.ts · F074, the intake half.
 *
 * `deriveOnboardingComplete` is where an onboarding answer can be silently
 * DROPPED (see complete-inputs.ts's own header) — this suite is the same
 * shape `_onboarding_e2e.test.ts` already uses for the pre-existing fields,
 * applied to the three new ones: a value that goes in must come out, and a
 * value the validator should refuse must not silently become a plausible
 * one (Rule 18).
 */
import { describe, it, expect } from 'vitest';
import { deriveOnboardingComplete, isRefusal, validateRecentRace } from './complete-inputs';

const TODAY = '2026-09-14';

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    distance: 'none',
    name: 'Runner',
    timezone: 'America/Los_Angeles',
    ...overrides,
  };
}

describe('F074 fix #1 · recentRace reaches deriveOnboardingComplete', () => {
  it('1a · a validated recent-race entry survives the round trip', () => {
    const body = baseBody({
      recentRace: { distance: 'half', timeSec: 5400, whenRaced: '<6mo' },
    });
    const d = deriveOnboardingComplete(body, TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.recentRace).toEqual({ distance: 'half', timeSec: 5400, whenRaced: '<6mo' });
  });

  it('1b · FALSIFIED without the fix: an entry missing whenRaced (what the CURRENT native screen sends) is dropped to null, not accepted', () => {
    // This is the exact shape IPR-20260914-005 found: distance + time, no
    // recency bucket. It must be REFUSED (null), not silently accepted with
    // a fabricated recency — the screen has to grow the field before this
    // can ever populate, and that is stated as a scope boundary, not fixed
    // here by inventing a bucket.
    const body = baseBody({ recentRace: { distance: 'half', timeSec: 5400 } });
    const d = deriveOnboardingComplete(body, TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.recentRace).toBeNull();
  });

  it('1c · an absent recentRace field (every existing client today) resolves null, never throws', () => {
    const d = deriveOnboardingComplete(baseBody(), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.recentRace).toBeNull();
  });

  it('1d · validateRecentRace never merges into raceHistory — the two stay independent', () => {
    const body = baseBody({
      recentRace: { distance: 'half', timeSec: 5400, whenRaced: '<6mo' },
      raceHistory: [{ distance: 'marathon', timeSec: 12000, whenRaced: '2+yr' }],
    });
    const d = deriveOnboardingComplete(body, TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.raceHistory).toHaveLength(1);
    expect(d.raceHistory[0].distance).toBe('marathon');
    expect(d.recentRace?.distance).toBe('half');
  });

  it('1e · an implausible/garbage recentRace payload refuses cleanly (validateRecentRace)', () => {
    expect(validateRecentRace('not an object')).toBeNull();
    expect(validateRecentRace(null)).toBeNull();
    expect(validateRecentRace({ distance: 'not-a-real-distance', timeSec: 100, whenRaced: '<6mo' })).toBeNull();
  });
});

describe('F074 fix #2 · effortPaceSecPerMi reaches deriveOnboardingComplete', () => {
  it('2a · the native "M:SS" pace string parses to seconds', () => {
    const d = deriveOnboardingComplete(baseBody({ effortPace: '7:45' }), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.effortPaceSecPerMi).toBe(465);
  });

  it('2b · a pre-parsed seconds value is also accepted (forward-compatible with a client that already computed it)', () => {
    const d = deriveOnboardingComplete(baseBody({ effortPaceSecPerMi: 420 }), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.effortPaceSecPerMi).toBe(420);
  });

  it('2c · FALSIFIED: a garbage or out-of-band string is dropped to null, not coerced into a plausible-looking number', () => {
    for (const bad of ['not a pace', '99:99', '']) {
      const d = deriveOnboardingComplete(baseBody({ effortPace: bad }), TODAY);
      expect(isRefusal(d)).toBe(false);
      if (!isRefusal(d)) expect(d.effortPaceSecPerMi).toBeNull();
    }
    const tooSlow = deriveOnboardingComplete(baseBody({ effortPace: '35:00' }), TODAY); // past the 1800s (30:00) ceiling
    expect(isRefusal(tooSlow)).toBe(false);
    if (!isRefusal(tooSlow)) expect(tooSlow.effortPaceSecPerMi).toBeNull();
    const tooFast = deriveOnboardingComplete(baseBody({ effortPace: '1:30' }), TODAY); // under the 2:00 (120s) floor
    expect(isRefusal(tooFast)).toBe(false);
    if (!isRefusal(tooFast)) expect(tooFast.effortPaceSecPerMi).toBeNull();
  });

  it('2d · CRITICAL: "7:45" is parsed as a PACE (7 min 45 s), never as parseRaceTime\'s H:MM finish-time heuristic would read it', () => {
    // parseRaceTime would read "7:45" as 7 hours 45 minutes (first part <= 9
    // -> H:MM). A pace parser that reused that heuristic would silently
    // produce a nonsense multi-hour-per-mile value. This is the falsifier
    // for using the WRONG parser.
    const d = deriveOnboardingComplete(baseBody({ effortPace: '7:45' }), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.effortPaceSecPerMi).toBe(7 * 60 + 45); // 465, not 27900 (7h45m)
  });

  it('2e · an absent effortPace field (every existing client today) resolves null, never throws', () => {
    const d = deriveOnboardingComplete(baseBody(), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.effortPaceSecPerMi).toBeNull();
  });
});

describe('F074 fix #3 · layoffWeeks reaches deriveOnboardingComplete', () => {
  it('3a · a valid weeks-off answer survives the round trip', () => {
    const d = deriveOnboardingComplete(baseBody({ layoffWeeks: 8 }), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.layoffWeeks).toBe(8);
  });

  it('3b · an answer of ZERO weeks survives distinctly from never answering (Rule 11)', () => {
    const answered = deriveOnboardingComplete(baseBody({ layoffWeeks: 0 }), TODAY);
    const unanswered = deriveOnboardingComplete(baseBody(), TODAY);
    expect(isRefusal(answered) || isRefusal(unanswered)).toBe(false);
    if (isRefusal(answered) || isRefusal(unanswered)) return;
    expect(answered.layoffWeeks).toBe(0);
    expect(unanswered.layoffWeeks).toBeNull();
  });

  it('3c · FALSIFIED: an out-of-band weeks value (negative, or absurdly large) is dropped to null', () => {
    for (const bad of [-1, 500, NaN, Infinity]) {
      const d = deriveOnboardingComplete(baseBody({ layoffWeeks: bad }), TODAY);
      expect(isRefusal(d)).toBe(false);
      if (!isRefusal(d)) expect(d.layoffWeeks).toBeNull();
    }
  });

  it('3d · reuses the EXISTING weeklyMi/histAvg fields for pre-break mileage — no new mileage field exists', () => {
    // The .timeoff mode's "weekly mileage before the break" is expected to
    // ride the same weeklyMi/histAvg keys the .consistent mode already
    // sends — this is the doctrine-cited reuse, not a gap. Confirmed here so
    // a future reader does not go looking for an "offWeeklyMi" field that
    // was deliberately never added.
    const d = deriveOnboardingComplete(baseBody({ layoffWeeks: 8, weeklyMi: 35, histAvg: '25-35' }), TODAY);
    expect(isRefusal(d)).toBe(false);
    if (isRefusal(d)) return;
    expect(d.layoffWeeks).toBe(8);
    expect(d.weeklyMi).toBe(35);
    expect(d.histAvgMi).toBe(30);
  });
});
