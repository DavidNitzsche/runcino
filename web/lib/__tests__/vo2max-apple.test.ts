/**
 * vo2max-apple — wellness-signal isolation coverage.
 *
 * THE PRINCIPLE (locked):
 *   Apple Health VO2max is a WELLNESS signal. It MUST NEVER drive
 *   pace prescription, never aggregate into VDOT, never "cross-check"
 *   under normal conditions. The only sanctioned uses are:
 *     1. Cold-start fallback when NO race history exists.
 *     2. Trend display.
 *     3. Extreme divergence (>20pt) data-quality flag.
 *
 * These tests are the canary for that principle. If any of them
 * change in a way that lets Apple values bleed into the normal pace
 * path, the change is wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  buildVo2MaxApple,
  coldStartVdotFromAppleVo2Max,
  checkVo2MaxDataQuality,
  resolveVdotWithColdStart,
} from '../vo2max-apple';

describe('coldStartVdotFromAppleVo2Max', () => {
  it('returns null when no Apple value is set', () => {
    const apple = buildVo2MaxApple(null, null);
    expect(coldStartVdotFromAppleVo2Max(apple)).toBeNull();
  });

  it('subtracts ~10 to compensate for Apple over-estimation', () => {
    // 8-15 points is the typical Apple over-estimate for trained
    // runners; we pick 10 as a conservative middle.
    const apple = buildVo2MaxApple(65, null);
    expect(coldStartVdotFromAppleVo2Max(apple)).toBe(55);
  });

  it('floors at 20 so absurd Apple values don\'t collapse VDOT', () => {
    const apple = buildVo2MaxApple(25, null);
    // 25 - 10 = 15, floored to 20.
    expect(coldStartVdotFromAppleVo2Max(apple)).toBe(20);
  });
});

describe('resolveVdotWithColdStart — tiered fallback', () => {
  it('Tier 1 wins: race-derived VDOT beats Apple cold-start even when both present', () => {
    // User has VDOT 50 from a race AND an Apple value of 65 (which
    // would cold-start to 55). Race wins — the principle is "race
    // performance is training signal, period".
    const apple = buildVo2MaxApple(65, null);
    const resolved = resolveVdotWithColdStart(50, apple, null);
    expect(resolved.value).toBe(50);
    expect(resolved.tier).toBe('race');
  });

  it('Tier 2 wins: no race, Apple value 65 → VDOT 55 cold-start (better than level default)', () => {
    const apple = buildVo2MaxApple(65, null);
    const resolved = resolveVdotWithColdStart(null, apple, 'intermediate');
    expect(resolved.value).toBe(55);
    expect(resolved.tier).toBe('apple-cold-start');
  });

  it('Tier 3 wins: no race, no Apple value → level-default 45 for intermediate', () => {
    const apple = buildVo2MaxApple(null, null);
    const resolved = resolveVdotWithColdStart(null, apple, 'intermediate');
    expect(resolved.value).toBe(45);
    expect(resolved.tier).toBe('level-default');
  });

  it('Tier 4: nothing at all → null', () => {
    const apple = buildVo2MaxApple(null, null);
    const resolved = resolveVdotWithColdStart(null, apple, null);
    expect(resolved.value).toBeNull();
    expect(resolved.tier).toBe('none');
  });
});

describe('checkVo2MaxDataQuality — fires only at >20 point gap', () => {
  it('returns null when no Apple value is set (nothing to check)', () => {
    const apple = buildVo2MaxApple(null, null);
    expect(checkVo2MaxDataQuality(apple, 50)).toBeNull();
  });

  it('returns null when no VDOT is set (nothing to compare against)', () => {
    const apple = buildVo2MaxApple(65, null);
    expect(checkVo2MaxDataQuality(apple, null)).toBeNull();
  });

  it('does NOT fire at the typical 8-15 point Apple over-estimate', () => {
    // User's own data: VDOT 47 from races, Apple 61.7 → 14.7 point
    // gap. This is the DEFAULT state for a fit runner with low RHR.
    // Firing here would produce a false positive on every fit user.
    const apple = buildVo2MaxApple(62, null);
    expect(checkVo2MaxDataQuality(apple, 47)).toBeNull();
  });

  it('does NOT fire at exactly 20 points (boundary respected)', () => {
    const apple = buildVo2MaxApple(70, null);
    expect(checkVo2MaxDataQuality(apple, 50)).toBeNull();
  });

  it('DOES fire at >20 point gap and frames as data-quality, never training', () => {
    const apple = buildVo2MaxApple(75, null);
    const flag = checkVo2MaxDataQuality(apple, 45);
    expect(flag).not.toBeNull();
    expect(flag!.gapPoints).toBe(30);
    expect(flag!.appleValue).toBe(75);
    expect(flag!.vdotValue).toBe(45);
    // Message must talk about data quality, not training implications.
    expect(flag!.message).toMatch(/data-source|over-estimat|unrelated/i);
    expect(flag!.message).not.toMatch(/should run|train slower|pace target|prescrib/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Spec scenarios — the 5 canonical cases from the build prompt.
// These exercise the FULL cold-start + data-quality flow end to end.
// ─────────────────────────────────────────────────────────────────────

describe('spec scenarios (canonical)', () => {
  it('Manual entry of 65, no races logged → cold-start VDOT = 55', () => {
    const apple = buildVo2MaxApple(65, '2026-05-01T12:00:00Z');
    const resolved = resolveVdotWithColdStart(null, apple, null);
    expect(resolved.value).toBe(55);
    expect(resolved.tier).toBe('apple-cold-start');
  });

  it('Manual entry of 65, races logged (VDOT 50) → race-based VDOT 50 wins', () => {
    const apple = buildVo2MaxApple(65, null);
    const resolved = resolveVdotWithColdStart(50, apple, null);
    expect(resolved.value).toBe(50);
    expect(resolved.tier).toBe('race');
  });

  it('Manual entry of 65, race-based VDOT 50 → data-quality check NOT fired (15pt gap is normal)', () => {
    const apple = buildVo2MaxApple(65, null);
    expect(checkVo2MaxDataQuality(apple, 50)).toBeNull();
  });

  it('Manual entry of 75, race-based VDOT 45 → data-quality check fires (30pt gap)', () => {
    const apple = buildVo2MaxApple(75, null);
    const flag = checkVo2MaxDataQuality(apple, 45);
    expect(flag).not.toBeNull();
    expect(flag!.gapPoints).toBe(30);
  });

  it('No manual entry → silent everywhere (no cold-start, no banner)', () => {
    const apple = buildVo2MaxApple(null, null);
    expect(coldStartVdotFromAppleVo2Max(apple)).toBeNull();
    expect(checkVo2MaxDataQuality(apple, 50)).toBeNull();
    expect(checkVo2MaxDataQuality(apple, null)).toBeNull();
    const resolved = resolveVdotWithColdStart(null, apple, null);
    expect(resolved.value).toBeNull();
    expect(resolved.tier).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Isolation canary — the module must not import anything from the
// pace pipeline. If somebody adds an import that violates the
// principle, this static check catches it.
// ─────────────────────────────────────────────────────────────────────

describe('isolation canary', () => {
  it('vo2max-apple does not import from lib/vdot, coach pace, or feasibility', async () => {
    // Read the module source and assert it never imports from any
    // training-signal module. Done via fs read so this fires in CI
    // independent of bundling.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'vo2max-apple.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/from ['"].*\/vdot['"]/);
    expect(source).not.toMatch(/from ['"].*\/pacing['"]/);
    expect(source).not.toMatch(/from ['"].*\/coach-engine['"]/);
    expect(source).not.toMatch(/from ['"].*\/coach-plan['"]/);
    expect(source).not.toMatch(/from ['"].*\/plan-builder['"]/);
    expect(source).not.toMatch(/from ['"].*\/race-feasibility['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildVo2MaxApple — null/undefined handling for the snapshot factory
// ─────────────────────────────────────────────────────────────────────

describe('buildVo2MaxApple', () => {
  it('returns a none-shaped snapshot when value is null', () => {
    const s = buildVo2MaxApple(null, '2026-01-01T00:00:00Z');
    expect(s.value).toBeNull();
    expect(s.source).toBe('none');
    expect(s.updatedAt).toBeNull();
  });

  it('marks source manual when a value is present', () => {
    const s = buildVo2MaxApple(50, '2026-05-01T12:00:00Z');
    expect(s.value).toBe(50);
    expect(s.source).toBe('manual');
    expect(s.updatedAt).toBe('2026-05-01T12:00:00Z');
  });

  it('coerces Date instances on updatedAt to ISO strings', () => {
    const d = new Date('2026-05-15T10:30:00Z');
    const s = buildVo2MaxApple(55, d);
    expect(s.updatedAt).toBe(d.toISOString());
  });
});
