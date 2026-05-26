/**
 * cache.ts — briefing cache backed by Postgres (table: briefings).
 *
 * Signature is computed from state inputs that SHOULD change the voice:
 *   today date · latest_activity_id · count(check-ins in last 7d) · profile_hash · race_signature
 *
 * Engine reads cache first; only calls LLM on miss. Mutating endpoints
 * (checkin, profile, race, shoe, workout-swap) call bustBriefingCache()
 * which deletes rows for the user — next /api/briefing call regenerates.
 */
import { createHash } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import type { CoachState, Topic } from '@/lib/topics/types';
import type { Surface } from './router';

const TTL_MS = 24 * 3600 * 1000;  // hard ceiling — stale data > 24h regenerates

export interface CachedBriefing {
  surface: Surface;
  mode: string;
  lead: string;
  voice: string[];
  topics: Topic[];
  _state: any;
}

export function signatureOf(state: CoachState, raceSlug?: string, compact?: boolean): string {
  const inputs = {
    today: state.today,
    latest_activity: state.latest_activity?.id ?? null,
    last_checkin_ts: state.recentCheckIns[0]?.ts ?? null,
    profile_hash: createHash('sha1').update(JSON.stringify(state.profile ?? {})).digest('hex').slice(0, 12),
    pending_intents: state.pendingIntents.length,
    // INCLUDE the whole plan week in the signature — any swap, type
    // change, distance change to ANY day in the week regenerates voice.
    // (Replaces the prior today_workout + next_workout single-row hashes,
    // which only captured changes to those two specific rows.)
    week_plan: (state.currentWeekDays ?? [])
      .map((d) => `${d.date}|${d.type}|${d.mi}`).join(','),
    race_slug: raceSlug ?? null,
    // iOS compact mode produces a different voice than web — keep cache buckets separate.
    compact: compact ? 1 : 0,
  };
  return createHash('sha1').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

export async function readCachedBriefing(userId: string, surface: Surface, signature: string): Promise<CachedBriefing | null> {
  try {
    const r = (await pool.query(
      `SELECT payload, generated_at FROM briefings
        WHERE user_id = $1 AND surface = $2 AND signature = $3
        ORDER BY generated_at DESC LIMIT 1`,
      [userId, surface, signature]
    )).rows[0];
    if (!r) return null;
    if (Date.now() - new Date(r.generated_at).getTime() > TTL_MS) return null;
    return r.payload as CachedBriefing;
  } catch {
    return null;
  }
}

export async function writeCachedBriefing(userId: string, surface: Surface, signature: string, mode: string, payload: CachedBriefing): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO briefings (user_id, surface, mode, signature, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, surface, signature)
       DO UPDATE SET payload = EXCLUDED.payload, generated_at = now(), mode = EXCLUDED.mode`,
      [userId, surface, mode, signature, payload]
    );
  } catch {
    // Cache write failure is non-fatal — engine still returned the live result.
  }
}

/**
 * Bust the cache for a user. Called from mutating endpoints whenever something
 * changes that should produce a fresh voice on next briefing fetch.
 */
export async function bustBriefingCache(userId: string, surface?: Surface): Promise<void> {
  try {
    if (surface) {
      await pool.query(`DELETE FROM briefings WHERE user_id = $1 AND surface = $2`, [userId, surface]);
    } else {
      await pool.query(`DELETE FROM briefings WHERE user_id = $1`, [userId]);
    }
  } catch {
    // non-fatal
  }
}
