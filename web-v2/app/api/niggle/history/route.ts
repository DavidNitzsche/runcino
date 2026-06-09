/**
 * GET /api/niggle/history
 *
 * Returns the full niggle log for the authenticated user — two shapes:
 *   summary  · one row per (body_part, side) combination with aggregate stats
 *             including recent_flare_count (Phase 2 recurrence flag)
 *   episodes · every niggle row, newest first, with recovery trend and
 *             acwr_at_log — ACWR in the 7 days before logging (Phase 2)
 *
 * Phase 2:
 *   ACWR join  — LEFT JOIN LATERAL fires one 28-day mileage scan per episode;
 *                MAX-per-day dedup matches training-form.ts convention.
 *   Recurrence — JS post-processing counts episodes per (body_part, side)
 *                within the 60 days before last_flare_at.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export interface BodyPartSummary {
  body_part: string;
  side: string | null;
  total_episodes: number;
  last_flare_at: string;           // ISO timestamp
  avg_severity: number;
  avg_days_active: number;
  days_since_last_flare: number;   // floor of days
  recent_flare_count: number;      // episodes in the 60 days before last_flare_at
}

export interface RecoveryEntry {
  response: 'better' | 'same' | 'worse' | 'gone';
  logged_at: string;               // ISO timestamp
}

export interface EpisodeRow {
  id: number;
  body_part: string;
  side: string | null;
  severity: number;
  status: 'just_started' | 'few_days' | 'weeks';
  note: string | null;
  logged_at: string;
  cleared_at: string | null;       // null = still active
  days_active: number;
  check_in_count: number;
  recovery_trend: RecoveryEntry[];
  acwr_at_log: number | null;      // ACWR in the 7 days before logged_at; null = no history
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    // ── 1. Body-part rollup ──────────────────────────────────────────────
    const summaryRes = await pool.query<{
      body_part: string;
      side: string | null;
      total_episodes: string;
      last_flare_at: Date;
      avg_severity: string;
      avg_days_active: string;
      days_since_last_flare: string;
    }>(
      `SELECT
        body_part,
        side,
        COUNT(*)::int                                                          AS total_episodes,
        MAX(logged_at)                                                         AS last_flare_at,
        ROUND(AVG(severity)::numeric, 1)                                       AS avg_severity,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (COALESCE(cleared_at, now()) - logged_at)) / 86400.0
        )::numeric, 1)                                                         AS avg_days_active,
        FLOOR(EXTRACT(EPOCH FROM (now() - MAX(logged_at))) / 86400.0)::int     AS days_since_last_flare
      FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1
      GROUP BY body_part, side
      ORDER BY MAX(logged_at) DESC`,
      [userId],
    );

    // ── 2. Full episode list with ACWR at time of logging ────────────────
    // LEFT JOIN LATERAL fires one 28-day mileage scan per episode row.
    // Inner subquery takes MAX distanceMi per calendar day (same dedup guard
    // used in training-form.ts to avoid double-counting watch/apple_watch
    // sibling rows for the same physical run).
    //
    // ACWR formula (matches training-form.ts:210-213):
    //   acute7        = sum of mi in the 7 days ending on logged_at (d >= logged_at - 6)
    //   chronic28_wk  = sum of mi in the 28-day window / 4
    //   acwr          = acute7 * 4 / chronic28_total   (≡ acute7 / chronic28_wk)
    const episodesRes = await pool.query<{
      id: string;
      body_part: string;
      side: string | null;
      severity: number;
      status: string;
      note: string | null;
      logged_at: Date;
      cleared_at: Date | null;
      days_active: string;
      check_in_count: string;
      acwr_at_log: string | null;
    }>(
      `SELECT
        n.id,
        n.body_part,
        n.side,
        n.severity,
        n.status,
        n.note,
        n.logged_at,
        n.cleared_at,
        ROUND(
          EXTRACT(EPOCH FROM (COALESCE(n.cleared_at, now()) - n.logged_at)) / 86400.0
        )::int                                                               AS days_active,
        (SELECT COUNT(*) FROM niggle_recovery nr
          WHERE nr.niggle_id = n.id)::int                                   AS check_in_count,
        acwr_w.acwr                                                          AS acwr_at_log
      FROM niggles n
      LEFT JOIN LATERAL (
        SELECT ROUND(
          SUM(CASE WHEN d >= n.logged_at::date - 6 THEN mi ELSE 0 END) * 4.0 /
          NULLIF(SUM(mi), 0.0),
          2
        ) AS acwr
        FROM (
          SELECT (data->>'date')::date                    AS d,
                 MAX((data->>'distanceMi')::numeric)      AS mi
            FROM runs
           WHERE user_uuid = $1::uuid
             AND NOT (data ? 'mergedIntoId')
             AND (data->>'date')::date
                   BETWEEN n.logged_at::date - 27
                       AND n.logged_at::date
           GROUP BY 1
        ) sub
      ) acwr_w ON true
      WHERE COALESCE(n.user_uuid, n.user_id) = $1
      ORDER BY n.logged_at DESC`,
      [userId],
    );

    // ── 3. Recovery trend per episode (batch) ────────────────────────────
    const episodeIds = episodesRes.rows.map(r => Number(r.id));
    const trendMap = new Map<number, RecoveryEntry[]>();

    if (episodeIds.length > 0) {
      const trendRes = await pool.query<{
        niggle_id: string;
        response: string;
        logged_at: Date;
      }>(
        `SELECT niggle_id, response, logged_at
         FROM niggle_recovery
         WHERE niggle_id = ANY($1)
         ORDER BY niggle_id, logged_at ASC`,
        [episodeIds],
      );
      for (const row of trendRes.rows) {
        const key = Number(row.niggle_id);
        if (!trendMap.has(key)) trendMap.set(key, []);
        trendMap.get(key)!.push({
          response: row.response as RecoveryEntry['response'],
          logged_at: new Date(row.logged_at).toISOString(),
        });
      }
    }

    // ── 4. Shape episodes ────────────────────────────────────────────────
    const episodes: EpisodeRow[] = episodesRes.rows.map(r => ({
      id: Number(r.id),
      body_part: r.body_part,
      side: r.side,
      severity: Number(r.severity),
      status: r.status as EpisodeRow['status'],
      note: r.note,
      logged_at: new Date(r.logged_at).toISOString(),
      cleared_at: r.cleared_at ? new Date(r.cleared_at).toISOString() : null,
      days_active: Number(r.days_active),
      check_in_count: Number(r.check_in_count),
      recovery_trend: trendMap.get(Number(r.id)) ?? [],
      acwr_at_log: r.acwr_at_log !== null ? Number(r.acwr_at_log) : null,
    }));

    // ── 5. Summary with recurrence counts ───────────────────────────────
    // Count how many episodes of each (body_part, side) fell in the 60 days
    // before last_flare_at. Consumers show "Flared X times recently" when
    // recent_flare_count >= 2. Window is anchored at last_flare_at (not
    // today) so the count is stable regardless of when the page loads.
    const summary: BodyPartSummary[] = summaryRes.rows.map(r => {
      const lastFlareMs = new Date(r.last_flare_at).getTime();
      const cutoffMs = lastFlareMs - SIXTY_DAYS_MS;
      const recent_flare_count = episodes.filter(
        e =>
          e.body_part === r.body_part &&
          e.side === r.side &&
          new Date(e.logged_at).getTime() >= cutoffMs,
      ).length;
      return {
        body_part: r.body_part,
        side: r.side,
        total_episodes: Number(r.total_episodes),
        last_flare_at: new Date(r.last_flare_at).toISOString(),
        avg_severity: Number(r.avg_severity),
        avg_days_active: Number(r.avg_days_active),
        days_since_last_flare: Number(r.days_since_last_flare),
        recent_flare_count,
      };
    });

    return NextResponse.json({ summary, episodes });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'niggle history failed', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
