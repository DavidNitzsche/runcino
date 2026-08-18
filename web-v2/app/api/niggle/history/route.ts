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
 *   ACWR       — resolved in TS against lib/coach/acwr.ts, per episode, at the
 *                date that episode was logged. See the 2026-08-17 note below.
 *   Recurrence — JS post-processing counts episodes per (body_part, side)
 *                within the 60 days before last_flare_at.
 *
 * 2026-08-17 COLD-3 · the ACWR used to be a LEFT JOIN LATERAL firing one
 * 28-day mileage scan per episode, with no coverage guard at all — the fifth
 * and last of five hand-rolled copies of the ratio. A niggle logged in a
 * runner's first fortnight got the cold-start identity (both legs sum the same
 * runs, so the ratio is the constant 28/7 = 4.00), and HealthView rendered
 * "Logged during a loaded week (ACWR 4.00)" against it — the app telling a new
 * runner their injury was their own fault, off a number that could not have
 * come out any other way. Now: one mileage read for the whole history, one
 * first-run date, and the shared pure function applied per episode date, so a
 * historical ACWR answers to exactly the same coverage rule as today's.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { acwrFromDailyMileage, ACWR_CHRONIC_DAYS } from '@/lib/coach/acwr';
import { coverageDaysFrom, firstRunISO, isoDaysBefore, mileageByDay } from '@/lib/runs/volume';

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

    // ── 2b. ACWR at each episode's log date ──────────────────────────────
    // One mileage read spanning every episode's chronic window, one first-run
    // date, then the shared pure ratio per episode. Absent (null) whenever the
    // account had less than a full chronic window of history at that date —
    // see the COLD-3 note in the file docblock.
    const episodeDates = episodesRes.rows.map((r) => new Date(r.logged_at).toISOString().slice(0, 10));
    const acwrByEpisode = new Map<string, number | null>();
    if (episodeDates.length > 0) {
      const newest = episodeDates.reduce((a, b) => (a > b ? a : b));
      const oldest = episodeDates.reduce((a, b) => (a < b ? a : b));
      const [byDay, firstISO] = await Promise.all([
        mileageByDay(userId, isoDaysBefore(oldest, ACWR_CHRONIC_DAYS - 1), newest)
          .catch(() => new Map<string, { mi: number; canonicalIds: string[] }>()),
        firstRunISO(userId).catch(() => null),
      ]);
      const mi = new Map<string, number>();
      for (const [day, info] of byDay) mi.set(day, info.mi);
      for (const dateISO of episodeDates) {
        if (acwrByEpisode.has(dateISO)) continue;
        acwrByEpisode.set(
          dateISO,
          acwrFromDailyMileage(mi, dateISO, coverageDaysFrom(firstISO, dateISO, ACWR_CHRONIC_DAYS)).acwr,
        );
      }
    }

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
      acwr_at_log: acwrByEpisode.get(new Date(r.logged_at).toISOString().slice(0, 10)) ?? null,
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
