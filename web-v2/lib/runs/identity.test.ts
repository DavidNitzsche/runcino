/**
 * lib/runs/identity.test.ts · physical-run identity + merge-op planning.
 *
 * Authored 2026-06-07 alongside the circular-mergedIntoId fix (P1). The core
 * falsifier: a day whose two rows point at EACH OTHER (A→B, B→A) — the state a
 * stale weather UPDATE re-applied after autoMerge on 06-07 — must resolve to
 * exactly ONE canonical with no cycle, so volume.ts stops zeroing the day.
 */
import { describe, it, expect } from 'vitest';
import {
  isSameRun,
  clusterRuns,
  pickCanonical,
  planMergeOps,
  type RunRow,
  type MergeOps,
} from './identity';

// ── fixtures ────────────────────────────────────────────────────────────────
function row(
  id: string,
  source: string,
  opts: Partial<{
    dist: number; dur: number; start: string; date: string;
    mergedIntoId: string; splits: unknown[];
  }> = {},
): RunRow {
  const data: Record<string, unknown> = {
    source,
    date: opts.date ?? '2026-06-02',
    startLocal: opts.start ?? '2026-06-02T07:00:00',
    distanceMi: opts.dist ?? 7.5,
    durationSec: opts.dur ?? 3600,
  };
  if (opts.splits) data.splits = opts.splits;
  if (opts.mergedIntoId !== undefined) data.mergedIntoId = opts.mergedIntoId;
  return { id, user_uuid: 'u', data };
}
const realSplit = [{ pace: '8:00', hr: 140 }];

// Apply a plan's flag ops to a COPY of the rows (mirrors merge.ts: clears then sets).
function applyOps(rows: RunRow[], ops: MergeOps): RunRow[] {
  const next = rows.map((r) => ({ ...r, data: { ...r.data } }));
  const byId = new Map(next.map((r) => [r.id, r]));
  for (const id of ops.clears) { const r = byId.get(id); if (r) delete (r.data as any).mergedIntoId; }
  for (const { id, canonicalId } of ops.sets) { const r = byId.get(id); if (r) (r.data as any).mergedIntoId = canonicalId; }
  return next;
}

// The invariant the reader (volume.ts) depends on: every physical-run cluster
// has EXACTLY ONE unflagged row, every other row points at it, and no row's
// mergedIntoId points at a row that points back.
function assertCanonicalInvariant(rows: RunRow[]) {
  for (const cluster of clusterRuns(rows)) {
    const unflagged = cluster.filter((r) => r.data?.mergedIntoId == null);
    expect(unflagged.length).toBe(1);
    const canonicalId = unflagged[0].id;
    for (const r of cluster) {
      if (r.id !== canonicalId) expect(String(r.data?.mergedIntoId)).toBe(canonicalId);
    }
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    const target = r.data?.mergedIntoId;
    if (target == null) continue;
    const t = byId.get(String(target));
    if (t) expect(String(t.data?.mergedIntoId ?? '')).not.toBe(r.id);
  }
}

// ── isSameRun ────────────────────────────────────────────────────────────────
describe('isSameRun', () => {
  it('clusters a watch + apple_watch dupe of the same physical run', () => {
    const w = row('W', 'watch', { start: '2026-06-02T07:00:00' });
    const aw = row('AW', 'apple_watch', { start: '2026-06-02T07:00:05', dist: 7.52, dur: 3605 });
    expect(isSameRun(w, aw)).toBe(true);
  });
  it('keeps two genuinely distinct same-day runs separate', () => {
    const am = row('AM', 'apple_watch', { start: '2026-06-02T07:00:00', dist: 5, dur: 2400 });
    const pm = row('PM', 'apple_watch', { start: '2026-06-02T18:00:00', dist: 3, dur: 1500 });
    expect(isSameRun(am, pm)).toBe(false);
  });
});

// ── runner-timezone threading (2026-07-06 · audit P1-51) ────────────────────
// The DANGER-ZONE contract: passing the runner's stored tz must be
// BYTE-IDENTICAL to the old hardcoded default for a Pacific runner (every
// profile with runs stored 'America/Los_Angeles' at rollout), while a
// non-Pacific tz must fix the bare-Strava-wall-time reconstruction that
// duplicated runs for everyone else.
describe('isSameRun · defaultTz threading', () => {
  // Strava start_date_local carries a spurious Z (athlete-LOCAL wall time,
  // Z stripped inside startUtcMs) · apple_health carries a REAL-UTC Z.
  // 07:00 athlete-local vs 06:10:00Z: for a London athlete these overlap
  // (07:00 BST = 06:00Z, span 06:00–07:00Z vs 06:10–07:10Z) · read as
  // Pacific they sit 8 h apart.
  const strava = row('S', 'strava', { start: '2026-06-02T07:00:00Z' });
  const hk = row('H', 'apple_health', { start: '2026-06-02T06:10:00Z' });

  it('is byte-identical for a Pacific runner: explicit LA == old hardcoded default', () => {
    for (const [a, b] of [[strava, hk],
      [row('W', 'watch'), row('AW', 'apple_watch', { start: '2026-06-02T07:00:05', dist: 7.52, dur: 3605 })],
      [row('AM', 'apple_watch', { dist: 5, dur: 2400 }), row('PM', 'apple_watch', { start: '2026-06-02T18:00:00', dist: 3, dur: 1500 })],
    ] as const) {
      expect(isSameRun(a, b, 'America/Los_Angeles')).toBe(isSameRun(a, b));
    }
  });

  it('merges a London runner\'s Strava + HK pair that the Pacific default splits', () => {
    expect(isSameRun(strava, hk)).toBe(false);                   // old behavior · dupe survives
    expect(isSameRun(strava, hk, 'Europe/London')).toBe(true);   // runner-tz threading · merged
  });

  it('a row\'s own data.timezone beats the caller defaultTz', () => {
    const pinned = { ...strava, data: { ...strava.data, timezone: 'Europe/London' } };
    // Even with the Pacific default, the London-pinned row reconstructs right.
    expect(isSameRun(pinned, hk)).toBe(true);
  });
});

describe('planMergeOps · defaultTz threading', () => {
  it('produces identical ops for a Pacific runner with and without the explicit tz', () => {
    const rows = [
      row('A', 'apple_watch', { mergedIntoId: 'B' }),
      row('B', 'watch', { mergedIntoId: 'A' }),
      row('S', 'strava', { start: '2026-06-02T07:00:00Z' }),
    ];
    expect(planMergeOps(rows, 'America/Los_Angeles')).toEqual(planMergeOps(rows));
  });
});

// ── pickCanonical · lock the trust-flip behavior (refactor regression guard) ──
describe('pickCanonical', () => {
  it('trust-flips apple_watch over the untrustworthy watch when equivalent and splits not demoted', () => {
    const w = row('W', 'watch');                          // tier 5, untrustworthy, 0 real splits
    const aw = row('AW', 'apple_watch', { splits: realSplit }); // tier 3, trustworthy, 1 real split
    expect(pickCanonical([w, aw]).canonical.id).toBe('AW');
  });
  it('does NOT flip when the watch row carries richer split coverage', () => {
    const w = row('W', 'watch', { splits: [...realSplit, ...realSplit] }); // 2 real splits
    const aw = row('AW', 'apple_watch', { splits: realSplit });            // 1 real split
    expect(pickCanonical([w, aw]).canonical.id).toBe('W');
  });

  // 2026-07-07 · wave3b/phone-gps-recording review fix. Before this, 'phone'
  // had no SOURCE_TIER entry and fell through to tier 0 — the SAME tier as
  // null/garbage sources — so a phone-recorded run always LOST canonical
  // selection to any same-day Strava/HK dupe of the identical physical run
  // (e.g. auto-push-to-Strava re-ingest, or the runner also running Strava's
  // own app). That inverted the locked doctrine "Faff app first, then
  // HealthKit, then Strava." phone must tie watch at tier 5: both are Faff's
  // own direct-record path, no third-party ingest in between.
  it('a phone-recorded run beats a same-day Strava dupe on tier alone, despite zero richness', () => {
    const phone = row('P', 'phone', { start: '2026-06-02T07:00:00Z' }); // no HR/cadence/splits — no sensor
    const strava = row('S', 'strava', { start: '2026-06-02T07:00:05Z', dist: 7.52, dur: 3605 });
    expect(pickCanonical([phone, strava]).canonical.id).toBe('P');
  });
  it('a phone-recorded run beats a same-day apple_watch HK dupe on tier alone', () => {
    const phone = row('P', 'phone', { start: '2026-06-02T07:00:00Z' });
    const aw = row('AW', 'apple_watch', { start: '2026-06-02T07:00:05', splits: realSplit, dist: 7.52, dur: 3605 });
    expect(pickCanonical([phone, aw]).canonical.id).toBe('P');
  });
  it('phone and watch tie at tier 5 — richness breaks the tie, not an implicit ordering', () => {
    const phone = row('P', 'phone', { splits: [...realSplit, ...realSplit] }); // 2 real splits
    const watch = row('W', 'watch');                                          // 0 splits
    expect(pickCanonical([phone, watch]).canonical.id).toBe('P');
  });
});

// ── planMergeOps · the cycle-free invariant ──────────────────────────────────
describe('planMergeOps', () => {
  it('flags a fresh unmerged dupe (one set, no clears)', () => {
    const w = row('W', 'watch', { splits: [...realSplit, ...realSplit] });
    const aw = row('AW', 'apple_watch', { splits: realSplit });
    const ops = planMergeOps([w, aw]);
    expect(ops.clears).toEqual([]);
    expect(ops.sets).toEqual([{ id: 'AW', canonicalId: 'W' }]);
    assertCanonicalInvariant(applyOps([w, aw], ops));
  });

  it('is a no-op on an already-correctly-merged dupe (idempotent steady state)', () => {
    const w = row('W', 'watch', { splits: [...realSplit, ...realSplit] }); // canonical
    const aw = row('AW', 'apple_watch', { splits: realSplit, mergedIntoId: 'W' });
    const ops = planMergeOps([w, aw]);
    expect(ops.clears).toEqual([]);
    expect(ops.sets).toEqual([]);
  });

  it('breaks a CIRCULAR pair (A→B, B→A) into exactly one canonical — the 06-07 bug', () => {
    // apple_watch trust-flips to canonical; both rows are currently flagged.
    const a = row('A', 'apple_watch', { mergedIntoId: 'B' });
    const b = row('B', 'watch', { mergedIntoId: 'A' });
    const before = [a, b];
    // Pre-fix symptom: BOTH rows carry mergedIntoId → the reader's
    // `NOT (data ? 'mergedIntoId')` filter excludes both → the day zeroes.
    expect(before.every((r) => r.data?.mergedIntoId != null)).toBe(true);

    const ops = planMergeOps(before);
    const after = applyOps(before, ops);
    expect(after.filter((r) => r.data?.mergedIntoId == null).length).toBe(1); // exactly one canonical
    assertCanonicalInvariant(after);
  });

  it('breaks a circular pair the OTHER direction (watch stays canonical)', () => {
    // watch keeps richer splits → no trust-flip → watch is canonical.
    const a = row('A', 'apple_watch', { mergedIntoId: 'B' });
    const b = row('B', 'watch', { mergedIntoId: 'A', splits: realSplit });
    const after = applyOps([a, b], planMergeOps([a, b]));
    expect(after.find((r) => r.id === 'B')!.data?.mergedIntoId).toBeUndefined();
    expect(String(after.find((r) => r.id === 'A')!.data?.mergedIntoId)).toBe('B');
    assertCanonicalInvariant(after);
  });

  it('heals a lone row orphaned by a deleted partner (singleton stale flag cleared)', () => {
    const x = row('X', 'apple_watch', { mergedIntoId: 'gone-999' });
    const ops = planMergeOps([x]);
    expect(ops.clears).toEqual(['X']);
    assertCanonicalInvariant(applyOps([x], ops));
  });

  it('leaves a clean lone run untouched (no churn)', () => {
    const ops = planMergeOps([row('X', 'apple_watch')]);
    expect(ops.clears).toEqual([]);
    expect(ops.sets).toEqual([]);
  });

  it('is idempotent: re-planning after applying the ops yields nothing', () => {
    const a = row('A', 'apple_watch', { mergedIntoId: 'B' });
    const b = row('B', 'watch', { mergedIntoId: 'A' });
    const after = applyOps([a, b], planMergeOps([a, b]));
    const second = planMergeOps(after);
    expect(second.clears).toEqual([]);
    expect(second.sets).toEqual([]);
  });
});
