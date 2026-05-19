/**
 * POST /api/admin/seed-orphan-races
 *
 * One-shot admin endpoint that creates curated races rows for the
 * two orphans identified by the audit:
 *
 *   1. LA Marathon 2026-03-08 — Strava has 3:30:25; David's chip
 *      time is 3:31:40 (12700s). Creates a curated entry so
 *      compute-vdot (post-Option-B) prefers the chip time.
 *
 *   2. Disney Half Marathon ("Powered by the Mouse") 2026-02-01 —
 *      Strava has 1:34:54 (5694s) which matches the chip time.
 *      Creates the curated entry so it's no longer an orphan
 *      (matters because Option-B compute-vdot reads races first).
 *
 * Also flips Big Sur Marathon (2026-04-26) and Sombrero Half
 * (2026-05-03) from source='strava' to source='manual' to mark
 * them user-confirmed — David confirmed the auto-imported values
 * (3:36:55 and 1:40:57 respectively) are correct chip times.
 *
 * The races table requires NOT NULL plan + gpx_text. We insert
 * minimal placeholders for the orphan races (empty plan JSONB,
 * empty gpx_text). The /races UI may not render their detail pages
 * meaningfully, but compute-vdot only reads actual_result, which
 * is what we care about. Future: full race plans can be added via
 * the UI without losing the actual_result.
 *
 * Idempotent: ON CONFLICT (slug) updates actual_result only,
 * leaves plan/gpx_text alone so subsequent UI-side race creation
 * doesn't get overwritten.
 *
 * Admin-only. POST with no body. Returns the slugs that were
 * inserted or updated.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

interface OrphanSeed {
  slug: string;
  name: string;
  date: string;            // ISO YYYY-MM-DD
  distanceMi: number;
  finishS: number;
  stravaActivityId: number;
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

/** The two orphans + their corrected chip times. */
const ORPHAN_SEEDS: OrphanSeed[] = [
  {
    slug: 'la-marathon-2026',
    name: 'LA Marathon',
    date: '2026-03-08',
    distanceMi: 26.219,
    finishS: 12700,                // 3:31:40 chip — supersedes Strava's 3:30:25
    stravaActivityId: 17654375467,
  },
  {
    slug: 'disney-half-2026',
    name: 'Disney Half Marathon',
    date: '2026-02-01',
    distanceMi: 13.109,
    finishS: 5694,                 // 1:34:54 chip — matches Strava
    stravaActivityId: 17250968534,
  },
];

/** Existing races where Strava auto-import value is the confirmed
 *  chip time — just flip source to 'manual' to mark as user-verified. */
const CONFIRM_SOURCES: string[] = ['big-sur-marathon', 'sombrero-half'];

export async function POST() {
  const admin = await requireAdmin();
  const userId = admin.id;
  const nowIso = new Date().toISOString();

  const inserted: string[] = [];
  const updated:  string[] = [];
  const confirmed: string[] = [];

  // ── 1. Seed the two orphans with curated actual_result ───────
  for (const seed of ORPHAN_SEEDS) {
    const paceSPerMi = seed.finishS / seed.distanceMi;
    const actualResult = {
      finishS: seed.finishS,
      finishDisplay: fmtFinish(seed.finishS),
      paceSPerMi: Math.round(paceSPerMi),
      paceDisplay: fmtPace(paceSPerMi),
      recordedAt: nowIso,
      source: 'manual' as const,
      stravaActivityId: seed.stravaActivityId,
    };

    // Placeholder plan + gpx so the NOT NULL constraints pass.
    // /races UI will render a degraded card for these (no plan,
    // no course profile), but compute-vdot reads actual_result and
    // doesn't care about plan/gpx.
    const planPlaceholder = {
      meta: {
        name: seed.name,
        date: seed.date,
        distanceMi: seed.distanceMi,
        goalDisplay: actualResult.finishDisplay,
        courseSlug: seed.slug,
      },
      miles: [],
      segments: [],
    };
    const metaPlaceholder = {
      name: seed.name,
      date: seed.date,
      distanceMi: seed.distanceMi,
      goalDisplay: actualResult.finishDisplay,
      courseSlug: seed.slug,
      priority: 'B' as const,  // past race, not the macrocycle target
    };

    const existing = await query<{ slug: string }>(
      `SELECT slug FROM races WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL) LIMIT 1`,
      [seed.slug, userId],
    );

    if (existing.length === 0) {
      // INSERT new row
      await query(
        `INSERT INTO races (slug, plan, gpx_text, meta, actual_result, user_uuid, saved_at)
         VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6, NOW())`,
        [
          seed.slug,
          JSON.stringify(planPlaceholder),
          '',                                  // empty gpx_text placeholder
          JSON.stringify(metaPlaceholder),
          JSON.stringify(actualResult),
          userId,
        ],
      );
      inserted.push(seed.slug);
    } else {
      // UPDATE actual_result only — leave plan/gpx alone for any
      // existing UI-side data.
      await query(
        `UPDATE races
            SET actual_result = $1::jsonb
          WHERE slug = $2 AND (user_uuid = $3 OR user_uuid IS NULL)`,
        [JSON.stringify(actualResult), seed.slug, userId],
      );
      updated.push(seed.slug);
    }
  }

  // ── 2. Mark the two confirmed strava-auto entries as 'manual' ──
  for (const slug of CONFIRM_SOURCES) {
    const rows = await query<{ slug: string; actual_result: Record<string, unknown> | null }>(
      `SELECT slug, actual_result FROM races WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL) LIMIT 1`,
      [slug, userId],
    );
    const existing = rows[0];
    if (!existing || !existing.actual_result) continue;
    const newResult = { ...existing.actual_result, source: 'manual' };
    await query(
      `UPDATE races SET actual_result = $1::jsonb WHERE slug = $2 AND (user_uuid = $3 OR user_uuid IS NULL)`,
      [JSON.stringify(newResult), slug, userId],
    );
    confirmed.push(slug);
  }

  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    confirmed,
    summary: `${inserted.length} new race(s) created, ${updated.length} updated, ${confirmed.length} marked user-confirmed.`,
    note: 'Re-run /api/admin/audit-races to verify the curation status flipped to manual-curated.',
  });
}
