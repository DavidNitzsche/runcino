/**
 * lib/race/_onboarding_recent_race.test.ts · F074 fix #1.
 *
 * Pure — no database — so every branch of `buildRecentRaceWrite` is
 * falsifiable (Rule 18). The SQL half (the Rule 6 merge + the
 * do-not-downgrade-a-confirmed-result CASE guard) is read directly out of
 * `app/api/onboarding/complete/route.ts` and asserted structurally below,
 * since a live DB round-trip is out of scope for this pure suite — the
 * report names this explicitly rather than implying a DB test exists here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildRecentRaceWrite, type RecentRaceWriteResult } from './onboarding-recent-race';
import type { RaceHistoryEntry } from '@/lib/training/race-history';

const NOW = new Date('2026-09-14T12:00:00Z');
const USER = 'a1b2c3d4-0000-0000-0000-000000000000';

function entry(overrides: Partial<RaceHistoryEntry> = {}): RaceHistoryEntry {
  return { distance: 'half', timeSec: 5400, whenRaced: '<6mo', ...overrides };
}

describe('F074 fix #1 · buildRecentRaceWrite', () => {
  it('1a · a validated half-marathon entry resolves a slug, a meta object and an actual_result patch', () => {
    const r = buildRecentRaceWrite(USER, entry(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.write.slug).toBe(`onboarding-recent-race-${USER.slice(0, 8)}`);
    expect(r.write.meta.distanceMi).toBeCloseTo(13.109, 2);
    expect(r.write.meta.distanceLabel).toBe('Half Marathon');
    expect(r.write.meta.priority).toBe('B');
    expect(r.write.meta.source).toBe('onboarding_self_report');
    expect(r.write.actualResult.finishS).toBe(5400);
    expect(r.write.actualResult.finishDisplay).toMatch(/1:30:00/);
    expect(r.write.actualResult.provisional).toBe(true);
    expect(r.write.actualResult.source).toBe('onboarding_self_report');
  });

  it('1b · the date is anchored on the recency BUCKET midpoint, not a fabricated exact date', () => {
    const fresh = buildRecentRaceWrite(USER, entry({ whenRaced: '<6mo' }), NOW);
    const old = buildRecentRaceWrite(USER, entry({ whenRaced: '1-2yr' }), NOW);
    expect(fresh.ok && old.ok).toBe(true);
    if (!fresh.ok || !old.ok) return;
    // <6mo -> 90 days ago; 1-2yr -> 547 days ago (whenRacedDaysAgo's own
    // midpoints) — asserted by the ORDERING, not a hand-copied date, so this
    // cannot drift from race-history.ts's own map.
    expect(new Date(fresh.write.meta.date).getTime()).toBeGreaterThan(new Date(old.write.meta.date).getTime());
  });

  it('1c · an "other" distance carries its own reported mileage as the label and the meta distance', () => {
    const r = buildRecentRaceWrite(USER, entry({ distance: 'other', otherDistanceMi: 8, timeSec: 3200 }), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.write.meta.distanceMi).toBe(8);
    expect(r.write.meta.distanceLabel).toBe('8 mi');
  });

  it('1d · FALSIFIED: an entry missing whenRaced (no recency bucket) refuses rather than fabricating a date', () => {
    // `whenRaced` is typed required on `RaceHistoryEntry`, but the runtime
    // value can still arrive unset from an un-narrowed JSON body — the same
    // defensive posture `validateRaceHistory` already takes.
    const bad = { distance: 'half', timeSec: 5400 } as unknown as RaceHistoryEntry;
    const r = buildRecentRaceWrite(USER, bad, NOW);
    expect(r.ok).toBe(false);
    expect((r as Extract<RecentRaceWriteResult, { ok: false }>).error).toBe('unresolvable_recent_race_entry');
  });

  it('1e · FALSIFIED: a non-finite or non-positive time refuses rather than writing a garbage finish', () => {
    for (const timeSec of [0, -5, NaN]) {
      const r = buildRecentRaceWrite(USER, entry({ timeSec: timeSec as number }), NOW);
      expect(r.ok).toBe(false);
    }
  });

  it('1f · the slug is deterministic per user and stable across repeated calls (idempotent re-onboarding)', () => {
    const a = buildRecentRaceWrite(USER, entry({ timeSec: 5400 }), NOW);
    const b = buildRecentRaceWrite(USER, entry({ timeSec: 5700 }), NOW); // a DIFFERENT recent race reported later
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Same slug — a re-onboarding replay targets the SAME row (an upsert),
    // never a duplicate.
    expect(a.write.slug).toBe(b.write.slug);
    // A different user gets a different slug — no cross-account collision.
    const other = buildRecentRaceWrite('z9z9z9z9-0000-0000-0000-000000000000', entry(), NOW);
    expect(other.ok && other.write.slug).not.toBe(a.write.slug);
  });

  it('1g · confirmedAt uses the injected clock, not the wall clock (falsifiable without a live timestamp)', () => {
    const r = buildRecentRaceWrite(USER, entry(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.write.actualResult.confirmedAt).toBe(NOW.toISOString());
  });
});

/* ── THE SQL HALF · Rule 6 + the confirmed-result guard ────────────────────
 * Read structurally out of the route rather than re-implemented, because a
 * SQL string re-typed here could drift from the real one silently. This is
 * NOT a live DB round-trip (out of scope for this pure suite — the
 * F074 report says so explicitly); it is the falsifiable minimum: the exact
 * three properties the report's verification section claims the SQL has are
 * actually present in the statement the route executes. */
describe('F074 fix #1 · the route\'s SQL carries the properties this fix claims', () => {
  const ROUTE_PATH = path.join(process.cwd(), 'app/api/onboarding/complete/route.ts');
  const src = readFileSync(ROUTE_PATH, 'utf8');

  it('2a · LIVENESS · the route file was actually read', () => {
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain('writeOnboardingRecentRace');
  });

  it('2b · Rule 6 · actual_result is merged with `||`, never replaced with a bare `= EXCLUDED.actual_result`', () => {
    expect(src).toContain("COALESCE(races.actual_result, '{}'::jsonb) || EXCLUDED.actual_result");
    // The specific bug shape Rule 6 exists to catch: an unconditional
    // full-replace assignment for this column.
    expect(src).not.toMatch(/actual_result\s*=\s*EXCLUDED\.actual_result\s*[,\n]/);
  });

  it('2c · a since-confirmed result (source != onboarding_self_report) is never downgraded back to provisional', () => {
    expect(src).toContain("races.actual_result ->> 'source' = 'onboarding_self_report'");
    // The guard's ELSE branch must be a no-op (keep the existing value),
    // not another write.
    expect(src).toMatch(/ELSE races\.actual_result\s*\n\s*END/);
  });

  it('2d · the write does NOT invoke the post-result chain (no plan exists yet to re-project or archive)', () => {
    // `writeOnboardingRecentRace`'s own body — isolate it from the rest of
    // the file so a `runPostResultChain` call anywhere else in the route
    // (there is one, for the goal race's real result path) cannot leak a
    // false pass here.
    const start = src.indexOf('async function writeOnboardingRecentRace');
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end);
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toContain('runPostResultChain');
  });
});
