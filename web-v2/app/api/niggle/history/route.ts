/**
 * GET /api/niggle/history
 *
 * Returns the full niggle log for the authenticated user — two shapes:
 *   summary  · one row per (body_part, side) combination with aggregate stats
 *   episodes · every niggle row, newest first, with its recovery trend inline
 *
 * Phase 1 — no training-load join. Phase 2 will add ACWR at logged_at.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export interface BodyPartSummary {
  body_part: string;
  side: string | null;
  total_episodes: number;
  last_flare_at: string;          // ISO timestamp
  avg_severity: number;
  avg_days_active: number;
  days_since_last_flare: number;  // floor of days
}

export interface RecoveryEntry {
  response: 'better' | 'same' | 'worse' | 'gone';
  logged_at: string;              // ISO timestamp
}

export interface EpisodeRow {
  id: number;
  body_part: string;
  side: string | null;
  severity: number;
  status: 'just_started' | 'few_days' | 'weeks';
  note: string | null;
  logged_at: string;
  cleared_at: string | null;      // null = still active
  days_active: number;
  check_in_count: number;
  recovery_trend: RecoveryEntry[];
}

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

    // ── 2. Full episode list ─────────────────────────────────────────────
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
          WHERE nr.niggle_id = n.id)::int                                   AS check_in_count
      FROM niggles n
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

    // ── 4. Shape response ────────────────────────────────────────────────
    const summary: BodyPartSummary[] = summaryRes.rows.map(r => ({
      body_part: r.body_part,
      side: r.side,
      total_episodes: Number(r.total_episodes),
      last_flare_at: new Date(r.last_flare_at).toISOString(),
      avg_severity: Number(r.avg_severity),
      avg_days_active: Number(r.avg_days_active),
      days_since_last_flare: Number(r.days_since_last_flare),
    }));

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
    }));

    return NextResponse.json({ summary, episodes });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'niggle history failed', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
