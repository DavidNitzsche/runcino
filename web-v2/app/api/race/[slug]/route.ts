/**
 * GET /api/race/[slug]
 *
 * P40 — JSON race detail for the iPhone RaceDetailSheet. Mirrors what
 * web /races/[slug] composes server-side: race meta + course geometry +
 * derived proximity mode.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { loadRacesState } from '@/lib/coach/races-state';
import { requireUserId } from '@/lib/auth/session';
import { parseRaceTime } from '@/lib/training/vdot';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;
  try {
    const races = await loadRacesState(userId);
    const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past]
      .find((r: any) => r?.slug === slug);
    if (!race) return NextResponse.json({ error: 'race not found' }, { status: 404 });

    // Scope course-geometry lookup by user_uuid so a slug guess can't leak
    // another runner's GPX even if a name collision would otherwise match.
    const geoRow = await pool.query(
      `SELECT course_geometry, course_source FROM races WHERE slug = $1 AND user_uuid = $2`,
      [slug, userId],
    ).catch(() => ({ rows: [] }));
    const courseGeometry = geoRow.rows[0]?.course_geometry ?? null;
    const courseSource = geoRow.rows[0]?.course_source ?? null;

    // Course-library provenance (2026-05-30 audit) — when the course came
    // from the shared library, surface `source` + `contributor_count` so
    // the iPhone can render "Crowd-sourced by N runners" on the race page.
    // 2026-06-09 · also pull geometry_json — the authored phase profile
    // feeds the course-aware goal splits below (race-killer F3).
    const libRow = await pool.query(
      `SELECT source, contributor_count, geometry_json FROM course_library WHERE slug = $1`,
      [slug],
    ).catch(() => ({ rows: [] }));
    const courseLibrary = libRow.rows[0] ? {
      source: libRow.rows[0].source ?? null,
      contributor_count: Number(libRow.rows[0].contributor_count ?? 0),
    } : null;

    // 2026-06-09 · race-killer F3 — course-aware goal splits. The splits
    // cards used to interpolate the goal linearly (flat-course splits on
    // every course). Distribute the goal over the authored phase profile
    // instead; degrades to the same linear ladder when no usable phases.
    // The goal string parses via the shared parser ("1:30" → 5400, not 90
    // — race-killer F2). Library phases win over user GPX geometry: the
    // library carries authored grade phases, GPX rarely does.
    let pacing = null;
    try {
      const goalSec = parseRaceTime((race as { goal?: string | null }).goal);
      const distanceMi = Number((race as { distance_mi?: number | null }).distance_mi);
      if (goalSec && distanceMi > 0) {
        pacing = buildRacePacing({
          goalSec,
          distanceMi,
          geometry: (libRow.rows[0]?.geometry_json ?? courseGeometry) as CourseGeometryInput | null,
        });
      }
    } catch { /* pacing is additive — never fail the detail over it */ }

    const proximity = (race as any).days < 0 ? 'post-race'
      : (race as any).days <= 7 ? 'race-week'
      : (race as any).days <= 60 ? 'sharpening'
      : 'building';

    return NextResponse.json({
      race,
      proximity,
      course_geometry: courseGeometry,
      course_source: courseSource,
      course_library: courseLibrary,
      pacing,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/race/[slug] · goal renegotiation (Phase 2.4).
 *
 * Body: { goalSec: number, source?: 'renegotiate' | 'manual' }
 *
 * Accepts a new goal time, updates races.plan.goal.finish_time_s +
 * meta.goalDisplay, audits the change, busts the briefing cache, and
 * fires an auto-rebuild (plan needs new pace targets at the new goal).
 *
 * Engine NEVER picks the new goal · the runner chose it from the gap
 * report's A/B/C alternatives. PATCH is the seam where the runner's
 * choice becomes durable state.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.4
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const goalSec = Number(body.goalSec);
  if (!Number.isFinite(goalSec) || goalSec < 600 || goalSec > 21600) {
    return NextResponse.json(
      { error: 'goalSec required · must be 600 (10min) to 21600 (6h)' },
      { status: 400 },
    );
  }
  const source = (body.source === 'renegotiate' ? 'renegotiate' : 'manual') as 'renegotiate' | 'manual';

  // Format new display
  const h = Math.floor(goalSec / 3600);
  const m = Math.floor((goalSec % 3600) / 60);
  const s = goalSec % 60;
  const goalDisplay = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  // Load current race for audit · then update both meta + plan.goal
  const current = (await pool.query<{ meta: any; plan: any }>(
    `SELECT meta, plan FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
    [userId, slug],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!current) return NextResponse.json({ error: 'race not found' }, { status: 404 });

  const oldGoalSec = Number(current.plan?.goal?.finish_time_s ?? 0);
  const newMeta = { ...current.meta, goalDisplay };
  const newPlan = {
    ...current.plan,
    goal: {
      ...current.plan?.goal,
      finish_time_s: goalSec,
      finish_time_display: goalDisplay,
    },
  };

  await pool.query(
    `UPDATE races SET meta = $1::jsonb, plan = $2::jsonb
      WHERE user_uuid = $3::uuid AND slug = $4`,
    [JSON.stringify(newMeta), JSON.stringify(newPlan), userId, slug],
  );

  // Audit the change
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     VALUES ($1::uuid, $1::uuid, NOW(), 'goal_renegotiated', $2, $3::jsonb)`,
    [
      userId, slug,
      JSON.stringify({
        old_goal_sec: oldGoalSec,
        new_goal_sec: goalSec,
        old_display: current.meta?.goalDisplay ?? null,
        new_display: goalDisplay,
        source,
        citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.4',
      }),
    ],
  ).catch(() => {/* audit failure shouldn't block */});

  // Fire auto-rebuild · paces shift at the new goal
  try {
    const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
    await fireAutoRebuild({
      userUuid: userId,
      raceSlug: slug,
      kind: 'goal_time_changed',
      reasons: {
        drift_kind: 'goal_renegotiated',
        old_goal_sec: oldGoalSec,
        new_goal_sec: goalSec,
        source,
      },
      source: 'goal_renegotiation',
    });
  } catch (e) {
    console.error('[race goal renegotiate] auto-rebuild failed:', e);
  }

  // Bust briefing cache
  try {
    const { bustBriefingCacheForEvent } = await import('@/lib/coach/cache');
    await bustBriefingCacheForEvent(userId, 'plan_swap');
  } catch {/* non-blocking */}

  return NextResponse.json({
    ok: true,
    goalSec,
    goalDisplay,
    oldGoalSec,
    rebuildTriggered: true,
  });
}
