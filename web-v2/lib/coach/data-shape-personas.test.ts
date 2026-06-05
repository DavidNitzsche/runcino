/**
 * lib/coach/data-shape-personas.test.ts · multi-tenant audit Move 4.
 *
 * Four canonical DATA-SHAPE personas exercise the cold-start envelope
 * + presence predicates. The plan-engine bench (plan-engine.test.ts)
 * covers plan-shape personas (peak weekly miles, VDOT trajectories).
 * THIS bench covers DATA-SHAPE — what CoachState looks like for a
 * runner with only Strava connected, only watch + iPhone, only manual
 * logging, or a mix.
 *
 *   · strava-only-web    · runs from Strava, NO health pillars
 *   · watch-only-iphone  · watch + iPhone fully synced, no Strava
 *   · manual-only        · zero device connections, hand-logged runs
 *   · mixed-partial      · some signals present, some absent
 *
 * The CI fail condition the audit named: a cold-start envelope must
 * NEVER claim hasRecoverySignal(). A Strava-only runner with zero
 * recovery pillars must surface that — not get scored 67-75 and
 * labeled "READY" with "All systems in their normal band."
 *
 * This is the structural unit-test layer. The plan-engine bench
 * runs ~5 mins of simulation; this runs in milliseconds and gates
 * every PR via the same vitest harness.
 *
 * Cite: docs/2026-06-05-multi-tenant-audit.html § Pattern 2, § Pattern 8.
 */

import { describe, it, expect } from 'vitest';
import type { CoachState } from '@/lib/topics/types';
import {
  hasRecoverySignal,
  hasLoadSignal,
  hasSleepSignal,
  hasHrvSignal,
  hasRhrSignal,
  hasHrRecoverySignal,
  recoveryCoverage,
  summarizePresence,
} from './state-presence';

/**
 * Each persona builds a synthetic CoachState with only the fields a
 * runner of that shape would actually have populated. Anything not
 * filled in is left undefined / null on purpose · that IS the shape.
 */
function baseSkeleton(): Partial<CoachState> {
  return {
    user_id: '00000000-0000-0000-0000-000000000000',
    today: '2026-06-05',
    biologicalSex: 'not_specified',
    cyclePhase: null,
  };
}

const STRAVA_ONLY_WEB: Partial<CoachState> = {
  ...baseSkeleton(),
  // LOAD present · the runner has been syncing Strava activities.
  loadAcwr: 1.05,
  loadAcute7: 32,
  loadChronic28: 30,
  // NO recovery pillars · no Apple Health, no watch, no iPhone sync.
  sleep7Avg: null,
  hrvCurrent: null,
  hrvBaseline: null,
  rhrCurrent: null,
  rhrBaseline: null,
  hrRecoveryCurrent: null,
  hrRecoveryBaseline: null,
};

const WATCH_ONLY_IPHONE: Partial<CoachState> = {
  ...baseSkeleton(),
  // Fully instrumented recovery picture.
  sleep7Avg: 7.4,
  hrvCurrent: 62,
  hrvBaseline: 60,
  rhrCurrent: 48,
  rhrBaseline: 50,
  hrRecoveryCurrent: 28,
  hrRecoveryBaseline: 26,
  // No Strava → no LOAD signal computed yet (first watch sync just
  // landed, no canonical runs ingested through Strava).
  loadAcwr: null,
  loadAcute7: null,
  loadChronic28: null,
};

const MANUAL_ONLY: Partial<CoachState> = {
  ...baseSkeleton(),
  // No source of either pillar group · cold start across the board.
  sleep7Avg: null,
  hrvCurrent: null,
  hrvBaseline: null,
  rhrCurrent: null,
  rhrBaseline: null,
  hrRecoveryCurrent: null,
  hrRecoveryBaseline: null,
  loadAcwr: null,
  loadAcute7: null,
  loadChronic28: null,
};

const MIXED_PARTIAL: Partial<CoachState> = {
  ...baseSkeleton(),
  // Strava + sleep tracking + RHR but no HRV / hr_recovery (e.g. older
  // Fitbit + Strava setup) · partial recovery picture.
  loadAcwr: 1.12,
  loadAcute7: 28,
  loadChronic28: 25,
  sleep7Avg: 7.1,
  rhrCurrent: 52,
  rhrBaseline: 50,
  hrvCurrent: null,
  hrvBaseline: null,
  hrRecoveryCurrent: null,
  hrRecoveryBaseline: null,
};

describe('Data-shape persona: strava-only-web', () => {
  const s = STRAVA_ONLY_WEB as CoachState;

  it('hasLoadSignal is true (runs ingesting through Strava)', () => {
    expect(hasLoadSignal(s)).toBe(true);
  });

  it('hasRecoverySignal is false · cold-start for recovery', () => {
    expect(hasRecoverySignal(s)).toBe(false);
  });

  it('all four recovery pillars are absent', () => {
    expect(hasSleepSignal(s)).toBe(false);
    expect(hasHrvSignal(s)).toBe(false);
    expect(hasRhrSignal(s)).toBe(false);
    expect(hasHrRecoverySignal(s)).toBe(false);
  });

  it('recoveryCoverage is 0', () => {
    expect(recoveryCoverage(s)).toBe(0);
  });

  it('CI gate · never lets a Strava-only runner present as READY with full recovery', () => {
    // This is the failure mode the audit named explicitly · before the
    // state-presence module landed, this combination could surface a
    // 67-75 readiness score labeled READY because the LOAD pillar
    // dominated weight when recovery was absent. Lock that behavior
    // here · if we ever rewire so a cold-start recovery runner gets
    // `hasRecoverySignal == true`, the suite fails.
    const summary = summarizePresence(s);
    expect(summary.recovery.hasAny).toBe(false);
    expect(summary.load).toBe(true);
  });
});

describe('Data-shape persona: watch-only-iphone', () => {
  const s = WATCH_ONLY_IPHONE as CoachState;

  it('hasRecoverySignal is true · full pillar set reporting', () => {
    expect(hasRecoverySignal(s)).toBe(true);
  });

  it('every recovery pillar fires', () => {
    expect(hasSleepSignal(s)).toBe(true);
    expect(hasHrvSignal(s)).toBe(true);
    expect(hasRhrSignal(s)).toBe(true);
    expect(hasHrRecoverySignal(s)).toBe(true);
  });

  it('hasLoadSignal is false · no Strava → no run-derived load math', () => {
    expect(hasLoadSignal(s)).toBe(false);
  });

  it('recoveryCoverage is 1.0', () => {
    expect(recoveryCoverage(s)).toBe(1);
  });
});

describe('Data-shape persona: manual-only', () => {
  const s = MANUAL_ONLY as CoachState;

  it('hasRecoverySignal is false', () => {
    expect(hasRecoverySignal(s)).toBe(false);
  });

  it('hasLoadSignal is false', () => {
    expect(hasLoadSignal(s)).toBe(false);
  });

  it('summary shows pure cold start', () => {
    const summary = summarizePresence(s);
    expect(summary.recovery.hasAny).toBe(false);
    expect(summary.recovery.coverage).toBe(0);
    expect(summary.load).toBe(false);
  });
});

describe('Data-shape persona: mixed-partial', () => {
  const s = MIXED_PARTIAL as CoachState;

  it('hasRecoverySignal is true · sleep + RHR carry the panel', () => {
    expect(hasRecoverySignal(s)).toBe(true);
  });

  it('only the connected pillars fire', () => {
    expect(hasSleepSignal(s)).toBe(true);
    expect(hasRhrSignal(s)).toBe(true);
    expect(hasHrvSignal(s)).toBe(false);
    expect(hasHrRecoverySignal(s)).toBe(false);
  });

  it('recoveryCoverage reflects partial picture · sleep 25 + rhr 20 / 75', () => {
    // Sleep weight 25 + RHR weight 20 = 45 / 75 total recovery weight = 0.60.
    expect(recoveryCoverage(s)).toBeCloseTo(45 / 75, 3);
  });

  it('hasLoadSignal is true', () => {
    expect(hasLoadSignal(s)).toBe(true);
  });
});

describe('Cross-persona invariant · cold-start envelope honesty', () => {
  // The audit named this as the CI gate · iterate all personas and
  // assert the cold-start cases don't sneak through as fully-real.
  const allPersonas: Array<[string, Partial<CoachState>, { recovery: boolean; load: boolean }]> = [
    ['strava-only-web', STRAVA_ONLY_WEB, { recovery: false, load: true }],
    ['watch-only-iphone', WATCH_ONLY_IPHONE, { recovery: true, load: false }],
    ['manual-only', MANUAL_ONLY, { recovery: false, load: false }],
    ['mixed-partial', MIXED_PARTIAL, { recovery: true, load: true }],
  ];

  for (const [name, persona, expected] of allPersonas) {
    it(`${name} · presence matches expected shape`, () => {
      const s = persona as CoachState;
      expect(hasRecoverySignal(s)).toBe(expected.recovery);
      expect(hasLoadSignal(s)).toBe(expected.load);
    });
  }
});
