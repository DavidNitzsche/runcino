/**
 * POST /api/admin/race-updates-2026-05-19
 *
 * One-shot admin endpoint for the race-table edits David authorized
 * on the night of 2026-05-19:
 *
 *   1. Reset priorities to reflect actual race-effort intent:
 *      - la-marathon-2026:   priority='A'  (was 'B' default)
 *      - big-sur-marathon:   priority='A'  (was 'A' display, normalize)
 *      - disney-half-2026:   priority='A'  (was 'B' default)
 *      - sombrero-half:      priority='C'  (was 'B' default, David
 *                                          ran it as a tune-up,
 *                                          not an A-race effort)
 *
 *   2. Create rose-bowl-half-2026 from the matching Strava activity.
 *      Looks for a race-distance Strava activity around 2026-01-18
 *      ±3 days, distance 12.5-13.7 mi (half marathon ±5%). If
 *      multiple match, picks the one closest in date to 2026-01-18.
 *      Seeds with finishS from canonicalFinishS / movingTimeS,
 *      priority='A', source='manual'.
 *
 * Idempotent. POST with no body. Admin-only.
 *
 * After this runs:
 *   - Disney HM + LA Marathon + Big Sur + Rose Bowl all show 'A' on
 *     /races (orange A pip in Recent Races)
 *   - Sombrero shows 'C'
 *   - Aggregate VDOT shifts: Sombrero now C-tier, won't qualify for
 *     full goal-tier exemption in cycle-aware compute (depending on
 *     whether tier matching honors priority, verify after run).
 *   - Rose Bowl Half is in the curated table; compute-vdot can use
 *     it on next refresh.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

interface StravaRaceCandidate {
  id: string;
  date: string;
  name: string;
  distance_mi: number;
  canonical_finish_s: number | null;
  moving_time_s: number;
  avg_hr: number | null;
}

function fmtFinish(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtPace(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

export async function POST() {
  const admin = await requireAdmin();
  const userId = admin.id;

  const updated: Array<{ slug: string; priority: 'A' | 'B' | 'C'; status: 'ok' | 'not_found' }> = [];
  const created: Array<{ slug: string; name: string; finishS: number; finishDisplay: string; stravaActivityId: number }> = [];
  const notes: string[] = [];

  // ── 1. Priority updates ──────────────────────────────────────
  const priorityUpdates: Array<{ slug: string; priority: 'A' | 'B' | 'C' }> = [
    { slug: 'la-marathon-2026',  priority: 'A' },
    { slug: 'big-sur-marathon',  priority: 'A' },
    { slug: 'disney-half-2026',  priority: 'A' },
    { slug: 'sombrero-half',     priority: 'C' },
  ];

  for (const u of priorityUpdates) {
    // Read the existing meta, set priority, write back.
    const rows = await query<{ meta: Record<string, unknown> | null }>(
      `SELECT meta FROM races WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL) LIMIT 1`,
      [u.slug, userId],
    );
    const existing = rows[0];
    if (!existing) {
      updated.push({ slug: u.slug, priority: u.priority, status: 'not_found' });
      continue;
    }
    const newMeta = { ...(existing.meta ?? {}), priority: u.priority };
    await query(
      `UPDATE races SET meta = $1::jsonb WHERE slug = $2 AND (user_uuid = $3 OR user_uuid IS NULL)`,
      [JSON.stringify(newMeta), u.slug, userId],
    );
    updated.push({ slug: u.slug, priority: u.priority, status: 'ok' });
  }

  // ── 2. Find Rose Bowl Half in Strava and seed it ─────────────
  const ROSE_BOWL_SLUG = 'rose-bowl-half-2026';
  const existingRose = await query<{ slug: string }>(
    `SELECT slug FROM races WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL) LIMIT 1`,
    [ROSE_BOWL_SLUG, userId],
  );

  if (existingRose.length > 0) {
    notes.push('rose-bowl-half-2026 already exists; skipped creation. To update its actual_result, use seed-orphan-races.');
  } else {
    // Search Strava activities ±5 days around 2026-01-18 with half-
    // marathon distance (12.5-13.7 mi → ±5% of 13.109).
    const candidates = await query<StravaRaceCandidate>(
      `SELECT
          id::text                                  AS id,
          data->>'date'                             AS date,
          COALESCE(data->>'name', '')               AS name,
          (data->>'distanceMi')::NUMERIC            AS distance_mi,
          (data->>'canonicalFinishS')::NUMERIC      AS canonical_finish_s,
          (data->>'movingTimeS')::NUMERIC           AS moving_time_s,
          (data->>'avgHr')::NUMERIC                 AS avg_hr
         FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND (data->>'date') BETWEEN '2026-01-13' AND '2026-01-23'
          AND (data->>'distanceMi')::NUMERIC BETWEEN 12.5 AND 13.7
          AND (data->>'movingTimeS')::NUMERIC > 0
        ORDER BY ABS((data->>'date')::DATE - DATE '2026-01-18') ASC
        LIMIT 5`,
      [userId],
    );

    if (candidates.length === 0) {
      notes.push('No Strava activity matched Rose Bowl criteria (Jan 13-23, 12.5-13.7 mi). Manual create needed.');
    } else {
      // Pick the closest to Jan 18. The query already sorted by date proximity.
      const pick = candidates[0];
      const finishS = pick.canonical_finish_s ?? Number(pick.moving_time_s);
      const distMi = 13.109;  // canonical HM
      const paceSPerMi = finishS / distMi;

      const actualResult = {
        finishS: Math.round(finishS),
        finishDisplay: fmtFinish(Math.round(finishS)),
        paceSPerMi: Math.round(paceSPerMi),
        paceDisplay: fmtPace(paceSPerMi),
        recordedAt: new Date().toISOString(),
        source: 'manual' as const,
        stravaActivityId: Number(pick.id),
        avgHr: pick.avg_hr != null ? Math.round(Number(pick.avg_hr)) : null,
      };

      const planPlaceholder = {
        meta: {
          name: 'Rose Bowl Half',
          date: pick.date,
          distanceMi: distMi,
          goalDisplay: actualResult.finishDisplay,
          courseSlug: ROSE_BOWL_SLUG,
        },
        miles: [],
        segments: [],
      };
      const metaPlaceholder = {
        name: 'Rose Bowl Half',
        date: pick.date,
        distanceMi: distMi,
        goalDisplay: actualResult.finishDisplay,
        courseSlug: ROSE_BOWL_SLUG,
        priority: 'A' as const,
      };

      await query(
        `INSERT INTO races (slug, plan, gpx_text, meta, actual_result, user_uuid, saved_at)
         VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6, NOW())`,
        [
          ROSE_BOWL_SLUG,
          JSON.stringify(planPlaceholder),
          '',
          JSON.stringify(metaPlaceholder),
          JSON.stringify(actualResult),
          userId,
        ],
      );

      created.push({
        slug: ROSE_BOWL_SLUG,
        name: pick.name || 'Rose Bowl Half',
        finishS: Math.round(finishS),
        finishDisplay: actualResult.finishDisplay,
        stravaActivityId: Number(pick.id),
      });

      if (candidates.length > 1) {
        notes.push(`${candidates.length} Strava activities matched the Rose Bowl criteria; picked the one closest to Jan 18. Other matches: ${candidates.slice(1).map((c) => `${c.id} (${c.date}, ${Number(c.distance_mi).toFixed(2)}mi)`).join(', ')}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    created,
    notes,
    nextSteps: [
      'Re-hit /api/admin/audit-races to verify race list',
      'Re-hit /races on the app to see priorities reflected',
      'Aggregate VDOT will reflect the new priorities on next Coach Reads load (note: current compute-vdot does not honor priority for tier matching, tomorrow ticket)',
    ],
  });
}
