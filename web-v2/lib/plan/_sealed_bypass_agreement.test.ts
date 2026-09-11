/**
 * lib/plan/_sealed_bypass_agreement.test.ts · SEALEDBYPASS-1 (2026-09-09).
 *
 * `recompute-paces.ts`, `reanchor-plan.ts`'s maintenance arm, and
 * `race-row-refresh.ts` each carried their OWN ad-hoc "sealed" predicate — a
 * correlated `EXISTS (SELECT 1 FROM runs WHERE ... date matches ...)`
 * subquery — instead of routing through `lib/plan/seal.ts`'s canonical
 * `isPrescriptionSealed`/`isDaySealed`. That is exactly the pre-fix
 * date-EXISTS join SEALING-IDENTITY-1 closed for `adapt.ts`: ANY unmerged run
 * on the same calendar date sealed EVERY prescription that date, with no
 * check the run had anything to do with THAT prescription. Three independent
 * copies of the same pre-fix query meant a day could seal in one call site
 * and stay unsealed in another, depending on which last touched it.
 *
 * TWO THINGS THIS FILE PROVES:
 *
 *   1. BEHAVIOURAL · the shared `sealedWorkoutIdsForRange` (what all three
 *      sites now call) agrees with `isPrescriptionSealed`/`isDaySealed` on
 *      the EXACT scenario the old ad-hoc predicate got wrong: a friend's
 *      unrelated run on the same date as a real prescription. The old
 *      predicate (any unmerged run that date seals it) would have sealed the
 *      prescription; the canonical resolver — and therefore the bulk range
 *      form — does not, because the run does not match.
 *   2. STRUCTURAL · all three real call sites actually CALL
 *      `sealedWorkoutIdsForRange` (imported from `./seal`), and none of them
 *      still carries its own `EXISTS (SELECT ... FROM runs ...)` sealed
 *      subquery. This is what makes agreement a STRUCTURAL guarantee rather
 *      than a coincidence of three separately-maintained queries staying in
 *      sync by luck — the same shape as `lib/plan/seal.ts`'s own header note
 *      that `adapt.ts` "now delegates to this file; nothing computes 'sealed'
 *      any other way."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runs/volume', () => ({ getCanonicalRunIds: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds } from '@/lib/runs/volume';
import { isDaySealed, isPrescriptionSealed, sealedWorkoutIdsForRange } from './seal';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DAY = '2026-09-03';

interface Prescription {
  id: string; type: string; distance_mi: string | null; sub_label: string | null;
  is_quality: boolean; is_long: boolean;
}
interface Run { id: string; data: Record<string, unknown> }

const hillPrescription: Prescription = {
  id: 'wko_hills', type: 'intervals', distance_mi: '6', sub_label: '10x60s hills',
  is_quality: true, is_long: false,
};

function wireRangeAndSingle(prescriptions: Prescription[], runs: Run[], day: string = DAY): void {
  (getCanonicalRunIds as any).mockResolvedValue(runs.map((r) => r.id));
  (pool.query as any).mockImplementation((sql: string) => {
    if (sql.includes('FROM plan_workouts') && sql.includes('MIN(')) {
      return Promise.resolve({ rows: [{ min_iso: day, max_iso: day }] });
    }
    if (sql.includes('FROM plan_workouts')) {
      return Promise.resolve({ rows: prescriptions.map((p) => ({ ...p, date_iso: day })) });
    }
    if (sql.includes('FROM runs')) {
      return Promise.resolve({ rows: runs.map((r) => ({ ...r, day })) });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => vi.clearAllMocks());

describe('SEALEDBYPASS-1 · the bulk range form agrees with the canonical per-row resolver', () => {
  it('the exact live shape all three sites got wrong: a friend\'s unrelated run does NOT seal the real prescription', async () => {
    wireRangeAndSingle([hillPrescription], [
      { id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } },
    ]);

    // The OLD ad-hoc predicate every one of the three sites carried: "any
    // unmerged run exists on this date" → true here (run_friend exists,
    // unmerged) → would have sealed the prescription. Documented, not
    // executed — the old SQL is gone from all three files (proven below).
    const oldAdHocPredicateWouldSeal = true;
    expect(oldAdHocPredicateWouldSeal).toBe(true);

    // The canonical answer, both forms: per-row and bulk-range must agree,
    // and both must say NOT sealed — the run is supplemental, not a match.
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(false);
    expect(await isDaySealed(USER, DAY)).toBe(false);
    const sealedIds = await sealedWorkoutIdsForRange(USER, DAY, '2026-09-04');
    expect(sealedIds).not.toBeNull();
    expect(sealedIds!.has('wko_hills')).toBe(false);
  });

  it('once the real session is EXACT-linked, all three forms agree it IS sealed', async () => {
    wireRangeAndSingle([hillPrescription], [
      { id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } },
      { id: 'run_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } },
    ]);

    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
    expect(await isDaySealed(USER, DAY)).toBe(true);
    const sealedIds = await sealedWorkoutIdsForRange(USER, DAY, '2026-09-04');
    expect(sealedIds).not.toBeNull();
    expect(sealedIds!.has('wko_hills')).toBe(true);
  });

  it('a resolver failure seals the whole range conservatively (null), matching isPrescriptionSealed\'s own posture', async () => {
    (getCanonicalRunIds as any).mockRejectedValue(new Error('db down'));
    (pool.query as any).mockRejectedValue(new Error('db down'));
    expect(await sealedWorkoutIdsForRange(USER, DAY, '2026-09-04')).toBeNull();
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
  });
});

describe('SEALEDBYPASS-1 · structural proof the three sites route through the ONE resolver', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const read = (rel: string): string => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  const SITES = [
    'lib/plan/recompute-paces.ts',
    'lib/plan/reanchor-plan.ts',
    'lib/race/race-row-refresh.ts',
  ];

  it('liveness · the sources read are real and non-trivial', () => {
    for (const rel of SITES) {
      expect(read(rel).length, `${rel} read as suspiciously small`).toBeGreaterThan(2000);
    }
  });

  it.each(SITES)('%s imports sealedWorkoutIdsForRange from the canonical seal module', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/import\s*\{[^}]*\bsealedWorkoutIdsForRange\b[^}]*\}\s*from\s*['"](\.\/seal|@\/lib\/plan\/seal)['"]/);
  });

  it.each(SITES)('%s no longer carries its own EXISTS-against-runs sealed subquery', (rel) => {
    const src = read(rel).replace(/\s+/g, ' ');
    // The exact pre-fix shape: a correlated EXISTS subquery against `runs`
    // whose own alias is compared to `pw.date_iso` — the date-coincidence
    // join this whole incident is about. A legitimate day-resolver read (in
    // day-resolver.ts itself) is exempt from this file's scope entirely.
    expect(src).not.toMatch(/EXISTS\s*\(\s*SELECT[^)]*FROM\s+runs[^)]*pw\.date_iso/is);
  });

  it('all three sites now agree by construction, not by luck: one function, one answer', () => {
    // This is the guarantee the behavioural tests above exercise directly —
    // stated here as the structural claim it rests on. If any site above
    // stopped importing sealedWorkoutIdsForRange, the previous two tests in
    // this describe block would already have failed.
    for (const rel of SITES) {
      const src = read(rel);
      expect(src).toMatch(/sealedWorkoutIdsForRange\(/);
    }
  });
});
