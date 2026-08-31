/**
 * lib/runs/absorb-splits-verdict.test.ts
 *
 * 2026-08-21 · backend audit · a verdict outlived the data it judged.
 *
 * `/api/watch/workouts/complete` drops a derived per-mile array that fails
 * `splitTimesReliable`, writing `splits: []` plus `splits_unreliable: true`.
 * That route has no path that ever writes the flag back to false — only the
 * iPhone ingest route (`/api/ingest/workout`) does, which is why every stale
 * row in production is watch-canonical.
 *
 * `enhanceCanonicalFromAbsorbed` then fills the SAME row with real per-mile
 * splits off the HealthKit sibling (the tier-independent Fix-4a branch) and
 * used to leave the old verdict sitting on top of the new array.
 *
 * Four readers gate on the flag and all four silently drop the run:
 *   · lib/coach/pacing-discipline.ts   — SQL `IS NOT TRUE`, the run leaves the query
 *   · lib/training/goal-projection.ts  — judgeTestPointExecution skips split judging
 *   · lib/execution/reconstruct.ts
 *   · app/api/runs/[id]/recap/route.ts
 *
 * Verified against production (faff_readonly, 2026-08-21): 6 canonical runs
 * carried `splits_unreliable: true` alongside real per-mile splits whose
 * `provenance.splits` reads `apple_watch` — among them run -226447289863060
 * (2026-06-14, 13.13 mi, 14 splits) and -132305279286285 (2026-06-27,
 * 14.02 mi, 15 splits).
 *
 * F1  absorbing real splits clears `splits_unreliable` and `splits_validation`
 * F2  ... and the reader-visible predicate flips with it
 * F3  a canonical that ALREADY has real splits is untouched — flag included,
 *     because no array was replaced and the verdict still describes live data
 * F4  a run that never carried the flag gains nothing (no key invented)
 * F5  the clear does not disturb unrelated keys on the canonical row
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

import { pool } from '@/lib/db/pool';
import { enhanceCanonicalFromAbsorbed } from '@/lib/runs/canonical';

const CANONICAL_ID = '-226447289863060';
const ABSORBED_ID = '-3558250452245243';
const USER = 'abcdef12-3456-7890-abcd-ef1234567890';

/**
 * Real per-mile splits, shaped as production stores them.
 *
 * 2026-08-30 · THE FIXTURE HAD TO DECOMPOSE ITS OWN RUN.
 *
 * This used to give every element `distanceMi: 1`, so `realSplits(14)` summed
 * to 14.00 miles on a fixture whose run is 13.13 — an array describing a
 * different run, which is precisely the shape `chooseSplits` now refuses (the
 * 2026-07-25 apple_watch array sums to 18.893 against a stated 18.00). The
 * fixture was passing only because nothing checked.
 *
 * `totalMi` defaults to the canonical's own distance so a sibling array is a
 * decomposition of the SAME run, with the final mile carrying the remainder,
 * which is what a real per-mile array looks like.
 */
function realSplits(n: number, totalMi = 13.13) {
  return Array.from({ length: n }, (_, i) => ({
    mile: i + 1,
    pace: '7:41',
    hr: 139 + i,
    cadence: 162,
    elev_ft: -3,
    // Whole miles, then whatever is left. Rounded so the sum is exact.
    distanceMi: i < n - 1 ? 1 : Math.round((totalMi - (n - 1)) * 1e6) / 1e6,
  }));
}

/** Capture of the committed `UPDATE runs SET data = …` payload. */
type Committed = { data: Record<string, unknown>; provenance: Record<string, string> } | null;

function installPool(canonicalData: Record<string, unknown>, canonicalProv: Record<string, string>) {
  const committed: { current: Committed } = { current: null };
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation(
    async (sql: string, params?: unknown[]) => {
      if (/SELECT\s+id,\s+data,\s+provenance,\s+shoe_id/i.test(sql)) {
        return {
          rows: [{
            id: CANONICAL_ID,
            data: canonicalData,
            provenance: canonicalProv,
            // Non-null so the two shoe-attribution branches are skipped and
            // the only UPDATE we capture is the data commit.
            shoe_id: 7,
          }],
          rowCount: 1,
        };
      }
      // 2026-08-30 · the data commit is no longer a bare `SET data = $1::jsonb`.
      // It carries the Rule-6 CASE from run-shape.ts:preserveMergedIntoIdSql,
      // which keeps a `mergedIntoId` a concurrent merge wrote after this
      // function read its snapshot. Match the statement, not its shape.
      if (/UPDATE runs\s+SET data =/i.test(sql)) {
        const p = params as [string, string, string];
        committed.current = { data: JSON.parse(p[0]), provenance: JSON.parse(p[1]) };
        return { rows: [], rowCount: 1 };
      }
      // The absorption stamp is now conditional (see mayStampAbsorbed). Answer
      // it the way a healthy row does — the loser really did lose to this
      // canonical — so these fixtures exercise the ordinary path and a refusal
      // here would be a real signal rather than mock noise.
      if (/SET absorbed_into_canonical_at = NOW\(\)/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  );
  return committed;
}

/** The stale shape production actually held: watch canonical, splits dropped
 *  to [] by the reliability guard, verdict + reconciliation blob left behind. */
function staleWatchCanonical() {
  return {
    id: `${USER}-2026-06-14`,
    source: 'watch',
    date: '2026-06-14',
    distanceMi: 13.13,
    durationSec: 6573,
    splits: [],
    splits_unreliable: true,
    splits_validation: { deltaS: 315, durationS: 3625, splitsSumS: 3940, droppedCount: 7 },
    avgHr: 148,
    watchCompletionRef: `${USER}-2026-06-14`,
  } as Record<string, unknown>;
}

function hkSibling(splits: unknown) {
  return {
    id: ABSORBED_ID,
    user_uuid: USER,
    data: { source: 'apple_watch', splits },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('enhanceCanonicalFromAbsorbed · the splits verdict follows the splits', () => {
  it('F1 · clears splits_unreliable and splits_validation when real splits are absorbed', async () => {
    const committed = installPool(staleWatchCanonical(), {});

    const res = await enhanceCanonicalFromAbsorbed({
      canonicalId: CANONICAL_ID,
      absorbedRow: hkSibling(realSplits(14)),
    });

    // The message names the miles it added — see chooseSplits. Assert the
    // SHAPE of the result (fourteen miles landed), not merely that some
    // string starting with "splits" appeared: an absence-only or prefix-only
    // assertion is satisfied by garbage.
    expect(res.fieldsAdded.some(f => f.startsWith('splits (+14 mile(s)'))).toBe(true);
    expect(committed.current).not.toBeNull();
    const data = committed.current!.data;

    // The new array landed …
    expect(Array.isArray(data.splits)).toBe(true);
    expect((data.splits as unknown[]).length).toBe(14);
    // … and the verdict about the array it replaced did not survive it.
    expect('splits_unreliable' in data).toBe(false);
    expect('splits_validation' in data).toBe(false);
  });

  it('F2 · the predicate every reader gates on flips with the data', async () => {
    const committed = installPool(staleWatchCanonical(), {});
    await enhanceCanonicalFromAbsorbed({
      canonicalId: CANONICAL_ID,
      // 14, not 15: a 13.13-mile run decomposes into fourteen splits (thirteen
      // whole miles and a 0.13 remainder), and a fifteenth would describe a
      // run that did not happen. See the note on `realSplits`.
      absorbedRow: hkSibling(realSplits(14)),
    });
    const data = committed.current!.data as { splits_unreliable?: boolean };

    // lib/coach/pacing-discipline.ts:  AND (data->>'splits_unreliable')::boolean IS NOT TRUE
    // lib/execution/reconstruct.ts:    if (runData.splits_unreliable !== true)
    // app/api/runs/[id]/recap:         data.splits_unreliable !== true
    // lib/training/goal-projection.ts: splitsUnreliable: r.splits_unreliable === true
    expect(data.splits_unreliable !== true).toBe(true);
    expect(data.splits_unreliable === true).toBe(false);
  });

  it('F3 · a canonical whose splits are already complete keeps its own flag', async () => {
    // Nothing is replaced here, so the verdict still describes live data and
    // clearing it would be inventing a reliability claim we did not compute.
    //
    // 2026-08-30 · the sibling now carries the SAME fourteen miles rather than
    // one more than the canonical. Under the old adopt-only-when-empty rule
    // any non-empty canonical was untouchable, so "13 against 14" read as
    // "nothing to do"; it was in fact a canonical missing its last mile, which
    // is the defect this file's sibling `_ingest_integrity.test.ts` exists for.
    // Equal coverage is the honest way to say "there is nothing to add".
    const canonical = { ...staleWatchCanonical(), splits: realSplits(14) };
    const committed = installPool(canonical, {});

    const res = await enhanceCanonicalFromAbsorbed({
      canonicalId: CANONICAL_ID,
      absorbedRow: hkSibling(realSplits(14)),
    });

    expect(res.fieldsSkipped.some(f => f.startsWith('splits (no adoption'))).toBe(true);
    expect(res.fieldsAdded.some(f => f.startsWith('splits_unreliable'))).toBe(false);
    // Either nothing was committed at all, or the flag survived untouched.
    if (committed.current) {
      expect(committed.current.data.splits_unreliable).toBe(true);
    }
  });

  it('F3b · a SHORT canonical takes the mile it was missing, and the verdict goes with it', async () => {
    // The 2026-07-25 shape, in miniature: the canonical holds a contiguous
    // 1..13 of a 13.13-mile run and the sibling holds 1..14. The last mile is
    // the fast finish, and it is the mile the old rule threw away.
    const canonical = { ...staleWatchCanonical(), splits: realSplits(13, 13.0) };
    const committed = installPool(canonical, {});

    const res = await enhanceCanonicalFromAbsorbed({
      canonicalId: CANONICAL_ID,
      absorbedRow: hkSibling(realSplits(14)),
    });

    expect(res.fieldsAdded.some(f => f.startsWith('splits (+1 mile(s) [14]'))).toBe(true);
    const splits = committed.current!.data.splits as Array<Record<string, unknown>>;
    expect(splits).toHaveLength(14);
    // Ordered by mile, and the first thirteen are the canonical's OWN
    // elements — byte-identical, so nothing a consumer already reads moved.
    expect(splits.map(s => s.mile)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,14]);
    expect(splits.slice(0, 13)).toEqual(realSplits(13, 13.0));
    // The added element is in the one shape this path writes, and carries the
    // sibling's measured HR rather than a zero.
    expect(splits[13]).toMatchObject({ mile: 14, pace: '7:41', paceSecPerMi: 461, hr: 152 });
    // The verdict described the array that has just changed, so it cannot survive it.
    expect('splits_unreliable' in committed.current!.data).toBe(false);
  });

  it('F4 · a clean run gains no key it never had', async () => {
    const canonical = staleWatchCanonical();
    delete canonical.splits_unreliable;
    delete canonical.splits_validation;
    const committed = installPool(canonical, {});

    await enhanceCanonicalFromAbsorbed({
      canonicalId: CANONICAL_ID,
      absorbedRow: hkSibling(realSplits(14)),
    });

    const data = committed.current!.data;
    expect('splits_unreliable' in data).toBe(false);
    expect('splits_validation' in data).toBe(false);
  });

  it('F5 · unrelated keys on the canonical row are undisturbed', async () => {
    const committed = installPool(staleWatchCanonical(), { splits: 'watch' });

    await enhanceCanonicalFromAbsorbed({
      canonicalId: CANONICAL_ID,
      absorbedRow: hkSibling(realSplits(14)),
    });

    const data = committed.current!.data;
    expect(data.distanceMi).toBe(13.13);
    expect(data.durationSec).toBe(6573);
    expect(data.avgHr).toBe(148);
    expect(data.watchCompletionRef).toBe(`${USER}-2026-06-14`);
    expect(data.source).toBe('watch');
    // provenance for splits is re-stamped to the row the array came from
    expect(committed.current!.provenance.splits).toBe('apple_watch');
  });
});
