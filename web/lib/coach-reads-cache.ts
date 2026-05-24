/**
 * Coach reads cache. Per docs/COACH_VOICE_AUDIT_AND_REWRITE.md §8 +
 * Phase 6. Engine reads are computed once on event ingest and stored
 * here; web pages, iOS surfaces, and watch tokens all consume the
 * same cached content. One coach computation per event; one source
 * of truth across surfaces.
 *
 * Invalidation triggers (callers fire these):
 *   activity ingest        → invalidate('activity-load')
 *   new race result        → invalidate('vdot-derived')
 *   new health sample      → invalidate('readiness-sleep')
 *   new check-in           → invalidate('readiness')
 *   plan mutation          → invalidate('prescription-chain')
 *   goal change            → invalidate('goal-anchored')
 */

import { query } from './db';

export type ReadKind =
  | 'prescription_today'
  | 'diagnosis_readiness'
  | 'diagnosis_body_systems'
  | 'projection_path_to_race'
  | 'projection_trajectory'
  | 'projection_race_prediction'
  | 'reflection_on_run'
  | 'form_read'
  | 'pattern_sleep_deficit'
  | 'pattern_missed_quality'
  | 'challenge_next_pushes'
  | 'week_deltas';

export interface CachedRead<T = unknown> {
  readKind: ReadKind;
  cacheKey: string;
  content: T;
  computedAt: string;
  ttlAt: string;
  sourceStateHash: string | null;
}

interface RawRow {
  read_kind: string;
  cache_key: string;
  content: unknown;
  computed_at: string | Date;
  ttl_at: string | Date;
  source_state_hash: string | null;
}

function toIso(d: string | Date): string {
  return typeof d === 'string' ? d : d.toISOString();
}

function fromRow<T>(r: RawRow): CachedRead<T> {
  return {
    readKind: r.read_kind as ReadKind,
    cacheKey: r.cache_key,
    content: r.content as T,
    computedAt: toIso(r.computed_at),
    ttlAt: toIso(r.ttl_at),
    sourceStateHash: r.source_state_hash,
  };
}

/** Read from cache. Returns null when no row exists or TTL has passed.
 *  Callers should recompute + write back on miss. */
export async function readCached<T>(
  userUuid: string,
  readKind: ReadKind,
  cacheKey: string,
): Promise<CachedRead<T> | null> {
  const rows = await query<RawRow>(
    `SELECT read_kind, cache_key, content, computed_at, ttl_at, source_state_hash
       FROM coach_reads_cache
      WHERE user_uuid = $1 AND read_kind = $2 AND cache_key = $3
        AND ttl_at > NOW()
      LIMIT 1`,
    [userUuid, readKind, cacheKey],
  );
  return rows[0] ? fromRow<T>(rows[0]) : null;
}

export interface WriteCacheInput<T> {
  userUuid: string;
  readKind: ReadKind;
  cacheKey: string;
  content: T;
  ttlSeconds: number;
  sourceStateHash?: string;
}

/** Upsert a cached read. ttl_at = NOW() + ttlSeconds. */
export async function writeCached<T>(input: WriteCacheInput<T>): Promise<void> {
  await query(
    `INSERT INTO coach_reads_cache
       (user_uuid, read_kind, cache_key, content, computed_at, ttl_at, source_state_hash)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW() + ($5 || ' seconds')::interval, $6)
     ON CONFLICT (user_uuid, read_kind, cache_key) DO UPDATE
       SET content = EXCLUDED.content,
           computed_at = EXCLUDED.computed_at,
           ttl_at = EXCLUDED.ttl_at,
           source_state_hash = EXCLUDED.source_state_hash`,
    [
      input.userUuid, input.readKind, input.cacheKey,
      JSON.stringify(input.content),
      String(input.ttlSeconds),
      input.sourceStateHash ?? null,
    ],
  );
}

/** Per spec §8 cache invalidation rules. Each trigger maps to a set
 *  of read_kinds that depend on the changed inputs. Callers pass the
 *  trigger; we delete every matching cache row, forcing recompute. */
export type InvalidationTrigger =
  | 'activity-load'        // new activity ingest
  | 'vdot-derived'         // new race result
  | 'readiness-sleep'      // new health sample
  | 'readiness'            // new check-in
  | 'prescription-chain'   // plan mutation
  | 'goal-anchored';       // goal change

const INVALIDATION_MAP: Record<InvalidationTrigger, ReadKind[]> = {
  'activity-load': [
    'reflection_on_run', 'form_read',
    'diagnosis_readiness', 'diagnosis_body_systems',
    'projection_trajectory', 'week_deltas',
    'pattern_missed_quality',
    'prescription_today',
  ],
  'vdot-derived': [
    'projection_race_prediction', 'projection_path_to_race',
    'projection_trajectory', 'prescription_today',
  ],
  'readiness-sleep': [
    'diagnosis_readiness', 'pattern_sleep_deficit', 'prescription_today',
  ],
  'readiness': [
    'diagnosis_readiness', 'prescription_today',
  ],
  'prescription-chain': [
    'prescription_today', 'projection_path_to_race', 'projection_trajectory',
    'week_deltas', 'challenge_next_pushes',
  ],
  'goal-anchored': [
    'projection_race_prediction', 'projection_path_to_race',
    'projection_trajectory', 'prescription_today', 'challenge_next_pushes',
  ],
};

export async function invalidate(
  userUuid: string,
  trigger: InvalidationTrigger,
): Promise<void> {
  const kinds = INVALIDATION_MAP[trigger];
  if (!kinds || kinds.length === 0) return;
  await query(
    `DELETE FROM coach_reads_cache
      WHERE user_uuid = $1 AND read_kind = ANY($2::text[])`,
    [userUuid, kinds],
  );
}

/** Sweep all rows whose TTL has passed. Run on cold start or periodically. */
export async function sweepExpired(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM coach_reads_cache WHERE ttl_at < NOW() RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM deleted`,
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

/** Standard TTLs per spec §8. */
export const READ_TTL_SECONDS: Record<ReadKind, number> = {
  prescription_today: 86400,        // 24h, refresh at 4am cron OR activity ingest
  diagnosis_readiness: 86400,
  diagnosis_body_systems: 86400,
  projection_path_to_race: 604800,  // 7d
  projection_trajectory: 604800,
  projection_race_prediction: 604800,
  reflection_on_run: 31536000,      // 1 year — per activity, basically forever
  form_read: 31536000,
  pattern_sleep_deficit: 86400,
  pattern_missed_quality: 86400,
  challenge_next_pushes: 86400,
  week_deltas: 86400,
};

/** Convenience: compute-and-cache wrapper. If cache hit, return it.
 *  Else call compute(), write result, return. */
export async function withCache<T>(
  userUuid: string,
  readKind: ReadKind,
  cacheKey: string,
  compute: () => Promise<T>,
): Promise<T> {
  const cached = await readCached<T>(userUuid, readKind, cacheKey);
  if (cached) return cached.content;
  const fresh = await compute();
  await writeCached({
    userUuid, readKind, cacheKey,
    content: fresh,
    ttlSeconds: READ_TTL_SECONDS[readKind],
  });
  return fresh;
}
