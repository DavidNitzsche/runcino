/**
 * _label_only_rows.test.ts · a race with a distance LABEL and no number is
 * still a race.
 *
 * ─── the shape ───────────────────────────────────────────────────────────────
 *
 * `POST /api/race` and onboarding write `meta.distanceLabel`; `meta.distanceMi`
 * is left NULL. Verified against production 2026-08-19: 2 of the 12 race rows
 * are that shape — a B-priority "10K" and an A-priority "Marathon". Readers
 * that reach for the numeric field directly see nothing:
 *
 *     mi = row.distance_mi ? Number(row.distance_mi) : 0     // → 0
 *     AND (meta->>'distanceMi')::numeric <= $5               // → NULL, row dropped
 *
 * Neither shape errors. The signal simply never fires, which is indistinguish-
 * able from a signal with nothing to report — so `pr_bank` could not bank a PR
 * set at such a race, `fitness_regression` could not see a bad one, and the
 * tune-up lever could not offer one.
 *
 * The fix is read-time resolution through the one shared resolver, so the
 * numeric column stays exactly as optional as it has always been and no
 * migration or backfill is needed. These tests pin the resolver's behaviour on
 * the real production row shapes, and pin the three call sites to it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { distanceMiOfMeta } from './distance';
import { distanceMiOf } from '@/lib/plan/generate';

const ROOT = join(__dirname, '..', '..');
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('distanceMiOfMeta · the shared read-time resolver', () => {
  it('resolves the two production label-only shapes', () => {
    // santa-monica-10k-2026-09-13 · {"distanceLabel":"10K","distanceMi":null}
    expect(distanceMiOfMeta({ distanceLabel: '10K', name: 'Santa Monica 10k' })).toBe(6.2);
    // my-marathon-2026-10-02 · {"distanceLabel":"Marathon","distanceMi":null}
    expect(distanceMiOfMeta({ distanceLabel: 'Marathon', name: 'My Marathon' })).toBe(26.2);
  });

  it('a numeric distance always wins', () => {
    expect(distanceMiOfMeta({ distanceMi: 26.22, distanceLabel: 'Marathon' })).toBe(26.22);
    // Even when the two disagree — the number is what a writer meant.
    expect(distanceMiOfMeta({ distanceMi: 50, distanceLabel: 'Half Marathon' })).toBe(50);
  });

  it('falls back to the name when there is no label either', () => {
    // sombrero-half / big-sur-marathon carry a numeric distance, but rows
    // written by older paths carried only a name.
    expect(distanceMiOfMeta({ name: 'Sombrero Half Marathon' })).toBe(13.1);
    expect(distanceMiOfMeta({ name: 'Javelina Jundred 100M' })).toBe(100);
  });

  it('returns null rather than guessing', () => {
    expect(distanceMiOfMeta({})).toBeNull();
    expect(distanceMiOfMeta(null)).toBeNull();
    expect(distanceMiOfMeta(undefined)).toBeNull();
    expect(distanceMiOfMeta({ name: 'Turkey Trot' })).toBeNull();
    expect(distanceMiOfMeta({ distanceMi: 0 })).toBeNull();
    expect(distanceMiOfMeta({ distanceMi: -5 })).toBeNull();
  });

  it('generate.ts distanceMiOf is the same function', () => {
    // ~40 call sites and a unit-test file import that name; the move must be a
    // pure relocation, not a second implementation waiting to drift.
    for (const meta of [
      { distanceLabel: '10K' }, { distanceLabel: 'Marathon' }, { distanceMi: 26.22 },
      { name: 'Javelina Jundred 100M' }, { name: 'Turkey Trot' }, {},
    ]) {
      expect(distanceMiOf(meta)).toBe(distanceMiOfMeta(meta));
    }
  });
});

describe('the three signals that could not see a label-only race', () => {
  it('pr_bank and fitness_regression resolve the distance at read time', () => {
    const src = code('lib/plan/adapt.ts');
    // The old shape is gone from both detectors — not softened, gone.
    expect(src).not.toMatch(/raceRow\.distance_mi \? Number\(raceRow\.distance_mi\) : 0/);
    // Both now resolve through the shared resolver. Two occurrences: one per
    // detector, because a fix to only the upward one would leave the engine
    // able to see a label-only race when it went well and blind when it did not.
    const uses = src.match(/distanceMiOfMeta\(raceRow\.meta\) \?\? 0/g) ?? [];
    expect(uses.length).toBe(2);
    // And `meta` is actually selected, or there would be nothing to resolve.
    expect((src.match(/meta->>'date' AS date,\s*\n\s*meta,/g) ?? []).length).toBe(2);
  });

  it('the tune-up lever filters on the resolved distance, not the SQL column', () => {
    const src = code('lib/coach/projection-levers.ts');
    // `NULL <= 26.2` is NULL, not true — the predicate silently dropped every
    // label-only race.
    expect(src).not.toMatch(/AND \(meta->>'distanceMi'\)::numeric <= /);
    expect(src).toMatch(/distanceMiOfMeta\(r\.meta\)/);
    // A row whose distance still will not resolve is DROPPED, never defaulted:
    // the lever has to name the race's distance to the runner.
    expect(src).toMatch(/x\.distanceMi != null && x\.distanceMi > 0 && x\.distanceMi <= goalDistMi/);
  });
});
