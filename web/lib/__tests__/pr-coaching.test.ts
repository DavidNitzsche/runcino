/**
 * Tests for lib/pr-coaching.ts, the consolidated C5 PR coaching lines.
 *
 * Locks the role classification matrix + the canonical strings so a
 * future agent can't quietly tweak the copy or change the boundary
 * between adjacent-tier and pre-cycle without updating tests.
 */
import { describe, expect, it } from 'vitest';
import {
  PRE_CYCLE_DAYS,
  PR_COACHING_LINES,
  classifyPR,
  coachingLineForPR,
} from '../pr-coaching';

describe('PR_COACHING_LINES, canonical strings', () => {
  it('all four roles have a coaching line', () => {
    expect(PR_COACHING_LINES['goal-distance']).toBeTruthy();
    expect(PR_COACHING_LINES['pre-cycle']).toBeTruthy();
    expect(PR_COACHING_LINES['adjacent-tier']).toBeTruthy();
    expect(PR_COACHING_LINES['strava-effort']).toBeTruthy();
  });

  it('goal-distance line names the role + VDOT anchoring', () => {
    expect(PR_COACHING_LINES['goal-distance']).toBe(
      'Most recent goal-distance effort. Anchors current VDOT.',
    );
  });

  it('strava-effort line invites the runner to race the distance', () => {
    expect(PR_COACHING_LINES['strava-effort']).toBe(
      'Training effort. Race this distance to lock it in.',
    );
  });
});

describe('classifyPR, role assignment matrix', () => {
  it('strava source → strava-effort regardless of distance/age', () => {
    expect(classifyPR({ source: 'strava' })).toBe('strava-effort');
    expect(
      classifyPR({ source: 'strava', isGoalDistance: true, ageDays: 30 }),
    ).toBe('strava-effort');
  });

  it('race + goal-distance + within cycle → goal-distance', () => {
    const role = classifyPR({
      source: 'race',
      isGoalDistance: true,
      ageDays: 30,
    });
    expect(role).toBe('goal-distance');
  });

  it('race + any-distance + older than 12 weeks → pre-cycle', () => {
    // Pre-cycle takes precedence over goal-distance match.
    const goalDistOld = classifyPR({
      source: 'race',
      isGoalDistance: true,
      ageDays: 200,
    });
    expect(goalDistOld).toBe('pre-cycle');

    const adjOld = classifyPR({
      source: 'race',
      isGoalDistance: false,
      ageDays: 200,
    });
    expect(adjOld).toBe('pre-cycle');
  });

  it('race + non-goal-distance + within cycle → adjacent-tier', () => {
    const role = classifyPR({
      source: 'race',
      isGoalDistance: false,
      ageDays: 30,
    });
    expect(role).toBe('adjacent-tier');
  });

  it('boundary day is exclusive, exactly PRE_CYCLE_DAYS still counts as current', () => {
    // ageDays > 84 is pre-cycle; ageDays === 84 is still current.
    const exact = classifyPR({
      source: 'race',
      isGoalDistance: true,
      ageDays: PRE_CYCLE_DAYS,
    });
    expect(exact).toBe('goal-distance');

    const oneOver = classifyPR({
      source: 'race',
      isGoalDistance: true,
      ageDays: PRE_CYCLE_DAYS + 1,
    });
    expect(oneOver).toBe('pre-cycle');
  });

  it('missing ageDays is treated as current (within cycle)', () => {
    // null age = unknown; default to NOT pre-cycle so we don't
    // misclassify recent unknown-date PRs as old.
    const role = classifyPR({
      source: 'race',
      isGoalDistance: true,
      ageDays: null,
    });
    expect(role).toBe('goal-distance');
  });
});

describe('coachingLineForPR, role-to-string lookup', () => {
  it('returns the canonical line for each role', () => {
    expect(coachingLineForPR('goal-distance')).toBe(
      PR_COACHING_LINES['goal-distance'],
    );
    expect(coachingLineForPR('strava-effort')).toBe(
      PR_COACHING_LINES['strava-effort'],
    );
  });
});
