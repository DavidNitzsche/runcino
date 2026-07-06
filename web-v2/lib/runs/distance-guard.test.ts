/**
 * distance-guard.test.ts · 2026-07-06 · audit P1-26 / P2-62 fix.
 *
 * Locks the run-distance classification that replaced the flat 50 mi
 * ingest ceiling (which 400'd real ultra runs into both durable queues'
 * dead-letter paths — permanent silent loss). See lib/runs/distance-guard.ts
 * for the full rationale + Research citations.
 *
 * Run: npx vitest run lib/runs/distance-guard.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRunDistance,
  excludeDistanceReviewSql,
  SOFT_DISTANCE_CEILING_MI,
  HARD_DISTANCE_CEILING_MI,
  DISTANCE_REVIEW_FLAG,
} from './distance-guard';

describe('classifyRunDistance', () => {
  it('accepts ordinary runs untouched', () => {
    for (const mi of [0.3, 6.2, 13.1, 26.2, 31.07, 50]) {
      const g = classifyRunDistance(mi);
      expect(g.verdict).toBe('ok');
      expect(g.qualityFlag).toBeNull();
      expect(g.distanceMi).toBe(mi);
    }
  });

  it('quarantines (not rejects) the 50–250 mi ultra band — the P1-26 loss case', () => {
    // 50.01 (50-mile ultra with GPS over-read), 62.14 (100K), 100 (100-miler),
    // 190 (24-hour world-class), 250 (edge of sanity bound).
    for (const mi of [50.01, 62.14, 100, 190, 250]) {
      const g = classifyRunDistance(mi);
      expect(g.verdict).toBe('review');
      expect(g.qualityFlag).toBe(DISTANCE_REVIEW_FLAG);
    }
  });

  it('rejects only past the hard sanity bound', () => {
    for (const mi of [250.1, 400, 10000]) {
      expect(classifyRunDistance(mi).verdict).toBe('reject');
      expect(classifyRunDistance(mi).qualityFlag).toBeNull();
    }
  });

  it('treats null/undefined/NaN as 0 — the sub-threshold guard owns that end', () => {
    expect(classifyRunDistance(null).verdict).toBe('ok');
    expect(classifyRunDistance(undefined).verdict).toBe('ok');
    expect(classifyRunDistance(Number.NaN).verdict).toBe('ok');
  });

  it('bounds are exactly the exported constants (boundary inclusivity)', () => {
    expect(classifyRunDistance(SOFT_DISTANCE_CEILING_MI).verdict).toBe('ok');
    expect(classifyRunDistance(SOFT_DISTANCE_CEILING_MI + 0.001).verdict).toBe('review');
    expect(classifyRunDistance(HARD_DISTANCE_CEILING_MI).verdict).toBe('review');
    expect(classifyRunDistance(HARD_DISTANCE_CEILING_MI + 0.001).verdict).toBe('reject');
  });
});

describe('excludeDistanceReviewSql', () => {
  it('emits a null-safe predicate on the given alias', () => {
    expect(excludeDistanceReviewSql('sa')).toBe(
      `COALESCE(sa.data->>'qualityFlag','') <> 'distance_review'`,
    );
  });
});

describe('Rule 6 · merge-upsert preservation contract', () => {
  // Every ingest writer upserts `SET data = runs.data ||
  // jsonb_strip_nulls(EXCLUDED.data)`. The quarantine flag rides on that
  // contract: payloads carry the key ONLY when flagged (spread idiom
  // `...(g.qualityFlag ? { qualityFlag: g.qualityFlag } : {})`), so a
  // clean re-POST's merge preserves a prior flag, and clearing is an
  // explicit field-level `data - 'qualityFlag'` — never silent. Emulate
  // the Postgres merge semantics to lock the payload-shape contract.
  const stripNulls = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  const pgMerge = (existing: Record<string, unknown>, incoming: Record<string, unknown>) =>
    ({ ...existing, ...stripNulls(incoming) });

  const payloadFor = (mi: number) => {
    const g = classifyRunDistance(mi);
    return {
      distanceMi: mi,
      ...(g.qualityFlag ? { qualityFlag: g.qualityFlag } : {}),
    };
  };

  it('clean payloads carry NO qualityFlag key (absent, not null)', () => {
    expect('qualityFlag' in payloadFor(26.2)).toBe(false);
  });

  it('flagged write then clean re-POST: merge preserves the flag (writer-A/writer-B shape)', () => {
    const row = pgMerge({}, payloadFor(100));           // writer A · 100 mi flagged
    expect(row.qualityFlag).toBe(DISTANCE_REVIEW_FLAG);
    const after = pgMerge(row, payloadFor(26.2));       // writer B · payload lacks the field
    expect(after.qualityFlag).toBe(DISTANCE_REVIEW_FLAG); // preserved · cleared only explicitly
  });

  it('clean write then flagged re-POST: flag lands', () => {
    const row = pgMerge(pgMerge({}, payloadFor(10)), payloadFor(60));
    expect(row.qualityFlag).toBe(DISTANCE_REVIEW_FLAG);
  });
});
